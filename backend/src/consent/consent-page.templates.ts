// Inline-styled, self-contained HTML for the parent-facing consent pages —
// no external assets (fonts/CSS/images), per the task: email clients and
// security scanners often prefetch links in emails, and a page that loads
// external resources on GET would be a needless second side channel on top
// of the "GET must have no side effects" rule these pages already follow.
// Not a full app screen — a one-off transactional page, kept minimal.
// Colors are the docs/design/style-guide.md tokens (paper/ink/flame/gold/
// success); no external font — system font stack only.
//
// docs/adr/0014-multi-language-support.md Decision 3 — this page takes the
// same locale as its corresponding email, resolved the same way (the
// Player row the consentToken already resolves to). Only the four pages
// that have a resolved Player in hand (confirm/approved, both flavors)
// take a `locale` param — the invalid/already-used pages have no token to
// resolve a Player from, so they stay the existing hardcoded Swedish copy,
// same as before this ADR. `COPY`/`resolveCopy` per-page, same pattern as
// every mail template in `mail/templates/*.template.ts` — part (b) (this
// session) added real en/fi/da/nb/de/cs/fr content to all four `COPY`
// objects; any locale outside the 8-value enum (there isn't one today)
// would still fall through to `sv`, never a blank/broken page.

import { PlayerLocale } from '../common/locale/player-locale.enum';
import { escapeHtml } from '../mail/templates/html-escape.util';
import { renderTransactionalHtmlPage as page } from '../common/html/transactional-page.util';

interface ConsentConfirmCopy {
  title: (safeName: string) => string;
  heading: (safeName: string) => string;
  body1: (safeName: string) => string;
  body2: (safeName: string) => string;
  button: string;
}

