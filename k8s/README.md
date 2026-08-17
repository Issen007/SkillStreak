# k8s/ — SkillStreak Kubernetes manifests

Plain Kubernetes YAML (no Helm), pulled forward ahead of the normal Fas 4
roadmap position to prepare for an external beta deployment. Mirrors
`docker-compose.yml`: one `api` (NestJS), one Postgres, one Redis, all
scoped to the `skillstreak` namespace — plus one `site` (the public
marketing page + hosted "try it" demo, built from `../site/`, not part of
the compose setup since it's a beta-specific addition).

Three public hostnames, real DNS records needed pointing at wherever
Safespring's Elastic IP for this cluster ends up (see "Public access —
current state" below — not resolvable yet):
- `skillstreak.xyz` (+ `www.`) — marketing/product page
- `try.skillstreak.xyz` — hosted Expo web export, the "try it" demo
- `api.skillstreak.xyz` — the backend API

## Public access — current state (updated 2026-07-30, new cluster)

**Cluster context: `skillstreak`** (Safespring Kubernetes Engine, cluster
ID `e244bd25-b959-497e-b57b-917a1ec66d85`, API at
`https://api.e244bd25-b959-497e-b57b-917a1ec66d85.342030113203835544.342030113203835544.usercontentsafedc.eu:6443`)
— this replaces an earlier cluster (`isstech-2`, a different Safespring
cluster ID under a different account/domain suffix, `paas.safedc.net`)
as the production target. `GitHub Secrets` `KUBE_URL`/`KUBE_TOKEN` point
here now.

Everything *inside* the cluster is correctly configured and confirmed
working:
- `gateway.yaml` uses Safespring's own pre-installed `cilium`
  `GatewayClass` directly (no custom `GatewayClass`/
  `CiliumGatewayClassConfig` needed here, unlike `isstech-2` — see that
  file's own comment for why). This cluster's Cilium runs Gateway API in
  **hostNetwork mode**: the Envoy proxy binds ports `80`/`443` directly on
  every node's real network interface, confirmed live (`curl
  http://<node-internal-ip>:80/` returns a real Envoy `404`, not
  connection-refused) — exactly what Safespring's Elastic IP product
  needs to forward traffic to.
- `cert-manager` already has `enableGatewayAPI: true` configured out of
  the box (a newer version than `isstech-2` shipped with, which needed
  this patched in by hand) — HTTP01 challenges via the Gateway work
  correctly.
- `HTTPRoute`s (`api-route`/`site-route`) are attached, `Certificate`
  (`skillstreak-xyz-tls`) is requesting correctly.

**What's still blocking real public access, both outside anything
`kubectl`/this repo can fix alone:**
1. **No DNS record exists yet for `skillstreak.xyz`** (+ `www.`/`try.`/
   `api.`) — nothing to create until the Elastic IP below is confirmed,
   since that's the actual target IP.
2. **Safespring's "Elastic IP"** (their BGP-anycast load-balancer
   product — see `docs.safespring.com/compute/loadbalancing/`) hasn't
   been provisioned for *this* cluster's ID. This is a **new, separate
   request** from any prior one for `isstech-2` — Elastic IP is
   per-cluster, not per-account, so a cluster swap means a fresh support
   request. Confirmed live: this cluster's own public IP answers on
   `:6443` (the Kubernetes API) but not `:80`/`:443`, the same symptom
   `isstech-2` had before its own (still-unresolved, now moot) request.

