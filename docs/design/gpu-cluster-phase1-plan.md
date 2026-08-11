# skillstreak-gpu — Phase 1 plan

Written 2026-08-11 against the **actual** provisioned cluster, not a
sketch. Everything in the Hardware section below was read from the cluster
itself; ADR-0028 Open Question 2 (GPU model, VRAM, node count) is closed
by it.

## Hardware, verified

| | |
|---|---|
| Kubernetes | v1.35.4, Talos Linux, Cilium CNI |
| Control plane | 3 nodes × 4 vCPU / 8 GB |
| Workers | **3 nodes × 4 vCPU / 8 GB, 1 GPU each** |
| GPU | **NVIDIA A2, 15 356 MiB (~15 GB) VRAM**, compute 8.6 (Ampere) |
| Driver | 570.211.01, open kernel modules, via Talos extensions |
| GPU scheduling | `nvidia-device-plugin` DaemonSet; **`runtimeClassName: nvidia` is required** |
| Storage | Cinder CSI (OpenStack) — `large` (default) and `fast` |
| TLS | cert-manager present |
| Ingress | **none yet — no LoadBalancer service exists** |
| Pod security | **`restricted` enforced** — every pod needs `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault` |

Two of those bit immediately while probing, and will bite anything
deployed here: a pod without `runtimeClassName: nvidia` cannot see the GPU
at all (`nvidia-smi: not found`), and a pod without the four
securityContext fields is refused outright.

## What the hardware means for model choice

**The binding constraint is 8 GB of system RAM per node, not the GPU.**
15 GB of VRAM is generous for this workload; 8 GB of host RAM is not, and
model loaders routinely stage weights in host memory on the way to the
card. Plan for that rather than discovering it.

Within 15 GB VRAM on an A2:

- **7–8 B parameters, 4-bit quantised** (~5 GB) — comfortable, leaves
  plenty for KV cache. **This is the sensible starting point.**
- 12–14 B, 4-bit (~9 GB) — fits, slower.
- 7–8 B at FP16 (~15 GB) — technically fits, leaves nothing for context.
  Do not.

The A2 is an *inference* card with modest memory bandwidth (~200 GB/s),
so expect tens of tokens per second, not hundreds. That is a real
mismatch for a chat UI and a perfectly good fit for what Phase 1 actually
is: a coach asking for a training plan, once, and waiting a moment.

**Swedish quality decides the model, not benchmarks.** ADR-0028 Decision 9
already says measure Swedish first, and it is the right call — most
open-weight leaderboards are English-only, and a plan a Swedish coach
cannot read is worthless however well it scores. Candidates worth
measuring, in the order I would try them: Llama 3.1 8B, Qwen2.5 7B,
Mistral 7B, and GPT-SW3 (AI Sweden's Swedish-first model, which may punch
above its size here precisely because it is not an afterthought).

## Sequence

**1. Namespace and guard rails.** `skillstreak-ai` — deliberately not
`skillstreak`, so a mistargeted `kubectl apply` fails loudly instead of
landing in the app's namespace. Plus the `cluster-identity` ConfigMap
ADR-0028 Decision 12 specifies, asserted before every apply.

**2. Prove the GPU path with something trivial** before any model. A pod
that runs `nvidia-smi` and exits, kept in the repo, so "is the GPU
reachable" is a command rather than an investigation. The probe that
produced the table above is that pod.

**3. Model serving.** One Deployment, one GPU, `runtimeClassName: nvidia`,
the four securityContext fields, requesting `nvidia.com/gpu: 1`. A
read-only PVC on the `fast` class for weights — the **only** persistent
volume this cluster gets, per ADR-0028 Decision 3's stateless-analyser
rule.

**4. The corpus.** `backend/src/drills/library/*.md`, already built and
shipping. One corpus, two consumers (ADR-0029 Decision 3).

**5. The app's call.** `POST /v1/training-plan`, bearer token from a
per-cluster Secret, 60 s timeout, no retries, unset config = feature off.

## What is not decided here

- **How the app reaches this cluster.** There is no ingress and no
  LoadBalancer yet, and ADR-0028 discharged ADR-0018's ClusterIP-only
  finding on the basis that the credential, not routability, is the
  control. Something still has to exist. This is the first real blocker
  and it is infrastructure, not code.
- **Which model**, pending the Swedish measurements above.
- **Anything about video.** Phase 2, behind its own blocking review.

## Cost note

Three A2s is real capacity for this workload and idle capacity most of the
time — a coach generating a plan is a handful of requests a week, not a
stream. Worth knowing before the resources stop being free: Phase 1 needs
**one** GPU, and the other two are headroom for Phase 2's video work, not
a requirement for this.
