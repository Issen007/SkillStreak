# 0027 — Music on the team-only video clip feed

## Status

Proposed — 2026-08-10. **Blocking security-reviewer sign-off required
before ux-designer finalizes a picker screen or backend-developer writes a
migration**, per CLAUDE.md's standing rule for anything touching media or
child data, and per the precedent every prior clip ADR set (ADR-0010's own
first pass returned a required GPS-metadata fix, not a rubber stamp;
ADR-0018's and ADR-0019's both returned blocking findings). This is an
addition *on top of* ADR-0010's highest-risk feature and should get no
lighter a review than ADR-0010 did.

**The gate on this feature is not technical.** Every option below is
buildable in a day or two by the standards of what this repo already runs;
what separates them is who owns the rights to the audio and on what terms.
**This ADR does not give legal advice and cannot.** Its job is to make the
technical consequence of each commercial option legible, so that when the
project owner takes real advice they are choosing between options whose
engineering cost, moderation surface, and failure modes are already
written down. **No option below may be built until the project owner has
picked a source and is satisfied the rights position behind it is sound.**
That is a decision only they can take.

Two factual claims in the Context below were verified against primary
sources on 2026-08-10 and are cited there. One claim — what a Swedish
collecting-society licence (STIM, and the master-side equivalent) would
actually cost or even offer a platform of this size — **could not be
verified** and is stated as unverified rather than asserted.

## Context

### The status quo is not silence — verified in the code, and this matters

