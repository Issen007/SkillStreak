# Cluster drift checker

Reports where a live cluster's Deployments have drifted from `k8s/`.

## Why this exists

Two outages in one day, 2026-08-11, both the same shape:

- **api** — `STAFF_JWT_SECRET` became required when staff SSO shipped. CI
  applied it to production; `ubuntu01`'s hand-applied Deployment never got
  it. Every rollout failed for **eight days** while the old pod kept
  serving, so the cluster looked alive.
- **site** — the container's nginx moved to port 8080. `ubuntu01`'s probes
  still pointed at 80, so kubelet killed the container every 44 seconds,
  forever, while nginx's own logs looked perfectly healthy.

The root cause is structural, not a mistake anyone made:
**production's manifests are applied by CI, `ubuntu01`'s are applied by
hand.** Every future required environment variable and every changed port
will drift there first, and the symptom will always be a new pod that
cannot start hiding behind an old pod that still works.

## Use

```bash
# from the repo root, against whatever context kubectl is pointing at
tools/cluster-drift/check-drift.sh

# against ubuntu01, over ssh
ssh 192.168.55.30 "cd ~/Github/Other/SkillStreak && KUBECTL='microk8s kubectl' \
  tools/cluster-drift/check-drift.sh"
```

Exits non-zero when anything differs, so it can gate a demo-day checklist.
**Run it before any demo**, and after merging anything that adds an
environment variable.

## What it does not do

It never patches. "Apply the repo manifest" is the wrong fix here — those
files carry a placeholder image and the production URLs, and applying them
to the internal cluster would point it at `skillstreak.xyz`. That is the
2026-07-30 wrong-image incident with the arrow reversed.

It compares environment variable **names, never values**. A drift checker
has no business reading secrets, and the failure this exists for is always
a missing name.