// en/fi/da/nb/de/cs/fr translations in all four COPY objects below (this
// one and the three further down the file) are AI-generated (this
// session), not sourced from a professional/native-speaker translator —
// recommend a native-speaker review pass before relying on this for real
// families, especially given this page's GDPR consent context.
const CONSENT_CONFIRM_COPY: Partial<Record<PlayerLocale, ConsentConfirmCopy>> =
  {
    sv: {
      title: (safeName) => `Godkänn ${safeName} — SkillStreak`,
      heading: (safeName) => `Godkänn ${safeName} på SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> vill logga träningspass i SkillStreak — en app för dagliga
      träningsstreak och ett gemensamt lagpoäng-mål. Inga platsdata samlas in någonsin, och
      allt ${safeName} delar — inklusive eventuella videoklipp — syns bara för sitt eget lag. Det finns ett undantag: ${safeName} kan välja att dela sina egna klipp med andra SkillStreak-användare, men bara om du säger ja till det separat, och du kan stänga av det när som helst.`,
      body2: (safeName) =>
        `Om du godkänner kan ${safeName} börja logga träningspass från och med nu. Videoklipp som
      ${safeName} delar kan också analyseras automatiskt för att skapa taggar som beskriver
      vilken typ av träning de visar. Du kan alltid höra av dig till tränaren om du ändrar dig
      senare.`,
      button: 'Jag godkänner',
    },
    en: {
      title: (safeName) => `Approve ${safeName} — SkillStreak`,
      heading: (safeName) => `Approve ${safeName} on SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> wants to log training sessions in SkillStreak — an app for daily
      training streaks and a shared team point goal. No location data is ever collected, and
      anything ${safeName} shares — including any video clips — is only visible to their own team. There is one exception: ${safeName} can choose to share their own clips with other SkillStreak users, but only if you separately agree to it, and you can switch it off at any time.`,
      body2: (safeName) =>
        `If you approve, ${safeName} can start logging training sessions right away. Video clips
      ${safeName} shares may also be automatically analyzed to generate tags describing what kind
      of training they show. You can always get in touch with the coach if you change your mind
      later.`,
      button: 'I approve',
    },
    es: {
      title: (safeName) => `Autorizar a ${safeName} — SkillStreak`,
      heading: (safeName) => `Autorizar a ${safeName} en SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> quiere registrar entrenamientos en SkillStreak, una app de rachas de
      entrenamiento diarias y de un objetivo de puntos compartido por el equipo. Nunca se recogen datos de ubicación, y
      todo lo que comparte ${safeName} — incluidos los vídeos — solo lo ve su propio equipo. Hay una excepción: ${safeName} puede compartir sus propios vídeos con otros usuarios de SkillStreak, pero solo si tú lo autorizas por separado, y puedes desactivarlo cuando quieras.`,
      body2: (safeName) =>
        `Si lo autorizas, ${safeName} podrá empezar a registrar entrenamientos ahora mismo. Los vídeos que
      comparta ${safeName} también pueden analizarse automáticamente para crear etiquetas
      que describen qué tipo de entrenamiento muestran. Siempre puedes hablar con el
      entrenador si cambias de idea más adelante.`,
      button: 'Doy mi autorización',
    },
    fi: {
      title: (safeName) => `Hyväksy ${safeName} — SkillStreak`,
      heading: (safeName) => `Hyväksy ${safeName} SkillStreakiin`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> haluaa kirjata harjoituksia SkillStreakissa — sovelluksessa, jossa
      harjoitellaan päivittäin putkeen ja kerätään yhteistä joukkuepistemäärää. Sijaintitietoja
      ei kerätä koskaan, ja kaikki mitä ${safeName} jakaa — myös mahdolliset videoklipit —
      näkyy vain omalle joukkueelleen. Yksi poikkeus: ${safeName} voi jakaa omia videoklippejään muille SkillStreakin käyttäjille, mutta vain jos annat siihen erikseen luvan, ja voit peruuttaa sen milloin tahansa.`,
      body2: (safeName) =>
        `Jos hyväksyt, ${safeName} voi alkaa kirjata harjoituksia heti. Videoklipit, joita
      ${safeName} jakaa, voidaan myös analysoida automaattisesti taggien luomiseksi sen mukaan,
      millaista harjoittelua ne näyttävät. Voit aina ottaa yhteyttä valmentajaan, jos muutat
      mielesi myöhemmin.`,
      button: 'Hyväksyn',
    },
    da: {
      title: (safeName) => `Godkend ${safeName} — SkillStreak`,
      heading: (safeName) => `Godkend ${safeName} på SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> vil gerne logge træningspas i SkillStreak — en app til daglige
      træningsstreaks og et fælles holdpoint-mål. Der indsamles aldrig placeringsdata, og alt
      hvad ${safeName} deler — inklusive eventuelle videoklip — er kun synligt for sit eget hold. Der er én undtagelse: ${safeName} kan vælge at dele sine egne klip med andre SkillStreak-brugere, men kun hvis du siger ja til det separat, og du kan slå det fra når som helst.`,
      body2: (safeName) =>
        `Hvis du godkender det, kan ${safeName} begynde at logge træningspas med det samme.
      Videoklip, som ${safeName} deler, kan også blive analyseret automatisk for at skabe tags,
      der beskriver, hvilken slags træning de viser. Du kan altid kontakte træneren, hvis du
      skifter mening senere.`,
      button: 'Jeg godkender',
    },
    nb: {
      title: (safeName) => `Godkjenn ${safeName} — SkillStreak`,
      heading: (safeName) => `Godkjenn ${safeName} på SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> vil logge treningsøkter i SkillStreak — en app for daglige
      treningsstreaker og et felles lagpoengmål. Det samles aldri inn stedsdata, og alt
      ${safeName} deler — inkludert eventuelle videoklipp — er bare synlig for sitt eget lag. Det finnes ett unntak: ${safeName} kan velge å dele sine egne klipp med andre SkillStreak-brukere, men bare hvis du sier ja til det separat, og du kan slå det av når som helst.`,
      body2: (safeName) =>
        `Hvis du godkjenner, kan ${safeName} begynne å logge treningsøkter med en gang. Videoklipp
      som ${safeName} deler kan også bli analysert automatisk for å lage tagger som beskriver hva
      slags trening de viser. Du kan alltid ta kontakt med treneren hvis du ombestemmer deg
      senere.`,
      button: 'Jeg godkjenner',
    },
    de: {
      title: (safeName) => `${safeName} zustimmen — SkillStreak`,
      heading: (safeName) => `Zustimmung für ${safeName} auf SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> möchte Trainingseinheiten in SkillStreak eintragen — einer App für
      tägliche Trainings-Streaks und ein gemeinsames Team-Punkteziel. Es werden niemals
      Standortdaten erhoben, und alles, was ${safeName} teilt — einschließlich etwaiger
      Videoclips — ist nur für das eigene Team sichtbar. Es gibt eine Ausnahme: ${safeName} kann eigene Clips mit anderen SkillStreak-Nutzern teilen, aber nur wenn Sie dem gesondert zustimmen, und Sie können es jederzeit wieder abschalten.`,
      body2: (safeName) =>
        `Wenn du zustimmst, kann ${safeName} ab sofort Trainingseinheiten eintragen. Videoclips, die
      ${safeName} teilt, können außerdem automatisch analysiert werden, um Tags zu erstellen, die
      beschreiben, welche Art von Training zu sehen ist. Du kannst dich jederzeit an den Trainer
      bzw. die Trainerin wenden, falls du es dir später anders überlegst.`,
      button: 'Ich stimme zu',
    },
    cs: {
      title: (safeName) => `Souhlas pro ${safeName} — SkillStreak`,
      heading: (safeName) => `Souhlas pro ${safeName} na SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> chce zaznamenávat tréninky v SkillStreak — aplikaci pro denní
      tréninkové série a společný týmový bodový cíl. Údaje o poloze se nikdy nesbírají a vše,
      co ${safeName} sdílí — včetně případných video klipů — je viditelné pouze pro jeho vlastní tým. Existuje jedna výjimka: ${safeName} může své vlastní klipy sdílet s ostatními uživateli SkillStreaku, ale jen pokud s tím zvlášť souhlasíte, a kdykoli to můžete vypnout.`,
      body2: (safeName) =>
        `Pokud souhlasíte, ${safeName} může začít zaznamenávat tréninky ihned. Video klipy, které
      ${safeName} sdílí, mohou být také automaticky analyzovány za účelem vytvoření štítků
      popisujících, jaký typ tréninku ukazují. Kdykoli se můžete obrátit na trenéra, pokud si to
      později rozmyslíte.`,
      button: 'Souhlasím',
    },
    fr: {
      title: (safeName) => `Approuver ${safeName} — SkillStreak`,
      heading: (safeName) => `Approuver ${safeName} sur SkillStreak`,
      body1: (safeName) =>
        `<strong>${safeName}</strong> souhaite enregistrer des séances d'entraînement sur SkillStreak —
      une application pour des séries d'entraînement quotidiennes et un objectif de points
      d'équipe commun. Aucune donnée de localisation n'est jamais collectée, et tout ce que
      ${safeName} partage — y compris d'éventuels clips vidéo — n'est visible que par sa propre équipe. Il y a une exception : ${safeName} peut choisir de partager ses propres clips avec d'autres utilisateurs de SkillStreak, mais uniquement si vous y consentez séparément, et vous pouvez le désactiver à tout moment.`,
      body2: (safeName) =>
        `Si vous approuvez, ${safeName} pourra commencer à enregistrer ses séances d'entraînement dès
      maintenant. Les clips vidéo partagés par ${safeName} peuvent également être analysés
      automatiquement pour générer des étiquettes décrivant le type d'entraînement montré. Vous
      pouvez toujours contacter l'entraîneur si vous changez d'avis plus tard.`,
      button: "J'approuve",
    },
  };

