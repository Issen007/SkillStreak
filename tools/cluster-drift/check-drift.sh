#!/usr/bin/env bash
#
# Reports where a live cluster's Deployments have drifted from the
# manifests in k8s/.
#
# Written 2026-08-11 after two outages in one day, both the same shape.
# `ubuntu01`'s manifests are applied BY HAND while production's are applied
# by CI, so every newly-required environment variable and every changed
# port drifts there first. The symptom is always identical and always
# misleading: a new pod that cannot start, an old pod that keeps serving,
# and a green CI. The cluster looks alive while being days stale.
#
# What it caught the day it was written:
#   - api: STAFF_JWT_SECRET absent from the Deployment, so the pod refused
#     to boot for eight days.
#   - site: probes still pointing at :80 after the container moved to
#     :8080, so kubelet killed it every 44 seconds forever.
#
# READ-ONLY. It never patches anything — it prints what differs and leaves
# the decision to a human, because "apply the repo manifest" is wrong here:
# the production manifest carries a placeholder image and production URLs
# that must not land on the internal cluster.
#
# Usage:
#   tools/cluster-drift/check-drift.sh                      # current context
#   tools/cluster-drift/check-drift.sh microk8s             # named context
#   KUBECTL="microk8s kubectl" tools/cluster-drift/check-drift.sh
#
# Exits non-zero if anything differs, so it can gate a demo-day checklist.

set -uo pipefail

CONTEXT="${1:-}"
KUBECTL="${KUBECTL:-kubectl}"
NAMESPACE="${NAMESPACE:-skillstreak}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

kube() {
  if [ -n "$CONTEXT" ]; then
    $KUBECTL --context "$CONTEXT" -n "$NAMESPACE" "$@"
  else
    $KUBECTL -n "$NAMESPACE" "$@"
  fi
}

drift_found=0

# Env var NAMES only — never values. A drift checker has no business
# reading secrets, and the failure mode this exists for is always a
# missing name rather than a wrong value.
repo_env_names() {
  grep -oE '^\s{12}- name: [A-Z_]+' "$1" | awk '{print $3}' | sort -u
}

live_env_names() {
  kube get deploy "$1" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\n"}{end}' 2>/dev/null | sort -u
}

# All THREE probe kinds plus containerPort. startupProbe was missed on the
# first pass and is the most lethal of the three: a wrong readiness port
# keeps a pod out of the Service, a wrong startup port means the pod never
# becomes ready at all — and `sort -u` collapses the set, so a startupProbe
# drifting alone would have printed "ok".
repo_ports() {
  grep -oE 'containerPort: [0-9]+|port: [0-9]+' "$1" | awk '{print $2}' | sort -u
}

live_ports() {
  kube get deploy "$1" -o go-template='{{range .spec.template.spec.containers}}{{range .ports}}{{.containerPort}}{{"\n"}}{{end}}{{if .readinessProbe}}{{.readinessProbe.httpGet.port}}{{"\n"}}{{end}}{{if .livenessProbe}}{{.livenessProbe.httpGet.port}}{{"\n"}}{{end}}{{if .startupProbe}}{{.startupProbe.httpGet.port}}{{"\n"}}{{end}}{{end}}' 2>/dev/null | sort -u
}

check_deployment() {
  local name="$1" manifest="$REPO_ROOT/k8s/$2"
  echo
  echo "=== deployment/$name"

  if [ ! -f "$manifest" ]; then
    echo "  ! no manifest at k8s/$2 — skipping"
    return
  fi
  if ! kube get deploy "$name" >/dev/null 2>&1; then
    echo "  ! not deployed on this cluster — skipping"
    return
  fi

  local missing
  missing="$(comm -23 <(repo_env_names "$manifest") <(live_env_names "$name"))"
  if [ -n "$missing" ]; then
    drift_found=1
    echo "  MISSING env vars (in k8s/$2, not on the cluster):"
    echo "$missing" | sed 's/^/    - /'
    echo "    ^ a REQUIRED one here means the pod cannot boot. Check"
    echo "      backend/src/config/env.validation.ts for which are optional."
  fi

  local extra
  extra="$(comm -13 <(repo_env_names "$manifest") <(live_env_names "$name"))"
  if [ -n "$extra" ]; then
    echo "  extra env vars on the cluster (not in the manifest):"
    echo "$extra" | sed 's/^/    - /'
    echo "    ^ usually fine — this cluster has its own ConfigMap — but"
    echo "      worth knowing when a variable was renamed."
  fi

  local repo_p live_p
  repo_p="$(repo_ports "$manifest" | tr '\n' ' ')"
  live_p="$(live_ports "$name" | tr '\n' ' ')"
  if [ "$repo_p" != "$live_p" ]; then
    drift_found=1
    echo "  PORT mismatch (container/probe ports):"
    echo "    manifest: ${repo_p:-none}"
    echo "    cluster:  ${live_p:-none}"
    echo "    ^ a probe pointing at a port nothing listens on kills the"
    echo "      container every failureThreshold, forever, while nginx logs"
    echo "      look perfectly healthy."
  fi

  if [ -z "$missing" ] && [ "$repo_p" = "$live_p" ]; then
    echo "  ok — env names and ports match the manifest"
  fi
}

echo "Comparing ${CONTEXT:-current context} / namespace $NAMESPACE against k8s/"
check_deployment api api-deployment.yaml
check_deployment site site-deployment.yaml

echo
if [ "$drift_found" -ne 0 ]; then
  echo "DRIFT FOUND. Nothing was changed — patch deliberately, and never by"
  echo "applying k8s/*.yaml wholesale to the internal cluster: those files"
  echo "carry a placeholder image and the production URLs."
  exit 1
fi
echo "No drift."
