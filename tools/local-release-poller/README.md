# local-release-poller

A small script + systemd user timer that watches for new commits on the
SkillStreak `prerelease` branch and automatically redeploys the local
microk8s test cluster (namespace `skillstreak`, on this machine — ubuntu01,
`192.168.55.x`, no public DNS/TLS) to whatever it finds. This cluster is
the **internal test environment** and only ever tracks `prerelease` — the
public isstech-2 cluster is the opposite, only ever running what's built
from `main` (see the root [`CLAUDE.md`](../../CLAUDE.md)'s "Git workflow
rule" section for the full branch split).

Not part of the SkillStreak product itself — a standalone local-dev tool,
same posture as `tools/lab-access/`.

## What it actually does

`poll-and-deploy.sh`:
1. Asks GitHub's public REST API for the latest commit SHA on `prerelease`
   (no auth needed — GHCR packages and this API are both public here).
2. Compares it to the last commit it successfully deployed (tracked in
   `~/.local/state/skillstreak-poller/current-sha`).
3. If there's a newer one, confirms both images actually exist on GHCR yet
   (`.github/workflows/ci-cd.yml`'s `internal-images` job — the only job
   that pushes `prerelease-<sha>`-tagged images — takes a couple of
   minutes after the commit lands; this just quietly retries next tick
   rather than failing loudly if it's still running), then runs
   `kubectl set image` on `deployment/api` and `deployment/site` in the
   `skillstreak` namespace to point at
   `ghcr.io/issen007/skillstreak-{api,site}:prerelease-<sha>`, and waits
   for the rollout.

Unlike the api image, the site image isn't interchangeable with what the
public cluster runs — it bakes in `192.168.55.71`/`192.168.55.72` (this
cluster's own metallb LoadBalancer IPs) at Docker build time instead of
`skillstreak.xyz`, per `internal-images`' own build-args. That's the whole
reason this tool tracks a separate `prerelease-<sha>` tag rather than
reusing whatever `main`'s pipeline already publishes.

It does **not** `docker pull` anything itself to actually run the new
images — pointing a Deployment at a new image tag is enough; Kubernetes'
own containerd on the node pulls it, completely separately from this
machine's own Docker daemon/image cache. It does use this machine's Docker
daemon for the lightweight `docker manifest inspect` existence check in
step 3 above, which doesn't pull image layers.

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
merge to `prerelease`, to see it work immediately):

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
