# Campaign copy — Swedish and English

Ready-to-post copy for the September demo. Four audiences, because they
want four different things: people who are just curious, people who might
invest, people who might build, and people who might coach.

---

## Before you post: the link

Every post ends in a registration link with its own `?campaign=` tag. That
tag is the whole attribution system — no pixels, no third-party analytics,
nothing that would spoil the clean "no trackers" answer the app store
review depends on. You will see which campaign each signup came from in
**Demo signups** in the admin console.

**Use this shape** — it is what every link below already is:

```
https://skillstreak.xyz/?campaign=li-sv-sommar#visning
```

The other order (`/#visning?campaign=...`) also works, because the page
reads the tag out of the fragment too. That is a deliberate safety net
rather than an invitation: the browser puts everything after `#` into the
fragment, so `location.search` is empty there, and losing a campaign tag
because someone wrote the URL in the obvious order would be a silly way to
lose data. Prefer the form above; do not worry if you slip.

**Post the trainer campaign last.** A coach you recruit today has nothing
to do: the only way into a team is a captain's code, so they would sign in
and wait. Run it after the demo, when there are teams to be invited by.

---

# 1. The summer project

The general share. The honest version is also the strongest one: a coach
got tired of losing his players to their phones and built the thing
himself.

## LinkedIn — Swedish
`?campaign=li-sv-sommar`

> I våras tröttnade jag.
>
> Jag tränar ett innebandylag. Barnen är 9–13 år, de är grymma, och de
> lägger mer tid på TikTok än på klubban. Det är ingen kritik mot dem —
> apparna är byggda av folk vars hela jobb är att vinna den kampen.
>
> Så jag byggde en egen.
>
> SkillStreak är en app där 15 minuters träning om dagen blir en streak,
> precis som i Duolingo. Men det är den andra halvan som faktiskt får dem
> att logga: varje pass går också in i lagets gemensamma pott, och laget
> jagar ett virtuellt VM-guld ihop. Den som är sämst i laget bidrar exakt
> lika mycket som den som är bäst — det är minuter som räknas, inte
> talang.
>
> Tre regler jag bestämde innan jag skrev en rad kod:
> • Ingen positionsdata. Appen vet *att* ett barn tränat, aldrig var.
> • Slutna lagbubblor. Ingen ser något utanför sitt eget verifierade lag.
> • Skärmnamn, inte riktiga namn.
>
> Det är inte funktioner jag lade till efteråt. Det är begränsningar som
> gjorde resten svårare att bygga, och de var värda det.
>
> Nu kör den skarpt mot ett riktigt lag. I början av september visar jag
> den live — 30 minuter, öppet för alla som är nyfikna.
>
> Anmäl dig här: https://skillstreak.xyz/?campaign=li-sv-sommar#visning

## LinkedIn — English
`?campaign=li-en-summer`

> This spring I gave up competing with TikTok and built something instead.
>
> I coach a youth floorball team. The kids are 9–13, they are brilliant,
> and they spend more time on their phones than with a stick in their
> hands. That is not a failure of character — those apps are built by
> people whose entire job is winning that fight.
>
> So I built one that plays for our side.
>
> SkillStreak turns 15 minutes of training a day into a streak, the way
> Duolingo does. But the half that actually makes them log it is the
> other one: every session also feeds a shared team pot, and the team
> chases a virtual World Championship gold together. The least skilled kid
> on the team contributes exactly as much as the best one — it counts
> minutes, not talent.
>
> Three rules I set before writing a line of code:
> • No location data. The app knows *that* a child trained, never where.
> • Closed team bubbles. Nobody sees anything outside their own verified
>   team.
> • Screen names, never real ones.
>
> None of those are features I added later. They are constraints that made
> everything else harder to build, and they were worth it.
>
> It is running with a real team now. In early September I am showing it
> live — 30 minutes, open to anyone curious.
>
> Sign up: https://skillstreak.xyz/?campaign=li-en-summer#visning

## Facebook — the floorball forum (innebandytugg__)
`?campaign=fb-tugg-sv`

Floorball first. Nobody here cares what it is written in.