The obvious framing for this ADR ("the app has no music; should we add
it?") is **wrong on the facts**, and starting from it would produce a bad
decision. `VideoProcessingService.remuxStripMetadata`
(`backend/src/video-clips/video-processing.service.ts:131-157`) explicitly
maps the first audio stream when one exists
(`...(hasAudioStream ? ['-map', '0:a:0'] : [])`) and stream-copies it with
`-c copy` alongside `-map_metadata -1`. Clips therefore already carry
**whatever audio the phone recorded** — the child's own voice, teammates'
voices, a coach shouting, and, routinely, whatever the sports hall's PA
system happened to be playing at the time.

So this app already stores copies of commercial recordings inside
children's video artifacts, incidentally, today. Decision 1 addresses
whether that is acceptable; it is deliberately answered separately from
the "should we offer a catalogue" question, because the two are not the
same act and conflating them would either overstate today's exposure or
understate tomorrow's.

### Why "add music" is a licensing decision wearing an engineering costume

Every commercial recording carries **two independent rights**, and a
licence to one is not a licence to the other:

- **The composition** (the song as written) — administered in Sweden by
  **STIM** on the publisher/writer side.
- **The master recording** (the specific recorded performance) — owned by
  the label; the neighbouring-rights/performer side runs through IFPI
  members and SAMI.

Putting a recording under a video is a **synchronisation** use, and sync
generally needs direct permission from both sides. TikTok, Instagram and
YouTube can offer catalogue music inside their editors because they hold
blanket deals negotiated at platform scale. Those deals are not something
a project of this size inherits by using the same UX pattern.

**Verified 2026-08-10 — "let the child pick a song from Spotify/Apple
Music" is not a small integration; it is unavailable.** Spotify's
developer terms prohibit synchronising sound recordings accessed via the
Spotify Platform with any visual media, and list synchronisation as a
prohibited use outright. Apple's MusicKit terms state that MusicKit
content cannot be synchronised with other content, and Apple's own
developer guidance says explicitly that if you want to create audio or
video files for sharing you must contact rights-holders directly for
synchronisation or adaptation rights. Both were checked against the
vendors' own developer documentation, not a secondary summary. This closes
off what is otherwise the first idea anyone has, so it is recorded here
with its source rather than left to be re-proposed in six months.

**Not verified, and deliberately not asserted**: whether STIM (or a
master-side equivalent) offers a licence product that would cover a small
Swedish app letting children put a track under a 60-second clip, and at
what cost. Collecting societies do license online/UGC uses, but the shape,
price, and whether it reaches the master side at all are exactly the
questions a real adviser answers and a search engine does not. If the
project owner pursues Option 3 below, this is the first call to make.

### The closed bubble helps, but it is not the plan

CLAUDE.md's closed-team-bubble constraint means a clip is visible only to
one verified team — roughly fifteen children who already know each other.
That genuinely does two things: it lowers the practical likelihood of
anyone noticing or caring, and it materially weakens any *public
performance* / *communication to the public* analysis, since there is no
public.

It does **not** make the reproduction right go away. Under every design in
this ADR the server **copies** the track into a new stored artifact in
MinIO, and that copy exists whether one child or a million watch it.
Audience size is a mitigating fact about exposure, not a rights position.

**"It's only the team" must therefore not become the plan.** If it is the
whole justification, the honest way to say that is "we are accepting a
small, quantified risk knowingly", which is a decision for the project
owner and their adviser — not a design this ADR can hide inside a
Decision heading and call resolved.

### Music is a new moderation surface, and audio is the worst kind

Users are 9–13. This app's entire text-moderation posture is
`KeywordChatModerationCheck` — a Swedish wordlist applied to captions and
chat (`backend/src/moderation/moderation.module.ts`, wired into
`VideoClipsService.assertCaptionAllowed`). Its security-reviewer sign-off
in ADR-0007 was explicitly conditional on small, closed, real-world-known
rosters, and ADR-0019 Decision 4 refused to stretch that condition to
stranger-facing freeform text.

Audio is harder than text in every direction that matters:

- Explicit lyrics are a real, ordinary property of ordinary popular music,
  including tracks a 12-year-old would obviously choose.
- No filter in this codebase can hear anything. Screening audio needs
  transcription plus classification — i.e. the deferred Python/ML service
  ADR-0010 Decision 3 and ADR-0018 both decline to build.
- Post-hoc moderation of audio is far worse than of a caption: a reviewer
  has to *watch the clip in real time* to find the problem, where a caption
  is one glance.

The conclusion that follows is the single most important structural point
in this ADR, and it is the same move ADR-0019 Decision 4 made for
reactions: **a fixed, pre-vetted catalogue is moderated by construction —
there is no sentence a fixed track list can form.** "Any audio the child
supplies" is the opposite: an unbounded moderation surface *and* an
unbounded licensing surface at the same time. Decision 3 makes this
structural rather than a policy note.

## Decision — 1: the incidentally-recorded audio stays exactly as it is; this ADR does not propose stripping it

**Decision: keep `-map 0:a:0` and `-c copy` unchanged. No audio-stripping
pass is added, now or as part of this feature.**

Argued, not assumed, because the alternative is genuinely on the table
once you notice the hall PA is being copied into every clip:

- **Incidental capture and deliberate offering are different acts.** A
  camera recording ambient sound in a room is not the same thing as a
  platform building a picker that invites a child to place a specific
  commercial recording under their video. Nobody's design intent, and
  nobody's product surface, is directed at the music in the first case.
  This is not a legal opinion about whether incidental capture is
  licensed — it is the observation that the two sit in visibly different
  places, and that this ADR's proposal concerns only the second.
- **Stripping audio would cost real product value for little gain.** The
  audio on these clips is mostly a child narrating their own trick, a
  coach's voice, teammates reacting. Removing all of it to avoid
  incidental background music would delete the thing that makes the clips
  feel like the child's own, in exchange for a risk reduction that is
  small and unquantified.
- **It would also be a silent change to already-published behaviour.**
  Every clip in the live beta has audio; a change that mutes them all is a
  visible product regression, not a privacy improvement.

**Stated plainly so it is not lost**: this means the premise "we don't
have music today" is false, and any argument for the feature that leans on
"this introduces music into the app for the first time" is overstating the
change. What this ADR would introduce is *deliberate, curated, offered*
music. That is the thing that needs a rights position.

## Decision — 2: source the tracks in a sequence — team-owned sounds, then commissioned originals, then (only if needed) a licensed catalogue

The three candidates, evaluated for *this* project, and then sequenced
rather than ranked, because they are not mutually exclusive and the cheap
ones do not block the expensive one.

### Option A — team-owned sounds (recommended first)

The team records its own audio: a chant, a countdown, a coach's catchphrase,
a bench roar, the sound of a ball hitting the boards.

- **Licensing: none.** The team owns what the team recorded. No STIM, no
  label, no expiry, no usage reporting, no renewal.
- **Fit with the product**: strongest of the three by a distance. This app
  exists to be *not* TikTok; a sound board of your own team's chants is
  something TikTok structurally cannot offer, and it reinforces the closed
  bubble rather than straining it.
- **Cost**: no money at all; the whole cost is the authoring surface.
- **The catch, named**: recorded audio from a team is user-generated
  content, so it re-opens the moderation surface Decision 3 exists to
  close — unless authoring is restricted. See Decision 3 for how.

### Option B — commissioned original tracks, work-for-hire, full ownership (recommended second)

Pay a composer for 15–20 short instrumental loops, written for this use,
with a work-for-hire agreement transferring ownership (or an unlimited,
irrevocable, sublicensable licence) to the project.

- **Licensing: clean and permanent.** No renewal, no lapse, no per-use
  reporting, no dependency on a vendor's continued existence. Decision 7's
  entire "what if the licence lapses" problem simply does not arise.
- **Cost**: for a fixed set of short loops this is plausibly the cheapest
  *clean* option available to a project this size — a one-off spend, not a
  subscription, and 15–20 loops is a small commission.
- **Moderation**: instrumental by specification, so there are no lyrics to
  vet. Pre-moderated by construction in the strongest possible sense.
- **The catch**: it is not the music the children actually want. A child
  who wanted the song currently on the radio does not want a bespoke loop,
  and the feature will land less well than the owner might expect.

### Option C — a curated pre-cleared library (Epidemic Sound / Artlist style)

- **The trap, and it is the specific thing to check**: an ordinary
  **creator subscription does not permit sublicensing to end users**. It
  licenses *you* to use the music in *your* content on *your* channels.
  Letting a third party — here, a child — pick a track and produce their
  own video with it is sublicensing, and it needs a **platform / partner /
  API tier**, not the plan a YouTuber buys. Epidemic Sound does market a
  partner API described as supporting sublicensing to end users, on the
  basis that they own their catalogue outright (checked 2026-08-10) — but
  the terms, the price band, and whether they will contract with a project
  at this scale are exactly what the owner must confirm directly. **The
  clause to ask about by name: does this tier grant our end users a
  licence for content they create in our product, and does that licence
  survive our subscription ending?**
- **Cost**: recurring, and the recurring part is the problem — Decision 7
  exists entirely because of it.
- **Moderation**: better than commercial pop (these libraries are aimed at
  advertising and vlogs), but not automatically child-safe; a catalogue
  with lyrics still needs vetting, which at "the whole catalogue" scale is
  not something this project can do.
- **The genuine advantage**: variety and quality, immediately, without
  commissioning anything.

### Rejected outright

- **"Pick from Spotify / Apple Music"** — unavailable, verified in the
  Context above. Not a cost question, not a scale question: the developer
  terms of both prohibit exactly this use.
- **"Let the child upload their own audio file"** — the worst available
  option on both axes simultaneously: unbounded licensing exposure (the
  child uploads the copyrighted track themselves) *and* unbounded
  moderation exposure (any audio at all, including a recording of a person
  who never consented). Ruled out in Decision 3 structurally, not by
  policy.

### Recommendation — a sequence, not a pick

1. **Ship Option A first.** Zero licensing, strongest ethos fit,
   genuinely differentiating, and it exercises the entire technical
   pipeline in Decisions 4–8 with an audio source that carries no rights
   question at all. If the mixing pipeline turns out to be a nuisance, the
   project learns that having spent nothing.
2. **Add Option B second**, as a small fixed pack, once the pipeline is
   proven. This is the "real music" answer that never expires.
3. **Consider Option C only if A+B demonstrably fail to satisfy the
   product need** — and only on a platform/API tier with the sublicensing
   clause confirmed in writing.

The sequence is chosen so that the two options with no recurring rights
dependency are the ones that ship, and the one that introduces an expiry
date is the one that has to justify itself against an already-working
feature.

## Decision — 3: the catalogue is server-curated and fixed; a child never supplies audio, ever

**Structural rule, not a policy note: the only audio that can be mixed into
a clip is a row in `ClipAudioTrack` that a server-side curation action put
there. There is no endpoint, on any surface, that accepts an audio file
or an audio URL from a player.** The mobile client sends a `trackId` from
the catalogue; anything else is a 400.

This mirrors the two strongest existing precedents in this codebase rather
than inventing a posture: ADR-0010 Decision 1's *object keys are
server-generated, never client-supplied*, and ADR-0019 Decision 4's
*fixed reaction vocabulary, because there is no sentence a fixed
vocabulary can form*. Applied to audio the same reasoning is stronger, not
weaker, because this app can read a caption and cannot hear a track.

**Instrumental-only for v1, recommended and argued.** No lyrics in any
language. This removes the explicit-lyrics problem by construction rather
than by vetting, and it sidesteps a subtler one: the Swedish keyword
filter that screens captions is structurally deaf, so a lyric is a
child-audible text channel that bypasses this app's only content filter
entirely. If lyrics are ever wanted, that is a separate decision with its
own review, not a catalogue expansion.

**Who may author an Option A team sound — the one place this rule bends,
and how it is kept from bending far.** A team-recorded chant is by
definition user-generated audio. Three ways to gate it were considered:

- *Any player may record a team sound* — **rejected.** It is the
  child-supplied-audio path with a friendlier name, and the first thing
  that happens is one child uploading a sound of another child.
- *A player records, and it goes into an approval queue* — **rejected for
  v1.** This app has no human review queue for anything; ADR-0010
  Decision 4's un-hide and ADR-0022's console both rely on out-of-band
  admin action. Building a real, staffed approval queue as a side effect
  of a music feature is exactly the scope creep CLAUDE.md warns against.
- **Adopted: team sounds are uploaded through the admin console
  (ADR-0022), by the operator, at a coach's request.** No new child-facing
  upload surface exists at all; the moderation guarantee in the first
  paragraph of this decision stays literally true (every row in
  `ClipAudioTrack` was put there by a server-side curation action); and a
  team's first chant needs a coach to organise the recording anyway. It is
  manual, it does not scale, and at this project's actual size — a handful
  of teams — that is the correct trade, the same one ADR-0010 already
  makes for un-hiding a reported clip.

A team-scoped track is offered only to that team (`ClipAudioTrack.team_id`,
Decision 5); a global track is offered to everyone. No cross-team leakage:
the picker query filters on `team_id IS NULL OR team_id = :viewerTeamId`,
and that filter is the same structural shape as every other team-scoped
read in this app.

## Decision — 4: bake the mix server-side into the existing remux — one ffmpeg pass, never two, never client-side

**Decision: audio is mixed into the stored artifact at the `complete`
step, inside the existing `remuxStripMetadata` invocation, producing a
single self-contained file. The client never composes audio at playback.**

Three arguments for baking, and they are not equally strong — the second
and third are the load-bearing ones:

1. **No sync drift.** A client that plays a video element and an audio
   element side by side will drift, and will drift differently on every
   Android device. This is the obvious argument and the least important
   one; it is an engineering annoyance, not a safety property.
2. **The artifact stays self-contained, so every existing lifecycle
   mechanism keeps working untouched.** `ClipRetentionService`'s daily
   sweep, ADR-0013's account-erasure walk, and uploader self-delete all
   operate on "the clip's object, then the clip's row." A baked mix means
   there is still exactly one object per clip and those three
   already-reviewed code paths need **zero** changes. Client-side
   composition would mean a clip's audible content lives partly outside
   the artifact that erasure deletes — a second thing to remember, in the
   one part of this system where forgetting is a GDPR problem.
3. **A moderator hears exactly what the child hears.** ADR-0010
   Decision 4's whole model is that a reported clip is provisionally
   hidden and its bytes are kept so a human can look at what was reported.
   If the music is composed at playback from a `trackId` and mix
   parameters, then what the reviewer plays back is a *reconstruction*
   that depends on the client honouring those parameters — and a client
   that got it wrong, or a track that has since been retired, silently
   produces a different experience than the one that was reported.
   Baking makes "the reported artifact" and "the artifact the reviewer
   plays" the same bytes, by construction.

**One pass, not two — and this is a real correctness requirement, not a
performance preference.** The metadata strip and the mix must be the same
ffmpeg invocation. A second pass over the output of the first is an
opportunity to reintroduce container metadata, and the metadata strip is
a *blocking* security-reviewer finding from ADR-0010 that must not become
conditional on a later step behaving. Illustrative only — backend-developer
owns the exact flags:

```
ffmpeg -y -i clip.mp4 -ss <offsetSeconds> -i track.m4a \
  -filter_complex "[0:a]volume=1.0[a0];[1:a]volume=0.30[a1];\
                   [a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]" \
  -map 0:v:0 -map "[aout]" \
  -map_metadata -1 \
  -c:v copy -c:a aac -b:a 128k \
  out.mp4
```

Note what does and does not change: **`-c:v copy` is retained**, so the
cheap path that ADR-0010 Decision 3 argued for ("a remux copies compressed
frame data byte-for-byte") survives intact for the video stream, which is
99% of the bytes. Only the audio re-encodes. Two degenerate cases the
implementation must handle and which are already visible in
`VideoProcessingService.probe`'s `hasAudioStream`: a clip recorded with no
audio stream at all (one `amix` input — just map and trim the track), and
a clip where the child chose no track (the existing path, completely
unchanged, `-c copy` throughout).

**Failure behaviour: fail closed, identically to today.** If the mixing
pass fails for any reason, `complete` fails with the existing `422
clip_processing_failed` and the clip stays `pending_upload` — the same rule
ADR-0010 Decision 3 sets, and deliberately *not* a silent fallback to
publishing without music. A child who picked a track and got a silent clip
has been given a wrong result without being told; a child who got an error
can retry. Consistency with the existing failure mode also means no new
error code and no new client branch.

## Decision — 5: the data model — `ClipAudioTrack` in Postgres, three columns on `VideoClip`, nothing in Redis

Per ADR-0002's posture (Postgres is the durable structured source of
truth; Redis holds only rebuildable things): **all of this is Postgres.**
The catalogue is tens of rows read once per picker open — there is no
leaderboard-shaped access pattern here and no reason to involve Redis at
all. Stated explicitly so nobody adds a cache for a table that will never
have a hundred rows.

```
ClipAudioTrack
  id                  uuid, PK
  title               varchar            -- shown in the picker
  attribution_text    varchar, nullable  -- what the licence requires be
                                            displayed, if anything; null for
                                            owned/commissioned/team tracks
  source              enum: owned_commission | team_recorded |
                            licensed_catalogue
                                         -- drives Decision 7's lapse handling;
                                            an owned track can never lapse
  external_track_id   varchar, nullable  -- the provider's own id, for usage
                                            reporting under Option C. Null for
                                            A and B.
  storage_key         varchar            -- see Decision 8; a separate bucket
  duration_seconds    int
  team_id             uuid, nullable, FK -> team.id, ON DELETE CASCADE
                                         -- NON-NULL only for team_recorded.
                                            NULL = global catalogue. This one
                                            column is the entire cross-team
                                            isolation mechanism for Option A.
  status              enum: active | retired
                                         -- retired = never offered again;
                                            existing baked clips unaffected
  licence_expires_at  timestamptz, nullable
                                         -- populated only for
                                            licensed_catalogue; the thing an
                                            operational check reads
  created_at          timestamptz
```

On `VideoClip`, three additive nullable columns — no changes to any
existing column, so ADR-0010's already-reviewed entity stays stable in the
same way ADR-0019 was careful to keep it:

```
audio_track_id        uuid, nullable, FK -> clip_audio_track.id,
                        ON DELETE RESTRICT
audio_offset_seconds  int, nullable      -- where in the track the mix started
audio_mix_preset      enum, nullable: original_only | music_under |
                                        music_forward | music_only
```

**`ON DELETE RESTRICT`, argued.** This is the opposite of the cascade
posture ADR-0019 chose for its three tables, and deliberately so: a
`ClipAudioTrack` row is not derived data about a clip, it is **the only
record of what audio is inside artifacts that already exist**. Deleting it
would make the Decision 7 enumeration query ("which clips contain this
track") return nothing while the audio is still baked into the files.
Retirement is `status = 'retired'`; deletion of a track that has ever been
used is not an operation this design allows.

**An enum preset, not free-floating gain values.** Three fixed mixes plus
"no music", not a slider. Reasons: a 10-year-old does not need a decibel
control; a fixed set means the mix a moderator hears is one of four known
shapes; and it keeps this column from becoming a place where a future
client sends arbitrary numbers into an ffmpeg filter string. The actual dB
values live in backend constants next to the existing clip constants, and
are tunable without a migration — the same "mechanism fixed, numbers
tunable" split ADR-0010's Consequences already established.

**Is `audio_track_id` worth the column?** The suggestion that prompted it
was "store it so we can re-render if a licence lapses." **That
justification does not survive Decision 4**: the mix is baked and the
pre-mix original is not retained (see the next paragraph), so there is
nothing to re-render *from*. The column is worth keeping anyway, for two
different and better reasons: it is the only way to answer "which clips
contain track X" when a licence lapses or a track is withdrawn
(Decision 7), and it is the only way to know which tracks anyone actually
uses when deciding what to commission next. Recorded here explicitly so a
future reader does not find the column and infer a re-render capability
that does not exist.

**Not retaining a pre-mix original — decided, with the condition that
would reverse it.** Keeping the original audio (as a small sidecar object,
or the whole original file) would make re-rendering possible. Rejected for
v1: a second stored artifact derived from child media acquires its own
retention and erasure obligations, needs a second storage key threaded
through `ClipRetentionService` and ADR-0013's erasure walk — both
already-reviewed code — and produces an artifact that no moderator ever
looks at. That is real cost against a capability only Option C needs.
**The condition that reverses this: if the project owner picks Option C (a
rented catalogue) as the primary source, the sidecar becomes worth its
cost**, because lapse stops being hypothetical. Named here so that choice
carries its true price rather than appearing free.

## Decision — 6: original audio is ducked by default; full mute is allowed, and the trade is stated

**Default (`music_under`): the child's own recorded audio stays at full
level and the track sits under it.** The voices are the point; the music is
atmosphere. `music_forward` ducks the original instead, for a child who
wants the clip to feel like a highlight reel.

**`music_only` — the child fully replaces their own audio — is allowed.**
Argued on both sides because it is the one genuinely two-sided question
here:

- **For**: it *reduces* the personal data in the artifact. A child's voice
  is unusually revealing content — a sibling's name, a parent shouting
  something, a background conversation, a hall announcement. A mute button
  is a privacy control that a child can operate for themselves, and this
  app's whole posture is to give children real control over their own
  content (ADR-0010's unconditional self-delete is the same instinct).
- **Against**: a moderator loses incidental audio context. If something
  bad is happening off-camera, the audio is where it would have been
  audible, and a mute removes that signal.

**Decision: allow it.** The "against" argument imagines a scenario in
which the child holding the camera is the one being harmed and would
nonetheless choose to mute the evidence — possible, but it is a thin case
against a control that otherwise straightforwardly reduces what this app
stores about a child. Two conditions attach:

1. **It is one-way, and the UI must say so before the child confirms.**
   The mix is baked; there is no un-mute afterwards. This is a real
   ux-designer requirement, not copy polish — the same "say what is
   permanent" obligation ADR-0019 placed on its review page.
2. **`audio_mix_preset = 'music_only'` is stored**, so a reviewer looking
   at a clip can at least tell that the original audio was removed
   deliberately rather than never existing. Cheap, and it means the
   moderation loss is visible instead of silent.

**A product tension worth naming**: a fully-scored, voiceless clip is a
music video, not a training log. Music makes the clip feed more fun, which
is the point, but it also nudges the feature away from "here's my drill"
toward "here's my edit". That is ux-designer's and the owner's call to
watch, not something this ADR can prevent architecturally.

## Decision — 7: what happens when a track's licence lapses or is withdrawn

The whole of this decision applies only to `source = licensed_catalogue`.
For `owned_commission` and `team_recorded` it is unreachable — which is
the single strongest practical argument for Decision 2's recommended
sequence, and the reason it is sequenced that way.

**Immediately, in every case: `status = 'retired'`.** The picker query
filters `status = 'active'`, so no *new* clip can use the track from that
moment. This is one predicate and needs no other machinery.

For clips that already have it baked in, three responses, in ascending
order of harm to children:

- **(a) Do nothing; let retention run out.** ADR-0010's rolling window
  (`CLIP_RETENTION_DAYS`, default 90) means every affected clip is
  hard-deleted within that window anyway. The exposure tail is bounded by
  a config value this app already has, which is a genuinely useful
  property most platforms lack. **Recommended default.**
- **(b) Strip the audio from the affected clips.** Technically possible
  from the baked artifact — a `-an -c:v copy` pass over each — but it
  removes the child's own voice too, because the mix is baked. An
  escalation lever, not a first response.
- **(c) Delete the affected clips.** **Rejected as a standing option.**
  Deleting children's videos because the platform's music subscription
  ended punishes the wrong party for the wrong reason. If it is ever
  genuinely required by a rights-holder demand, that is an out-of-band
  operator decision with the affected families told what happened — not an
  automated sweep this ADR pre-authorises.

The enumeration this depends on — "which clips contain track X" — is a
single indexed query on `VideoClip.audio_track_id`, which is what that
column is actually for (Decision 5).

**An operational note, not a new mechanism**: `licence_expires_at` is
worth surfacing in the admin console (ADR-0022) as a plain list, so a
lapse is noticed before a rights-holder notices it. No cron job, no
alerting infrastructure — a column on a page.

## Decision — 8: track files live in a separate MinIO bucket; clients get previews, never playback copies

**Where.** The same MinIO instance ADR-0010 Decision 1 already deploys, but
a **separate bucket** (recommend `audio-tracks`), not a prefix inside
`clips`. Argued:

- The `clips` bucket carries a max-object-size `Deny` policy and a CORS
  policy shaped for client-side `PUT` (`ObjectStorageService`'s
  `configureMaxObjectSizePolicy`/`configureCorsPolicy`). Tracks are
  server-read-only and never client-PUT; inheriting a policy set tuned for
  the opposite access pattern is a needless coupling.
- `clips`'s key layout is `clips/{teamId}/{clipId}.{ext}`, whose whole
  organizational point is bulk-cleanup-by-team. A catalogue asset has no
  team for the global case and must not be swept by anything that walks
  that prefix.
- Separation means the retention sweep can never touch a catalogue asset
  by accident, which is a cheap way to make a whole class of bug
  impossible.

Everything else is unchanged: same credentials pattern, same
`MINIO_ENDPOINT` / `MINIO_PUBLIC_ENDPOINT` split ADR-0010's addendum
established, same per-cluster `ConfigMap`/`Secret`. **No new
environment-specific URL is introduced anywhere**, which is the property
CLAUDE.md's environment-parity section actually cares about — nothing here
gets baked into an image.

**Are tracks served to clients at all?** Under baking, *playback* never
needs them — the mix is already in the clip. But the **picker does**: a
child has to hear a track before choosing it. So:

- **Yes, a preview**, via a presigned GET minted by the API per request,
  short expiry, never persisted — the identical mechanism and the
  identical rule as clip playback (`CLIP_PLAYBACK_URL_EXPIRES_SECONDS`).
  Not a public URL, not a CDN path, not a bucket policy. This is
  deliberately boring: reusing the one mechanism this app already has
  beats inventing a second, more permissive one for lower-sensitivity
  assets.
- **The picker query is team-filtered** (`team_id IS NULL OR team_id =
  :viewerTeamId`, Decision 3), and the presigned-URL mint re-checks that
  the requested track is actually offerable to this player — the same
  "re-check on every single read, structurally" bar ADR-0010 Decision 2
  set. A `trackId` from another team's sound board is a 404.
- **Licensing consequence, flagged for Option C only**: delivering a
  preview to a device is a *distribution* of the recording, which some
  catalogue agreements treat separately from sync. Another clause to
  confirm with the provider, named here so it is asked about rather than
  discovered.

## Decision — 9: no points consequence — and no music-for-points, ever

ADR-0025's evidence tiers pay ×1.2 for a clip attached to a log and ×1.4
for one shared with the team (`points.util.ts`'s `MULTIPLIER_BY_TIER`). Anything that makes clips more fun therefore has
a points consequence: more clips means more tier-3/4 logs means the
`TeamSeasonPot` fills faster relative to `goalThreshold` — which ADR-0025's
2026-08-10 amendment already flags as an **open, unresolved retune**. This
feature does not create that problem, but it makes it arrive sooner.
Flagged for the owner, not fixed here.

**Two things this ADR rules out explicitly, so they are not invented
later:**

- **No new evidence tier and no music multiplier.** The tier ladder is
  keyed to *evidence of training*, not to production value. A clip with a
  soundtrack is not better proof that a child trained than one without,
  and paying more for it would reward editing rather than training —
  precisely the inversion ADR-0025 exists to correct.
- **Music is never an unlockable purchased with points.** Gating tracks
  behind a points total aimed at 9–13-year-olds is a loot-box shape
  pointed at children, and it would convert the team pool — a cooperative
  mechanic — into peer pressure to produce content, the exact dynamic
  ADR-0025 Decision 4 refuses to create for public publishing. Ruled out
  here rather than left as an obvious future idea.

**On the model separation this project keeps carefully**: nothing in this
ADR touches individual-streak state (Redis, rebuildable, personal streak
days) or the team season pot ledger (Postgres, durable, auditable). Music
is a property of a clip artifact and lives entirely in the media path. It
is worth saying so, because "add music" is the kind of feature that
acquires a gamification hook by accident if nobody writes down that it
must not.

## Decision — 10: explicitly NOT being decided here

Named rather than silently dropped, in the same posture ADR-0019 Decision
9 uses:

- **Whether this ships at all.** Decision 2 recommends a sequence; the
  rights position behind whichever option is chosen is the project
  owner's decision on real advice. This ADR is not that advice.
- **Music on the public Shorts feed (ADR-0019).** Out of scope entirely,
  and not merely because ADR-0019 is itself blocked on a CLAUDE.md
  amendment the owner alone can make: the closed-bubble mitigation in this
  ADR's Context **evaporates completely** for a cross-team audience, and
  the public-performance analysis that the closed bubble weakens comes
  straight back. Music on a public feed is a **larger and different**
  licensing question, and must get its own ADR rather than being treated
  as this feature reaching a new surface.
- **Chat clip attachments (ADR-0017).** A clip is a clip; if it has baked
  audio it carries it wherever the existing surfaces already show it. No
  new decision needed, stated so nobody looks for one.
- **Trimming, beat-sync, transitions, or any editor.** Offering a track at
  an offset is the entire scope. An editing suite is a different product.
- **Lyrics, in any language** — Decision 3, deferred with reasons.
- **Audio classification / transcription** — the same deferred
  Python-and-uv ML service ADR-0010 Decision 3 and ADR-0018 both decline
  to build. A fixed catalogue is what makes deferring it safe here; that
  is the whole argument.
- **Retaining a pre-mix original** — Decision 5, deferred with the named
  condition (Option C) that reverses it.
- **Exact numbers**: duck levels in dB, AAC bitrate, catalogue size,
  preview-URL expiry. All tunable config next to the existing clip
  constants, not schema decisions — the same "mechanisms fixed, numbers
  free" split ADR-0010's Consequences already established.

## Consequences

- **New Postgres entity** `ClipAudioTrack`; **three additive nullable
  columns** on `VideoClip` (`audio_track_id`, `audio_offset_seconds`,
  `audio_mix_preset`). No existing column changes; every existing
  team-scoped read path is untouched.
- **New MinIO bucket** (`audio-tracks`), created the same way
  `ObjectStorageService.onModuleInit` already creates `clips`. New config
  key for the bucket name; no new endpoint, no new credential pattern, no
  new environment-specific URL.
- **`VideoProcessingService` gains a mixing variant of the existing
  remux** — same single invocation, `-c:v copy` retained, `-c:a aac` added,
  `amix` filter. The `complete` step gets measurably slower for clips with
  music (an audio-only encode of up to `CLIP_MAX_DURATION_SECONDS` = 60s);
  **measure it before assuming it stays comfortably inside the request**,
  since ADR-0010's "sub-second, no transcode" justification for doing this
  synchronously was reasoned about a pure stream copy. If it turns out not
  to fit, that is an argument for an async completion step, which is a
  larger change than this ADR should smuggle in.
- **Failure is fail-closed and reuses `422 clip_processing_failed`** — no
  new error code, no silent publish-without-music.
- **`ClipRetentionService`, ADR-0013's account-erasure walk, and uploader
  self-delete need no changes at all** — the direct payoff of Decision 4's
  self-contained artifact. Worth stating as a result rather than an
  assumption: one object per clip, still.
- **A new curation surface in the admin console (ADR-0022)** — list,
  upload, retire, and a plain view of `licence_expires_at`. Manual by
  design (Decision 3), proportionate to a handful of teams.
- **A new picker screen and a permanence-warning confirmation** —
  ux-designer owns the flow, the copy, and the attribution display if a
  chosen source requires one. The "this cannot be undone" wording for
  `music_only` is a flow constraint, not styling.
- **Moderation posture is unchanged and deliberately so** — a fixed
  server-curated catalogue means this feature adds no content this app
  cannot already vet. That property is the justification for not building
  audio moderation, and it is destroyed the moment anyone adds a
  child-supplied-audio path. Any future ADR proposing one must re-argue
  this section, not extend it.
- **Hand-off**: **security-reviewer** blocking pass first, per the Status
  section — with the sharpest attention on Decision 3's structural claim
  (that no player-supplied audio can reach the mixer) and on Decision 6's
  full-mute trade. Then **ux-designer** (picker, permanence copy,
  attribution) and **backend-developer** (migration, ffmpeg pass, admin
  curation endpoints, picker query) against this ADR directly.

## Open questions for the project owner

1. **Which source, and is the rights position behind it sound?** The
   recommendation is the sequence in Decision 2 (team sounds → commissioned
   originals → licensed catalogue only if needed). This needs a real read,
   not an engineering opinion, and nothing should be built before it.
2. **Budget for Option B**, if taken: 15–20 short instrumental loops,
   work-for-hire, full ownership. This is the one spend that makes the
   whole lapse/renewal problem disappear permanently.
3. **Instrumental-only?** Recommended (Decision 3). Lyrics are the
   moderation surface this design exists to avoid, and this app's only
   content filter cannot hear them.
4. **Does Option A (team sounds) ship at all in v1**, given that
   authoring goes through the admin console by hand (Decision 3)? It is
   the most distinctive option and the most manual one.
5. **`TeamSeasonPot.goalThreshold` retune** — already open from ADR-0025's
   amendment; this feature makes it more urgent rather than causing it.
