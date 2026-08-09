#!/usr/bin/env python3
"""Autonomous Claude Code loop for SkillStreak's ACTION_PLAN.md queue.

Run this by hand (inside tmux/screen/nohup so it survives you disconnecting)
when you're going to be away for a while and want development to keep
moving. Each cycle spawns one non-interactive `claude -p` session that:

  1. reads docs/internal/ACTION_PLAN.md's "Next Up" queue,
  2. picks the first item that isn't blocked on you,
  3. does the work (dispatching the right subagent roles, same as an
     interactive session would),
  4. runs the project's own tests/lint/build,
  5. commits and pushes STRAIGHT TO `prerelease` (never `main` — the
     prompt below is explicit about this, mirroring CLAUDE.md's own rule),
  6. updates ACTION_PLAN.md/CONTINUE.md so the next cycle (or you, when
     you're back) can see what happened.

Read tools/autonomous-loop/README.md before running this unattended for
real — in particular the permission-mode tradeoff and the fact that this
script could not be live-tested end-to-end (Claude Code's own auto-mode
classifier blocks a session from spawning a nested `claude` session, for
good reason — see the README). Do a short supervised run first.
"""

from __future__ import annotations

import argparse
import json
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

# ---------------------------------------------------------------------------
# Config — edit these or override via CLI flags (see --help)
# ---------------------------------------------------------------------------

REPO_DIR = Path(__file__).resolve().parents[2]  # .../SkillStreak
BRANCH = "prerelease"
LOG_FILE = Path(__file__).resolve().parent / "loop.log"
STOP_FILE = Path(__file__).resolve().parent / "STOP"
# Raw stream-json saved per cycle — added after this tool's own supervised
# test run (2026-08-07) hit a real usage limit that the classifier missed;
# without the raw transcript, diagnosing exactly which event carried the
# limit message required re-reading log.log's already-summarized output
# and guessing. One file per cycle, kept indefinitely (small; text) —
# delete old ones by hand if this directory grows large.
TRANSCRIPTS_DIR = Path(__file__).resolve().parent / "transcripts"

CLAUDE_BIN = "claude"
# "auto" = the same classifier-backed Auto Mode this repo's interactive
# sessions already use (blocks the genuinely risky stuff, allows the rest
# through without a human clicking "allow"). "bypassPermissions" removes
# every guardrail — only use that if "auto" turns out to stall on things
# you're fine letting through unattended. See README.
PERMISSION_MODE = "auto"

CYCLE_COOLDOWN_SECONDS = 60          # pause between cycles that did real work
IDLE_SLEEP_SECONDS = 30 * 60         # nothing actionable — recheck in 30 min
RATE_LIMIT_POLL_SECONDS = 15 * 60    # no parseable reset time — recheck in 15 min
RATE_LIMIT_MAX_SLEEP_SECONDS = 8 * 60 * 60  # never blind-sleep more than 8h at once
SHORT_RETRY_BACKOFF_SECONDS = 2 * 60  # a real error, not a limit — brief backoff
MAX_CONSECUTIVE_FAILURES = 3
FAILURE_PAUSE_SECONDS = 60 * 60      # after MAX_CONSECUTIVE_FAILURES, wait this long

STATUS_MARKER_RE = re.compile(
    r"^LOOP_STATUS:\s*(ITEM_COMPLETED|NOTHING_ACTIONABLE|BLOCKED)\b(.*)$",
    re.MULTILINE,
)

# Confirmed against a real hit during this tool's own supervised test run
# (2026-08-07): the actual CLI message was "You've hit your session limit
# · resets 5:10pm (Europe/Stockholm)" — note "session limit" (not "usage
# limit"), and "resets 5:10pm" with NO "at" between "resets" and the time.
# The original keyword/regex pair here missed that message entirely and
# let a real rate limit fall through to the generic error path instead of
# sleeping until reset. Keep this list broad — a false positive here just
# costs one extra sleep-and-recheck cycle; a false negative burns retries
# against a wall that won't move until the real reset time.
RATE_LIMIT_KEYWORDS = (
    "usage limit",
    "session limit",
    "rate limit",
    "rate_limit",
    "limit reached",
    "hit your",  # "You've hit your {session,usage,weekly} limit"
    "quota",
    "try again later",
    "weekly limit",
)