> Fråga till er andra ungdomstränare: hur får ni era spelare att göra
> något mellan träningarna?
>
> Jag har kämpat med det i två säsonger. Det är inte att de är lata — det
> är att ingenting händer när de tränar hemma. Ingen ser det, det räknas
> inte, det finns liksom inte.
>
> Så jag byggde en app åt mitt lag i somras.
>
> Spelaren loggar sina 15 minuter och får en streak. Men det viktiga: alla
> pass går in i lagets gemensamma pott, och laget jagar ett VM-guld ihop.
> Vår sämsta löpare drar in exakt lika mycket som vår bästa — det räknas
> minuter, inte hur bra du är. Det var hela poängen. De som mest behöver
> känna sig viktiga för laget är sällan de som gör mål.
>
> Inga riktiga namn, ingen position, ingen kan se in i laget utifrån.
> Föräldrarna godkänner innan något barn kan lägga upp video.
>
> Visar den live i början av september om någon vill se. Säg gärna till om
> ni tycker jag missat något — det är byggt av en tränare, inte av ett
> företag, och det märks nog på sina ställen.
>
> https://skillstreak.xyz/?campaign=fb-tugg-sv#visning

## Facebook — the vibe-coding forum
`?campaign=fb-vibe-sv` (Swedish) / `?campaign=fb-vibe-en` (English)

Developers want the build, not the pitch.

> **Swedish:**
>
> Sommarprojekt: en träningsapp för mitt innebandylag med 9–13-åringar.
> NestJS + Postgres/Redis, Expo/React Native, kör på en riktig
> Kubernetes-kluster med CI/CD. Allt beslutsunderlag ligger som ADR:er i
> repot.
>
> Det intressanta var inte stacken. Det var att målgruppen är barn, vilket
> gör nästan varje bekvämt val förbjudet:
>
> • Ingen positionsdata någonstans — inte ens "nära dig"-funktioner.
> • Ingen analytics-SDK, inga trackers. Produktmätningen är egen och
>   aggregerad, med golv så att inget kan spåras till ett enskilt barn.
> • Föräldrasamtycke innan något media kan laddas upp, per barn.
> • Tränare ser inget alls om ett barn förrän just den familjen sagt ja —
>   och laget kan aldrig bläddras fram utifrån.
>
> Den sista regeln är den som formade arkitekturen mest: en vuxen kan
> aldrig söka upp ett lag. Inbjudan går alltid från laget till tränaren,
> aldrig tvärtom. Det låter litet och det ändrar allt.
>
> Poängsystemet blev också roligare än väntat — du får mer poäng ju bättre
> du bevisar att du faktiskt tränat. Klicka i en knapp: 0,1×. Selfie: 1×.
> Video du delar med laget: 1,4×.
>
> Visar den live i september: https://skillstreak.xyz/?campaign=fb-vibe-sv#visning
>
> **English:**
>
> Summer project: a training app for the youth floorball team I coach
> (ages 9–13). NestJS + Postgres/Redis, Expo/React Native, running on a
> real Kubernetes cluster with CI/CD. Every decision is an ADR in the repo.
>
> The stack was not the interesting part. The interesting part is that the
> users are children, which makes almost every convenient choice illegal
> or wrong:
>
> • No location data anywhere — not even "teams near you".
> • No analytics SDK, no third-party trackers. Product metrics are our own
>   and aggregate-only, with a suppression floor so nothing resolves to a
>   single child.
> • Parental consent before any media upload, per child.
> • A coach sees nothing about a child until that specific family says
>   yes — and teams can never be browsed from outside.
>
> That last rule shaped the architecture more than anything: an adult can
> never go looking for a team. The invitation always runs team → coach,
> never the reverse. It sounds small. It changes everything downstream.
>
> The scoring turned out more fun than expected: you earn more the better
> you prove you actually trained. Tap a button: 0.1×. Selfie: 1×. Video
> shared with the team: 1.4×.
>
> Live demo in September: https://skillstreak.xyz/?campaign=fb-vibe-en#visning

---

# 2. Investors

**Rule for this whole section: every claim must be checkable today.**
Nothing about projected users, revenue, market size or returns. Those are
regulated in ways a LinkedIn post should not go near, and — more
practically — a number you invented is the one thing a serious person will
check first. Say what exists. It is more impressive than a forecast
anyway.

Fill in `[…]` with real numbers before posting, or delete the line.

## LinkedIn — Swedish
`?campaign=li-sv-invest`

