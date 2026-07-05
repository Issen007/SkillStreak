# k8s/ — SkillStreak Kubernetes manifests

Plain Kubernetes YAML (no Helm), pulled forward ahead of the normal Fas 4
roadmap position to prepare for an external beta deployment. Mirrors
`docker-compose.yml`: one `api` (NestJS), one Postgres, one Redis, all
scoped to the `skillstreak` namespace.

**Not yet verified against a real cluster.** There is no cluster available
in this environment to `kubectl apply` these manifests against. What *was*
checked: every file is well-formed YAML, and `kubectl apply --dry-run=client`
(client-side only, no live cluster) ran clean against all of them together.
That confirms the manifests parse and satisfy the Kubernetes API schema —
it does **not** confirm they actually converge to a healthy deployment
(Service selectors matching real pod labels at runtime, probes passing
against a real container, PVC provisioning succeeding on the target
cluster's StorageClass, etc.). Treat this as a solid first draft, not a
tested one.

## Files

| File | What it is |
|---|---|
| `namespace.yaml` | The `skillstreak` namespace everything else lives in. |
| `configmap.yaml` | Non-secret API config (`NODE_ENV`, `PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `JWT_EXPIRES_IN`, SMTP host/port/from, `APP_PUBLIC_URL`). |
| `secret.yaml.example` | Template for the real Secret — copy to `secret.yaml` and fill in. `secret.yaml` itself is git-ignored and must never be committed. |
| `postgres-pvc.yaml` | PersistentVolumeClaim so Postgres data survives pod restarts. |
| `postgres-deployment.yaml` | Postgres 16-alpine, single replica, `Recreate` rollout strategy (safe for a ReadWriteOnce PVC). |
| `postgres-service.yaml` | ClusterIP only — never expose Postgres externally (no LoadBalancer/NodePort/Ingress for it, matching the compose setup's `127.0.0.1`-only binding). |
| `redis-deployment.yaml` | Redis 7-alpine, single replica, deliberately no PVC (cache/accelerator over Postgres per ADR-0002 — safe to lose and rebuild). |
| `redis-service.yaml` | ClusterIP only, same reasoning as Postgres's Service. |
| `api-deployment.yaml` | The NestJS API. Uses a placeholder image (`skillstreak-api:latest`) — building/pushing the real image is a CI/CD step not covered here. Reads config from the ConfigMap + Secret; `/health` for readiness/liveness. |
| `api-service.yaml` | ClusterIP for the api Pods — the real external entry point is the Ingress, not this Service directly. |
| `ingress.yaml` | Routes external traffic to the api Service via ingress-nginx. No TLS/cert-manager yet — there's no real domain to issue a cert for. |

## Deploy order

```
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml       # copied from secret.yaml.example, real values filled in
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/postgres-pvc.yaml -f k8s/postgres-deployment.yaml -f k8s/postgres-service.yaml
kubectl apply -f k8s/redis-deployment.yaml -f k8s/redis-service.yaml
kubectl apply -f k8s/api-deployment.yaml -f k8s/api-service.yaml
kubectl apply -f k8s/ingress.yaml
```

(`kubectl apply -f k8s/` applying everything at once also works, since
these manifests don't strictly depend on apply ordering — Kubernetes will
retry until dependencies like the Secret/ConfigMap exist — but applying in
the order above is easier to reason about and debug on a first attempt.)

## Known gaps / deliberate TODOs

- **No real image yet.** `skillstreak-api:latest` in `api-deployment.yaml`
  is a placeholder — needs an actual CI/CD step to build `backend/Dockerfile`
  and push to a registry the cluster can pull from.
- **No domain/TLS yet.** `ingress.yaml`'s `host` is a placeholder, and there's
  no TLS/cert-manager config — both are marked TODO for whoever sets up the
  real domain.
- **Migration race with `replicas: 2` on the api.** `backend/docker-entrypoint.sh`
  runs TypeORM migrations on every container start; with more than one
  replica, a rolling restart can run `migration:run` from two pods at once.
  Not solved here (would need a separate Job/init-container with locking) —
  flagged in a comment in `api-deployment.yaml`. Drop to `replicas: 1` if
  this is a concern before that's addressed.
- **No HPA, NetworkPolicy, or multi-region setup** — intentionally out of
  scope for a small youth-sports app's first beta (that's Fas 4 territory,
  not this pass).
