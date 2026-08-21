# uptime-monitor

A small script + systemd user timer that checks SkillStreak's real,
public production endpoints (`skillstreak.xyz`, `api.skillstreak.xyz`,
`try.skillstreak.xyz`) every couple of minutes and emails you when one of
them goes down or comes back up.

This is `docs/PROJECT.md` Fas 4, point 7: "24/7 drifts-/hälsoövervakning
... Börja med en enkel schemalagd hälsokontroll, inte den större
'AI-driven'-idén" — deliberately the simplest thing that's still real
monitoring (alerts on a state *change*), not the bigger dashboard/AI idea
tracked separately in `docs/internal/BACKLOG.md`.

Not part of the SkillStreak product itself — a standalone local-dev/ops
tool, same posture as `tools/local-release-poller/` and `tools/lab-access/`
in this same directory. Deliberately runs from an independent machine
(ubuntu01), not from inside the production cluster itself — a checker
running inside the thing it's checking can't be trusted to notice or
report a networking-level failure of that same cluster.

## What it actually does

`check-health.sh`, once per run:
1. Requests each of the four production URLs (`https://api.skillstreak.xyz
   /health`, `https://skillstreak.xyz/`, `https://skillstreak.xyz/i18n.js`,
   `https://try.skillstreak.xyz/`), with a 10s timeout. Three of the four
   also confirm the response *body*, not just a 2xx status code — the API
   must contain `"status":"ok"`, the site must contain `id="topnav"`, and
   `i18n.js` must contain `lang-switch`.

   The body checks on the site exist because of 2026-08-21, when the
   marketing page's config `<script>` was a syntax error and `/i18n.js` had
   been 404ing for as long as the page existed — no language switcher, no
   English, and every API call the page made going to `undefined/...`. The
   homepage answered 200 throughout. A status-code check would have
   reported "up" for the entire outage, which is the failure mode this tool
   exists to prevent.
2. Compares each target's result to its last known status (tracked per
   target in `~/.local/state/skillstreak-uptime/<name>.state`).
3. **Only sends an email on a state change** — healthy → down, or
   down → recovered — never on every tick. A prolonged real outage sends
   one "down" email, then stays silent (no repeat-reminder yet — a
   reasonable future enhancement, deliberately not built now to keep this
   the "simple" version) until it recovers, then sends one "recovered"
   email.
4. Always logs a line per target either way — `journalctl` shows a full
   history even when nothing changed.

If `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`ALERT_TO` aren't all set (see
`.env.example`), the checks still run and log normally — alert emails are
just skipped, with a line in the log saying so. This means installing the
timer before configuring email is safe; you just won't be notified yet.

## Setup

```bash
cd tools/uptime-monitor
cp .env.example .env
# edit .env — reuse the same SMTP_USER/SMTP_PASSWORD as production's
# k8s/secret.yaml.example (the backend's own already-verified Google
# Workspace relay), and set ALERT_TO to your own inbox.
```

## Installing the timer (user-level, no root needed)

Same mechanism as `tools/local-release-poller/` — see that tool's README
for the full explanation of why this is a user-level unit and the
one-time `loginctl enable-linger` step it needs to survive logout/reboot;
not repeated here.

```bash
mkdir -p ~/.config/systemd/user
ln -sf ~/SkillStreak/tools/uptime-monitor/skillstreak-uptime.service ~/.config/systemd/user/
ln -sf ~/SkillStreak/tools/uptime-monitor/skillstreak-uptime.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now skillstreak-uptime.timer
```

Check it's running and see recent output:

```bash
systemctl --user status skillstreak-uptime.timer
journalctl --user -u skillstreak-uptime.service -n 50 --no-pager
```

Run it once by hand to confirm it works (and to seed the initial
`ok`/`down` state for each target, so the very first run after install
never sends a spurious alert — there's no "previous status" to compare
against yet):

```bash
systemctl --user start skillstreak-uptime.service
```

## Uninstalling

```bash
systemctl --user disable --now skillstreak-uptime.timer
rm ~/.config/systemd/user/skillstreak-uptime.service ~/.config/systemd/user/skillstreak-uptime.timer
systemctl --user daemon-reload
rm -rf ~/.local/state/skillstreak-uptime
```

## Changing the check interval

Edit `OnUnitActiveSec=2min` in `skillstreak-uptime.timer`, then re-run the
symlink + `daemon-reload` + `enable --now` steps above (systemd doesn't
pick up unit file edits from a live symlink target automatically).

## Not built here, on purpose

Per the backlog item's own scope note ("not the bigger AI-driven idea")
and to avoid over-building a "simple" first version:
- No repeat-reminder while an outage is ongoing (one email at the start,
  one at recovery).
- No Postgres/Redis/MinIO connectivity check — `GET /health` is a
  liveness check only (`backend/src/health/health.controller.ts`), so
  this tool can't currently distinguish "API process down" from "API up
  but its database is unreachable." Extending `/health` itself to check
  datastore connectivity would be a reasonable, separate follow-up.
- No dashboard, no historical uptime graph, no multi-channel alerting
  (SMS/Slack/etc.) — just email, matching every other outbound
  notification this app already sends.
- No check of the internal test cluster (`ubuntu01` itself,
  `192.168.55.x`) — it has no public DNS/TLS and wasn't what this backlog
  item was blocked on (see `docs/PROJECT.md`: unblocked specifically by
  *production's* DNS/TLS going live 2026-07-31).

The bigger "control monitoring web UI" idea (stats, error visibility,
social media campaign control, blog generation) is tracked separately in
`docs/internal/BACKLOG.md` as its own, much larger, not-yet-designed idea — this
tool is not a step toward that, just the small thing this backlog item
actually asked for.
