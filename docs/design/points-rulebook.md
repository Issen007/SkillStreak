# Points Rulebook — "Regelboken" (player/parent-facing points explainer)

## Status

Draft — 2026-08-01, ux-designer. Content-only design doc, not wired into any
screen yet (see "Placement recommendation" and "Handoff notes" below for
what frontend-developer needs to do with this).

## What this is and isn't

The mechanics behind streaks, the team pot, the weekly goal bonus, the
VM-Guld-tabellen, and badges are all real, already-shipped, and correctly
specified across `docs/adr/0002`, `0005`, `0015`, `0008`, and `0016` — but
there has never been one place a player or a parent could go to read "how
does this actually work." This doc is that single source of truth, written
as **ready-to-use Swedish screen copy** (not prose *about* a screen), compiled
by cross-checking every number and rule against the ADRs above so nothing
here is approximated or guessed.

It is **not**:
- A restatement of the consent/privacy flow (that's covered elsewhere,
  in-app, at onboarding — this doc only touches privacy where it's directly
  relevant to a points rule, e.g. why a teammate might not count toward a
  weekly goal yet).
- A translation deliverable. This is Swedish source content only. Once this
  is wired into a real screen, it goes through the same translation pass
  Phase 4.3(b) is already running for the rest of the app (en/fi/da/nb/de/cs/fr)
  — flagged explicitly so it isn't forgotten or done twice.

## Audience and tone

Written for a 9–13-year-old reading alone, and for a parent reading it with
them. Matches the app's existing voice (see `docs/design/style-guide.md` and
the copy patterns in `docs/design/phase1-flows.md` /
`docs/design/phase2.6-2.7-flows.md`): short lines, concrete numbers instead
of abstractions, warm and encouraging, never a rulebook-as-legal-document.
Where this doc reuses copy that's already shipped/approved elsewhere in the
app verbatim (e.g. the "Bästa laginsats" explainer), that's called out —
reuse, not duplication, so the two surfaces never drift apart.

Color/type notes for whoever builds the screen: per the style guide, flame
(`#FF6B35`) marks "mine" (the individual streak section below) and gold
(`#FFB800`) marks "ours" (team pot, weekly goal, VM-Guld-tabellen, badges) —
carry that same color split into this screen's section headers/icons so it
reads consistently with the rest of the app, not as a separate, neutral
"help page."

---

# Screen copy (Swedish source)

> **Recommended screen structure**: a short intro, then five collapsible
> cards (collapsed by default, one-line teaser + icon, tap to expand) rather
> than one long scroll — this app's "two minutes between picking up the
> phone and getting bored" constraint applies to a rulebook just as much as
> to the core loop. Suggested order below; each `###` is one card.

## Intro (always visible, not collapsible)

> **"Regelboken"**
>
> **"Så funkar poängen i [appnamn] — kort och enkelt, utan krångel."**
>
> "Två olika saker pågår samtidigt i appen: din egen streak, och lagets
> gemensamma poäng. De är inte samma sak, och du får inga egna poäng — bara
> dagar i rad. Laget är det som samlar poäng. Här är hela bilden."

*(Design note: this line exists specifically to head off the most likely
kid question — "how many points do I have?" — before it gets asked. See
"Hard-to-explain mechanics" below.)*

---

### 🔥 Din streak (flame-colored card)

> **"Din streak — dagar i rad du har tränat"**
>
> "Varje dag du loggar att du tränat — genom att trycka på 'Jag har tränat'
> och välja vad du gjorde — räknas den dagen. Loggar du en dag i rad efter
> en annan växer din streak: 1 dag, 2 dagar, 3 dagar... Appen sparar också
> din bästa streak någonsin, så du alltid kan se ditt eget rekord."
>
> "Exempel: Om du loggar sex dagar i rad visar appen '6 dagar'. Missar du en
> dag börjar streaken om från 0 nästa gång du loggar — inget konstigt med
> det, bara att sätta igång igen. Det är din egen resa, ingen annan ser om
> du missar en dag."
>
> "Loggar du flera gånger samma dag räknas bara den *första* loggningen för
> din streak — men varje logg du gör, oavsett hur många per dag, ger
> fortfarande poäng till **laget** (se nästa kort)."
>
> "Din streak ger inga egna poäng — den är din personliga grej, helt separat
> från lagets poäng."