function resolveConsentConfirmCopy(locale: PlayerLocale): ConsentConfirmCopy {
  return CONSENT_CONFIRM_COPY[locale] ?? CONSENT_CONFIRM_COPY.sv!;
}

/** GET, valid token: the genuine confirmation step — a human must press
 * this button (which POSTs) for anything to actually change. */
export function renderConsentConfirmPage(
  screenName: string,
  locale: PlayerLocale,
): string {
  const safeName = escapeHtml(screenName);
  const copy = resolveConsentConfirmCopy(locale);
  return page(
    copy.title(safeName),
    `
    <h1 style="margin:0 0 16px;font-size:22px;">${copy.heading(safeName)}</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      ${copy.body1(safeName)}
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      ${copy.body2(safeName)}
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#FF6B35;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        ${copy.button}
      </button>
    </form>
    `,
    locale,
  );
}

const SELF_VERIFICATION_CONFIRM_COPY: Partial<
  Record<PlayerLocale, ConsentConfirmCopy>
> = {
  sv: {
    title: () => `Verifiera ditt konto — SkillStreak`,
    heading: () => `Verifiera ditt konto på SkillStreak`,
    body1: (safeName) =>
      `Nästan klart, <strong>${safeName}</strong>! Bekräfta att det här är din e-post för att
      aktivera ditt konto. Inga platsdata samlas in någonsin, och allt du delar — inklusive
      eventuella videoklipp — syns bara för ditt eget lag. Vill du någon gång dela ett eget klipp utanför laget krävs det att en förälders eller vårdnadshavares e-post läggs till på kontot och att den vuxna säger ja.`,
    body2: () =>
      `När du bekräftar kan du börja logga träningspass från och med nu. Videoklipp du delar kan
      också analyseras automatiskt för att skapa taggar som beskriver vilken typ av träning de
      visar.`,
    button: 'Verifiera mitt konto',
  },
  en: {
    title: () => `Verify your account — SkillStreak`,
    heading: () => `Verify your account on SkillStreak`,
    body1: (safeName) =>
      `Almost done, <strong>${safeName}</strong>! Confirm that this is your email to activate your
      account. No location data is ever collected, and anything you share — including any video
      clips — is only visible to your own team. If you ever want to share one of your own clips outside your team, a parent or guardian's email has to be added to your account and that adult has to agree.`,
    body2: () =>
      `Once you confirm, you can start logging training sessions right away. Video clips you share
      may also be automatically analyzed to generate tags describing what kind of training they
      show.`,
    button: 'Verify my account',
  },
  es: {
    title: () => `Verifica tu cuenta — SkillStreak`,
    heading: () => `Verifica tu cuenta en SkillStreak`,
    body1: (safeName) =>
      `¡Ya casi está, <strong>${safeName}</strong>! Confirma que este es tu correo para activar tu
      cuenta. Nunca se recogen datos de ubicación, y todo lo que compartes — incluidos los
      vídeos — solo lo ve tu propio equipo. Si alguna vez quieres compartir uno de tus vídeos fuera del equipo, hay que añadir a tu cuenta el correo de un padre, una madre o un tutor, y ese adulto tiene que dar su permiso.`,
    body2: () =>
      `En cuanto lo confirmes, podrás empezar a registrar entrenamientos ahora mismo. Los vídeos que compartas
      también pueden analizarse automáticamente para crear etiquetas que describen qué tipo de entrenamiento
      muestran.`,
    button: 'Verificar mi cuenta',
  },
  fi: {
    title: () => `Vahvista tilisi — SkillStreak`,
    heading: () => `Vahvista tilisi SkillStreakissa`,
    body1: (safeName) =>
      `Melkein valmista, <strong>${safeName}</strong>! Vahvista, että tämä on sähköpostiosoitteesi,
      jotta voit aktivoida tilisi. Sijaintitietoja ei kerätä koskaan, ja kaikki mitä jaat —
      myös mahdolliset videoklipit — näkyy vain omalle joukkueellesi. Jos joskus haluat jakaa oman videoklippisi joukkueen ulkopuolelle, tilillesi on lisättävä huoltajan sähköpostiosoite ja hänen on annettava siihen lupa.`,
    body2: () =>
      `Kun vahvistat, voit alkaa kirjata harjoituksia heti. Videoklipit, joita jaat, voidaan myös
      analysoida automaattisesti taggien luomiseksi sen mukaan, millaista harjoittelua ne
      näyttävät.`,
    button: 'Vahvista tilini',
  },
  da: {
    title: () => `Bekræft din konto — SkillStreak`,
    heading: () => `Bekræft din konto på SkillStreak`,
    body1: (safeName) =>
      `Næsten færdig, <strong>${safeName}</strong>! Bekræft, at dette er din e-mail for at aktivere
      din konto. Der indsamles aldrig placeringsdata, og alt hvad du deler — inklusive
      eventuelle videoklip — er kun synligt for dit eget hold. Hvis du på et tidspunkt vil dele et af dine egne klip uden for holdet, skal en forælders eller værges e-mail tilføjes til kontoen, og den voksne skal sige ja.`,
    body2: () =>
      `Når du har bekræftet, kan du begynde at logge træningspas med det samme. Videoklip, du
      deler, kan også blive analyseret automatisk for at skabe tags, der beskriver, hvilken slags
      træning de viser.`,
    button: 'Bekræft min konto',
  },
  nb: {
    title: () => `Bekreft kontoen din — SkillStreak`,
    heading: () => `Bekreft kontoen din på SkillStreak`,
    body1: (safeName) =>
      `Nesten ferdig, <strong>${safeName}</strong>! Bekreft at dette er e-posten din for å aktivere
      kontoen din. Det samles aldri inn stedsdata, og alt du deler — inkludert eventuelle
      videoklipp — er bare synlig for ditt eget lag. Hvis du en gang vil dele et av dine egne klipp utenfor laget, må e-postadressen til en forelder eller foresatt legges til på kontoen, og den voksne må si ja.`,
    body2: () =>
      `Når du bekrefter, kan du begynne å logge treningsøkter med en gang. Videoklipp du deler kan
      også bli analysert automatisk for å lage tagger som beskriver hva slags trening de viser.`,
    button: 'Bekreft kontoen min',
  },
  de: {
    title: () => `Bestätige dein Konto — SkillStreak`,
    heading: () => `Bestätige dein Konto auf SkillStreak`,
    body1: (safeName) =>
      `Fast geschafft, <strong>${safeName}</strong>! Bestätige, dass dies deine E-Mail-Adresse ist, um
      dein Konto zu aktivieren. Es werden niemals Standortdaten erhoben, und alles, was du
      teilst — einschließlich etwaiger Videoclips — ist nur für dein eigenes Team sichtbar. Wenn du irgendwann einen eigenen Clip außerhalb deines Teams teilen möchtest, muss die E-Mail-Adresse eines Elternteils oder Erziehungsberechtigten zum Konto hinzugefügt werden und diese erwachsene Person muss zustimmen.`,
    body2: () =>
      `Sobald du bestätigst, kannst du sofort mit dem Eintragen von Trainingseinheiten beginnen.
      Videoclips, die du teilst, können außerdem automatisch analysiert werden, um Tags zu
      erstellen, die beschreiben, welche Art von Training zu sehen ist.`,
    button: 'Mein Konto bestätigen',
  },
  cs: {
    title: () => `Ověřte svůj účet — SkillStreak`,
    heading: () => `Ověřte svůj účet na SkillStreak`,
    body1: (safeName) =>
      `Už téměř hotovo, <strong>${safeName}</strong>! Potvrďte, že toto je váš e-mail, abyste
      aktivovali svůj účet. Údaje o poloze se nikdy nesbírají a vše, co sdílíte — včetně
      případných video klipů — je viditelné pouze pro váš vlastní tým. Pokud budete někdy chtít sdílet vlastní klip mimo tým, musí být k účtu přidán e-mail rodiče nebo zákonného zástupce a tento dospělý s tím musí souhlasit.`,
    body2: () =>
      `Jakmile potvrdíte, můžete ihned začít zaznamenávat tréninky. Video klipy, které sdílíte,
      mohou být také automaticky analyzovány za účelem vytvoření štítků popisujících, jaký typ
      tréninku ukazují.`,
    button: 'Ověřit můj účet',
  },
  fr: {
    title: () => `Vérifiez votre compte — SkillStreak`,
    heading: () => `Vérifiez votre compte sur SkillStreak`,
    body1: (safeName) =>
      `Presque terminé, <strong>${safeName}</strong> ! Confirmez qu'il s'agit bien de votre adresse
      e-mail pour activer votre compte. Aucune donnée de localisation n'est jamais collectée,
      et tout ce que vous partagez — y compris d'éventuels clips vidéo — n'est visible que par votre propre équipe. Si vous souhaitez un jour partager l'un de vos propres clips en dehors de votre équipe, l'adresse e-mail d'un parent ou tuteur doit être ajoutée au compte et cet adulte doit donner son accord.`,
    body2: () =>
      `Une fois confirmé, vous pourrez commencer à enregistrer vos séances d'entraînement dès
      maintenant. Les clips vidéo que vous partagez peuvent également être analysés
      automatiquement pour générer des étiquettes décrivant le type d'entraînement montré.`,
    button: 'Vérifier mon compte',
  },
};

