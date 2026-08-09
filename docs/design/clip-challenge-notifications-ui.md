# Clip-challenge notifications — client UX

Scope: the four client-UX pieces `docs/adr/0021-clip-challenge-notifications.md`'s
hand-off note assigns to ux-designer — pending-challenges surface placement/
visuals in the **Laget** (Team) tab, the exact ack-trigger interaction, the
chat system-message bubble's visual treatment, and the exact Swedish/English
copy for the challenge-announcement chat template — plus concrete component-
tree placement, full copy tables, and an explicit states/edge-cases list.
Written for **frontend-developer** to implement against `mobile/src/team/`
and `mobile/src/chat/`; the two new endpoints and the two ADR-flagged
binding backend requirements (system-message report-rejection guard,
`teamJoinStatus` tag-picker tightening) are **backend-developer's**, not
designed here — this doc only confirms where the client already behaves
correctly against them and where it needs a matching guardrail of its own.

**Read first:** `docs/adr/0021-clip-challenge-notifications.md` in full,
including its 2026-08-06 security-reviewer addendum at the top.
`mobile/src/team/TeamScreen.tsx` (the screen this design adds a new section
to — read its existing `pendingJoins` block closely, §1 mirrors its
placement/failure-handling idiom on purpose), `mobile/src/team/components/
PendingJoinRow.tsx` (the closest existing row pattern, reused for layout —
not code), `mobile/src/chat/ChatScreen.tsx` + `mobile/src/chat/components/
MessageBubble.tsx` (§3 extends this directly), `mobile/src/chat/components/
ClipEmbed.tsx` (reused as-is inside the new system bubble, no changes
needed there), `mobile/src/clips/ClipsScreen.tsx`'s `checkForChallengeBanner`
and `mobile/src/api/localFlags.ts`'s `getSeenChallengeClipIds`/
`addSeenChallengeClipId` (removed by this design, per the ADR's own
"supersedes" note), `mobile/src/clips/upload/V5CaptionChallenge.tsx` (the
tag-picker the ADR's addendum flags — confirmed compatible as-is, §7),
`mobile/src/navigation/TabBar.tsx` + `mobile/src/AppShell.tsx` (the
"presence, not count" tab-dot convention this design extends to a fifth
tab), and `mobile/src/theme/colors.ts` (token conventions this design
follows for two new tokens).

---

## 0. What's fixed by the ADR vs. what this design decides

Fixed, not re-litigated here:

- `GET .../clips/challenges/pending` → `{ challenges: [{ clipId,
  uploaderPlayerId, uploaderScreenName, uploaderAvatarId, caption,
  playbackUrl, createdAt }] }` and `POST .../clips/:clipId/challenge-ack`
  → `{ clipId, acknowledged: true }`, idempotent. No pagination.
- `TeamChatMessage.authorType: 'player' | 'system'`,
  `systemEventType: 'clip_challenge_issued' | null`. A system row's
  `content` is a **fixed, server-rendered string, baked in once at publish
  time, always Swedish** — never looked up client-side, never re-resolved
  live. Its `senderPlayerId` is always `NULL`; its `clip` block resolves
  exactly like any other message's (live, per ADR-0017 Decision 2).
- Report is server-rejected for `authorType = 'system'` rows (binding,
  backend-developer). Block is structurally inert against them for free.
- `taggedPlayerId` will require `tagged.teamJoinStatus === APPROVED` at
  `createUploadUrl` time (binding, backend-developer's choice of exact
  error shape — see §7).

Decided here: everything about how the tagged player *finds out* and
*clears* the notification, and how the announcement *looks* in chat. Two
new color tokens (`systemMessageBg`/`systemMessageBorder`) are minted
per-§3, following this codebase's stated "a new token pair per new
meaning" convention (see `colors.ts`'s `tipBg`/`freshStartBg` comments).

---

## 1. Pending-challenges surface — the "Laget" tab

### 1.1 Placement

A new section in `TeamScreen.tsx`, inserted **first**, directly under the
`k1.heading` title and above `ConsentChips` — the most prominent position
on the screen, ahead even of the captain-only pending-joins block. Reasoning:
pending-joins is administrative and captain-only; a pending challenge is
personal, exciting, per-player content ("someone challenged *you*") — the
one thing on this whole tab a kid actually wants to see first. Only
rendered while non-empty (no empty state — a card that says "no challenges"
would be exactly the kind of clutter the task asked this design to avoid).

```tsx
<ScrollView contentContainerStyle={styles.content}>
  <Text style={styles.heading}>{t('k1.heading')}</Text>

  {pendingChallenges.length > 0 ? (
    <>
      <Text style={styles.sectionLabel}>
        {t('k1.pendingChallengesHeading', { count: pendingChallenges.length })}
      </Text>
      <View style={styles.teammatesCard}>
        {pendingChallenges.map((challenge) => (
          <ChallengeRow
            key={challenge.clipId}
            uploaderScreenName={challenge.uploaderScreenName}
            uploaderAvatarId={challenge.uploaderAvatarId}
            caption={challenge.caption}
            playbackUrl={challenge.playbackUrl}
            acking={ackingClipId === challenge.clipId}
            onWatch={() => handleWatchChallenge(challenge)}
            onDismiss={() => void handleDismissChallenge(challenge)}
          />
        ))}
      </View>
    </>
  ) : null}

  <ConsentChips ... />
  {/* ...pendingJoins, weeklyGoal, teammates, invite, teamPool, captain — unchanged */}
</ScrollView>

<ChallengeClipModal
  challenge={activeChallenge}
  onClose={() => setActiveChallenge(null)}
/>
```

Reuses the exact `styles.teammatesCard` container TeamScreen already has
(white card, hairline border, `borderRadius: 16`) — this is a sibling
section to "Väntar på godkännande," not a new visual language.

### 1.2 `ChallengeRow` — new component, `mobile/src/team/components/ChallengeRow.tsx`

Modeled directly on `PendingJoinRow.tsx`'s avatar-circle + name + action
layout, extended with a small static clip thumbnail (reusing
`PausedClipThumbnail` verbatim — no new video-frame-capture mechanism) and
**two physically separate tap zones**, matching this codebase's own
established rule for exactly this shape of problem (`ClipCard`'s "three
physically separate tap zones," `MessageBubble`'s avatar-vs-body split):
watching and dismissing must never be one accidental mis-tap apart.

```
┌──────────────────────────────────────────────────┐
│ ┌──────┐  Anna utmanade dig! 🎯                   │
│ │ thumb│  "Kolla min fintteknik 😎"                │
│ │ 9:16 │  Titta →                     Redan sett  │
│ └──────┘                                          │
└──────────────────────────────────────────────────┘
```

- **Zone 1 — the whole row except the dismiss link** (thumbnail + title +
  caption + "Titta →"): one `Pressable`, `onPress={onWatch}`. This is the
  large, obvious, default tap target per the task's own instruction — a
  kid tapping anywhere on this row *except* the one small link gets to
  watch the clip.
- **Zone 2 — "Redan sett"**: a small, separate `Pressable`, bottom-right,
  own `hitSlop`, visually de-emphasized (`textMuted`, no icon) so it never
  competes with Zone 1 for attention — an escape hatch, not a peer action.

Props:

```ts
interface ChallengeRowProps {
  uploaderScreenName: string;
  uploaderAvatarId: string;
  caption: string | null;
  playbackUrl: string; // passed straight to PausedClipThumbnail
  acking: boolean; // true while this row's own ack call is in flight
  onWatch: () => void;
  onDismiss: () => void;
}
```

Layout notes: thumbnail `44×62` (9:16, `borderRadius: 8`,
`backgroundColor: colors.ink`, same portrait-shape convention as
`ClipGridCell`); title bold `colors.ink`; caption `colors.textMuted`,
`numberOfLines={1}`, omitted entirely when `null`; "Titta →" bold
`colors.flame` (this is *your* personal notification, the individual-streak
motif's color, not `gold` — a single clip challenge between two players
isn't a team-pool event); "Redan sett" `colors.textMuted`, smaller, no
bold.

### 1.3 Tab-bar badge

Extends `TabBar.tsx`'s existing "presence, not count" dot convention
(already used for Mål/Chatt/Klipp) to the **Laget** tab — a fifth boolean
dot, not a fourth exception:

```ts
// TabBar.tsx
interface TabBarProps {
  // ...existing goalTabDot/chatTabDot/clipsTabDot...
  /** New — presence dot for unacknowledged clip challenges, identical
   * convention to the other three. */
  teamTabDot?: boolean;
}
// showDot gains: || (tab.key === 'team' && teamTabDot)
```

`AppShell.tsx` gains a fifth foreground check, `checkForPendingChallenges`,
identical shape to `checkForUnreadChat`/`checkForUnreadClips` (§1.4), and a
new `teamChallengesPending` state feeding `teamTabDot`.

### 1.4 Data flow

**Fetch:** `TeamScreen.fetchAll` adds `getPendingClipChallenges(teamId)` to
its existing `Promise.all([getTeamDashboard, getTeammates])` — every
player, not captain-gated (unlike the adjacent `pendingJoins` fetch), but
still **wrapped in its own try/catch defaulting to `[]`**, mirroring the
captain-only `pendingJoins` fetch's own non-critical-failure posture: a
transient failure to load challenges shouldn't block the rest of the tab,
and a `403` from `assertConsentApproved`/`assertTeamJoinApproved` on the
requester (a not-yet-approved player, per Decision 3's unchanged
requester-side gate) is handled the same way — the section just doesn't
render, no error surfaced (see §6).

```ts
try {
  const pendingChallengesResponse = await getPendingClipChallenges(teamId);
  setPendingChallenges(pendingChallengesResponse.challenges);
  onChallengesChanged(pendingChallengesResponse.challenges.length > 0);
} catch {
  setPendingChallenges([]);
  onChallengesChanged(false);
}
```

**New `TeamScreenProps` field:** `onChallengesChanged: (hasPending: boolean)
=> void` — called on every fetch and every successful ack, so `AppShell`
can clear/set `teamTabDot` immediately from data the screen already has,
without a second network round-trip. Exact same "tell the parent directly,
don't wait for the next foreground poll" idiom `onCaptainTransferred`
already uses.

**`AppShell`'s own check** (independent, for the badge to be visible
*before* the tab is ever opened):

```ts
const checkForPendingChallenges = useCallback(async (resolvedTeamId: string) => {
  try {
    const response = await getPendingClipChallenges(resolvedTeamId);
    setTeamChallengesPending(response.challenges.length > 0);
  } catch {
    // Non-critical — same posture as the other three foreground checks.
  }
}, []);
// added to runForegroundChecks' Promise.all alongside the existing three
```

New endpoint-client functions, matching this file's exact existing
convention (`getTeammates`/`getPendingJoins` shape):

```ts
export function getPendingClipChallenges(teamId: string): Promise<PendingChallengesResponse> {
  return apiClient.request<PendingChallengesResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/challenges/pending`,
    { auth: true },
  );
}

