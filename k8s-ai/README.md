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