function resolveSelfVerificationConfirmCopy(
  locale: PlayerLocale,
): ConsentConfirmCopy {
  return (
    SELF_VERIFICATION_CONFIRM_COPY[locale] ?? SELF_VERIFICATION_CONFIRM_COPY.sv!
  );
}

/** GET, valid token, self-verification (13+, added 2026-07-27) — first-
 * person copy: the player is confirming their own email, nobody else is
 * being asked anything, unlike renderConsentConfirmPage's "does a parent
 * approve this child" framing. Same POST-to-confirm mechanism. */
export function renderSelfVerificationConfirmPage(
  screenName: string,
  locale: PlayerLocale,
): string {
  const safeName = escapeHtml(screenName);
  const copy = resolveSelfVerificationConfirmCopy(locale);
  return page(
    copy.title(safeName),
    `
    <h1 style="margin:0 0 16px;font-size:22px;">${copy.heading(safeName)}</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">
      ${copy.body1(safeName)}
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
      ${copy.body2(safeName)}
    </p>
    <form method="POST" action="">
      <button type="submit" style="background-color:#FF6B35;color:#FFFFFF;border:none;border-radius:12px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;">
        ${copy.button}
      </button>
    </form>
    `,
    locale,
  );
}

/** GET, invalid/expired/already-consumed token: deliberately identical
 * copy regardless of *why* the token doesn't resolve — never hints
 * whether it was close to valid. */
