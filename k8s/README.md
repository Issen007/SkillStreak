# k8s/ — SkillStreak Kubernetes manifests

Plain Kubernetes YAML (no Helm), pulled forward ahead of the normal Fas 4
roadmap position to prepare for an external beta deployment. Mirrors
`docker-compose.yml`: one `api` (NestJS), one Postgres, one Redis, all
scoped to the `skillstreak` namespace — plus one `site` (the public
marketing page + hosted "try it" demo, built from `../site/`, not part of
the compose setup since it's a beta-specific addition).

Three public hostnames, three separate DNS records needed (all pointing
at the same ingress-nginx external IP):
- `skillstreak.app2.isstech.io` — marketing/product page (`site-ingress.yaml`)
- `try.skillstreak.app2.isstech.io` — hosted Expo web export, the "try it" demo (`site-ingress.yaml`)
- `api.skillstreak.app2.isstech.io` — the backend API (`ingress.yaml`)

## Alpha access (current state — read this before the section above)

This cluster (`oidc@isstech-2`, a shared internal PaaS) currently has **no
working external ingress path**, so the three real hostnames above aren't
reachable yet and `ingress.yaml`/`site-ingress.yaml` are **not applied** for
now (see "Deploy order" below):
- `type: LoadBalancer` Services never get an external IP here — this
  cluster's `openstack-cloud-controller-manager` runs with the
  `service-lb-controller` explicitly disabled (confirmed via its pod logs:
  `Failed to start service controller: the cloud provider does not support
  external load balancers`).
- The cluster's one public IP (behind `api.isstech-2.paas.safedc.net`)
  only serves the Kubernetes API on `:6443` — `:80`/`:443` accept a TCP
  connection but nothing responds, so there's no existing front door to
  point DNS at either.
- `ingress-nginx` itself runs as a `hostNetwork` DaemonSet bound to each
  node's private (`10.66.x.x`) IP — not reachable from outside the
  cluster's own network.

Getting real hostnames working again needs someone with access to this
PaaS's networking (OpenStack/Horizon, or whoever administers
`paas.safedc.net`) to either enable LBaaS on the CCM or forward `:80`/`:443`
from a public IP to the node ports — outside anything `kubectl` or this
repo can do alone.

**Until then**, reach the app via port-forward:
```
kubectl port-forward svc/api 3000:80 -n skillstreak
kubectl port-forward svc/site 8080:80 -n skillstreak
```
`k8s/configmap.yaml`'s `APP_PUBLIC_URL` and the site image's
`EXPO_PUBLIC_API_URL` build-arg are both set to `http://localhost:3000` to
match — this only works while the port-forward runs, and only on the
machine running it (fine for one person clicking around, not for real
parents receiving consent emails or for anyone else to browse the demo).
Note the site container serves two different vhosts distinguished by Host
header (see `site/nginx.conf`); `try.skillstreak.app2.isstech.io`'s block
is `default_server`, so `http://localhost:8080` lands on the demo, not the
marketing page — use `curl -H "Host: skillstreak.app2.isstech.io"
http://localhost:8080/` to reach that one instead.