---

### 🥇 Lagets poäng (gold-colored card)

> **"Lagets gemensamma pott"**
>
> "Varje gång någon i laget loggar en träning läggs poäng till lagets
> gemensamma pott — **1 poäng per minut du tränar**, oavsett om det är
> kondition, teknik/övning, löpning eller något annat. Alla i laget bidrar
> lika mycket per minut, oavsett ålder eller hur bra man är."
>
> "Exempel: Du tränar 20 minuter och loggar det. Laget får 20 poäng i sin
> pott — direkt."
>
> "Poängen samlas ihop av hela laget tillsammans mot **VM-Guld** — se
> VM-Guld-tabellen nedan för hur ditt lag ligger till mot andra lag."

---

### 🎯 Veckans mål (gold-colored card)

> **"Veckans mål — satt av er kapten"**
>
> "Er kapten kan sätta ett mål för veckan — till exempel '20 minuter löpning
> var' eller '3 pass kondition var'. Målet gäller **varje spelare för sig**,
> inte laget som helhet — alla som kan vara med måste nå sitt eget mål,
> annars räknas det inte som klart. Det gör att alla i laget behöver bidra,
> inte bara en eller två som tränar mycket."
>
> "Så räknas 'klar': du loggar den träningstyp och mängd målet gäller för,
> tills du når (eller går över) målet. Det spelar ingen roll om du gör det
> på en enda dag eller sprider ut det över veckan."
>
> "**Vem räknas med:** alla i laget som har fått sina föräldrars godkännande
> och är med i laget sedan innan målet startade. Väntar du fortfarande på
> godkännande, eller gick du med i laget efter att veckans mål redan satte
> igång, räknas du inte med den här gången — varken som klar eller som att
> du saknas. Du är med igen nästa vecka."
>
> "**Bonusen:** Det ögonblick den *sista* spelaren i laget når sitt mål,
> får laget en engångsbonus: **+5 poäng, plus 1 poäng för varje minut hela
> laget tillsammans tränat** inom målets tidsram och träningstyp — inte
> bara det som krävdes för att nå målet, utan allt som faktiskt loggades."
>
> "Exempel: Kaptenen sätter målet '25 minuter löpning var'. Laget har 5
> spelare som kan vara med den här veckan. Alla fem loggar sina 25+ minuter
> under veckan — tillsammans blir det 153 löpminuter totalt (några sprang
> mer än sina 25). Precis när den femte och sista spelaren klarar sitt mål
> får laget **5 + 153 = 158 bonuspoäng**, direkt i potten. En gång per mål —
> ingen mer bonus förrän kaptenen sätter ett nytt mål."
>
> "Bonusen räknas alltid i minuter — även om målet var satt i antal pass i
> stället för minuter. Poängen kommer ändå in i lagets pott på samma sätt."

---

### 🏆 VM-Guld-tabellen (gold-colored card)

> **"VM-Guld-tabellen — hur ligger vi till mot andra lag?"**
>
> "Här ser ni hur ert lag ligger till jämfört med andra lag i appen. Det
> finns två sätt att se det, som två flikar:"
>
> **"🥇 Mest poäng"** — "Lagen rankade efter sin totala poängsumma. Enkelt
> och rakt av: flest poäng vinner."
>
> **"💪 Bästa laginsats"** — "Ett rättvist snitt — så kan även mindre lag
> vinna. Här jämför vi hur många poäng varje lag får **per spelare**, inte
> bara totalsumman. Är ett lag litet räknar vi lite försiktigt, så att några
> enstaka riktigt bra dagar inte råkar avgöra förstaplatsen av en slump. Ju
> fler spelare ett lag har, desto mer litar vi på deras eget snitt."
>
> "Exempel: Lag A har 15 spelare och 3000 poäng totalt — det är 200 poäng
> per spelare. Lag B har bara 4 spelare men 1200 poäng totalt — det är hela
> 300 poäng per spelare. På 'Mest poäng' vinner Lag A stort. Men på 'Bästa
> laginsats' kan Lag B faktiskt hamna högre än Lag A — för att Lag B:s
> spelare i snitt kämpat mer per person, även om laget är mycket mindre."
>
> "Ditt eget lags siffror (poäng per spelare, hur många spelare ni är) ser
> ni alltid exakt. För *andra* lag visar vi bara ungefär hur många spelare
> de är (t.ex. '1-2 spelare', '3-5 spelare', '6+ spelare') — aldrig ett
> exakt antal för ett annat lag. Det är för att skydda enskilda spelares
> integritet, inte för att gömma något."

