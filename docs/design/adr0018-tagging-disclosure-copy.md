# ADR-0018 Decision 3 — tagging-disclosure copy for the consent pages

Scope: one added sentence in `body2` of each of the two `ConsentConfirmCopy`
objects in `backend/src/consent/consent-page.templates.ts` —
`CONSENT_CONFIRM_COPY` (parent-facing) and
`SELF_VERIFICATION_CONFIRM_COPY` (13+ player's own confirmation). No new
consent gate, no new page, no change to `body1`, the buttons, the
"approved"/"invalid"/"already-used" pages, or any locale not already in
this file. Per ADR-0018 Decision 3, this is a transparency copy addition
riding on the existing account-level upload approval, for the recommended
self-hosted-classification architecture only.

Same disclaimer as the file's own header: sv/en were written with care;
fi/da/nb/de/cs/fr are best-effort, AI-produced translations, flagged for
the same future native-speaker review pass the rest of the file already
calls for — not a lower bar specific to this addition.

## Placement and tense, briefly

- **Placement — extends `body2`, not `body1`.** `body1` is about *who
  sees* what's shared (team-only visibility) — that's a different fact
  than *how the app processes* what's shared, and stacking both ideas
  into one sentence would make the page's densest paragraph denser.
  `body2` already covers "what happens after you approve," so a new
  sentence about automatic tag-generation sits there naturally. In the
  parent-facing copy it's inserted *between* the existing "can start
  logging now" sentence and the closing "contact the coach if you change
  your mind" reassurance, so the reassurance stays last. The
  self-verification copy's `body2` has no second sentence today, so the
  new one is simply appended.
- **One sentence, plain words.** "Automatically analyzed" and "tags
  describing what kind of training they show" instead of
  AI/algorithm/classifier jargon — matches this file's existing
  short-sentence, non-legalese register, and gives a concrete example
  (what the tag is *for*) rather than an abstract "processed."
- **Tense — "may... be automatically analyzed," not "is/are analyzed."**
  This is deliberate per the task's framing, not a style tic: as of this
  writing the classification service isn't deployed (two infra findings
  still open in ADR-0018), so a present-tense "is analyzed" would be
  false today. "May be" is accurate both now (describes the app's
  standing processing capability/intent, not a claim it's happening this
  second) and after launch (tagging is best-effort/threshold-gated per
  Decision 4 — not every clip gets a confident tag, so even post-launch
  "may" is the literally correct word, not "is").
- **No new gate.** No new checkbox, button, or page — just one more
  sentence inside the informational paragraph a parent/13+ player is
  already reading before tapping the existing single confirm button, per
  ADR-0018 Decision 3's explicit "copy change, not a new flow."

## `CONSENT_CONFIRM_COPY` — new `body2`, all locales