export function renderConsentInvalidPage(): string {
  return page(
    'Länken är inte längre giltig — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Länken är inte längre giltig</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Den här länken för godkännande fungerar inte längre. Det kan bero på att den redan har
      använts eller gått ut. Hör av dig till tränaren om du behöver en ny länk.
    </p>
    `,
  );
}

interface ConsentApprovedCopy {
  title: string;
  heading: string;
  body: (safeName: string) => string;
}

const CONSENT_APPROVED_COPY: Partial<
  Record<PlayerLocale, ConsentApprovedCopy>
> = {
  sv: {
    title: 'Tack! — SkillStreak',
    heading: 'Tack!',
    body: (safeName) => `${safeName} kan nu börja logga träningar.`,
  },
  en: {
    title: 'Thank you! — SkillStreak',
    heading: 'Thank you!',
    body: (safeName) => `${safeName} can now start logging training sessions.`,
  },
  es: {
    title: '¡Gracias! — SkillStreak',
    heading: '¡Gracias!',
    body: (safeName) =>
      `${safeName} ya puede empezar a registrar entrenamientos.`,
  },
  fi: {
    title: 'Kiitos! — SkillStreak',
    heading: 'Kiitos!',
    body: (safeName) => `${safeName} voi nyt alkaa kirjata harjoituksia.`,
  },
  da: {
    title: 'Tak! — SkillStreak',
    heading: 'Tak!',
    body: (safeName) => `${safeName} kan nu begynde at logge træningspas.`,
  },
  nb: {
    title: 'Takk! — SkillStreak',
    heading: 'Takk!',
    body: (safeName) => `${safeName} kan nå begynne å logge treningsøkter.`,
  },
  de: {
    title: 'Danke! — SkillStreak',
    heading: 'Danke!',
    body: (safeName) =>
      `${safeName} kann jetzt mit dem Eintragen von Trainingseinheiten beginnen.`,
  },
  cs: {
    title: 'Děkujeme! — SkillStreak',
    heading: 'Děkujeme!',
    body: (safeName) => `${safeName} nyní může začít zaznamenávat tréninky.`,
  },
  fr: {
    title: 'Merci ! — SkillStreak',
    heading: 'Merci !',
    body: (safeName) =>
      `${safeName} peut maintenant commencer à enregistrer ses séances d'entraînement.`,
  },
};