*(Design note: the "Ett rättvist snitt..." paragraph and the small-team
protection explanation deliberately reuse `docs/design/
phase2.6-2.7-flows.md`'s Screen LB3 copy (the "ⓘ Så räknar vi ut det" sheet)
near-verbatim, adapted only to drop the sheet's second-person "Ditt lag: X
p/spelare..." transparency line, which belongs on that specific screen, not
here. Do not rewrite LB3's copy independently of this doc going forward —
one of them should always be the source the other reuses.)*

---

### ⭐ Utmärkelser (gold-colored card)

> **"Utmärkelser — inte bara för de som är bäst"**
>
> "Ibland får du en utmärkelse (badge) helt automatiskt — appen ger dem ut
> själv, du behöver inte ansöka om något. Det kan handla om:"
>
> - "Att du hållit igång en streak ett tag — t.ex. 7 dagar eller 30 dagar i
>   rad."
> - "Att laget klarat veckans mål tillsammans."
> - "Att laget nått en stor milstolpe i sin poängpott."
>
> "Er kapten kan också ge en utmärkelse direkt till en lagkompis, för sånt
> som inte alls handlar om att vara snabbast eller bäst — som **'Bästa
> kämpe'** eller **'Mest kreativa övning'**. De utmärkelserna handlar om
> attityd och glädje, inte prestation."
>
> "Dina utmärkelser visas med ditt skärmnamn — aldrig ditt riktiga namn —
> och bara för ditt eget lag, ingen utanför laget ser dem."

---

## FAQ (optional, if room — short-answer accordion or plain list)

> **"Hur många poäng har jag själv?"**
> "Inga — poäng är alltid lagets, aldrig dina egna. Du har en streak
> (dagar i rad), laget har poäng."
>
> **"Kan jag hitta på att jag tränat för att få fler poäng?"**
> "Du kan, men gör det inte — hela grejen bygger på att alla är ärliga med
> vad de faktiskt gjort. Det är på hedersord, precis som att skriva rätt i
> en träningsdagbok."
>
> **"Ser andra lag vilka som är med i vårt lag?"**
> "Nej. Andra lag ser bara ert lagnamn och er poäng (och ungefär hur många
> ni är, på fliken 'Bästa laginsats') — aldrig vilka spelare som är med,
> vad ni heter på riktigt, eller något annat om er."
>
> **"Måste jag vara bäst i laget för att få en utmärkelse?"**
> "Nej, tvärtom — flera utmärkelser handlar om kämparanda och kreativitet,
> inte om att vara snabbast eller starkast."

---

# Placement recommendation