**Until DNS/Elastic IP are sorted**, reach the app via port-forward:
```
kubectl port-forward svc/api 3000:80 -n skillstreak
kubectl port-forward svc/site 8080:80 -n skillstreak
```
`k8s/configmap.yaml`'s `APP_PUBLIC_URL` and the site image's
`EXPO_PUBLIC_API_URL` build-arg are both set to the real `skillstreak.xyz`
domain already (not `localhost`) — a port-forward alone won't make the
site's embedded API calls resolve correctly without also editing `/etc/hosts`
or similar locally; this is a real limitation of testing via port-forward
now that the app is built against the real domain, not a bug. Note the
site container serves two different vhosts distinguished by Host header
(see `site/nginx.conf`); the marketing vhost is `default_server`, so
`http://localhost:8080` (once port-forwarded) reaches the marketing page
directly — use `curl -H "Host: try.skillstreak.xyz" http://localhost:8080/`
to reach the demo instead.

> ## 🛑 Don't let real parental-consent emails go out before the PROD cert is Ready
> The parental-consent email (`docs/api/phase1-contract.md`) links to
> `${APP_PUBLIC_URL}/api/v1/consent/:token` — that URL's token **is the
> credential** that approves a child's account (see
> `backend/src/players/consent-token.util.ts`). Serving it over plain HTTP
> or an untrusted cert means that link, mailed to a real parent, is
> interceptable or gets rejected/warned-on by their mail client. TLS is
> wired via cert-manager (`cluster-issuer.yaml`, `certificate.yaml`), but
> **currently pointed at `letsencrypt-staging`** — deliberately, to confirm
> the HTTP01 challenge flow works (DNS, Gateway reachability, cert-manager
> itself) without risking Let's Encrypt's production rate limits on the
> first attempt. Staging certs are untrusted by real browsers/mail
> clients. Before any real parent receives a consent email: confirm
> `kubectl describe certificate skillstreak-xyz-tls -n skillstreak` shows
> `Ready`, switch `certificate.yaml`'s `issuerRef` to `letsencrypt-prod`,
> delete the stale `skillstreak-xyz-tls` Secret so cert-manager reissues a
> trusted one, and confirm *that* one is also `Ready` before MailService
> actually sends anything real. Originally flagged as CONFIRMED/High in
> the pre-beta security review (see `docs/ACTION_PLAN.md`) back when there
> was no TLS story at all.

## Internal test cluster (ubuntu01) — tracks `prerelease`, not `main`

Everything above describes the public cluster (context `skillstreak`),
which only ever runs what `main` builds. There's a second, separate deployment: a
microk8s cluster on `ubuntu01` (`192.168.55.x`, LAN-only, no public
DNS/TLS), namespace `skillstreak` there too, with its own Postgres/Redis/
MinIO — a real test database, not shared with production. It exists so
`prerelease` work can be exercised end-to-end before it ever reaches
`main`, per the root `CLAUDE.md`'s git workflow rule.