function resolveConsentApprovedCopy(locale: PlayerLocale): ConsentApprovedCopy {
  return CONSENT_APPROVED_COPY[locale] ?? CONSENT_APPROVED_COPY.sv!;
}

/** POST, successful approval. */
export function renderConsentApprovedPage(
  screenName: string,
  locale: PlayerLocale,
): string {
  const safeName = escapeHtml(screenName);
  const copy = resolveConsentApprovedCopy(locale);
  return page(
    copy.title,
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">${copy.heading}</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      ${copy.body(safeName)}
    </p>
    `,
    locale,
  );
}

const SELF_VERIFICATION_APPROVED_COPY: Partial<
  Record<PlayerLocale, ConsentApprovedCopy>
> = {
  sv: {
    title: 'Klart! — SkillStreak',
    heading: 'Klart!',
    body: (safeName) =>
      `Ditt konto är verifierat, ${safeName}. Du kan nu börja logga träningar.`,
  },
  en: {
    title: 'Done! — SkillStreak',
    heading: 'Done!',
    body: (safeName) =>
      `Your account is verified, ${safeName}. You can now start logging training sessions.`,
  },
  es: {
    title: '¡Listo! — SkillStreak',
    heading: '¡Listo!',
    body: (safeName) =>
      `Tu cuenta está verificada, ${safeName}. Ya puedes empezar a registrar entrenamientos.`,
  },
  fi: {
    title: 'Valmista! — SkillStreak',
    heading: 'Valmista!',
    body: (safeName) =>
      `Tilisi on vahvistettu, ${safeName}. Voit nyt alkaa kirjata harjoituksia.`,
  },
  da: {
    title: 'Klart! — SkillStreak',
    heading: 'Klart!',
    body: (safeName) =>
      `Din konto er bekræftet, ${safeName}. Du kan nu begynde at logge træningspas.`,
  },
  nb: {
    title: 'Ferdig! — SkillStreak',
    heading: 'Ferdig!',
    body: (safeName) =>
      `Kontoen din er bekreftet, ${safeName}. Du kan nå begynne å logge treningsøkter.`,
  },
  de: {
    title: 'Fertig! — SkillStreak',
    heading: 'Fertig!',
    body: (safeName) =>
      `Dein Konto ist bestätigt, ${safeName}. Du kannst jetzt mit dem Eintragen von Trainingseinheiten beginnen.`,
  },
  cs: {
    title: 'Hotovo! — SkillStreak',
    heading: 'Hotovo!',
    body: (safeName) =>
      `Váš účet je ověřen, ${safeName}. Nyní můžete začít zaznamenávat tréninky.`,
  },
  fr: {
    title: 'Terminé ! — SkillStreak',
    heading: 'Terminé !',
    body: (safeName) =>
      `Votre compte est vérifié, ${safeName}. Vous pouvez maintenant commencer à enregistrer vos séances d'entraînement.`,
  },
};