# Matches "resets 5:10pm", "resets at 5:10pm", "resets
# 2026-08-07T17:10:00+02:00" — "at"/"in" are optional since the real
# message omits it. Captures an optional trailing "(Zone/Name)" IANA
# timezone separately so we can interpret the wall-clock time correctly
# instead of assuming it's in this machine's local timezone. Only
# absolute times are actually parsed downstream (see try_parse_reset_time)
# — a relative phrase like "resets in 2 hours" will match this regex
# loosely (capturing just "2") but then safely fail every strptime format
# and fall back to polling, rather than being mis-parsed as a clock time.
RESET_TIME_RE = re.compile(
    r"reset[s]?\s+(?:at\s+|in\s+)?"
    r"([0-9:apmAPM\s./\-T+]+?)"
    r"(?:\s*\(([A-Za-z]+/[A-Za-z_]+)\))?"
    r"(?:[.,]|\s|$)",
    re.IGNORECASE,
)

PROMPT_TEMPLATE = """\
You are running as one cycle of an unattended, autonomous loop while the \
project owner is away. This is a single non-interactive invocation — you \
will not be asked for confirmation and no one is watching in real time, so \
act on your own judgment within the rules below, and be conservative \
whenever something would normally warrant asking first.

Do exactly ONE thing this invocation:

1. Read docs/internal/ACTION_PLAN.md's "Next Up" section.
2. Pick the FIRST item that is not already checked off and not listed \
under "Blocked on the project owner". If everything remaining is blocked \
on the project owner, or the queue is empty, do NOT pick anything — skip \
to step 6 with NOTHING_ACTIONABLE.
3. Do the work for that one item, following this repo's own established \
workflow (see CLAUDE.md and docs/internal/ACTION_PLAN.md's "Standing \
practice" section) — dispatch the right subagent role(s) \
(architect/ux-designer/backend-developer/frontend-developer as needed), \
then a code-critic review before committing, and fix confirmed findings. \
Run this project's real tests/lint/build and confirm they pass before \
committing anything — don't skip verification just because no one's \
watching.
4. Commit and push directly to the `prerelease` branch. NEVER commit to, \
merge into, or push `main` — that is the project owner's own action only, \
no exception, per CLAUDE.md's unconditional git workflow rule. Never \
force-push. Never touch anything outside this repository.
5. Update docs/internal/ACTION_PLAN.md (check off the item you completed, \
with a short completion note in the same style as the existing archive \
entries) and append a new dated entry to docs/internal/CONTINUE.md \
summarizing what you did, so the next cycle (or the project owner, \
whenever they're back) can catch up without re-reading everything. If you \
discovered the item is actually blocked on a decision only the project \
owner can make, do NOT guess or force it — record the open question \
clearly in CONTINUE.md and BACKLOG.md instead, leave the item unchecked, \
and stop.
6. End your final response with exactly one line, in exactly this format \
(this is machine-parsed, so match it precisely and put nothing else on \
that line):

LOOP_STATUS: ITEM_COMPLETED — <one-line summary of what shipped>

or

LOOP_STATUS: NOTHING_ACTIONABLE

or

LOOP_STATUS: BLOCKED — <one-line reason>

Do not start a second Next Up item in this same invocation, even if you \
finish the first one quickly and have budget left — one item per cycle, \
so progress is checkpointed (committed + pushed + documented) before this \
process exits.
"""


def log(message: str, level: str = "INFO") -> None:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    line = f"[{timestamp}] [{level}] {message}"
    print(line, flush=True)
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass  # logging to disk is best-effort; never let it crash the loop


_stop_requested = False


def _handle_signal(signum, _frame):
    global _stop_requested
    log(f"Received signal {signum} — will stop after the current cycle finishes.", "WARN")
    _stop_requested = True


def stop_requested() -> bool:
    if _stop_requested:
        return True
    if STOP_FILE.exists():
        log(f"Found stop file {STOP_FILE} — stopping.", "WARN")
        return True
    return False


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=REPO_DIR, capture_output=True, text=True, **kwargs)


def ensure_clean_branch() -> bool:
    """Make sure we're on `prerelease`, up to date, and the tree is clean.

    Returns False (and logs why) if it's not safe to proceed — e.g. leftover
    uncommitted changes from a previous crashed cycle. We do not touch those
    automatically; a human needs to look.
    """
    status = run(["git", "status", "--short"])
    if status.stdout.strip():
        log(
            "Working tree is not clean — refusing to start a cycle on top of "
            "unknown local changes. Inspect `git status` by hand, then remove "
            f"{STOP_FILE.name} if you created one, or just rerun once it's clean.",
            "ERROR",
        )
        return False

    fetch = run(["git", "fetch", "origin", BRANCH])
    if fetch.returncode != 0:
        log(f"git fetch failed: {fetch.stderr.strip()}", "ERROR")
        return False

    checkout = run(["git", "checkout", BRANCH])
    if checkout.returncode != 0:
        log(f"git checkout {BRANCH} failed: {checkout.stderr.strip()}", "ERROR")
        return False

    pull = run(["git", "pull", "--ff-only", "origin", BRANCH])
    if pull.returncode != 0:
        log(f"git pull --ff-only failed (diverged history?): {pull.stderr.strip()}", "ERROR")
        return False

    return True