It's kept up to date automatically by `tools/local-release-poller/`
(a systemd user timer on ubuntu01 itself, not this repo's CI) polling for
new `prerelease` commits, and by `.github/workflows/ci-cd.yml`'s
`internal-images` job, which builds and pushes
`ghcr.io/issen007/skillstreak-{api,site}:prerelease-<sha>` on every push to
`prerelease` — a separate tag from what `main`'s `deploy`/`release` jobs
push, because the site image bakes in this cluster's own LAN addresses
(`192.168.55.71` api, `192.168.55.72` site/try-it) at Docker build time
instead of `skillstreak.xyz`. See that tool's own README for exactly how
the poller works.

No Ingress/TLS on this cluster — reached directly by its metallb
LoadBalancer IPs over plain HTTP, which is fine for an internal-only test
environment. `skillstreak-config` there is applied by hand (not by CI,
same posture as `k8s/secret.yaml` — see "Deploy order" below), pointed at
those same LAN addresses.

**Because that poller only runs `kubectl set image`, it never re-applies
these manifests**: any change to `configmap.yaml`, `secret.yaml`, or
`api-deployment.yaml`'s `env:` list has to be applied on ubuntu01 by hand
before the internal cluster picks it up, even though the new image is
deployed there automatically. Most recent example: Fas 5's
`USAGE_REPORT_CRON`/`USAGE_REPORT_MIN_TEAMS_PER_BUCKET` (ConfigMap) and
`USAGE_REPORT_RECIPIENT_EMAIL` (Secret) — all three are optional, so the
internal cluster boots and runs fine without them (the report job just
no-ops), which is the sensible default there: the internal test database's
numbers aren't worth emailing anywhere.

## Files

| File | What it is |
|---|---|
| `namespace.yaml` | The `skillstreak` namespace everything else lives in. |
| `configmap.yaml` | Non-secret API config (`NODE_ENV`, `PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `JWT_EXPIRES_IN`, SMTP host/port/from, `APP_PUBLIC_URL`, since Fas 3 `MINIO_ENDPOINT`/`MINIO_BUCKET`/`CLIP_RETENTION_DAYS`/`CLIP_PENDING_UPLOAD_TTL_MINUTES`, and since Fas 5 `USAGE_REPORT_CRON`/`USAGE_REPORT_MIN_TEAMS_PER_BUCKET`). |
| `secret.yaml.example` | Template for the real Secret — copy to `secret.yaml` and fill in. `secret.yaml` itself is git-ignored and must never be committed. Since Fas 3, also holds `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`; since Fas 5, the optional `USAGE_REPORT_RECIPIENT_EMAIL`. |
| `postgres-pvc.yaml` | PersistentVolumeClaim so Postgres data survives pod restarts. |
| `postgres-deployment.yaml` | Postgres 16-alpine, single replica, `Recreate` rollout strategy (safe for a ReadWriteOnce PVC). |
| `postgres-service.yaml` | ClusterIP only — never expose Postgres externally (no LoadBalancer/NodePort/Ingress for it, matching the compose setup's `127.0.0.1`-only binding). |
| `redis-deployment.yaml` | Redis 7-alpine, single replica, deliberately no PVC (cache/accelerator over Postgres per ADR-0002 — safe to lose and rebuild). |
| `redis-service.yaml` | ClusterIP only, same reasoning as Postgres's Service. |
| `minio-pvc.yaml` | PersistentVolumeClaim so video-clip bytes survive pod restarts (docs/adr/0010-video-storage-and-serving.md Decision 1) — sized larger than Postgres's (20Gi) since this holds actual video, not just rows. |
| `minio-deployment.yaml` | MinIO (self-hosted S3-API object store), single replica, `Recreate` rollout strategy — the *identical* Deployment+PVC+ClusterIP shape as Postgres, per ADR-0010's explicit "no new deployment paradigm" framing. |
| `minio-service.yaml` | ClusterIP only, same reasoning as Postgres's/Redis's Service — never an Ingress/NodePort/LoadBalancer for it (ADR-0010 Decision 2: the bucket has zero public/anonymous read access, and a public MinIO endpoint would defeat that boundary entirely). |
| `api-deployment.yaml` | The NestJS API. Ships with a blank placeholder `image:` — `.github/workflows/ci-cd.yml`'s deploy job builds/pushes the real image and `sed`-fills this field at deploy time; the committed file is never updated with a real tag. Reads config from the ConfigMap + Secret; `/health` for readiness/liveness. |
| `api-service.yaml` | ClusterIP for the api Pods — the real external entry point is the Gateway (`gateway.yaml`/`httproute.yaml`), not this Service directly. |
| `cluster-issuer.yaml` | Two cert-manager `ClusterIssuer`s (`letsencrypt-staging`, `letsencrypt-prod`), HTTP01-solved through `skillstreak-gateway` (Gateway API, not ingress-nginx). Cluster-scoped, apply once. |
| `gateway.yaml` | The Cilium `Gateway` (`skillstreak-gateway`) — one HTTP listener + one HTTPS listener per public hostname, all sharing `certificate.yaml`'s multi-SAN cert. Cluster-scoped `GatewayClass` dependency (Safespring's own pre-installed `cilium` class on the current cluster — see this file's own comment on why no custom one is needed here), apply once by hand like `cluster-issuer.yaml`. |
| `httproute.yaml` | Routes `skillstreak.xyz`/`www.`/`try.` to the `site` Service and `api.skillstreak.xyz` to the `api` Service, both attached to `skillstreak-gateway`. Namespace-scoped, applied by CI on every deploy. |
| `certificate.yaml` | The multi-SAN `Certificate` (`skillstreak-xyz-tls`) covering all four public hostnames, resolved via `cluster-issuer.yaml`'s HTTP01 solver. Currently annotated for `letsencrypt-staging` — see the warning above before switching to prod. Namespace-scoped, applied by CI. |
| `site-deployment.yaml` | The marketing page + hosted "try it" demo, built from `../site/Dockerfile`. Ships with a blank placeholder `image:`, same convention as `api-deployment.yaml` — `.github/workflows/ci-cd.yml`'s deploy job now builds/pushes this image and fills the field at deploy time too. |
| `site-service.yaml` | ClusterIP for the site Pods — external entry point is the Gateway, not this Service directly. |
| `github-actions-deployer.yaml` | ServiceAccount + Role + RoleBinding CI deploys as (see its header comment for the incident this fixed). Cluster-scoped RBAC objects but namespace-scoped rights, apply once by hand like `cluster-issuer.yaml`. |
| `github-actions-deployer-token.yaml` | Mints a long-lived token Secret for that ServiceAccount — read it out and put it in the `KUBE_TOKEN` GitHub Actions secret. |

## Deploy order

```
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/github-actions-deployer.yaml   # once, with a kubeconfig that has broader rights
kubectl apply -f k8s/github-actions-deployer-token.yaml
# kubectl get secret github-actions-deployer-token -n skillstreak -o jsonpath='{.data.token}' | base64 -d
# -> put this in the KUBE_TOKEN GitHub Actions secret
kubectl apply -f k8s/secret.yaml       # copied from secret.yaml.example, real values filled in
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/postgres-pvc.yaml -f k8s/postgres-deployment.yaml -f k8s/postgres-service.yaml
kubectl apply -f k8s/redis-deployment.yaml -f k8s/redis-service.yaml
kubectl apply -f k8s/minio-pvc.yaml -f k8s/minio-deployment.yaml -f k8s/minio-service.yaml
kubectl apply -f k8s/api-deployment.yaml -f k8s/api-service.yaml
kubectl apply -f k8s/site-deployment.yaml -f k8s/site-service.yaml

# Cluster-scoped, apply once by hand with a kubeconfig that has broader
# rights (github-actions-deployer is namespace-scoped only, by design —
# see that file's own comment):
kubectl apply -f k8s/cluster-issuer.yaml
kubectl apply -f k8s/gateway.yaml

# Namespace-scoped, safe to reapply every deploy — this is what CI does:
kubectl apply -f k8s/httproute.yaml -f k8s/certificate.yaml
```

(`kubectl apply -f k8s/` applying everything at once also works, since
these manifests don't strictly depend on apply ordering — Kubernetes will
retry until dependencies like the Secret/ConfigMap exist — but applying in
the order above is easier to reason about and debug on a first attempt.)

## MinIO scoped credentials (`MINIO_CLIPS_ACCESS_KEY`/`SECRET_KEY`)

Added 2026-07-30, closing a security-review finding: the `api` Deployment
no longer authenticates to MinIO with the root user/password — a
compromised `api` process previously had full MinIO admin access (every
team's clips, plus bucket/user/policy management), not just the `clips`
bucket it actually needs. It now uses a dedicated, non-root user with a
custom least-privilege policy. Recreate this if the cluster is ever
rebuilt from scratch, or to rotate the key:

```bash
# From a pod that can reach the in-cluster MinIO Service (e.g. a
# temporary `kubectl run mc-admin --image=minio/mc:latest --command --
# sleep 600` pod, `kubectl exec`'d into):
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc admin policy create local clips-rw - <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::clips"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::clips/*"]
    }
  ]
}
EOF