function resolveSelfVerificationApprovedCopy(
  locale: PlayerLocale,
): ConsentApprovedCopy {
  return (
    SELF_VERIFICATION_APPROVED_COPY[locale] ??
    SELF_VERIFICATION_APPROVED_COPY.sv!
  );
}

/** POST, successful self-verification (13+). */
export function renderSelfVerificationApprovedPage(
  screenName: string,
  locale: PlayerLocale,
): string {
  const safeName = escapeHtml(screenName);
  const copy = resolveSelfVerificationApprovedCopy(locale);
  return page(
    copy.title,
    `
    <h1 style="margin:0 0 16px;font-size:22px;color:#3DAA6B;">${copy.heading}</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      ${copy.body(safeName)}
    </p>
    `,
    locale,
  );
}

/** POST, token already consumed/invalid/expired — friendly, not an error,
 * since a second POST to an already-used link is an expected case (e.g. a
 * parent double-tapping the button), not a failure. */
export function renderConsentAlreadyUsedPage(): string {
  return page(
    'Redan bekräftat — SkillStreak',
    `
    <h1 style="margin:0 0 16px;font-size:22px;">Redan bekräftat</h1>
    <p style="margin:0;font-size:15px;line-height:1.5;">
      Det här godkännandet är redan genomfört, eller så har länken gått ut. Inget mer behöver
      göras. Hör av dig till tränaren om något verkar fel.
    </p>
    `,
  );
}
