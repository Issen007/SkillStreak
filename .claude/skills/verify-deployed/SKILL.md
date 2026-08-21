---
name: verify-deployed
description: Verify that a change is actually live, rather than merely merged. Use after merging a PR, after changing a secret or ConfigMap, before telling anyone something "shipped", and whenever a report of "it doesn't work" contradicts what the repository says. Covers the API, the site, the mobile app, cluster secrets and the staff console.
---

# Verifying a change is actually running

**The premise: "merged" is not "running", and this project has been wrong
about the difference at least five separate times.** Every incident below
really happened, and each one looked fine from wherever it was checked.

| What was believed | What was true |
|---|---|
| PR #92 / #93 merged | still open; `main` unchanged |
| Sharing feature shipped | the app on the phone was 3 days and 11 commits stale |
| SMTP password updated | correct in GitHub, absent from the cluster for 3 deploys |
| Certificate renewal verified | the ACME test used a cached authorization and solved nothing |
| Production serving the right image | it served an internal-LAN build for a stretch of 2026-07-30 |

The pattern is always the same: **the artifact existed somewhere, and the
place that mattered was never asked.** So ask that place.

---

## 1. Always pass `--context=skillstreak`

This kubeconfig holds four clusters and the default is **`issassist`**, a
different production cluster.

It hides well: `issassist` also runs cert-manager v1.19.4 in a
`cert-manager` namespace, with ClusterIssuers named `letsencrypt-prod` and
`letsencrypt-staging`. Every detail an operator would check to confirm
they are in the right place is identical, so a misdirected command
**reports success**.

```bash
kubectl config current-context    # before anything that writes
```

`No resources found in skillstreak namespace` means **wrong context**, not
a missing resource. The namespace does not exist on `issassist` at all.

## 2. Ask the running pod what it is

The API stamps its build and returns it:

```bash
curl -s https://api.skillstreak.xyz/health
# {"status":"ok","version":"main-<sha>", ...}
```

Compare that `<sha>` against the merge commit. `main` containing the code
and the cluster running it are **separate claims**; this is the only one
that matters to a user.

## 3. Confirm a PR merged from `main`, not from the PR

`gh pr view` has reported `OPEN` for an already-merged PR in this repo
(stale cache), and has reported `mergedAt: null` while `main` held the
merge commit. Check the thing itself:

```bash
gh api repos/Issen007/SkillStreak/commits/main --jq '.sha[0:7] + "  " + (.commit.message|split("\n")[0])'
gh api repos/Issen007/SkillStreak/contents/<a file the PR added>?ref=main --jq '.name'
```

If a file the PR added is on `main`, it merged. Nothing else is evidence.

## 4. Secrets: GitHub and the cluster are different places

CI **regenerates** `skillstreak-secret` from GitHub Actions secrets during
the deploy job. So:

- Updating a GitHub secret changes nothing until a deploy runs.
- Patching the cluster directly is overwritten by the next deploy.
- Pods read secrets as env at **start**, so they also need to restart.

Check the shape without printing the value:

```bash
kubectl --context=skillstreak -n skillstreak get secret skillstreak-secret -o json \
  | python3 -c "
import json,sys,base64
d=json.load(sys.stdin)['data']
v=base64.b64decode(d['SMTP_PASSWORD']).decode()
print('len', len(v))"
```

And confirm the GitHub side was actually touched — names and timestamps
are readable, values are not:

```bash
gh api repos/Issen007/SkillStreak/actions/secrets --jq '.secrets[] | "\(.name)  \(.updated_at)"'
```

A Google App Password is **16 lowercase letters** (19 with spaces). Any
other shape will fail with `534-5.7.9 Application-specific password
required`.

## 5. The mobile app is not deployed by CI

**Nothing in CI builds or publishes the app.** It typechecks `mobile/` and
stops. The API and site deploy on every merge; the app changes only when
someone runs `eas build`.

```bash
cd mobile && npx eas-cli build:list --limit 3 --non-interactive
```

Compare the build's `Commit` against `main`, or read
`mobile/.last-eas-build.json` and let the `Mobile build drift` CI job
answer it. A screenshot showing a missing control usually means a stale
build, not a bug — check this **before** debugging the feature.

## 6. Wait for the right job, not the whole run

`Build and Push clip-tagger Image` can take **hours**. The deploy finishes
long before the run does, so waiting on the run wastes time and waiting on
nothing at all reports too early:

```bash
RID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view $RID --json jobs --jq '.jobs[] | select(.name|test("Deploy to Kubernetes")) | "\(.status)/\(.conclusion)"'
kubectl --context=skillstreak -n skillstreak rollout status deploy/api --timeout=300s
```

## 7. Prefer a probe that would fail

A check that passes for the wrong reason is worse than no check, because
it ends the investigation.

- **New endpoints:** `401` proves wired-and-guarded; `404` proves the
  module never registered. Curl them unauthenticated.
- **Static assets:** fetch over HTTPS, do not read the file from git.
  `curl -s https://api.skillstreak.xyz/console/app.js | grep -c <marker>`
- **ACME/TLS:** a green certificate proves nothing on its own. Check the
  Order's `initialState` — `valid` means a cached authorization answered
  and no challenge ran. Only `pending` exercised the path. Test with a
  hostname never issued before.
- **Anything behind a config flag:** confirm the *service* logged the flag,
  not that the ConfigMap contains it.

## Before saying "it works"

1. `kubectl config current-context` is `skillstreak`
2. `/health` reports the expected commit
3. The change is reachable by the path a user takes — not just present
4. If it touches mobile: a build exists that contains it
5. If it touches a secret: a deploy ran **after** the secret changed, and
   pods restarted after that

If any step was skipped, say which, rather than reporting a clean result.
An unverified claim in this project has cost more time than every bug in
it.