> SkillStreak: vad som faktiskt finns, för den som undrar.
>
> Jag har byggt en aktivitetsapp för ungdomsinnebandy i sommar. Den är
> inte en prototyp och inte en pitchdeck — den kör skarpt, mot ett
> riktigt lag, på egen infrastruktur.
>
> Vad som är byggt och i drift idag:
> • Individuella streaks och en gemensam lagpott
> • Klippflöde som bara laget ser, med föräldragodkännande innan uppladdning
> • Lagchatt med moderering
> • Tränarroll med samtycke per spelare
> • Åtta språk
> • Kubernetes, CI/CD, automatiska releaser
> • [X] lag och [Y] spelare i beta
>
> Vad som inte finns: intäkter, betalflöden, och en tränarmarknadsplats
> som är designad men inte byggd.
>
> Varför jag tror på den: reglerna som skyddar barnen är också det som gör
> den svår att kopiera. Vi samlar ingen positionsdata, har inga trackers
> och inga tredjepartsintegrationer i barnens flöde. Det stänger dörrar —
> och det är exakt den sortens app en förälder och en klubb faktiskt
> vågar säga ja till.
>
> Jag visar den live i början av september. Är du nyfiken på var det här
> kan ta vägen, kom och titta först och prata sen.
>
> https://skillstreak.xyz/?campaign=li-sv-invest#visning

## LinkedIn — English
`?campaign=li-en-invest`

> SkillStreak — what actually exists, for anyone wondering.
>
> I spent this summer building an activity app for youth floorball. It is
> not a prototype and it is not a deck. It runs, with a real team, on
> infrastructure I operate.
>
> Built and live today:
> • Individual streaks and a shared team pot
> • A clip feed only the team can see, with parental approval before upload
> • Team chat with moderation
> • A coach role gated on per-player consent
> • Eight languages
> • Kubernetes, CI/CD, automated releases
> • [X] teams and [Y] players in beta
>
> What does not exist: revenue, payments, and a coach marketplace that is
> designed but unbuilt.
>
> Why I think it holds: the rules that protect the children are also what
> make it hard to copy. No location data, no trackers, no third-party
> integrations anywhere in a child's path. That closes doors — and it is
> exactly the kind of app a parent and a club will actually agree to.
>
> Live demo in early September. If you are curious where this goes, come
> and look first, talk after.
>
> https://skillstreak.xyz/?campaign=li-en-invest#visning

## Direct message — when you spot someone worth approaching
`?campaign=dm-invest`

Short, specific, no deck attached. Adjust the middle line to them.

