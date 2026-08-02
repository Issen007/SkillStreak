#!/usr/bin/env bash
# docs/PROJECT.md Fas 4, point 7 — "24/7 drifts-/hälsoövervakning... Börja
# med en enkel schemalagd hälsokontroll, inte den större 'AI-driven'-idén."
# Deliberately the smallest thing that's still real monitoring, not just
# logging: polls the production public endpoints, and emails on a state
# *change* (healthy -> down, or down -> recovered) — not on every single
# tick, so a real outage doesn't spam an inbox once every few minutes.
#
# Same posture as tools/local-release-poller/ in this same directory tree:
# a standalone script + systemd user timer meant to run on ubuntu01 (see
# that tool's README for the linger/install steps, which apply here
# unchanged) — not part of the SkillStreak product itself, and not
# in-cluster, deliberately: if the production cluster's networking itself
# is the problem, a checker running *inside* that cluster can't be trusted
# to notice or report it. Running from an independent machine is the point.
#
# Only checks production (skillstreak.xyz/api.skillstreak.xyz/
# try.skillstreak.xyz) — the internal test cluster (ubuntu01 itself,
# 192.168.55.x) has no public DNS/TLS and isn't what this backlog item
# was about (see docs/PROJECT.md: unblocked specifically by production's
# DNS/TLS going live 2026-07-31).
set -euo pipefail

STATE_DIR="${STATE_DIR:-$HOME/.local/state/skillstreak-uptime}"
CURL_TIMEOUT="10"

mkdir -p "$STATE_DIR"

# name|url|required-body-substring (empty = just check the status code)
TARGETS=(
  "api|https://api.skillstreak.xyz/health|\"status\":\"ok\""
  "site|https://skillstreak.xyz/|"
  "try-it|https://try.skillstreak.xyz/|"
)

send_alert() {
  local name="$1" new_status="$2" detail="$3"

  if [ -z "${SMTP_HOST:-}" ] || [ -z "${SMTP_USER:-}" ] || [ -z "${SMTP_PASSWORD:-}" ] || [ -z "${ALERT_TO:-}" ]; then
    echo "[${name}] status changed to ${new_status}, but SMTP_HOST/SMTP_USER/SMTP_PASSWORD/ALERT_TO aren't all set — skipping email, see tools/uptime-monitor/.env.example."
    return 0
  fi

  local subject
  if [ "$new_status" = "down" ]; then
    subject="[SkillStreak] ${name} is DOWN"
  else
    subject="[SkillStreak] ${name} recovered"
  fi

  # Same SMTP_HOST/PORT/USER/PASSWORD/FROM shape as k8s/configmap.yaml +
  # secret.yaml.example (the backend's own real, already-verified Google
  # Workspace relay) — reusing those exact env var names deliberately,
  # not inventing a second naming convention for the same kind of value.
  MAIL_SUBJECT="$subject" MAIL_BODY="$detail" python3 - "$SMTP_HOST" "${SMTP_PORT:-587}" "$SMTP_USER" "$SMTP_PASSWORD" "${SMTP_FROM:-$SMTP_USER}" "$ALERT_TO" <<'PY'
import os
import smtplib
import sys
from email.mime.text import MIMEText

host, port, user, password, mail_from, mail_to = sys.argv[1:7]
msg = MIMEText(os.environ["MAIL_BODY"])
msg["Subject"] = os.environ["MAIL_SUBJECT"]
msg["From"] = mail_from
msg["To"] = mail_to

with smtplib.SMTP(host, int(port), timeout=15) as smtp:
    smtp.starttls()
    smtp.login(user, password)
    smtp.sendmail(mail_from, [mail_to], msg.as_string())
PY
  echo "[${name}] alert email sent to ${ALERT_TO} (${subject})."
}

for target in "${TARGETS[@]}"; do
  IFS='|' read -r name url expect_body <<<"$target"
  state_file="${STATE_DIR}/${name}.state"
  previous_status="unknown"
  [ -f "$state_file" ] && previous_status="$(cat "$state_file")"

  body_file="$(mktemp)"
  http_code="$(curl -sS -L --max-time "$CURL_TIMEOUT" -o "$body_file" -w '%{http_code}' "$url" 2>/dev/null || echo "000")"

  current_status="down"
  detail="HTTP ${http_code}"
  if [ "$http_code" -ge 200 ] 2>/dev/null && [ "$http_code" -lt 400 ] 2>/dev/null; then
    if [ -z "$expect_body" ] || grep -qF "$expect_body" "$body_file"; then
      current_status="ok"
    else
      detail="HTTP ${http_code} but response body did not contain expected \"${expect_body}\""
    fi
  fi
  rm -f "$body_file"

  echo "[${name}] ${url} -> ${current_status} (${detail}); previous: ${previous_status}"

  if [ "$current_status" != "$previous_status" ] && [ "$previous_status" != "unknown" ]; then
    send_alert "$name" "$current_status" "${url} -> ${detail}"
  fi

  echo "$current_status" >"$state_file"
done

# Exit 0 regardless of target health — a target being down is an expected,
# handled outcome (that's what the alert above is for), not a bug in this
# script. Reserve a non-zero systemd-visible failure for the script itself
# breaking (e.g. can't write STATE_DIR), which `set -e` above already
# covers without needing an explicit exit code here.
exit 0
