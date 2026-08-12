# k8s-ai — manifests for the `skillstreak-gpu` cluster

Separate directory from `k8s/` on purpose. Those manifests belong to the
app cluster and carry its image placeholders and its production URLs;
applying either set to the other cluster is the 2026-07-30 wrong-image
incident in a new costume.

**Always pass `--context` explicitly.** `skillstreak-gpu` was the *current*
context when this directory was written, which is exactly how a command
meant for one cluster lands on another.

```bash
kubectl --context skillstreak-gpu apply -f k8s-ai/namespace.yaml
kubectl --context skillstreak-gpu apply -f k8s-ai/cluster-identity.yaml

# Assert you are where you think you are, before anything else:
kubectl --context skillstreak-gpu -n skillstreak-ai \
  get configmap cluster-identity -o jsonpath='{.data.cluster}'
# -> skillstreak-gpu

# Prove the GPU path:
kubectl --context skillstreak-gpu apply -f k8s-ai/gpu-probe.yaml
kubectl --context skillstreak-gpu -n skillstreak-ai logs gpu-probe
kubectl --context skillstreak-gpu delete -f k8s-ai/gpu-probe.yaml
```

## Two things this cluster enforces that will stop you

- **`runtimeClassName: nvidia`** — without it a pod runs happily and cannot
  see the GPU. The symptom is `nvidia-smi: executable file not found`,
  which reads as a bad image rather than a missing runtime.
- **PodSecurity `restricted`** — every pod needs `runAsNonRoot`,
  `allowPrivilegeEscalation: false`, `capabilities.drop: ["ALL"]` and
  `seccompProfile: RuntimeDefault`, or it is refused before it starts.

## What does not belong here, ever

No PersistentVolumeClaim except a read-only model/corpus volume, and no
database or object-storage credential of any kind. ADR-0028 Decision 3:
this cluster is a stateless analyser. The moment it holds a durable copy
of anything about a child, ADR-0013's erasure walk and the clip retention
sweep both have to reach it, and neither can.

See `docs/design/gpu-cluster-phase1-plan.md` for the hardware survey and
the sequence.

## The route — there isn't one yet (measured 2026-08-12)

`gpu.skillstreak.xyz` resolves to `192.121.132.68`, but **only port 6443
is open there — that is the Kubernetes API endpoint, not a web listener.**
Ports 80 and 443 are closed, no Ingress/Gateway/LoadBalancer exists, and
no `CiliumLoadBalancerIPPool` is defined.

Two things this means in practice:

- **Do not point anything at `gpu.skillstreak.xyz` expecting HTTPS.** It
  is the address `kubectl` talks to. Reusing the record for a web endpoint
  would take the API endpoint with it.
- **The app cluster has no private path here.** Tested from a production
  pod: all three GPU worker IPs (`10.66.2.157`, `10.66.0.100`, `10.66.4.9`)
  are unreachable, while `192.121.132.68:6443` answers. Both clusters use
  `10.66.0.0/16`, which looks like one network and is not — the ranges are
  per-cluster and unrouted between them.

That second point rules out the cheap option: Cilium has
`gateway-api-hostnetwork-enabled=true` and all three workers carry the
`component=gateway-api` label, so a host-network Gateway would cost
nothing — but it would bind to a `10.66.x.x` address that nothing outside
this cluster can reach.

What is actually needed is a **public address for this cluster**, then a
`CiliumLoadBalancerIPPool`, a Gateway, and cert-manager TLS. The software
side is ready: `enable-gateway-api=true`, `enable-lb-ipam=true`, and the
`cilium` GatewayClass is `Accepted`.

Full reasoning, including the alternative of inverting the call direction
and what that trades away, is in
`docs/design/gpu-video-tagging-architecture.md` under "The route".

`clip-tagger.yaml`'s Service is therefore **ClusterIP**, and its
NetworkPolicy leaves pod-level ingress open to the cluster because the
namespace to narrow it to does not exist yet. **Narrow that rule as soon
as an ingress controller is chosen** — it is marked in the manifest.

## Known: one GPU worker is down

`...jn4fr-5nhm9` has been `NotReady` since roughly cluster creation, every
condition `Unknown`, reason `NodeStatusUnknown` — its kubelet stopped
posting status while Cilium still reports the node's network as up. That
is 1 of 3 GPUs unavailable. Worth fixing before any capacity plan assumes
three.