**Not a new tab-bar entry.** The app already has five tabs (`Hem`, `Chatt`,
`Shorts`, `Mål`, `Laget` — `mobile/src/navigation/TabBar.tsx`), each earning
its place in the core "train → see progress" loop. This content is reference
material a player consults occasionally out of curiosity ("wait, how did
that other team beat us with fewer players?"), not something that belongs
one tap away at all times — adding a sixth tab for it would work against the
project's own "one tap deep for the core loop, minimal reading" brief by
diluting the tab bar's meaning.

**Primary entry point: a new screen linked from `ProfileScreen`**
(`mobile/src/home/ProfileScreen.tsx`, already reachable from `HomeScreen`).
Profile is already the natural home for "about this app" content, not a
frequently-glanced surface, so a "❓ Så funkar poängen" row there costs
nothing on the screens players actually look at every day.

**Secondary, contextual entry points** — added at the exact moments a player
is actually likely to wonder "why," reusing the app's existing "ⓘ" info-link
pattern (`docs/design/phase2.6-2.7-flows.md`'s Screen LB3) rather than
inventing a new one:
- On the `Mål` tab's goal card, near the existing **"Satt av lagets
  kapten"** sub-line, a small **"ⓘ Hur funkar veckans mål?"** link deep-links
  into this doc's "Veckans mål" section (or reuses this doc's copy in a
  bottom sheet, matching LB3's pattern, at frontend-developer's discretion).
- On the VM-Guld-tabellen's existing LB3 sheet, add one small trailing line
  — **"Läs mer i regelboken →"** — linking to the full screen, for a kid who
  wants the complete picture beyond just the fairness explanation.

**Not recommended:** any link from the home screen's streak/team-pool cards.
`docs/design/phase1-flows.md`'s own H1/H3 design already documents a
deliberate aversion to adding a second tap target to that compact, most-
frequently-glanced card — this doc's content isn't urgent enough to earn a
place there.

# Handoff notes

- **frontend-developer**: implement as a new screen (suggested name
  `RulebookScreen` / route `regelbok`), collapsible-card layout per the
  design note under "Screen copy" above, flame/gold color split per section
  as in the style guide. Copy lives in this doc for now — when wired up, it
  should move into the i18n system the same way every other screen's copy
  has (a new `mobile/src/i18n/locales/sv/*.json` namespace, e.g.
  `rulebook.json`), **not hardcoded**, since Phase 4.3(b) will need real
  translation keys to work against for en/fi/da/nb/de/cs/fr. This doc's
  Swedish text is the source for that `sv` file, not a substitute for it.
- **This pass does not translate anything** — Swedish only, as scoped.

---

# Mechanics that were genuinely hard to explain simply

Flagging these as real signals, not just doc-writing friction — each is a
candidate for a small copy/UX adjustment in the actual product, not just in
this explainer:

1. **The weekly-goal bonus is always paid in minutes, even when the goal
   itself was set in sessions ("pass").** A captain can set "3 pass var" —
   a player only has to log three sessions of any length to be "done" — but
   the team's bonus is still `5 + total minutes logged team-wide`, not
   anything tied to the number 3 or to "pass" at all (confirmed against
   ADR-0015 Decision 5, step 5: `computeTeamProgress` — the bonus basis — is
   unconditionally minutes-based, regardless of `targetUnit`). For a
   minutes-based goal this is intuitive; for a session-count goal it's a
   real conceptual jump ("we did 3 pass each, why is the bonus a number of
   *minutes*?"). This doc handles it with one explicit sentence, but the
   actual goal-completion celebration screens (G2/G3 in
   `docs/design/phase2.10-per-player-goal-flows.md`) currently just show
   **"Laget fick +{awardedPoints} bonuspoäng"** with no unit context at all
   — worth a small copy addition there (e.g. surfacing "X minuter loggade
   totalt" alongside the bonus figure) so the number doesn't feel arbitrary
   to a team that was tracking sessions, not minutes, all week.
2. **"Bästa laginsats" fairness (the shrinkage math) is the one mechanic
   this doc could not make simple on its own** — it leans entirely on
   reusing the already-approved LB3 sheet copy, which itself was clearly a
   hard problem for ux-designer to solve the first time (see how carefully
   `docs/design/phase2.6-2.7-flows.md`'s own addendum reasons through
   floor-vs-drop-vs-bucket for the roster-count exposure). The explanation
   that ships is honest and warm but still asks a 9-year-old to trust "we
   count carefully for small teams" on faith — there's no simpler true
   version of this available without either exposing the actual formula
   (explicitly out of scope, confirmed in the task) or being vague to the
   point of meaninglessness. Not a doc problem to fix further; flagging so
   the project owner knows this is closer to "as simple as it can honestly
   get" than "under-explained."
3. **Individual streak vs. team points is an easy mix-up worth guarding
   against explicitly**, not just describing correctly. Kids fluent in
   Duolingo (which does give the *player* points/XP) may reasonably expect
   their own point total somewhere in this app. This doc heads it off with
   one line in the intro and again at the end of the streak section
   ("din streak ger inga egna poäng") — worth keeping that repetition
   rather than trimming it as redundant, since it's the single most likely
   wrong assumption a new player brings in.