> **SV:** Hej [namn] — jag har byggt en app för ungdomsinnebandy i sommar
> (streaks för spelarna, gemensam pott för laget, byggd med barnens
> integritet som hårdkrav). Den kör skarpt mot ett riktigt lag nu. Jag såg
> att du [konkret sak de gjort], och tänkte att det här kanske ligger nära
> något du bryr dig om. Jag visar den live i september — ingen pitch, bara
> appen. Vill du ha länken?
>
> **EN:** Hi [name] — I spent the summer building an app for youth
> floorball (streaks for the player, a shared pot for the team, built with
> children's privacy as a hard constraint). It is running with a real team
> now. I saw that you [specific thing they did], and this might sit close
> to something you care about. I am showing it live in September — no
> pitch, just the app. Want the link?

---

# 3. People who might build it with you

Lead with what is *unfinished and interesting*. "Looking for
contributors" attracts nobody; a good unsolved problem attracts the right
person.

`?campaign=li-sv-bygg` / `?campaign=li-en-build`

> **Swedish:**
>
> Roligaste olösta problemen i mitt sommarprojekt, ifall någon vill vara
> med:
>
> 1. **Animerade avatarer som tävlar.** Barnen väljer en figur idag. Nästa
>    steg är att lagens avatarer springer mot varandra när potten växer.
>    Vem kan animation och gillar barnprodukter?
> 2. **En marknadsplats för tränare** — dela pass gratis eller ta betalt,
>    med omdömen. Svåra biten är inte kod: hur bygger man rykte för vuxna
>    som jobbar med barn, utan att ett bra betyg blir precis det en
>    olämplig person jagar?
> 3. **AI som skriver träningspass** från "kul 15-minuterspass för
>    11-åringar, ingen utrustning".
>
> Stacken är NestJS, Expo/React Native, Postgres/Redis, Kubernetes. Allt
> designbeslut ligger som ADR:er, så man kan läsa sig in på varför något
> ser ut som det gör istället för att gissa.
>
> Visar appen live i september: https://skillstreak.xyz/?campaign=li-sv-bygg#visning
>
> **English:**
>
> The most interesting unsolved problems in my summer project, in case
> anyone wants in:
>
> 1. **Animated avatars that race.** Kids pick a character today. Next is
>    team avatars racing each other as the pot grows. Who does animation
>    and likes building for children?
> 2. **A marketplace for coaches** — share sessions free or charge, with
>    reviews. The hard part is not the code: how do you build reputation
>    for adults who work with children, when a good rating is exactly what
>    a bad actor would farm?
> 3. **AI-generated sessions** from "a fun 15-minute session for
>    11-year-olds, no equipment".
>
> Stack is NestJS, Expo/React Native, Postgres/Redis, Kubernetes. Every
> design decision is an ADR, so you can read why something is the way it
> is instead of guessing.
>
> Live demo in September: https://skillstreak.xyz/?campaign=li-en-build#visning

---

# 4. Coaches and trainers

**Hold this one until after the demo.** Everything below promises a
waiting list, not an account — because that is what is true. The only way
into a team today is a captain's code.

`?campaign=li-sv-tranare` / `?campaign=li-en-coach`

> **Swedish:**
>
> Till er som tränar ungdomslag och lägger söndagskvällen på att planera
> veckans pass:
>
> Jag har byggt något åt oss. Inte åt klubbarna, åt oss.
>
> SkillStreak låter dig sätta ett veckomål för laget och sedan faktiskt se
> vad som händer mellan träningarna — vem som kört, vem som har en streak
> igång, och vem som tyst slutat dyka upp. Det sista är det jag själv
> saknade mest. Man märker det alldeles för sent annars.
>
> Du bygger veckan på ett av tre sätt: låt AI:n föreslå ett pass, använd
> ditt eget material, eller ta någon annan tränares upplägg och anpassa
> det. Ingen av dem kräver att du blir innehållsskapare. Du får fortsätta
> vara tränare.
>
> Och det du *inte* ser, med flit: inga riktiga namn, ingen kontaktinfo,
> ingen lagchatt, inga klipp, aldrig var ett barn befunnit sig. Du ser en
> spelares träning först när just den familjen sagt ja — och de kan ångra
> sig när som helst utan att förklara sig. Det kostar mig som tränare
> något. Det är också det enda skälet till att en förälder säger ja
> överhuvudtaget.
>
> Vi är inte öppna för nya tränare än — man kommer in via en lagkapten som
> bjuder in. Men skriv upp dig, så hör jag av mig när det går.
>
> https://skillstreak.xyz/?campaign=li-sv-tranare#visning
>
> **English:**
>
> For everyone who coaches a youth team and spends Sunday evening planning
> the week:
>
> I built something for us. Not for the clubs — for us.
>
> SkillStreak lets you set a weekly goal and then actually see what
> happens between sessions: who trained, who has a streak running, and who
> has quietly stopped showing up. That last one is what I missed most as a
> coach. You notice far too late otherwise.
>
> You build the week one of three ways: let the AI draft a session, use
> your own material, or take another coach's and adapt it. None of them
> ask you to become a content creator. You get to stay a coach.
>
> And what you deliberately do *not* see: no real names, no contact
> details, no team chat, no clips, and nowhere a child has been. You see a
> player's training only after that family says yes — and they can change
> their mind at any time without explaining. That costs me something as a
> coach. It is also the only reason a parent says yes at all.
>
> We are not open to new coaches yet — you get in when a team captain
> invites you. Put your name down and I will get in touch when we are.
>
> https://skillstreak.xyz/?campaign=li-en-coach#visning

---

## Things not to say

Worth keeping in front of you, because all four are tempting:

- **No invented numbers.** No user projections, no market size, no "we
  expect". Anything with `[X]` above gets a real figure or gets deleted.
- **Do not promise the coach marketplace, reviews, or paid tiers as
  features.** They are designed at best, and one of them is not even
  that. `docs/TRAINERS.md` says so out loud and should keep saying so.
- **Never post a child's screen name, clip, or team.** Screenshots for
  social media use made-up data. A screen name is anonymised for people
  *inside* the team bubble; it was never meant to be published to the
  internet next to the team's name.
- **Do not describe the app as approved, certified or GDPR-compliant by a
  third party.** It is built to a set of rules that are written down and
  argued in the repo, which is a stronger and more honest claim than a
  badge nobody issued.