Parent-facing, third person (`${safeName}` = the child's screen name).
Bold = unchanged from current file; the inserted sentence is the middle
one in each.

**sv**
> Om du godkänner kan ${safeName} börja logga träningspass från och med nu. Videoklipp som ${safeName} delar kan också analyseras automatiskt för att skapa taggar som beskriver vilken typ av träning de visar. Du kan alltid höra av dig till tränaren om du ändrar dig senare.

**en**
> If you approve, ${safeName} can start logging training sessions right away. Video clips ${safeName} shares may also be automatically analyzed to generate tags describing what kind of training they show. You can always get in touch with the coach if you change your mind later.

**fi**
> Jos hyväksyt, ${safeName} voi alkaa kirjata harjoituksia heti. Videoklipit, joita ${safeName} jakaa, voidaan myös analysoida automaattisesti taggien luomiseksi sen mukaan, millaista harjoittelua ne näyttävät. Voit aina ottaa yhteyttä valmentajaan, jos muutat mielesi myöhemmin.

**da**
> Hvis du godkender det, kan ${safeName} begynde at logge træningspas med det samme. Videoklip, som ${safeName} deler, kan også blive analyseret automatisk for at skabe tags, der beskriver, hvilken slags træning de viser. Du kan altid kontakte træneren, hvis du skifter mening senere.

**nb**
> Hvis du godkjenner, kan ${safeName} begynne å logge treningsøkter med en gang. Videoklipp som ${safeName} deler kan også bli analysert automatisk for å lage tagger som beskriver hva slags trening de viser. Du kan alltid ta kontakt med treneren hvis du ombestemmer deg senere.

**de**
> Wenn du zustimmst, kann ${safeName} ab sofort Trainingseinheiten eintragen. Videoclips, die ${safeName} teilt, können außerdem automatisch analysiert werden, um Tags zu erstellen, die beschreiben, welche Art von Training zu sehen ist. Du kannst dich jederzeit an den Trainer bzw. die Trainerin wenden, falls du es dir später anders überlegst.

**cs**
> Pokud souhlasíte, ${safeName} může začít zaznamenávat tréninky ihned. Video klipy, které ${safeName} sdílí, mohou být také automaticky analyzovány za účelem vytvoření štítků popisujících, jaký typ tréninku ukazují. Kdykoli se můžete obrátit na trenéra, pokud si to později rozmyslíte.

**fr**
> Si vous approuvez, ${safeName} pourra commencer à enregistrer ses séances d'entraînement dès maintenant. Les clips vidéo partagés par ${safeName} peuvent également être analysés automatiquement pour générer des étiquettes décrivant le type d'entraînement montré. Vous pouvez toujours contacter l'entraîneur si vous changez d'avis plus tard.

## `SELF_VERIFICATION_CONFIRM_COPY` — new `body2`, all locales

13+ player's own confirmation, first/second person, no `safeName`
interpolation in `body2` (matches current file — the name only appears in
`body1`'s greeting).

**sv**
> När du bekräftar kan du börja logga träningspass från och med nu. Videoklipp du delar kan också analyseras automatiskt för att skapa taggar som beskriver vilken typ av träning de visar.

**en**
> Once you confirm, you can start logging training sessions right away. Video clips you share may also be automatically analyzed to generate tags describing what kind of training they show.

**fi**
> Kun vahvistat, voit alkaa kirjata harjoituksia heti. Videoklipit, joita jaat, voidaan myös analysoida automaattisesti taggien luomiseksi sen mukaan, millaista harjoittelua ne näyttävät.

**da**
> Når du har bekræftet, kan du begynde at logge træningspas med det samme. Videoklip, du deler, kan også blive analyseret automatisk for at skabe tags, der beskriver, hvilken slags træning de viser.

**nb**
> Når du bekrefter, kan du begynne å logge treningsøkter med en gang. Videoklipp du deler kan også bli analysert automatisk for å lage tagger som beskriver hva slags trening de viser.

**de**
> Sobald du bestätigst, kannst du sofort mit dem Eintragen von Trainingseinheiten beginnen. Videoclips, die du teilst, können außerdem automatisch analysiert werden, um Tags zu erstellen, die beschreiben, welche Art von Training zu sehen ist.

**cs**
> Jakmile potvrdíte, můžete ihned začít zaznamenávat tréninky. Video klipy, které sdílíte, mohou být také automaticky analyzovány za účelem vytvoření štítků popisujících, jaký typ tréninku ukazují.

**fr**
> Une fois confirmé, vous pourrez commencer à enregistrer vos séances d'entraînement dès maintenant. Les clips vidéo que vous partagez peuvent également être analysés automatiquement pour générer des étiquettes décrivant le type d'entraînement montré.

## Implementation note (for wiring, not a request to act)

Only the `body2` function bodies change; `title`, `heading`, `body1`, and
`button` are untouched in both copy objects, in all 8 locales. The
`ConsentConfirmCopy` interface's `body2` signature already accepts
`safeName` even where unused (`SELF_VERIFICATION_CONFIRM_COPY`'s `body2`
is currently `() => ...`) — no interface change needed either way.
