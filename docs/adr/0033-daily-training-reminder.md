# 0033 - A calm daily training reminder, local to the device

## Status

Accepted 2026-08-22. Project owner's request: *"How can we make sure our
users when they download our app continue using the app and keeping their
streak? We need some sort of reminder."*

Supersedes nothing. Narrows the "No push notification" note in
[ADR-0024](0024-streak-savers.md) Decision 3 — that ruled push out of the
streak-saver change, not out of the product.

## Context

The app has no notification infrastructure of any kind: no
`expo-notifications`, no push tokens, no server send path, no permission
prompt anywhere in `mobile/src`.

It does already have the mechanic that prevents the worst retention
failure. ADR-0024's streak savers bank up to four grace days and spend
them automatically, so a child who misses a day does not lose a long
streak and quit. What is missing is the smaller thing: a reason to open
the app on a day they would otherwise forget.

**The constraint that shapes this decision is the product's own premise.**
This app exists to pull 9–13-year-olds away from TikTok and Snapchat's
compulsion loops. Streak-urgency notifications — escalating nudges,
evening pings, "your streak is about to die" — are the same mechanic those
apps use, and are the most-criticised part of Duolingo's design. Building
that here would work in the short term and contradict the reason the app
exists.

## Decision 1 — Local notifications, not push

The reminder is scheduled on the device by `expo-notifications` and never
involves the server.

This is not a compromise; it is the correct mechanism for what was asked.
"Remind me to train today" depends only on the time of day and whether the
child has already logged — both of which the device knows. A server round
trip would add nothing to the reminder and a great deal to everything
else.

What it avoids is the whole reason ADR-0024 declined push: no push token
(a new personal-data category, on a children's app, requiring a lawful
basis and a privacy-policy entry that does not exist yet), no server send
path, no new answers on Apple's App Privacy or Play's Data Safety forms —
both of which are already blocking release
([`LAUNCH-CHECKLIST.md`](../LAUNCH-CHECKLIST.md) §1.3). It also works
offline, which a reminder to go and train very reasonably should.

**Push is deferred, not rejected.** The cases it would genuinely serve are
social and cannot be known by the device: a teammate has challenged you,
the team is close to its VM-guld, a parent has approved sharing. The team
goal is plausibly a stronger retention lever than any individual streak
nudge. That deserves its own ADR, its own consent question and its own
store declarations, after the legal documents are signed off.

## Decision 2 — One reminder a day, at a time the child chooses, never at night

- **One notification per day.** No second chance, no escalation, no
  "you're about to lose it" follow-up.
- **The child picks the time**, from a bounded set of sensible hours.
- **Quiet hours are enforced by construction**: the picker offers nothing
  before 08:00 or after 20:00, so a reminder cannot land at bedtime or
  wake a child. This is a hard bound in code, not a default.
- **Nothing is sent on a day already logged.** The app reschedules on
  every training log, so a child who has trained is not told to train.
- **Off by default.** The OS permission prompt appears only when the child
  turns the reminder on — never on first launch, where it would be one
  more thing to dismiss before the app has earned anything.

## Decision 3 — The copy carries no urgency

The message says it is time to train and mentions the streak only as
encouragement. It never counts down, never warns, and never implies loss.
Streak savers mean a missed day genuinely is not a catastrophe, so the
copy is allowed to be honest about that.

Rejected: streak-at-risk reminders, "you'll lose N days" language, and any
notification whose content depends on how much the child stands to lose.
Those are the mechanic this app positions itself against, and choosing
them would need to be a deliberate product decision by the owner rather
than a default that crept in through a retention feature.

## Decision 4 — Local persistence reuses `secureStorage`, not a new dependency

The enabled flag and the chosen hour live in `localFlags.ts` behind
`secureStorage` (SecureStore on native, `localStorage` on web), exactly as
the existing bonus-banner and captain flags do — that file already
explains why it avoided adding AsyncStorage for one small value, and this
is one more small value.

Nothing about the reminder reaches the server. The server does not know
whether a child has one, and does not need to.

## Consequences

- A new OS permission surface on a child-directed app, which both stores
  will ask about. The answer is simple and good: local notifications only,
  no tokens, no data leaves the device.
- `expo-notifications` is a native module, so this needs a new build
  before it can be tested on a device.
- If push is added later, Decision 2's bounds should carry over rather
  than being re-litigated per surface.
