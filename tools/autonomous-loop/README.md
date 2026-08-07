# autonomous-loop

A Python script you run **by hand** when you're going to be away for a
longer stretch and want SkillStreak's `docs/internal/ACTION_PLAN.md`
"Next Up" queue to keep moving without you at the keyboard. Not a
systemd timer like `tools/uptime-monitor`/`tools/local-release-poller` —
you start this yourself (in `tmux`/`screen`/`nohup` so it survives you
disconnecting) and stop it yourself when you're back.

## What it actually does

Each cycle, `run_loop.py` spawns one non-interactive `claude -p` session
in this repo and gives it one job: read `docs/internal/ACTION_PLAN.md`'s
"Next Up" section, do the first item that isn't blocked on you, verify it
(tests/lint/build), commit and push straight to `prerelease`, update
`ACTION_PLAN.md`/`CONTINUE.md` so the next cycle (or you) can see what
happened, then exit. The Python script watches that session's live
output, prints `[INFO]`/`[WARN]`/`[ERROR]` lines to the screen (and to
`loop.log` next to this file) as it goes so you can see what phase it's
on and what it's done, and then either:

- starts the next cycle after a short cooldown,
- sleeps and rechecks later if nothing in the queue is actionable,
- or — the part you specifically asked for — **detects a usage-limit
  rejection (the 5-hour rolling limit or the weekly one) and sleeps
  until it resets** (or, if it can't parse an exact reset time out of
  the message, polls periodically instead of guessing) rather than
  spinning and burning cycles against a wall.

It **never touches `main`** — the prompt given to each cycle repeats
CLAUDE.md's own unconditional git-workflow rule explicitly, and every
push target in the script itself is hardcoded to `prerelease`.

## Before you leave it running unattended — read this part

**I could not run this end-to-end myself before handing it to you.** The
sandbox this was built in has its own Auto Mode classifier, and that
classifier blocks a Claude Code session from spawning a *nested* `claude`
session — which is exactly what this script does, so even a trivial
`--help` invocation got blocked while building it. That's the classifier
working as intended (recursive self-invocation is a reasonable thing to
block by default), but it means this script is verified by careful
reading and `py_compile`, not by a real run. **Do a short supervised test
run yourself before trusting it for days unattended**:

```bash
cd tools/autonomous-loop
python3 run_loop.py --max-cycles 1
```

Watch the whole cycle happen, check the resulting commit on `prerelease`
looks right, and read `loop.log`, before starting it for real with no
`--max-cycles` cap.

**The permission-mode tradeoff.** Because no one's present to click
"allow" on a tool-permission prompt, each cycle runs with
`--permission-mode auto` by default — the same classifier-backed Auto
Mode this repo's interactive Claude Code sessions already use (it's what
blocked the nested-invocation test above, and what's blocked a couple of
genuinely risky actions during real work on this repo already: reading a
decoded secret, triggering a full production deploy without asking
first). That's a real, if imperfect, safety net — not the same as a human
reviewing every diff, but meaningfully more supervised than turning every
check off. If you find `auto` stalling a cycle on something you're
genuinely fine letting through unattended, you can loosen it:

```bash
python3 run_loop.py --permission-mode bypassPermissions
```

but understand that removes every guardrail, including the ones that
already caught real issues this session. Only do that if you've thought
about what could go wrong while you're not watching.

## Running it for real

```bash
cd ~/SkillStreak/tools/autonomous-loop
tmux new -s skillstreak-loop
python3 run_loop.py
# Ctrl+B then D to detach — the loop keeps running.
```

Reattach any time with `tmux attach -t skillstreak-loop` to watch it
live, or just read `loop.log`. `nohup python3 run_loop.py &` works too if
you don't want tmux.

**Stopping it:**
- Attached: Ctrl+C. It finishes the current cycle (won't abort a
  half-done commit/push) and then exits — not instant, by design.
- Not attached: `touch tools/autonomous-loop/STOP` from anywhere with
  filesystem access to this repo (e.g. over SSH from your phone). Same
  "finishes current cycle first" behavior. Delete the file before
  starting the loop again.

## Catching up when you're back

Read `docs/internal/CONTINUE.md`'s most recent entries (newest at the
bottom) and `tools/autonomous-loop/loop.log` — between the two you'll see
every cycle's outcome, every commit it made, and anything it flagged as
blocked and needing you specifically.

## Safety behavior worth knowing about

- **Refuses to start a cycle on a dirty working tree.** If a previous
  cycle crashed mid-work and left uncommitted changes, the script stops
  and waits rather than building on top of unknown local state — you'll
  need to look at `git status` yourself before it continues.
- **Three consecutive failed cycles → a long pause** (`FAILURE_PAUSE_SECONDS`
  in the script, default 1h), not an infinite crash-loop burning cycles
  on the same stuck problem.
- **Rate-limit detection deliberately only scans Claude Code's own
  system-generated error text**, not its narration of a successful
  cycle's work. This project's own backlog regularly involves building
  real "rate limit"/"quota"/"throttle" features (ADR-0007, ADR-0013,
  ADR-0023 all touch this) — scanning the *whole* transcript for those
  words would misfire on a totally successful cycle that happened to
  describe rate-limiting code it just wrote.

## Not built here, on purpose

- No Slack/email/push notification when a cycle finishes or something
  gets blocked — `loop.log` plus `CONTINUE.md` is the whole notification
  surface for now. `tools/uptime-monitor`'s existing SMTP setup would be
  a reasonable thing to wire in later if you want a ping.
- No cost cap per cycle (`claude`'s own `--max-budget-usd` flag exists
  and could be added, but cutting a cycle off mid-commit is its own
  risk — left as a manual edit to `run_loop.py` if you want it).
- No parallelism — one cycle at a time, strictly sequential, so nothing
  ever races itself over the same `prerelease` branch.
