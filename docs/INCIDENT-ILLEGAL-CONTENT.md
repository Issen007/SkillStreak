# When something illegal is found in the app

`docs/design/clip-safety.md` layer 5. Written 2026-08-27, before it was
needed, which is the only useful time to write it.

**Not legal advice.** It is an operational checklist plus a list of
specific things to put in front of the lawyer already being engaged for
the privacy policy (launch checklist §1.1). Where it names a law it names
the article so it can be checked rather than believed.

---

## Part 1 — the first hour

The order matters more than the speed.

### 1. Do not open it again. Do not download it. Do not send it to anyone.

If the material is child sexual abuse material, **possessing it is itself
a crime in Sweden** (Brottsbalken 16 kap. 10 a §). That is not a
technicality: downloading a copy "to be sure", saving it to show someone,
or forwarding it to a colleague for a second opinion each create a new
offence, by the person trying to help.

You have already seen enough if you are reading this. Nobody needs to
look twice.

### 2. Make it unreachable, without destroying it

A report already hides a clip instantly. If it is not already hidden, hide
it — in the console's **Reported clips** queue, or by upholding the report.

**Do not delete it, and do not delete the account.** The file and the
surrounding records are evidence. Deleting them before the police have
what they need can destroy the case and can itself be an offence.

Concretely, until told otherwise by the police:

- Do not run any manual clip deletion.
- Do not action an account-erasure request from the uploader or the
  reporter. `AccountErasureSweepService` runs nightly on a 30-day window —
  if an erasure is already pending for either account, that is the one
  thing that needs a deliberate hold, and it needs it that day.

### 3. Write down what you know, once

In a file, not in your head, and not in a chat window:

- the clip id, the uploader's player id, the team id
- when it was uploaded, when it was reported, by how many people
- what the reporting reasons said
- what you did and when (hidden at HH:MM, report upheld at HH:MM)

That record is what turns "we handled it" into something demonstrable.

### 4. Report it

**Police — Sweden:** call **114 14** (or 112 if a child is in immediate
danger) and say you are an online service provider reporting suspected
child sexual abuse material on your platform. Ask them how they want the
material preserved and handed over. Follow that instruction rather than
this document.

**ECPAT Sverige's hotline** — <https://ecpat.se> — takes reports of
child sexual abuse material and is part of INHOPE, the international
hotline network. Reporting there does not replace the police.

If the content is not CSAM but is still serious — a credible threat, a
child in danger, grooming — 114 14 is still the number, and Article 18 of
the DSA (below) may make contacting them an obligation rather than a
choice.

### 5. Only then, the product questions

Whether to suspend the account, whether to tell the team, whether to tell
the parents. **Ask the police first** — telling the wrong person early can
tip off a suspect. There is no rush here that outweighs that.

---

## Part 2 — what the DSA probably requires, to confirm with the lawyer

Regulation (EU) 2022/2065. SkillStreak stores content supplied by users,
so it is at least a **hosting service**, and probably an **online
platform** (it disseminates that content to other users).

The obligations stack by tier. Take this list to the lawyer rather than
treating it as settled:

**As an intermediary service (Articles 11–15)**
- A **single point of contact** for authorities and for users, published.
- **Terms and conditions** that describe any restrictions imposed on user
  content, including moderation and any automated tools — in language a
  child can understand where the service is aimed at minors (Art 14(3)).
- Annual **transparency reporting** — Art 15, with a micro/small
  enterprise exemption in Art 15(2).

**As a hosting service (Articles 16–18)**
- **Notice and action** (Art 16): a mechanism anyone can use to flag
  illegal content, not just a logged-in teammate. The in-app clip report
  is not enough on its own — it needs a public route.
- **Statement of reasons** (Art 17) to the affected user when content is
  removed or restricted. The rejection reason on public review and the
  note on a moderation decision are the raw material; whether they are
  delivered to the child in the form Art 17 requires is the open question.
- **Article 18 — notification of suspected criminal offences.** If the
  provider becomes aware of information giving rise to a suspicion of a
  criminal offence involving a threat to the life or safety of a person,
  it must inform law enforcement. **This is the article that turns Part 1
  step 4 from good practice into a duty**, and it is the single most
  important one to have read properly.

**As an online platform (Articles 19–28)**
- Art 19 exempts **micro and small enterprises** from this whole section —
  internal complaint handling, trusted flaggers, measures against misuse,
  and Article 28's protection-of-minors provisions.
- **Confirm that exemption actually applies, and confirm it covers Art
  28.** A children's app being exempt from the minors article is
  surprising enough to be worth checking rather than assuming, and the
  answer changes what has to be built.

**Ask the lawyer these five questions:**

1. Is SkillStreak an online platform, or only a hosting service?
2. Does the micro/small-enterprise exemption apply, and does it cover
   Article 28?
3. Does the in-app report satisfy Article 16, or is a public notice route
   needed as well?
4. What form must an Article 17 statement of reasons take for a child?
5. Is there a Swedish reporting duty beyond Article 18?

---

## Part 3 — what has to exist in the product before launch

Each of these is small, and none exists yet.

- **A public way to report**, reachable without an account — an address on
  the site is enough to start, and the contact form already built could
  carry it.
- **A published point of contact** for authorities. Today the only
  published address is the sponsorship contact.
- **Terms of service**, published. `terms-of-service-DRAFT.md` exists and
  is unpublished; §1.1 of the launch checklist already has this.
- **Say what happens when something is reported**, in the parent-facing
  copy and in language a child can read. The controls are real and nobody
  is told about them, which wastes them.

---

## Part 4 — who does this

**One person: the project owner.** That is the honest state of it, and
writing it down is the point rather than an embarrassment.

Two consequences to decide deliberately:

- **There is no cover.** If the owner is on a plane, nothing happens.
  Worth naming one other adult who can at least hide a clip and call 114
  14 — they do not need database access to do either.
- **The queue depends on one person's attention.** Both the public-review
  queue and the reported-clip queue are one operator wide, by design, and
  that is the first thing to break if the app grows. `clip-safety.md` says
  so; this is where the consequence lands.

---

## What this document is not

It does not make the app compliant, and it does not replace the lawyer's
hour. It means that on the day something happens, nobody has to work out
what to do while it is happening — which is the only part of this that
cannot be bought afterwards.