export function ackClipChallenge(teamId: string, clipId: string): Promise<ChallengeAckResponse> {
  return apiClient.request<ChallengeAckResponse>(
    `/teams/${encodeURIComponent(teamId)}/clips/${encodeURIComponent(clipId)}/challenge-ack`,
    { method: 'POST', auth: true },
  );
}
```

New `mobile/src/api/types.ts` shapes (additive, mirrors the ADR's sketch
exactly):

```ts
export interface PendingChallengeEntry {
  clipId: string;
  uploaderPlayerId: string;
  uploaderScreenName: string;
  uploaderAvatarId: string;
  caption: string | null;
  playbackUrl: string;
  createdAt: string;
}
export interface PendingChallengesResponse { challenges: PendingChallengeEntry[]; }
export interface ChallengeAckResponse { clipId: string; acknowledged: true; }
```

---

## 2. The ack-trigger interaction — the decision

**Two triggers, not one, each firing the same idempotent `POST
.../challenge-ack` — deliberately asymmetric in how failure is surfaced,
justified below.**

### 2.1 Trigger A (primary): watching the clip

Tapping Zone 1 of a `ChallengeRow` **immediately** opens
`ChallengeClipModal` and starts playback — it does not wait on the network.
The ack call fires in parallel:

```ts
const handleWatchChallenge = (challenge: PendingChallengeEntry) => {
  setActiveChallenge(challenge); // opens the modal now, no spinner
  void ackClipChallenge(teamId, challenge.clipId)
    .then(() => {
      setPendingChallenges((prev) => {
        const next = prev.filter((c) => c.clipId !== challenge.clipId);
        onChallengesChanged(next.length > 0);
        return next;
      });
    })
    .catch(() => {
      // Silent — see 2.3. The row simply stays pending and will retry
      // the ack next time it's tapped (idempotent, no harm either way).
    });
};
```

**Ack fires on *opening* the clip, not on watch-to-completion.** This
codebase doesn't track watch-completion/progress anywhere else (no
scrubber telemetry, no "watched %" field on any clip), and building that
just for this one ack condition would be new product surface nobody asked
for — the same "don't build a state machine nobody requested" instinct
ADR-0021 itself already applied to challenge *state* (Decision 1). "Opened
it" is a real, meaningful signal on its own: the player made a deliberate
choice to engage with this specific notification, which is a stronger
signal than "the list happened to be on screen" (§2.3) without adding any
new tracking machinery.

### 2.2 Trigger B (secondary): "Redan sett" (explicit dismiss, no watch)

Tapping Zone 2 calls the ack endpoint directly, no modal, matching
`TeamScreen.handleApprove`/`handleReject`'s exact existing
await-then-toast idiom:

```ts
const handleDismissChallenge = async (challenge: PendingChallengeEntry) => {
  setAckingClipId(challenge.clipId);
  try {
    await ackClipChallenge(teamId, challenge.clipId);
    setPendingChallenges((prev) => {
      const next = prev.filter((c) => c.clipId !== challenge.clipId);
      onChallengesChanged(next.length > 0);
      return next;
    });
    setToastMessage(t('k1.challengeAckedToast', { screenName: challenge.uploaderScreenName }));
  } catch {
    setToastMessage(t('k1.challengeAckErrorToast'));
  } finally {
    setAckingClipId(null);
  }
};
```

**Why this exists at all, not just Trigger A:** the same clip is very
plausibly already visible elsewhere before a player ever opens the Laget
tab — most concretely, the new chat system message (§3) embeds the same
clip, and per `TabBar.tsx`'s own comment, Chatt is "the one surface a kid
plausibly opens several times a day" while Laget is "opened least often of
all." A kid who already watched the clip in team chat and comes to Laget
later shouldn't be forced to re-watch it just to clear a badge — that
would be exactly the kind of manufactured chore this app's own constraints
rule out ("no manipulative streak-loss guilt trips aimed at children,"
extended here to "no manufactured re-watch requirement either"). Trigger B
is the required safety valve, not a nice-to-have.

### 2.3 Why *not* auto-ack on merely rendering the list

Explicitly rejected: firing the ack call the instant `pendingChallenges`
is fetched/rendered (i.e., the moment the Laget tab happens to be open)
would silently reintroduce the exact bug this ADR exists to fix. The old
`AsyncStorage` toast was "easy to miss ... lost on reinstall" specifically
*because* seeing was conflated with acknowledging — a kid who opened the
Klipp tab without noticing a fast-scrolling toast still had it marked
"seen," permanently. A tab-badge dot that can clear itself the instant the
tab is opened, before the kid has even looked at the list, has the
identical failure mode: open Laget for an unrelated reason (e.g. to check
the invite code), the dot vanishes, the challenge is now effectively as
invisible as the old toast — durable storage doesn't fix a UX shape that
was the actual bug. Both triggers above require a real, specific action
against a real, specific challenge (open *this* clip, or explicitly
dismiss *this* one) — never a side effect of the screen simply being
visible.

### 2.4 Failure-handling asymmetry, justified

- **Trigger A's ack failure is silent** (2.1's `.catch` does nothing
  user-visible): the meaningful thing the player wanted — watching the
  clip — already succeeded the moment the modal opened. An ack-bookkeeping
  failure here is genuinely non-critical (idempotent, retried for free the
  next time this same row is tapped, or picked up by nothing worse than
  "the badge stays on one extra day"), and interrupting a kid mid-watch
  with an error toast about a background bookkeeping call they never asked
  about would be a worse experience than just quietly retrying later —
  the same "non-critical, silently retry" posture this app already applies
  to `checkForUnreadChat`/`checkForUnreadClips`/`fetchConsentStatus`.
- **Trigger B's ack failure gets a toast** (2.2): here the ack call *is*
  the entire point of the tap — nothing else happened as a result of
  pressing "Redan sett." Without visible failure feedback, a kid would
  have no way to know the tap didn't work, and the row would just silently
  fail to disappear with no explanation. Matches `k1.approveErrorToast`/
  `k1.rejectErrorToast`'s exact existing precedent for "the tap's only
  effect is this one API call, so its failure needs to be visible."

---

## 3. Chat system-message bubble

### 3.1 `MessageBubble.tsx` changes

A system row (`message.authorType === 'system'`) needs a **third layout
variant**, not a variant of `isOwn`/`!isOwn` — today's component only knows
two (`rowMine`/`rowTheirs`), both edge-aligned and both assuming a real
sender exists. `isSystem` must be checked **before** `isOwn` branching,
since `isOwn` (`message.senderPlayerId === viewerPlayerId`) evaluates to
`false` for a system row today (`null !== <any playerId>`) — without an
explicit check, a system message would silently fall through to the
ordinary `rowTheirs`/left-aligned/white-bubble treatment, exactly the
"looks like an ordinary player message" outcome Decision 2/3 explicitly
rule out.

```ts
const isSystem = message.authorType === 'system';
// ...
const canReportMessage = !isOwn && !isSystem; // client-side mirror of the
  // backend's binding report-rejection guard (ADR-0021 Decision 3,
  // security-reviewer finding 1) — belt-and-suspenders: even though the
  // server will 400 a report attempt against a system row regardless, the
  // UI should never *offer* an action guaranteed to fail. "Design the
  // guardrail, not just the happy path."