def try_parse_reset_time(text: str) -> datetime | None:
    """Best-effort parse of a reset time out of Claude Code's own message.

    Returns a naive datetime in THIS MACHINE'S local time (matching every
    other use of `datetime.now()` in this script), or None if parsing
    fails — callers should fall back to periodic polling rather than
    guess wrong and oversleep. Claude Code's exact wording isn't a stable
    API, so a failed parse here is expected sometimes, not a bug.
    """
    match = RESET_TIME_RE.search(text)
    if not match:
        return None
    raw = match.group(1).strip()
    tz_name = match.group(2)  # e.g. "Europe/Stockholm", or None

    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%I:%M%p",
        "%I:%M %p",
        "%I %p",
        "%I%p",
        "%H:%M",
    ):
        try:
            parsed = datetime.strptime(raw.upper(), fmt)
        except ValueError:
            continue

        if parsed.tzinfo is not None:
            # A full ISO timestamp already carries its own date/offset —
            # just convert straight to local time.
            return parsed.astimezone().replace(tzinfo=None)

        minute = parsed.minute if "%M" in fmt else 0

        if tz_name:
            try:
                zone = ZoneInfo(tz_name)
            except Exception:  # noqa: BLE001 — unknown/malformed zone name
                zone = None
        else:
            zone = None

        if zone is not None:
            now_in_zone = datetime.now(zone)
            candidate_in_zone = now_in_zone.replace(
                hour=parsed.hour, minute=minute, second=0, microsecond=0
            )
            if candidate_in_zone <= now_in_zone:
                candidate_in_zone += timedelta(days=1)
            return candidate_in_zone.astimezone().replace(tzinfo=None)

        # No timezone info available at all — assume this machine's own
        # local time, same as the original (pre-fix) behavior.
        now = datetime.now()
        candidate = now.replace(hour=parsed.hour, minute=minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    return None


def looks_rate_limited(combined_output: str) -> bool:
    lowered = combined_output.lower()
    return any(keyword in lowered for keyword in RATE_LIMIT_KEYWORDS)


class CycleOutcome:
    """Everything classify_and_act needs — kept separate from the raw success
    narration so a rate-limit check never has to scan Claude's own free-text
    work summary (see looks_rate_limited's docstring for why that matters)."""

    def __init__(self) -> None:
        self.final_result_text = ""
        self.result_is_error: bool | None = None
        self.saw_result_event = False
        self.pre_stream_lines: list[str] = []  # non-JSON lines, likely early failures
        self.last_assistant_text = ""  # overwritten each time — ends up holding the final one
        self.exit_code = 1


def stream_claude_cycle(cycle_number: int) -> CycleOutcome:
    """Run one `claude -p` cycle, printing INFO lines live as it works."""
    cmd = [
        CLAUDE_BIN,
        "-p",
        PROMPT_TEMPLATE,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        PERMISSION_MODE,
    ]
    log(f"Launching: claude -p ... --permission-mode {PERMISSION_MODE} (cwd={REPO_DIR})")

    proc = subprocess.Popen(
        cmd,
        cwd=REPO_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    outcome = CycleOutcome()

    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    transcript_path = TRANSCRIPTS_DIR / f"cycle-{cycle_number:04d}-{ts}.jsonl"
    log(f"Raw transcript for this cycle: {transcript_path}")

    assert proc.stdout is not None
    with transcript_path.open("w", encoding="utf-8") as transcript_file:
        for raw_line in proc.stdout:
            raw_line = raw_line.rstrip("\n")
            if not raw_line:
                continue

            try:
                transcript_file.write(raw_line + "\n")
            except OSError:
                pass  # transcript logging is best-effort; never let it crash the loop

            try:
                event = json.loads(raw_line)
            except json.JSONDecodeError:
                # Not a JSON event (e.g. a startup warning, or a hard CLI-level
                # rejection printed before any streaming starts — that's exactly
                # where a real "usage limit reached" message would show up).
                log(raw_line, "CLAUDE")
                outcome.pre_stream_lines.append(raw_line)
                continue

            etype = event.get("type")
            if etype == "system" and event.get("subtype") == "init":
                log(f"Session started (model={event.get('model', '?')}, "
                    f"session_id={event.get('session_id', '?')})")
            elif etype == "assistant":
                for block in event.get("message", {}).get("content", []):
                    if block.get("type") == "text":
                        text = block.get("text", "").strip()
                        if text:
                            outcome.last_assistant_text = text
                            # Keep the console readable — one line per thought,
                            # not a full essay dumped mid-stream.
                            first_line = text.splitlines()[0][:200]
                            log(f"→ {first_line}")
                    elif block.get("type") == "tool_use":
                        name = block.get("name", "?")
                        tool_input = block.get("input", {})
                        hint = tool_input.get("command") or tool_input.get("description") \
                            or tool_input.get("file_path") or tool_input.get("prompt", "")
                        hint = (str(hint)[:140] + "...") if len(str(hint)) > 140 else str(hint)
                        log(f"  tool call: {name} {hint}".rstrip())
            elif etype == "result":
                outcome.saw_result_event = True
                outcome.final_result_text = event.get("result", "") or ""
                outcome.result_is_error = bool(event.get("is_error"))
                cost = event.get("total_cost_usd")
                turns = event.get("num_turns")
                log(f"Cycle finished (is_error={event.get('is_error')}, "
                    f"cost=${cost}, turns={turns})")

    outcome.exit_code = proc.wait()
    return outcome


def classify_and_act(outcome: CycleOutcome) -> str:
    """Returns one of: "success", "nothing_actionable", "blocked", "rate_limited", "error".

    Deliberately narrow about where we look for rate-limit keywords: this
    project's own work regularly involves building real "rate limit"/
    "quota"/"throttle" features (see ADR-0007/0013/0023 etc.), so scanning
    Claude's full narration of a *successful* cycle for those words would
    false-positive constantly. Only text tied to an actual error outcome
    is scanned — the `result` event's own text when `is_error` is true,
    the last assistant text block seen before that error result (this is
    where Claude Code's own "You've hit your session limit" notice showed
    up during this tool's real supervised test, 2026-08-07 — NOT in the
    result event's text), or raw output printed before any structured
    event ever started (a hard CLI-level rejection). A successful cycle
    (is_error false/absent) never has this scan run against it at all.
    """
    if outcome.result_is_error and (
        looks_rate_limited(outcome.final_result_text)
        or looks_rate_limited(outcome.last_assistant_text)
    ):
        return "rate_limited"
    if not outcome.saw_result_event and looks_rate_limited(
        "\n".join(outcome.pre_stream_lines)
    ):
        return "rate_limited"

    analysis_text = outcome.final_result_text
    exit_code = outcome.exit_code
    match = STATUS_MARKER_RE.search(analysis_text)
    if match:
        status, rest = match.group(1), match.group(2).strip(" —-")
        if status == "ITEM_COMPLETED":
            log(f"Item completed: {rest}" if rest else "Item completed.")
            return "success"
        if status == "NOTHING_ACTIONABLE":
            log("Nothing actionable in the Next Up queue right now.")
            return "nothing_actionable"
        if status == "BLOCKED":
            log(f"Blocked, needs the project owner: {rest}" if rest else "Blocked.", "WARN")
            return "blocked"

    if exit_code != 0:
        log(f"claude exited with code {exit_code} and no recognizable status marker.", "WARN")
        return "error"

    log("claude exited cleanly but printed no LOOP_STATUS marker — treating as "
        "an error so a human notices; check loop.log for the full transcript.", "WARN")
    return "error"


def sleep_with_heartbeat(seconds: int, reason: str) -> None:
    """Sleep in short slices so Ctrl-C / the STOP file are honored promptly.

    Confirmed as a real bug during this tool's own manual testing
    (2026-08-07): the original version slept in 60-second chunks, relying
    on `time.sleep()` being interrupted early when SIGINT arrives. Python
    3.5+'s PEP 475 auto-retries an interrupted syscall for the REMAINING
    duration as long as the registered signal handler returns normally
    (ours does — it just logs and sets a flag, doesn't raise) — so the
    60-second `time.sleep()` call was silently restarting itself instead
    of returning early, meaning Ctrl-C did nothing until the current
    60-second slice happened to finish on its own. A real terminal test
    needed ~14 Ctrl-C presses before giving up and using Ctrl-Z instead.
    One-second slices bound the worst-case reaction latency to roughly a
    couple of seconds regardless of this auto-retry behavior, at the cost
    of one cheap `stop_requested()` check per second while sleeping.
    """
    wake_at = datetime.now() + timedelta(seconds=seconds)
    log(f"Sleeping {seconds // 60} min ({reason}) — next check around "
        f"{wake_at.strftime('%Y-%m-%d %H:%M:%S')} local time.")
    remaining = seconds
    slice_seconds = 1
    while remaining > 0 and not stop_requested():
        time.sleep(min(slice_seconds, remaining))
        remaining -= slice_seconds


def main() -> int:
    global PERMISSION_MODE

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-cycles", type=int, default=None,
                         help="Stop after this many cycles (default: run forever).")
    parser.add_argument("--permission-mode", default=PERMISSION_MODE,
                         help=f"Passed through to `claude -p`. Default: {PERMISSION_MODE}.")
    args = parser.parse_args()

    PERMISSION_MODE = args.permission_mode

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    log(f"=== Autonomous loop starting (repo={REPO_DIR}, branch={BRANCH}, "
        f"permission_mode={PERMISSION_MODE}) ===")
    log(f"Stop this loop cleanly at any time with Ctrl+C, or `touch {STOP_FILE}` "
        f"from anywhere with filesystem access.")

    cycle = 0
    consecutive_failures = 0

    while not stop_requested():
        if args.max_cycles is not None and cycle >= args.max_cycles:
            log(f"Reached --max-cycles={args.max_cycles}. Stopping.")
            break
        cycle += 1
        log(f"--- Cycle {cycle} ---")

        if not ensure_clean_branch():
            log("Pausing before retrying branch setup.", "ERROR")
            sleep_with_heartbeat(SHORT_RETRY_BACKOFF_SECONDS, "branch setup failed")
            continue

        try:
            cycle_outcome = stream_claude_cycle(cycle)
        except FileNotFoundError:
            log(f"Could not find the `{CLAUDE_BIN}` executable on PATH. "
                "Install/authenticate Claude Code, then rerun this script.", "ERROR")
            return 1
        except Exception as exc:  # noqa: BLE001 — a loop daemon must not crash on surprises
            log(f"Unexpected error launching claude: {exc!r}", "ERROR")
            consecutive_failures += 1
            if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                log("Too many consecutive failures — pausing for a longer interval "
                    "so a human notices. Consider stopping and checking loop.log.", "ERROR")
                sleep_with_heartbeat(FAILURE_PAUSE_SECONDS, "repeated failures")
                consecutive_failures = 0
            else:
                sleep_with_heartbeat(SHORT_RETRY_BACKOFF_SECONDS, "retry after error")
            continue

        classification = classify_and_act(cycle_outcome)

        if classification == "success":
            consecutive_failures = 0
            sleep_with_heartbeat(CYCLE_COOLDOWN_SECONDS, "cooldown between cycles")
        elif classification == "nothing_actionable":
            consecutive_failures = 0
            sleep_with_heartbeat(IDLE_SLEEP_SECONDS, "nothing actionable")
        elif classification == "blocked":
            consecutive_failures = 0
            sleep_with_heartbeat(IDLE_SLEEP_SECONDS, "item blocked on project owner")
        elif classification == "rate_limited":
            # Try every place the actual reset-time text could be, in the
            # same priority order classify_and_act checked for the
            # rate-limit keywords themselves.
            reset_source = "\n".join(filter(None, [
                cycle_outcome.final_result_text,
                cycle_outcome.last_assistant_text,
                "\n".join(cycle_outcome.pre_stream_lines),
            ]))
            reset_at = try_parse_reset_time(reset_source)
            if reset_at:
                wait_seconds = max(60, int((reset_at - datetime.now()).total_seconds()))
                wait_seconds = min(wait_seconds, RATE_LIMIT_MAX_SLEEP_SECONDS)
                log(f"Usage limit hit — parsed a reset time around "
                    f"{reset_at.strftime('%Y-%m-%d %H:%M:%S')}.", "WARN")
                sleep_with_heartbeat(wait_seconds, "usage limit, parsed reset time")
            else:
                log("Usage limit (or weekly limit) hit — could not parse an exact "
                    "reset time from the output, polling periodically instead.", "WARN")
                sleep_with_heartbeat(RATE_LIMIT_POLL_SECONDS, "usage limit, polling")
        else:  # error
            consecutive_failures += 1
            log(f"Cycle {cycle} ended in an unrecognized state "
                f"({consecutive_failures}/{MAX_CONSECUTIVE_FAILURES} consecutive).", "WARN")
            if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                log("Too many consecutive failures — pausing for a longer interval "
                    "so a human notices. Check loop.log for what's going wrong.", "ERROR")
                sleep_with_heartbeat(FAILURE_PAUSE_SECONDS, "repeated failures")
                consecutive_failures = 0
            else:
                sleep_with_heartbeat(SHORT_RETRY_BACKOFF_SECONDS, "retry after error")

    log("=== Autonomous loop stopped ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
