# local-release-poller

A small script + systemd user timer that watches for new SkillStreak
GitHub Releases and automatically redeploys the local microk8s test
cluster (namespace `skillstreak`) to whatever version it finds — the
"automatically download and test the new version locally" half of the
`prerelease` → `main` → auto-release pipeline (see the root
[`CLAUDE.md`](../../CLAUDE.md)'s "Git workflow rule" section for the full
chain: `prerelease` merges, then `main` merges trigger
`.github/workflows/ci-cd.yml`'s `release` job, which is what this tool
polls for).

Not part of the SkillStreak product itself — a standalone local-dev tool,
same posture as `tools/lab-access/`.

## What it actually does

`poll-and-deploy.sh`:
1. Asks GitHub's public REST API for this repo's latest release tag (no
   auth needed — GHCR packages and the releases API are both public here).
2. Compares it to the last version it successfully deployed (tracked in
   `~/.local/state/skillstreak-poller/current-version`).
3. If there's a newer one, runs `kubectl set image` on `deployment/api`
   and `deployment/site` in the `skillstreak` namespace to point at
   `ghcr.io/issen007/skillstreak-{api,site}:<new-version>`, then waits for
   the rollout.

It does **not** `docker pull` anything itself — pointing a Deployment at a
new image tag is enough; Kubernetes' own containerd on the node pulls it,
completely separately from this machine's own Docker daemon/image cache.

## Installing the timer (user-level, no root needed)

```bash
mkdir -p ~/.config/systemd/user
ln -sf ~/SkillStreak/tools/local-release-poller/skillstreak-poller.service ~/.config/systemd/user/
ln -sf ~/SkillStreak/tools/local-release-poller/skillstreak-poller.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now skillstreak-poller.timer
```

Check it's running and see recent output:

```bash
systemctl --user status skillstreak-poller.timer
journalctl --user -u skillstreak-poller.service -n 50 --no-pager
```

Run it once by hand instead of waiting for the timer (e.g. right after a
merge to `main`, to see it work immediately):

```bash
systemctl --user start skillstreak-poller.service
```

## The one caveat: user services need a lingering session

This is a **user-level** systemd unit (`systemctl --user`), not a
system-level one, because installing into `/etc/systemd/system/` needs
root and this account doesn't have passwordless `sudo`. User-level units
only keep running while the user has an active session, *unless* lingering
is enabled for the account — which lets `chrisp`'s user services keep
running across logout/reboot. Enable it once, with sudo:

```bash
sudo loginctl enable-linger chrisp
```

Without that, the poller will stop between logins and the "always on"
half of this only holds while someone's actually logged into this
machine. Confirm it's on:

```bash
loginctl show-user chrisp | grep Linger
```

## Uninstalling

```bash
systemctl --user disable --now skillstreak-poller.timer
rm ~/.config/systemd/user/skillstreak-poller.service ~/.config/systemd/user/skillstreak-poller.timer
systemctl --user daemon-reload
rm -rf ~/.local/state/skillstreak-poller
```

## Changing the poll interval

Edit `OnUnitActiveSec=5min` in `skillstreak-poller.timer`, then re-run the
symlink + `daemon-reload` + `enable --now` steps above (systemd doesn't
pick up unit file edits from a live symlink target automatically — a
`daemon-reload` is what re-reads it).