```

```tsx
{!isOwn && !isSystem ? (
  <Pressable onPress={onTapSender} ...>{/* existing sender row, unchanged */}</Pressable>
) : null}

<Pressable
  onPress={canReportSomething ? onTapBody : undefined}
  style={[
    styles.bubble,
    isSystem ? styles.bubbleSystem : isOwn ? styles.bubbleMine : styles.bubbleTheirs,
  ]}
  accessibilityLabel={
    isSystem ? t('systemMessage.a11yPrefix', { content: message.content }) : undefined
  }
>
  {message.content ? <Text style={[styles.content, isSystem && styles.contentSystem]}>{message.content}</Text> : null}
  {clip ? <ClipEmbed clip={clip} ... /> : showClipPlaceholder ? <ClipUnavailablePlaceholder /> : null}
</Pressable>
```

`row` gains a third variant too — **centered, not edge-aligned** (a system
announcement isn't "from" either side of the conversation):

```ts
rowSystem: { alignSelf: 'center', alignItems: 'center', maxWidth: '92%' },
bubbleSystem: {
  backgroundColor: colors.systemMessageBg,
  borderWidth: 1,
  borderColor: colors.systemMessageBorder,
  borderRadius: 14, // symmetric — no asymmetric "speech-bubble tail"
                     // corner the way bubbleMine/bubbleTheirs have, since
                     // this bubble isn't pointing at anyone.
},
contentSystem: { textAlign: 'center' },
```

**No new avatar/name chrome is added to replace the omitted sender row** —
per the ADR's own hand-off note ("no avatar/sender name the way a normal
message has one"), and because the templated `content` text already names
both players in plain language (§4.1) — a redundant "SYSTEM" label on top
of a sentence that already says "Anna utmanade Karl" would be visual
noise, not clarity. The centered layout + distinct fill + no avatar/name
row together are enough to read as "not a person" at a glance; the
`accessibilityLabel` above carries that same distinction for a screen
reader, which can't infer it from layout alone.

Everything else about the bubble — the `ClipEmbed`, its attribution line,
its own block/report affordances, the timestamp — is **reused completely
unchanged**. `showAttribution` (`clip.uploaderPlayerId !==
message.senderPlayerId`) already evaluates to `true` for every system row
(`uploaderPlayerId !== null`), so "Klipp av {{uploaderScreenName}}" already
renders correctly under the embed with zero special-casing — confirmed by
reading the existing computation, not assumed. `onTapClipUploader` /
block-the-uploader and "Rapportera klippet" both keep working exactly as
they do on any other message, since both key off `clip.uploaderPlayerId`,
never `message.senderPlayerId`.

### 3.2 New color tokens (`colors.ts`)

```ts
/** System-message bubble fill + border (docs/design/
 * clip-challenge-notifications-ui.md §3) — the chat-history announcement
 * for a video-clip challenge, the app's first-ever system-authored
 * message. Deliberately its own token, not reused from `tipBg`/
 * `goldRowTint` (both a different meaning: an onboarding tip / "this is
 * my team's row"), following this file's own established "new token per
 * new meaning" convention. A warm, pale gold-neutral — ties loosely to
 * the team-wide "something happened" register without being the
 * saturated `gold` fill, which style-guide.md reserves for the team pool
 * specifically. */