> ## 🛑 Don't let real parental-consent emails go out before the PROD cert is Ready
> The parental-consent email (`docs/api/phase1-contract.md`) links to
> `${APP_PUBLIC_URL}/api/v1/consent/:token` — that URL's token **is the
> credential** that approves a child's account (see
> `backend/src/players/consent-token.util.ts`). Serving it over plain HTTP
> or an untrusted cert means that link, mailed to a real parent, is
> interceptable or gets rejected/warned-on by their mail client. TLS is now
> wired via cert-manager (`cluster-issuer.yaml`, `ingress.yaml`), but
> **currently pointed at `letsencrypt-staging`** — deliberately, to confirm
> the HTTP01 challenge flow works (DNS, ingress-nginx reachability,
> cert-manager itself) without risking Let's Encrypt's production rate
> limits on the first attempt. Staging certs are untrusted by real
> browsers/mail clients. Before any real parent receives a consent email:
> confirm `kubectl describe certificate api-tls -n skillstreak` shows
> `Ready`, switch `ingress.yaml`'s `cert-manager.io/cluster-issuer`
> annotation to `letsencrypt-prod`, delete the stale `api-tls` Secret so
> cert-manager reissues a trusted one, and confirm *that* one is also
> `Ready` before MailService actually sends anything real. Originally
> flagged as CONFIRMED/High in the pre-beta security review (see
> `docs/ACTION_PLAN.md`) back when there was no TLS story at all.

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
| `api-deployment.yaml` | The NestJS API. Ships with a blank placeholder `image:` — `.github/workflows/ci-cd.yml`'s deploy job builds/pushes the real image and `sed`-fills this field at deploy time; the committed file is never updated with a real tag. Reads config from the ConfigMap + Secret; `/health` for readiness/liveness. |
| `api-service.yaml` | ClusterIP for the api Pods — the real external entry point is the Ingress, not this Service directly. |
| `cluster-issuer.yaml` | Two cert-manager `ClusterIssuer`s (`letsencrypt-staging`, `letsencrypt-prod`), HTTP01-solved through the existing ingress-nginx controller. Cluster-scoped, apply once. |
| `ingress.yaml` | Routes `api.skillstreak.app2.isstech.io` to the api Service via ingress-nginx, with TLS from cert-manager. Currently annotated for `letsencrypt-staging` — see the warning above before switching to prod. |
| `site-deployment.yaml` | The marketing page + hosted "try it" demo, built from `../site/Dockerfile`. Ships with a blank placeholder `image:`, same convention as `api-deployment.yaml` — `.github/workflows/ci-cd.yml`'s deploy job now builds/pushes this image and fills the field at deploy time too. |
| `site-service.yaml` | ClusterIP for the site Pods — external entry point is `site-ingress.yaml`, not this Service directly. |
| `site-ingress.yaml` | Routes both `skillstreak.app2.isstech.io` (root) and `try.skillstreak.app2.isstech.io` to the site Service — nginx inside the pod picks the right content by Host header (see `../site/nginx.conf`). One multi-SAN cert covers both hostnames. |
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
kubectl apply -f k8s/api-deployment.yaml -f k8s/api-service.yaml
kubectl apply -f k8s/site-deployment.yaml -f k8s/site-service.yaml

# Not applied for now — see "Alpha access" above: this cluster has no
# working external ingress path, so these two would just create Ingress
# objects and Certificates stuck Pending forever. Re-enable once that's
# resolved.
# kubectl apply -f k8s/cluster-issuer.yaml
# kubectl apply -f k8s/ingress.yaml -f k8s/site-ingress.yaml
```

(`kubectl apply -f k8s/` applying everything at once also works, since
these manifests don't strictly depend on apply ordering — Kubernetes will
retry until dependencies like the Secret/ConfigMap exist — but applying in
the order above is easier to reason about and debug on a first attempt.)

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
- **The hosted demo's browser-tab title says "SkillStreak (dev)"** —
  that's `mobile/app.json`'s `name` field, shared with the native app
  builds. Cosmetic only, not worth a special-case for one export target
  while the project doesn't have a final name yet anyway (see root
  `CLAUDE.md`'s naming banner).
- **TLS is on staging, not prod, until verified.** `ingress.yaml` currently
  issues certs via `letsencrypt-staging` (untrusted by real
  browsers/clients) — see the warning at the top of this file for the
  cutover steps to `letsencrypt-prod` before this is used for real.
- **Migration race with multiple api replicas.** `backend/docker-entrypoint.sh`
  runs TypeORM migrations on every container start; with more than one
  replica, a rolling restart can run `migration:run` from two pods at once —
  this is exactly what stalled the first real alpha deploy (rollout stuck at
  "1 out of 2 new replicas" until the progress deadline, on 2026-07-11).
  `api-deployment.yaml` now runs `replicas: 1` as a direct fix for that, not
  a precaution. Not properly solved (would need a separate Job/init-container
  with locking) — go back to more than 1 replica only once that's built.
- **No HPA, NetworkPolicy, or multi-region setup** — intentionally out of
  scope for a small youth-sports app's first beta (that's Fas 4 territory,
  not this pass).
