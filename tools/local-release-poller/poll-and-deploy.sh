#!/usr/bin/env bash
# Polls GitHub for the latest commit on the `prerelease` branch and, if
# it's newer than what's currently deployed, updates the local microk8s
# cluster's api/site Deployments to that commit's images and waits for the
# rollout.
#
# This cluster (ubuntu01, 192.168.55.x, no public DNS/TLS) is the internal
# test environment — it tracks `prerelease`, never `main`. The public
# isstech-2 cluster is the opposite: it only ever runs what
# .github/workflows/ci-cd.yml's `deploy`/`release` jobs build from `main`.
# Keeping these on separate branches is deliberate (see the root
# CLAUDE.md's git workflow rule) — this script is the "download and run
# the newest prerelease automatically" half of that split.
#
# Deliberately does NOT `docker pull` anything itself — the images this
# updates the Deployments to point at live on GHCR (ghcr.io/issen007/
# skillstreak-{api,site}:prerelease-<sha>, pushed by
# .github/workflows/ci-cd.yml's `internal-images` job, which only runs on
# pushes to `prerelease`), and it's Kubernetes' own containerd on the node
# that actually pulls them once the Deployment's image field changes —
# this script's own `docker` daemon is a separate image store that has
# nothing to do with what the cluster runs. GHCR packages here are public,
# so no registry credentials are needed either.
#
# Every kubectl call below is pinned to --context microk8s explicitly —
# confirmed live 2026-07-30 that this machine's *ambient default* context
# had drifted to "skillstreak" (the production cluster) for some stretch
# of time, and every poll during that window silently redeployed
# production with these prerelease-tagged images instead of touching this
# script's actual target. Never rely on whatever `kubectl config
# current-context` happens to be — always pin it here, since this script
# runs unattended and nothing else double-checks its target cluster.
#
# Run manually to test, or via the systemd timer in this same directory
# for the "always on, checks every few minutes" version (see this
# directory's README for install steps).
set -euo pipefail

REPO="Issen007/SkillStreak"
# The single integration branch (was `prerelease` until 2026-08-10, when
# `review` took over that role). The image TAG prefix below is still
# `prerelease-` on purpose: it names the build channel, not the branch, so
# images already on GHCR and the version string a running pod reports at
# /health all stay valid. Keep this in step with the `internal-images` job
# in .github/workflows/ci-cd.yml — they must agree on both branch and tag.
BRANCH="review"
NAMESPACE="skillstreak"
KUBE_CONTEXT="microk8s"
STATE_DIR="${STATE_DIR:-$HOME/.local/state/skillstreak-poller}"
STATE_FILE="$STATE_DIR/current-sha"
ROLLOUT_TIMEOUT="180s"

mkdir -p "$STATE_DIR"

current_sha=""
if [ -f "$STATE_FILE" ]; then
  current_sha="$(cat "$STATE_FILE")"
fi

latest_sha="$(curl -sf "https://api.github.com/repos/${REPO}/commits/${BRANCH}" | python3 -c "
import sys, json
print(json.load(sys.stdin)['sha'])
")" || {
  echo "Could not reach the GitHub commits API this run — will retry next tick."
  exit 0
}

if [ -z "$latest_sha" ]; then
  echo "Got an empty SHA back from the GitHub API — will retry next tick."
  exit 0
fi

if [ "$latest_sha" = "$current_sha" ]; then
  echo "Already at ${latest_sha} — nothing to do."
  exit 0
fi

echo "New ${BRANCH} commit detected: ${latest_sha} (currently deployed: ${current_sha:-none yet})"

api_image="ghcr.io/issen007/skillstreak-api:prerelease-${latest_sha}"
site_image="ghcr.io/issen007/skillstreak-site:prerelease-${latest_sha}"

# The internal-images CI job only runs after backend-test/compose-smoke-test
# pass, and only pushes once both images are built — but there's still a
# window between "commit landed on prerelease" and "CI finished pushing the
# images" where the latest SHA's images don't exist on GHCR yet. Checking
# the manifest exists first (rather than letting `kubectl set image` +
# rollout status time out and report a confusing failure) means a run that
# lands in that window just quietly retries next tick instead.
if ! docker manifest inspect "$api_image" >/dev/null 2>&1; then
  echo "${api_image} doesn't exist on GHCR yet (CI probably still running) — will retry next tick."
  exit 0
fi
if ! docker manifest inspect "$site_image" >/dev/null 2>&1; then
  echo "${site_image} doesn't exist on GHCR yet (CI probably still running) — will retry next tick."
  exit 0
fi

echo "Updating deployment/api -> ${api_image}"
kubectl --context "$KUBE_CONTEXT" set image "deployment/api" "api=${api_image}" -n "$NAMESPACE"
echo "Updating deployment/site -> ${site_image}"
kubectl --context "$KUBE_CONTEXT" set image "deployment/site" "site=${site_image}" -n "$NAMESPACE"

echo "Waiting for rollout..."
kubectl --context "$KUBE_CONTEXT" rollout status "deployment/api" -n "$NAMESPACE" --timeout="$ROLLOUT_TIMEOUT"
kubectl --context "$KUBE_CONTEXT" rollout status "deployment/site" -n "$NAMESPACE" --timeout="$ROLLOUT_TIMEOUT"

echo "$latest_sha" > "$STATE_FILE"
echo "Deployed ${latest_sha} successfully."
