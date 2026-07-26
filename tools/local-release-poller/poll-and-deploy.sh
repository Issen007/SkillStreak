#!/usr/bin/env bash
# Polls GitHub for the latest SkillStreak release and, if it's newer than
# what's currently deployed, updates the local microk8s cluster's api/site
# Deployments to that version and waits for the rollout.
#
# Deliberately does NOT `docker pull` anything itself — the images this
# updates the Deployments to point at live on GHCR (ghcr.io/issen007/
# skillstreak-{api,site}:vX.Y.Z, pushed by .github/workflows/ci-cd.yml's
# `release` job), and it's Kubernetes' own containerd on the node that
# actually pulls them once the Deployment's image field changes — this
# script's own `docker` daemon is a separate image store that has nothing
# to do with what the cluster runs. GHCR packages here are public, so no
# registry credentials are needed either.
#
# Run manually to test, or via the systemd timer in this same directory
# for the "always on, checks every few minutes" version (see this
# directory's README for install steps).
set -euo pipefail

REPO="Issen007/SkillStreak"
NAMESPACE="skillstreak"
STATE_DIR="${STATE_DIR:-$HOME/.local/state/skillstreak-poller}"
STATE_FILE="$STATE_DIR/current-version"
ROLLOUT_TIMEOUT="180s"

mkdir -p "$STATE_DIR"

current_version=""
if [ -f "$STATE_FILE" ]; then
  current_version="$(cat "$STATE_FILE")"
fi

# Deliberately NOT /releases/latest — that endpoint returns the most
# recently *created* release regardless of tag format, which found a
# stale, unrelated "0.0.1-alpha" release from mid-July (predates this
# versioning scheme entirely, and its images no longer exist on GHCR) the
# one time this ran before this fix landed, and tried to deploy it,
# confirmed live. Listing releases and filtering to this scheme's own
# vX.Y.Z tag shape, then taking the highest by version sort, is immune to
# any other release (past or future, this scheme's or not) ever being
# picked up by accident.
releases_json="$(curl -sf "https://api.github.com/repos/${REPO}/releases?per_page=100")" || {
  echo "Could not reach the GitHub releases API this run — will retry next tick."
  exit 0
}
latest_version="$(printf '%s' "$releases_json" | python3 -c "
import sys, json, re
releases = json.load(sys.stdin)
tags = [r['tag_name'] for r in releases if re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', r['tag_name'])]
def key(t):
    return tuple(int(p) for p in t[1:].split('.'))
print(max(tags, key=key) if tags else '')
")"

if [ -z "$latest_version" ]; then
  echo "No release matching this scheme's vX.Y.Z tag format found — nothing to do."
  exit 0
fi

if [ "$latest_version" = "$current_version" ]; then
  echo "Already at ${latest_version} — nothing to do."
  exit 0
fi

echo "New version detected: ${latest_version} (currently deployed: ${current_version:-none yet})"

api_image="ghcr.io/issen007/skillstreak-api:${latest_version}"
site_image="ghcr.io/issen007/skillstreak-site:${latest_version}"

echo "Updating deployment/api -> ${api_image}"
kubectl set image "deployment/api" "api=${api_image}" -n "$NAMESPACE"
echo "Updating deployment/site -> ${site_image}"
kubectl set image "deployment/site" "site=${site_image}" -n "$NAMESPACE"

echo "Waiting for rollout..."
kubectl rollout status "deployment/api" -n "$NAMESPACE" --timeout="$ROLLOUT_TIMEOUT"
kubectl rollout status "deployment/site" -n "$NAMESPACE" --timeout="$ROLLOUT_TIMEOUT"

echo "$latest_version" > "$STATE_FILE"
echo "Deployed ${latest_version} successfully."