systemMessageBg: '#FFF3DC',
systemMessageBorder: '#FFD27A',
```

### 3.3 Mockup

```
                ┌───────────────────────────────────────┐
                │  🎯 Anna utmanade Karl med en video!   │
                │                                        │
                │        ┌──────────────┐                │
                │        │   ▶  video   │                │
                │        │   (9:16)     │                │
                │        └──────────────┘                │
                │        Klipp av Anna                   │
                └───────────────────────────────────────┘
                              14:32
```

Centered in the message list, pale-gold pill, no avatar, no name row —
visually distinct at a glance from either a left-aligned teammate bubble
(white) or a right-aligned own bubble (lavender `pausedBg`), and from both
of those in alignment too (centered vs. edge-anchored).

---

## 4. Copy

### 4.1 The server-rendered template — not an i18n key

Per Decision 2, `content` is rendered **once, server-side, always in
Swedish**, at the moment `completeUpload` transitions the clip to
`published`. It is never looked up via `t()` at read time (the ADR's own
"Left open" section explicitly defers per-viewer i18n of this field to a
future ADR). This is therefore a **literal string template for
backend-developer to implement directly**, not a `chat.json` key:

| | Template |
|---|---|
| Swedish (ships now, the only version actually sent) | `🎯 {{uploaderScreenName}} utmanade {{taggedScreenName}} med en video!` |
| English (documented now for the deferred future per-viewer-i18n pass the ADR flags — **not wired into any code path today**) | `🎯 {{uploaderScreenName}} challenged {{taggedScreenName}} with a video!` |

Tone/wording call: short, single sentence, reuses the exact 🎯 icon and
"utmana(de)" verb already established everywhere else this concept appears
in this codebase (`v2.challengeBanner`, `clipCard.challengeChip`,
`v5.challengeLabel`) rather than inventing new vocabulary. Both names are
plain data substitutions — no other variable content, matching Decision
2's fixed-template guarantee exactly.

### 4.2 Client-rendered i18n — `chat.json`

Only the bubble's *chrome* is real client-side i18n (the sentence above is
not); this is the accessibility label distinguishing the bubble as
automated, read by a screen reader before the templated sentence itself:

| Key | Swedish | English |
|---|---|---|
| `systemMessage.a11yPrefix` (`{{content}}`) | "Automatiskt lagmeddelande: {{content}}" | "Automatic team message: {{content}}" |

### 4.3 Client-rendered i18n — `team.json`

New keys under `k1.*` (Laget tab, §1) and a new `challengeRow.*` /
`challengeClipModal.*` namespace (§1.2, §1.5 below):

| Key | Swedish | English |
|---|---|---|
| `k1.pendingChallengesHeading` (`{{count}}`) | "🎯 Utmaningar till dig ({{count}})" | "🎯 Challenges for you ({{count}})" |
| `k1.challengeAckedToast` (`{{screenName}}`) | "Utmaningen från {{screenName}} är markerad som sedd." | "The challenge from {{screenName}} is marked as seen." |
| `k1.challengeAckErrorToast` | "Kunde inte markera utmaningen som sedd. Testa igen." | "Couldn't mark the challenge as seen. Try again." |
| `challengeRow.title` (`{{screenName}}`) | "{{screenName}} utmanade dig!" | "{{screenName}} challenged you!" |
| `challengeRow.watchCta` | "Titta →" | "Watch →" |
| `challengeRow.dismissCta` | "Redan sett" | "Already seen" |
| `challengeRow.a11yLabel` (`{{screenName}}`) | "Utmaning från {{screenName}}. Tryck för att titta." | "Challenge from {{screenName}}. Tap to watch." |
| `challengeClipModal.heading` (`{{screenName}}`) | "{{screenName}} utmanade dig! 🎯" | "{{screenName}} challenged you! 🎯" |
| `challengeClipModal.close` | "Stäng" | "Close" |
| `challengeClipModal.playError` | "Kunde inte spela videon." | "Couldn't play the video." |

### 4.4 `clips.json` updates — one removal, one rewrite

**Remove `v2.challengeBanner`** (all 8 locales) — dead the moment
`ClipsScreen`'s `checkForChallengeBanner`/`challengeBanner` toast is
deleted (§5, this design supersedes it entirely, not alongside it, per the
ADR's own explicit instruction).

**Rewrite `v5.taggedHelper`** — the existing copy ("X sees it next time
they open Shorts") becomes actively wrong the moment this ships, since the
tagged player now finds out almost immediately via chat + the Laget tab
badge, not "next time they happen to open Shorts":

| Key | Old (Swedish) | New (Swedish) | New (English) |
|---|---|---|---|
| `v5.taggedHelper` (`{{screenName}}`) | "{{screenName}} ser att du utmanat dem nästa gång de öppnar Shorts." | "{{screenName}} ser utmaningen direkt — i lagchatten och på Laget-fliken." | "{{screenName}} will see the challenge right away — in the team chat and on the Team tab." |

### 4.5 Other locales

`cs`/`fi`/`de`/`nb`/`da`/`fr` get the same best-effort-AI-then-native-review
pass for every new/changed key above (§4.2–4.4), per
`clip-library-grid.md`'s already-established convention for this repo — no
new i18n machinery, same flat-key/`{{var}}` shape used everywhere else.

---

## 5. `ChallengeClipModal` — new component, `mobile/src/team/components/ChallengeClipModal.tsx`

A dedicated, deliberately smaller sibling of `clips/components/
ClipPlayerModal.tsx` — not a reuse, because `ClipPlayerModal` is typed
against `ClipFeedItem` (`taggedPlayerId`, `taggedScreenName`,
`reportedByMe`, etc.), fields the pending-challenges response doesn't
carry (§0's fixed contract). Forcing those fields to fake values just to
reuse the component would be worse than a small, honest, purpose-built
one.

```ts
interface ChallengeClipModalProps {
  /** `null` = closed, same convention as every other `xTarget: T | null`
   * modal in this codebase. */
  challenge: PendingChallengeEntry | null;
  onClose: () => void;
}
```

Full-screen, dark background, same `aspectRatio: 9/16` video treatment as
`ClipPlayerModal`/`ClipCard`, tap-to-play/pause, mute toggle — all lifted
verbatim from the existing `VideoView` pattern already used three other
places in this codebase. Header: `challengeClipModal.heading` with the
uploader's screen name, close (✕) button top-right (`challengeClipModal
.close` as the a11y label, same as `clipPlayerModal.close`). Caption below
the video if present (`numberOfLines={2}`).

**Deliberately omits report/delete** — a real scope cut, stated explicitly
rather than silently dropped:

- **Delete** never applies — the viewer is always the *tagged* player here,
  never the uploader (self-tagging is already prevented client-side by
  `V5CaptionChallenge`'s own teammate-list filter).
- **Report** is left out of this specific surface because the
  pending-challenges response contract (§0, fixed by the ADR) has no
  `reportedByMe` field, so this modal has no reliable way to know whether
  the clip's already been reported — showing a report control that might
  silently misrepresent that state is worse than not showing one. This is
  not a real gap in the child-safety flow: **the identical clip is always
  independently reachable, with full report support, via the ordinary
  Shorts feed** (any `published` clip appears there regardless of tagging)
  **and via the chat system message's own `ClipEmbed`** (§3.1, "Rapportera
  klippet" fully functional there). A kid who wants to report this specific
  video always has two other one-tap-away paths to do it from; this modal
  just isn't a third one.

---

## 6. States and edge cases

- **Zero pending challenges** — §1's section is omitted entirely from
  `TeamScreen`; no tab dot; `AppShell`'s `teamChallengesPending` is
  `false`. Not a bug, not a "loading" state — a completely ordinary steady
  state most players are in most of the time.
- **1–N pending challenges** — section renders, each as a `ChallengeRow`,
  no pagination (bounded by team size, per the ADR's own reasoning for
  omitting pagination from the endpoint itself).
- **Requester not yet consent/team-join-approved** — `GET .../challenges/
  pending` 403s (unchanged requester-side gate, §0). Handled identically to
  any other non-critical fetch failure on this screen (§1.4): swallowed,
  section simply doesn't render. Unlike Chatt/Klipp, `TeamScreen` has never
  gated its whole body behind consent (ADR-0007 Decision 5's "reading is
  ungated" precedent already covers roster/goal/pool content here) — this
  one new section is the only piece of Laget that can be invisible to a
  not-yet-approved player, and that's consistent with everything else on
  the screen already being read-only-safe for them.
- **Tap "Titta" while offline / ack call fails** — modal still opens and
  plays (video is fetched from `playbackUrl`, independent of the ack call);
  ack silently retries next tap, per §2.4. Row stays in the list.
- **Tap "Redan sett" while offline / ack call fails** — visible error
  toast (`k1.challengeAckErrorToast`), row stays in the list, no local
  state mutated on failure.
- **The same clip is acked from two different devices in quick succession**
  (e.g. an old phone session and a new one) — the ack endpoint is
  idempotent server-side (ADR Decision 1); the second call is a no-op
  `200`, no error surfaced on either device, list just converges to the
  same empty state next fetch.
- **Uploader gets erased after publishing but before the tagged player
  acks** — per ADR Decision 4, the chat announcement's `content` text is
  unaffected (baked in at publish time), and the pending-challenges list
  still resolves `uploaderScreenName` live from the (still-present,
  possibly stale) row — no special client handling needed; this mirrors
  every other place a since-erased player's screen name can still appear
  in this app (ADR-0013's accepted, standing limitation).
- **Clip hard-deleted (self-delete or 90-day sweep) while still an
  unacknowledged pending challenge** — the row simply stops appearing on
  the next `GET .../challenges/pending` fetch (the query is `WHERE
  status = 'published' AND challenge_acknowledged_at IS NULL`, so a
  deleted clip silently drops out — no error, no "this challenge expired"
  message needed, matching this app's existing "gone means gone, no
  ceremony" posture for deleted clips elsewhere).
- **A system message's clip becomes unavailable** (report-hidden/deleted)
  — falls back to the existing `ClipUnavailablePlaceholder`, exactly like
  any other message's clip embed (ADR-0017 Decision 2, unchanged, §3.1).
  The announcement text itself (`content`) is unaffected either way.
- **A player reports the *clip* attached to a system message** — fully
  supported, unchanged mechanism (§3.1). Reporting the *system message
  itself* is not offered client-side (`canReportMessage` forced `false`,
  §3.1) and would additionally 400 server-side even if attempted directly
  against the API (backend-developer's binding guard, §0).
- **Tag-picker (`V5CaptionChallenge.tsx`) showing a still-`PENDING`
  teammate** — see §7; no client change needed either way backend-developer
  resolves it.

---

## 7. Awareness note on the two ADR-flagged backend items (not designed here, confirmed compatible)

Both from the ADR's 2026-08-06 security-reviewer addendum, backend-
developer's call, included here only to confirm the client already behaves
correctly against either resolution — no UI work is pending on this:

1. **System-message report-rejection guard** — purely server-side; §3.1's
   `canReportMessage = !isOwn && !isSystem` client mirror means the "🚩
   Rapportera meddelandet" link is never even shown on a system row, so the
   guard's 400 (if ever hit some other way) is defense-in-depth, not
   something a player using this UI would ever trigger.
2. **`teamJoinStatus === APPROVED` tightening on `taggedPlayerId`** — if
   backend-developer ships the recommended fix (filtering `listTeammates`
   to `APPROVED` only), `V5CaptionChallenge.tsx`'s tag-picker needs zero
   changes — it already renders exactly whatever `getTeammates` returns. If
   backend-developer instead keeps the `400` + `"taggedPlayerId"`-substring
   error shape, the picker's **existing** catch block already handles it
   (`err.message.toLowerCase().includes('taggedplayerid')` →
   `setTagError(t('v5.taggedPlayerGone')); setTaggedPlayerId(null)`,
   confirmed present in the code today) — again, zero client changes
   either way.

---

## 8. Component boundaries — what's new vs. changed vs. reused

| Component | Status |
|---|---|
| `mobile/src/team/components/ChallengeRow.tsx` (new) | §1.2's two-tap-zone row. Takes uploader info, `caption`, `playbackUrl`, `acking`, `onWatch`, `onDismiss`. |
| `mobile/src/team/components/ChallengeClipModal.tsx` (new) | §5's full-screen player, purpose-built (not a `ClipPlayerModal` reuse — different, narrower data contract). No report/delete. |
| `mobile/src/team/TeamScreen.tsx` | **Changed.** New `pendingChallenges`/`activeChallenge`/`ackingClipId` state; `fetchAll` gains a third, non-critical parallel fetch; new section rendered first, above `ConsentChips`; new `onChallengesChanged` prop. |
| `mobile/src/AppShell.tsx` | **Changed.** New `teamChallengesPending` state + `checkForPendingChallenges` foreground check (added to the existing `Promise.all`); `teamTabDot` passed to `TabBar`; `onChallengesChanged` passed to `TeamScreen`. |
| `mobile/src/navigation/TabBar.tsx` | **Changed.** New `teamTabDot?: boolean` prop, extends the existing dot-selection logic — same convention as the other three, no new mechanism. |
| `mobile/src/chat/components/MessageBubble.tsx` | **Changed.** New `isSystem` branch (checked before `isOwn`): `rowSystem`/`bubbleSystem`/`contentSystem` styles, sender row omitted, `canReportMessage` forced `false`, new `accessibilityLabel`. `ClipEmbed`, block/report-clip, timestamp all reused unmodified. |
| `mobile/src/chat/components/ClipEmbed.tsx` | **Unchanged.** Confirmed compatible with a system row's `clip` block with zero modification (§3.1). |
| `mobile/src/theme/colors.ts` | **Changed.** New tokens: `systemMessageBg`, `systemMessageBorder`. |
| `mobile/src/api/types.ts` | **Changed.** New `PendingChallengeEntry`/`PendingChallengesResponse`/`ChallengeAckResponse`; `ChatMessage` gains `authorType: 'player' \| 'system'` and `systemEventType: 'clip_challenge_issued' \| null`. |
| `mobile/src/api/endpoints.ts` | **Changed.** New `getPendingClipChallenges`/`ackClipChallenge`, matching the existing `getTeammates`/`getPendingJoins` call shape exactly. |
| `mobile/src/api/localFlags.ts` | **Changed — removal.** `seenChallengeClipIdsKeyFor`/`getSeenChallengeClipIds`/`addSeenChallengeClipId` deleted (superseded, per the ADR's explicit "should be removed, not kept alongside" instruction). |
| `mobile/src/clips/ClipsScreen.tsx` | **Changed — removal.** `checkForChallengeBanner`, the `challengeBanner` state, and its `Toast` render deleted; the call site inside `fetchInitial` removed. |
| `mobile/src/clips/upload/V5CaptionChallenge.tsx` | **Unchanged.** Confirmed compatible with either of backend-developer's two options for the `teamJoinStatus` tightening (§7). |
| `mobile/src/i18n/locales/{sv,en}/team.json` | **Changed.** New `k1.pendingChallengesHeading`/`k1.challengeAckedToast`/`k1.challengeAckErrorToast`, new `challengeRow.*` (4 keys), new `challengeClipModal.*` (3 keys) — §4.3. |
| `mobile/src/i18n/locales/{sv,en}/chat.json` | **Changed.** New `systemMessage.a11yPrefix` — §4.2. |
| `mobile/src/i18n/locales/{sv,en}/clips.json` | **Changed.** `v2.challengeBanner` removed; `v5.taggedHelper` rewritten — §4.4. |
| Other 6 locale files (`cs`/`fi`/`de`/`nb`/`da`/`fr`) | Same additions/removals, best-effort-AI-then-native-review pass — §4.5. |
| Backend: `TeamChatMessage.content` template | **Not an i18n key.** Literal Swedish string, backend-developer implements directly — §4.1. |

---

## 9. Implementation checklist

- [ ] `getPendingChallenges` returns `[]` → Laget tab shows no new section,
      no tab dot, unaffected screen otherwise.
- [ ] `getPendingChallenges` returns 1 challenge → section renders with
      exactly one `ChallengeRow`; tab dot appears without opening the tab
      (via `AppShell`'s own check).
- [ ] `getPendingChallenges` 403s (requester not consent/join-approved) →
      section silently omitted, no error banner, rest of Laget tab
      unaffected.
- [ ] Tap "Titta →" → `ChallengeClipModal` opens and plays **immediately**,
      not gated on the ack call's network round-trip.
- [ ] Tap "Titta →" with ack succeeding → row disappears from the list
      behind the (still open) modal; tab dot clears if this was the last
      pending challenge; no toast (§2.4).
- [ ] Tap "Titta →" with ack failing (simulate offline) → modal still
      plays the video; row stays in the list; no error toast; a later tap
      retries the ack (idempotent).
- [ ] Tap "Redan sett" with ack succeeding → row disappears, tab dot
      updates, `k1.challengeAckedToast` shown.
- [ ] Tap "Redan sett" with ack failing → row stays, `k1.challengeAckErrorToast`
      shown, no local state mutated.
- [ ] Tapping "Titta →" vs. "Redan sett" are two separate, non-overlapping
      tap targets — verify no accidental dismiss from a near-miss tap
      intended for "Titta →" (Zone 1 excludes Zone 2's bounds).
- [ ] Merely opening the Laget tab with challenges pending never, by
      itself, changes `pendingStreakGap`/dot/list state (§2.3) —
      regression-test this explicitly, it's the exact old bug's shape.
- [ ] A system chat message renders centered, pale-gold `bubbleSystem`
      fill, no avatar/sender-name row, correct `content` text verbatim
      from the server.
- [ ] A system chat message's embedded clip plays, mutes/unmutes, shows
      "Klipp av {{uploaderScreenName}}" attribution, and that attribution
      still opens the block sheet for the real uploader — all identical to
      an ordinary message's embed.
- [ ] Tap-to-reveal on a system message shows **only** "Rapportera
      klippet" (when a clip is present and its uploader isn't the viewer)
      — "Rapportera meddelandet" never appears.
- [ ] A system message whose clip has been deleted/hidden falls back to
      `ClipUnavailablePlaceholder`, `content` text unaffected.
- [ ] Blocking a system message's clip uploader hides that clip's embed on
      the system row exactly as it would on any ordinary message (existing
      block-filter mechanism, §3.1's "reused unmodified" claim).
- [ ] `v2.challengeBanner` toast no longer appears anywhere in the Klipp
      tab (old mechanism fully removed, not left dormant alongside the
      new one).
- [ ] `v5.taggedHelper`'s new copy renders correctly after uploading a
      tagged clip.
- [ ] All new copy reads correctly with `{{count}}`/`{{screenName}}` at
      both short and long screen-name values — no new i18n machinery
      introduced (plain `{{var}}` substitution throughout, matching this
      repo's existing convention).
