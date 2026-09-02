# local-release-poller

A small script + systemd user timer that watches for new commits on the
SkillStreak `review` branch and automatically redeploys the local
microk8s test cluster (namespace `skillstreak`, on this machine — ubuntu01,
`192.168.55.x`, no public DNS/TLS) to whatever it finds. This cluster is
the **internal test environment** and only ever tracks `review` — the
public isstech-2 cluster is the opposite, only ever running what's built
from `main` (see the root [`CLAUDE.md`](../../CLAUDE.md)'s "Git workflow
rule" section for the full branch split).

Not part of the SkillStreak product itself — a standalone local-dev tool,
same posture as `tools/lab-access/`.

## What it actually does

`poll-and-deploy.sh`:
1. Asks GitHub's public REST API for the latest commit SHA on `review`
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
REPO=~/Github/Other/SkillStreak     # wherever this checkout actually is
mkdir -p ~/.config/systemd/user
ln -sf "$REPO"/tools/local-release-poller/skillstreak-poller.service ~/.config/systemd/user/
ln -sf "$REPO"/tools/local-release-poller/skillstreak-poller.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now skillstreak-poller.timer
```

The unit's `ExecStart=` is an absolute path — systemd gives a unit no way
to find its own checkout — and it names `~/Github/Other/SkillStreak` on
ubuntu01. If yours is elsewhere, don't edit the committed unit; add a
drop-in, which is what ubuntu01 itself does:

```bash
systemctl --user edit skillstreak-poller.service
# then, in the editor:
#   [Service]
#   ExecStart=
#   ExecStart=/your/path/tools/local-release-poller/poll-and-deploy.sh
systemctl --user daemon-reload
```

The empty `ExecStart=` is required: without it systemd *appends* a second
command rather than replacing the first.

Check it's running and see recent output:

```bash
systemctl --user status skillstreak-poller.timer
journalctl --user -u skillstreak-poller.service -n 50 --no-pager
```

Run it once by hand instead of waiting for the timer (e.g. right after a
merge to `review`, to see it work immediately):

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

## Checking whether it is actually working

Added 2026-08-11, because this poller failed every five minutes for about
a week without anyone noticing — the old pod kept serving, so the cluster
looked alive while being eight days stale. The cause was
`STAFF_JWT_SECRET` becoming required while the internal cluster's
Deployment did not reference it, so every rollout timed out.

Two files in `~/.local/state/skillstreak-poller/` now make each run's
outcome durable:

- `current-sha` — the commit actually deployed. **This is the number that
  matters**: if it is behind `review`, the cluster is stale whatever the
  pods say.
- `last-status` — tab-separated `timestamp`, `ok|fail`, and a message.
- `consecutive-failures` — present only while failing; deleted on success.

```bash
cat ~/.local/state/skillstreak-poller/last-status
journalctl --user -u skillstreak-poller -p err --since '-1 day'
```

The `-p err` filter is the useful one: from three consecutive failures
(~15 minutes, past any plausible transient) the script logs at syslog
priority `err`, so that command stays empty until something is genuinely
wrong.

**Worth knowing about the failure this was built for.** `ubuntu01`'s
Kubernetes manifests are applied **by hand**, while production's are
applied by CI from GitHub Secrets. So every new required environment
variable drifts here first, and the symptom is always the same: a pod that
cannot boot, an old pod that keeps serving, and a green CI. When a rollout
fails, compare the Deployment's env against `k8s/api-deployment.yaml`
before looking anywhere else:

```bash
microk8s kubectl -n skillstreak get deploy api \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\n"}{end}' | sort
```

`tools/cluster-drift/check-drift.sh` does that comparison and more, and is
the faster first move:

```bash
KUBECTL='kubectl --context=microk8s' tools/cluster-drift/check-drift.sh
```

**This poller only ever patches an image tag.** It never applies a
manifest. So *any* field that changes in `k8s/` — a port, a probe, a
resource limit — reaches production via CI and reaches this cluster only
when a human patches it. Bumping the image is what makes that gap fatal:
the new image expects the new manifest and gets the old one.

## The two failures of 2026-09-01, both silent

Read these before debugging a stuck internal cluster; between them they
cost about two and a half weeks of the internal environment.

**1. The poller pointed at an IP the node no longer had.** 4997
consecutive failures — roughly 17 days at one run per five minutes — all
of them `dial tcp 192.168.55.164:16443: connect: no route to host`.
Nothing was wrong with the poller, the cluster, or the network.
`~/.kube/config`'s `microk8s-cluster` entry still named `192.168.55.164`;
ubuntu01 is `192.168.55.30`, and microk8s had regenerated its CA as well.
The cluster was up and serving the whole time.

The tell is that the failure is at *connect*, before any Kubernetes
concept appears. `microk8s config` prints the node's real current values;
the fix was `kubectl config set-cluster microk8s-cluster --server=... 
--certificate-authority=... --embed-certs=true` plus the matching
`set-credentials admin`, and nothing else. Compare those two before
assuming the cluster is down:

```bash
microk8s config | grep server:                    # what the node thinks
kubectl config view -o jsonpath='{.clusters[?(@.name=="microk8s-cluster")].cluster.server}'
```

**2. Then the first successful deploy in 17 days broke the site.** The
site container moved from port 80 to 8080 (it runs as a non-root user)
sometime inside that window. `k8s/site-deployment.yaml` and production
both moved with it; this cluster's live Deployment and Service did not,
because — see above — the poller only ever changes the image tag. The new
image listened on 8080, the probes kept asking port 80, and the container
was killed on every `failureThreshold` forever while its own nginx log
printed a clean, cheerful startup every time.

`check-drift.sh` names this one in one line. It was fixed by patching the
live objects — `containerPort`, both probe ports, and the Service's
`marketing` `targetPort`, all 80 → 8080 — and deliberately **not** by
applying `k8s/site-deployment.yaml`, which carries production's URLs.

**Neither failure was undetectable; both were unread.** The status file
below recorded failure #1 durably, every five minutes, for 17 days.
Whatever you add next, add a thing that *arrives* somewhere, not one more
thing that waits to be looked at.

## The third one, the next morning, and it reported success

2026-09-02. `~/.kube/config` was rebuilt from a set of per-cluster files
and the `microk8s` context was not among them. This script pinned
`kubectl --context microk8s`, so its handle on the cluster stopped
existing — no change to the script, nothing anyone did wrong.

**It reported `ok`.** The run compares GitHub's `review` head against the
state file and returns early on "already at `<sha>`" — before any kubectl
call. So with nothing new to deploy, a script that could not have reached
the cluster if it tried wrote a success line every five minutes. That is
worse than the 17-day outage above, which at least said `fail`.

Two changes, and they fix different halves:

- **`microk8s kubectl`, not `kubectl --context microk8s`.** Pinning was
  the right instinct and a shared kubeconfig was the wrong handle — it is
  somebody else's file and it gets regenerated. `microk8s kubectl` reads
  the node's own config, cannot be edited out from under this script, and
  cannot address any cluster but this one. `KUBECTL=` overrides it.
- **A preflight on every tick**, before the early return: one cheap read
  of the very Deployment a deploy would patch. Reachability is now
  asserted every five minutes rather than only when someone happens to
  push, so this class of break can no longer hide behind a quiet day.

The general lesson, which is the one worth carrying: **a health signal
that is only computed on the busy path is not a health signal.** Success
had been meaning "nothing to do" and was being read as "everything is
fine".