mc admin user add local <new-access-key> <new-secret-key>
mc admin policy attach local clips-rw --user <new-access-key>
```

Then `gh secret set MINIO_CLIPS_ACCESS_KEY`/`MINIO_CLIPS_SECRET_KEY` (so
the next CI deploy picks it up) and, for immediate effect on the running
cluster, `kubectl patch secret skillstreak-secret` with the new values
followed by `kubectl rollout restart deployment/api`. Verify the new key
can read/write `clips/*` but gets `Access Denied` on `mc admin info`/`mc
mb` — proves it's scoped, not another root-equivalent key.

`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` still exist (`minio-deployment.yaml`
needs them to boot the server itself, and the recreate steps above need
them once) — just nothing application-facing uses them anymore.

## Known gaps / deliberate TODOs

- **`cluster-issuer.yaml` isn't applied by CI.** It's cluster-scoped
  (`ClusterIssuer`), and `github-actions-deployer` (the service account
  `.github/workflows/ci-cd.yml` deploys with, created by
  `github-actions-deployer.yaml` — see that file's header comment for why
  it didn't exist for a while and every CI deploy was failing) is
  deliberately scoped to the `skillstreak` namespace only — same posture
  as `temp/`'s `skillstreak-deployer` (see `temp/README.md`). Apply it
  once by hand with a kubeconfig that has broader rights, per the deploy
  order above.
- **The hosted demo's browser-tab title said "SkillStreak (dev)" —
  RESOLVED 2026-08-17.** That was `mobile/app.json`'s `name` field,
  shared with the native app builds, left alone while the project had no
  final name. The name has been settled since 2026-08-10 (see root
  `CLAUDE.md`), and `name` is now plain `SkillStreak` — it is the app's
  home-screen label on iOS and Android, so it had to be right before the
  first store submission regardless of the tab title.
- **TLS is on staging, not prod, until verified.** `certificate.yaml`
  currently issues certs via `letsencrypt-staging` (untrusted by real
  browsers/clients) — see the warning at the top of this file for the
  cutover steps to `letsencrypt-prod` before this is used for real.
- **Migration race with multiple api replicas — RESOLVED.**
  `backend/docker-entrypoint.sh` runs TypeORM migrations on every container
  start; with more than one replica, a rolling restart used to be able to run
  `migration:run` from two pods at once — this is exactly what stalled the
  first real alpha deploy (rollout stuck at "1 out of 2 new replicas" until
  the progress deadline, on 2026-07-11), and why `api-deployment.yaml` was
  pinned to `replicas: 1` for a while as a direct fix, not a precaution. Now
  fixed properly: `docker-entrypoint.sh` runs migrations via
  `dist/scripts/migrate-with-lock.js` (built from
  `backend/src/scripts/migrate-with-lock.ts`), which wraps `migration:run` in
  a Postgres session-level advisory lock (`pg_advisory_lock`/`pg_advisory_
  unlock`, held on one dedicated connection for the whole lock -> migrate ->
  unlock sequence) — only one pod's migration attempt runs at a time, the
  rest block on the lock and then find nothing new to apply.
  `api-deployment.yaml` is back to `replicas: 2`. The three in-process
  `@nestjs/schedule` sweeps (`ClipRetentionService`'s two,
  `AccountErasureSweepService`'s one) got the matching fix for their own
  race — a non-blocking Redis try-lock
  (`RedisService.tryClaimScheduledJobRun`), since a scheduled job that loses
  the race should skip the tick entirely rather than block-and-retry like
  the migration case.
- **No HPA, NetworkPolicy, or multi-region setup** — intentionally out of
  scope for a small youth-sports app's first beta (that's Fas 4 territory,
  not this pass).
