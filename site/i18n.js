/* SkillStreak marketing site — runtime translation.
 *
 * Keyed by the Swedish source string rather than by an invented key, for
 * one reason: this page is 2,300 lines of hand-written HTML, and adding a
 * data-i18n attribute to every text node would be a large, risky edit that
 * has to be repeated by anyone who ever touches the copy. Keying by source
 * means the markup stays untouched and a missing translation falls back to
 * Swedish — visible, honest, and never a blank page.
 *
 * The trade: editing the Swedish copy silently detaches its translation.
 * That is the right failure for a marketing page (you see Swedish, not an
 * empty element), and the check at the bottom of this file logs the misses
 * to the console so they are findable.
 *
 * Adding a language is a data change: add a block to TRANSLATIONS and an
 * option to LANGUAGES. No code changes.
 */
(function () {
  'use strict';

  /* Flags are inline SVG, not emoji.
   *
   * 🇸🇪/🇬🇧 render as the bare letters "SE"/"GB" on Windows, which has no
   * flag-emoji font and is a large share of this site's Swedish audience —
   * the switcher would silently degrade to text for exactly the people it
   * is aimed at. Inline SVG renders identically everywhere, needs no font
   * and no network request, and survives the site's CSP.
   *
   * The flag is decoration: each button keeps an `aria-label` and a
   * `title` carrying the language's own name, so a screen reader announces
   * "Svenska" rather than "image", and a hover explains the picture. A
   * flag is a country, not a language, which is why the accessible name
   * is the one that has to be right. */
  var FLAGS = {
    sv:
      '<svg viewBox="0 0 16 10" width="20" height="13" aria-hidden="true" focusable="false">' +
        '<rect width="16" height="10" fill="#005293"/>' +
        '<rect x="5" width="2" height="10" fill="#FECB00"/>' +
        '<rect y="4" width="16" height="2" fill="#FECB00"/>' +
      '</svg>',
    en:
      '<svg viewBox="0 0 60 30" width="20" height="13" aria-hidden="true" focusable="false">' +
        '<clipPath id="ls-uk"><path d="M0 0h60v30H0z"/></clipPath>' +
        '<g clip-path="url(#ls-uk)">' +
          '<path d="M0 0h60v30H0z" fill="#012169"/>' +
          '<path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/>' +
          '<path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" stroke-width="4"/>' +
          '<path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/>' +
          '<path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/>' +
        '</g>' +
      '</svg>'
  };

  var LANGUAGES = [
    { code: 'sv', label: 'Svenska' },
    { code: 'en', label: 'English' }
  ];

  var TRANSLATIONS = {
    en: {
      /* --- sponsors ----------------------------------------------------- */
      'Projektet stöds av': 'Supported by',

      /* --- sponsorship contact form -------------------------------------- */
      'Vill ditt företag också stödja SkillStreak?':
        'Would your company like to support SkillStreak too?',
      'Vi är en innebandytränare och ett projekt som drivs i öppen dager. Berätta kort vilka ni är och vad ni tänker er, så hör vi av oss.':
        'We are a floorball coach and a project built in the open. Tell us briefly who you are and what you have in mind, and we will get back to you.',
      'Företag eller förening (frivilligt)':
        'Company or club (optional)',
      'Vad vill ni berätta?': 'What would you like to tell us?',
      'Skicka': 'Send',

      /* --- trainer CTA --------------------------------------------------- */
      'Vill du vara tränare i SkillStreak?': 'Do you want to be a trainer in SkillStreak?',
      'Du sätter veckans mål och ser vad som faktiskt händer mellan träningarna — vem som kört, vem som har en streak igång, och vem som tyst slutat dyka upp. Det sista är det man annars märker alldeles för sent.':
        'You set the weekly goal and see what actually happens between sessions — who trained, who has a streak running, and who has quietly stopped showing up. That last one is what you otherwise notice far too late.',
      'Du kommer in genom att en lagkapten bjuder in dig — du kan aldrig söka upp ett lag själv. Och du ser en spelares träning först när just den familjen sagt ja. Det kostar dig något som tränare, och det är också hela skälet till att en förälder säger ja.':
        'You get in when a team captain invites you — you can never search for a team yourself. And you see a player\u2019s training only once that family has said yes. That costs you something as a coach, and it is also the whole reason a parent says yes at all.',
      'Vi är inte öppna för nya tränare än.': 'We are not open to new trainers yet.',
      'Skriv upp dig, så hör vi av oss när det går.':
        'Put your name down and we will get in touch when we are.',
      'Skriv upp mig som tränare': 'Put me on the list',
      'Läs vad tränarrollen ser': 'Read what the trainer role sees',

      /* --- demo-event signup ------------------------------------------- */
      'Jag vill vara med på resan som delägare':
        'I want to join the journey as a co-owner',
      'Visning': 'Live demo',
      'Var med på resan': 'Come along for the ride',
      /* Keys are the source string with whitespace collapsed to single
         spaces — see `apply()`. The entry this replaces kept the HTML's
         newlines and indentation and therefore never matched anything:
         this paragraph has been silently Swedish-only on the English site
         for as long as it has existed. Write long copy on one line. */
      'SkillStreak byggs i öppen dager av en innebandytränare. Skriv upp dig så hör du av oss när något faktiskt händer — nya släpp, och visningarna där vi går igenom hur en träning loggas, hur laget jagar VM-guldet ihop och hur trygghetsreglerna fungerar. Du väljer själv vad du vill ha, och kan säga upp det när som helst.':
        'SkillStreak is being built in the open by a floorball coach. Put your name down and you will hear from us when something actually happens — new releases, and the live demos where we go through how a session gets logged, how a team chases its World Championship gold together, and how the safety rules work. You choose what you want, and you can stop it at any time.',
      'Namn': 'Name',
      'E-post': 'Email',
      'Hur vill du vara med?': 'How would you like to be involved?',
      'Vad vill du att vi hör av oss om?': 'What should we get in touch about?',
      'Håll mig uppdaterad om nya släpp': 'Keep me posted about new releases',
      'Bjud in mig till nästa visning': 'Invite me to the next live demo',
      'Jag är bara nyfiken': 'Just curious',
      'Jag vill bli tränare i appen': 'I want to be a trainer in the app',
      'Jag vill vara med och bygga': 'I want to help build it',
      'Jag vill veta mer om investering': 'I want to know more about investing',
      'Annat': 'Something else',
      'Något särskilt du vill se? (frivilligt)': 'Anything in particular you want to see? (optional)',
      'Ja, spara mitt namn och min mejladress så ni kan höra av er om det jag kryssat i ovan. Vi använder dem bara till det, delar dem inte med någon, och du kan be oss radera dem när som helst.':
        'Yes, keep my name and email so you can get in touch about what I ticked above. We use them only for that, we do not share them with anyone, and you can ask us to delete them at any time.',
      'Så hanterar vi uppgifterna.': 'How we handle your details.',
      'Skriv upp mig': 'Put me on the list',
      'Webbplats': 'Website',

      /* --- safety cards -------------------------------------------------
       * The closed-bubble paragraph is three entries, not one, because
       * `<em>egna</em>` splits it into three text nodes and this file
       * translates node by node. Written out in full rather than
       * simplified: this is the product's central promise about children's
       * privacy, and until 2026-08-21 English visitors read it in Swedish.
       * If the Swedish is ever reworded, all three move together. */
      'Inget syns utanför ditt eget verifierade lag — som standard, inte som inställning. Enda undantaget: ett barns':
        'Nothing is visible outside your own verified team — by default, not as a setting. The one exception: a child\'s',
      'egna': 'own',
      'klipp kan delas vidare, men bara om barnets egen förälder har sagt ja, och det kan stängas av när som helst.':
        'clips can be shared further, but only while that child\'s own parent has said yes — and it can be switched off at any time.',

      /* --- banner + nav ------------------------------------------------ */
      '🧪 Det här är bara ett TEST — skapa inte ett riktigt konto med riktiga uppgifter. Allt kan raderas när som helst.':
        '🧪 This is only a TEST — do not create a real account with real details. Everything may be deleted at any time.',
      'Streak': 'Streak',
      'Laget': 'The team',
      'Trygghet': 'Safety',
      'Funktioner': 'Features',
      'Tränare': 'Coaches',
      'Skaffa appen': 'Get the app',
      'Skapa konto gratis': 'Create a free account',

      /* --- hero -------------------------------------------------------- */
      '🔥 Byggt av en innebandytränare': '🔥 Built by a floorball coach',
      'Din trupp.': 'Your squad.',
      'Din streak.': 'Your streak.',
      'Ert VM-guld.': 'Your world title.',
      'Skapa ditt konto gratis nu': 'Create your free account now',
      'Jag är tränare': 'I am a coach',
      'platsspårning, någonsin': 'location tracking, ever',
      'slutna lagbubblor': 'closed team bubbles',
      'tränare som byggde detta': 'coach who built this',

      /* --- phone mockups ----------------------------------------------- */
      'Hem': 'Home',
      '6 dagar': '6 days',
      'Din personliga streak — fortsätt så!': 'Your personal streak — keep it going!',
      '🥇 Lagets VM-Guld-pott': '🥇 The team’s gold-medal pot',
      '64% mot nästa nivå': '64% to the next level',
      'Bästa insatsen': 'Best effort',
      'Mest kreativ': 'Most creative',
      'Scrolla': 'Scroll',
      'Platshållare — riktig Shorts kommer här': 'Placeholder — real Shorts appear here',
      '🔥 Så här känns det': '🔥 This is how it feels',
      'En streak är bara': 'A streak is only',
      '15 minuter bort.': '15 minutes away.',
      'Kom igång gratis nu': 'Get started free',
      'Jag har tränat': 'I trained',
      'dagar': 'days',
      'Loggat idag ✓ — din längsta streak hittills': 'Logged today ✓ — your longest streak yet',
      'Morgonpass': 'Morning session',
      '4 veckor i rad': '4 weeks in a row',
      'Kaptenens veckomål: 78% klart': 'Captain’s weekly goal: 78% done',
      '👥 12 spelare bidrog denna vecka': '👥 12 players contributed this week',
      'Ditt lag': 'Your team',
      'Skärmnamn, inte riktigt namn — alltid.': 'Screen names, never real names — always.',
      '🔒 Endast ditt verifierade lag': '🔒 Only your verified team',
      'Inget syns utanför lagbubblan.': 'Nothing is visible outside the team bubble.',
      'Shorts': 'Shorts',
      'Ny zorro-fint! 🔥': 'New zorro trick! 🔥',

      /* --- feature sections -------------------------------------------- */
      'Individuell streak': 'Individual streak',
      'Du tävlar bara mot': 'You only compete against',
      'gårdagens du.': 'yesterday’s you.',
      'DAGAR I RAD, UTAN ATT KÄNNAS SOM LÄXA': 'DAYS IN A ROW, WITHOUT FEELING LIKE HOMEWORK',
      'Lagets VM-guld': 'The team’s world title',
      'Elvaåringen och': 'The eleven-year-old and',
      'lagkaptenen väger lika.': 'the captain count the same.',
      'Trygghet först': 'Safety first',
      'Byggt så att en': 'Built so a',
      'förälder vågar säga ja.': 'parent dares to say yes.',
      'Shorts-flödet': 'The Shorts feed',
      'Samma sug som TikTok.': 'The same pull as TikTok.',
      'Bara innanför laget.': 'Only inside the team.',

      /* --- safety promises --------------------------------------------- */
      'Trygghet, konkret': 'Safety, concretely',
      'Fyra löften vi aldrig förhandlar om': 'Four promises we never negotiate',
      'Slutna lagbubblor': 'Closed team bubbles',
      /* The longer form of this sentence lives in the safety-cards block
         above. The short one was left behind when the Swedish gained
         ADR-0030's sharing exception, and stopped applying the moment the
         copy changed — found by check-site-build.mjs's dead-key pass on
         its first run. */
      'Skärmnamn som standard': 'Screen names by default',
      'Riktiga namn är aldrig synliga för andra spelare — anonymt utan att behöva slås på.':
        'Real names are never visible to other players — anonymous without having to switch anything on.',
      'Föräldragodkännande': 'Parental approval',
      'Krävs innan något media eller Shorts kan laddas upp — varje gång, inget undantag.':
        'Required before any media or Shorts can be uploaded — every time, no exceptions.',
      'Ingen platsspårning': 'No location tracking',
      'Vi loggar bara': 'We only log',
      'att': 'that',
      'du tränat — aldrig var. Platsdata finns inte i produkten.':
        'you trained — never where. Location data does not exist in the product.',

      /* --- feature grid ------------------------------------------------ */
      'Allt som gör att de kommer tillbaka imorgon': 'Everything that brings them back tomorrow',
      'Badges': 'Badges',
      'Belönar mer än prestation': 'Rewards more than performance',
      'Bästa insatsen. Mest kreativa övningen. Delas ut automatiskt — inte bara till den snabbaste.':
        'Best effort. Most creative drill. Awarded automatically — not only to the fastest.',
      'Lagchatt': 'Team chat',
      'Peppa varandra, tryggt': 'Cheer each other on, safely',
      'En chatt för laget att hålla ihop streaken — med rapportering och blockering inbyggt från start.':
        'A chat for the team to keep the streak alive — with reporting and blocking built in from the start.',
      'Kaptensroll': 'Captain role',
      'En spelare sätter veckans mål': 'One player sets the week’s goal',
      'Ingen separat tränarinlogg behövs — kaptenen driver laget mot ett gemensamt veckomål.':
        'No separate coach login needed — the captain drives the team towards a shared weekly goal.',
      'VM-Guld-tabellen': 'The gold-medal table',
      'Jämför er mot andra lag': 'Compare yourselves with other teams',
      'Se hur ert lags pott står sig mot andra verifierade lag — utan att någonsin exponera enskilda spelare.':
        'See how your team’s pot compares with other verified teams — without ever exposing individual players.',

      /* --- coach section ------------------------------------------------ */
      'För tränaren': 'For the coach',
      'Ett träningspass bort,': 'One session away,',
      'inte en timme av planering.': 'not an hour of planning.',
      'Tränarens prompt': 'The coach’s prompt',
      'Ge mig ett kul 15-minuters fyspass för 11-åringar, inget material behövs.':
        'Give me a fun 15-minute fitness session for 11-year-olds, no equipment needed.',
      '🔥 Klart! 4 övningar, 15 min, uppvärmning inkluderad — vill du skicka det som veckans utmaning direkt?':
        '🔥 Done! 4 drills, 15 min, warm-up included — want to send it as this week’s challenge right away?',

      /* --- onboarding widget -------------------------------------------- */
      'Kom igång — direkt här': 'Get started — right here',
      'Gå med i laget. Ingen app-butik.': 'Join the team. No app store.',
      'Vilket lag kör du för?': 'Which team do you play for?',
      'Fråga din tränare om lagets kod.': 'Ask your coach for the team’s code.',
      'Lagkod': 'Team code',
      'Hitta mitt lag': 'Find my team',
      '🎲 Föreslå en lagkod åt mig': '🎲 Suggest a team code for me',
      'Testa gärna koden': 'Feel free to try the code',
      'för att se hur det ser ut att gå med i ett befintligt lag.':
        'to see what joining an existing team looks like.',
      'Har du redan ett konto?': 'Already have an account?',
      'Ditt användarnamn': 'Your username',
      'Tillbaka': 'Back',
      'Skicka kod': 'Send code',
      'Kolla inkorgen': 'Check your inbox',
      'Kod': 'Code',
      'Fick du ingen kod?': 'Did not get a code?',
      'Logga in': 'Log in',
      'Vi hittade inget lag med den koden': 'We found no team with that code',
      'Ingen fara — välj det som stämmer för dig:': 'No problem — pick whichever fits:',
      'Jag skrev nog fel': 'I probably typed it wrong',
      'Testa koden igen': 'Try the code again',
      'Vårt lag har ingen kod än': 'Our team does not have a code yet',
      'Skapa ett nytt lag med den här koden': 'Create a new team with this code',
      'Osäker? Fråga din tränare innan du skapar ett nytt lag.':
        'Not sure? Ask your coach before creating a new team.',
      'Namnge ditt nya lag': 'Name your new team',
      'Alla lagkompisar ser det här namnet.': 'All your teammates see this name.',
      'Lagnamn': 'Team name',
      '🎲 Föreslå ett lagnamn åt mig': '🎲 Suggest a team name for me',
      'Nästa': 'Next',
      'Ni kan bjuda in fler spelare med samma kod sen.':
        'You can invite more players with the same code later.',
      'Byt namnet': 'Change the name',
      'Ja, skapa laget!': 'Yes, create the team!',
      'Stämmer det, så kör vi!': 'If that is right, let us go!',
      'Nej, testa en annan kod': 'No, try another code',
      'Ja, det är mitt lag!': 'Yes, that is my team!',
      'Välj ditt spelarnamn': 'Choose your player name',
      'Det här är namnet ditt lag ser — inte ditt riktiga namn om du inte vill.':
        'This is the name your team sees — not your real name unless you want it to be.',
      'Spelarnamn': 'Player name',
      '🎲 Föreslå ett spelarnamn åt mig': '🎲 Suggest a player name for me',
      'Välj en avatar': 'Choose an avatar',
      'Ingen bild behövs — välj en figur du gillar.':
        'No photo needed — pick a character you like.',
      'Vilket år är du född?': 'What year were you born?',
      'Vi använder det för att anpassa utmaningar till din ålder.':
        'We use it to match challenges to your age.',
      'Födelseår': 'Year of birth',
      'Vi frågar en vuxen om lov': 'We ask an adult for permission',
      'Förälders eller vårdnadshavares e-post eller mobilnummer':
        'Parent’s or guardian’s email or mobile number',
      'Vi använder det bara för att fråga om lov — inget annat.':
        'We use it only to ask for permission — nothing else.',
      'Skicka förfrågan': 'Send request',
      'Tränare: hjälp spelaren fylla i om de är osäkra på uppgifterna.':
        'Coaches: help the player fill this in if they are unsure.',

      'SkillStreak tar samma sug efter att öppna appen som TikTok och Snapchat redan äger — och riktar det mot 15 minuters träning om dagen. Individuell streak för dig. Ett gemensamt lagmål för er alla.':
        'SkillStreak takes the same pull to open an app that TikTok and Snapchat already own — and points it at 15 minutes of training a day. An individual streak for you. One shared team goal for all of you.',
      'Det här är ytan där en riktig Shorts från ert eget lag kommer att spela — en spelare som loggar sitt pass, en zorro-fint som lyckas, laget som firar att potten fyllts. Just nu en skiss av rörelsen. Snart er egen.':
        'This is where a real Shorts clip from your own team will play — a player logging a session, a zorro trick that lands, the team celebrating a full pot. Right now a sketch of the motion. Soon your own.',
      '10–15 minuters träning om dagen räcker för att hålla liv i elden. Precis som i Duolingo bygger varje logg vidare på föregående dag — men belöningen är styrka, inte poäng.':
        '10–15 minutes of training a day is enough to keep the fire alive. Just like Duolingo, each log builds on the day before — but the reward is strength, not points.',
      'Alla loggade pass — styrketräning, löpning, bollövningar hemma — läggs till en gemensam pott. Ingen tabell rankar spelare mot varandra. Bara laget mot det gemensamma målet: ett virtuellt VM-guld.':
        'Every logged session — strength work, running, ball drills at home — adds to one shared pot. No table ranks players against each other. Only the team against the shared goal: a virtual world title.',
      'Skärmnamn istället för riktiga namn. Slutna lagbubblor. Inget media utan föräldragodkännande. Ingen platsspårning — någonsin. Det är inte tillval, det är grunden appen är byggd på.':
        'Screen names instead of real names. Closed team bubbles. No media without parental approval. No location tracking — ever. These are not options; they are the foundation the app is built on.',
      'Beskriv vad du behöver — SkillStreak föreslår ett färdigt pass anpassat efter gruppens ålder. Du justerar, laget kör.':
        'Describe what you need — SkillStreak suggests a ready-made session matched to the group’s age. You adjust, the team runs it.',
      'Samma flöde som i telefonappen, rakt i webbläsaren. Har ni ingen lagkod än? Ni skapar ett nytt lag på under en minut.':
        'The same flow as in the phone app, straight in the browser. No team code yet? You can create a new team in under a minute.',
      'Ange lagets kod och ditt användarnamn, så skickar vi en inloggningskod till din (eller din förälders) e-post.':
        'Enter the team code and your username, and we will send a login code to your (or your parent’s) email.',
      'Om uppgifterna stämde har vi skickat en kod till din (eller din förälders) e-post. Ange koden nedan för att logga in igen.':
        'If those details were right, we have sent a code to your (or your parent’s) email. Enter it below to log in again.',
      'Innan du kan börja logga träningar behöver en förälder eller vårdnadshavare säga ja. Vi skickar dem en snabb fråga — de godkänner med ett klick.':
        'Before you can start logging training, a parent or guardian has to say yes. We send them a quick question — they approve with one click.',
      'Det här skapar ett riktigt lag och spelarkonto, precis som i telefonappen. Vill du testa den fullständiga appupplevelsen istället?':
        'This creates a real team and player account, exactly as in the phone app. Would you rather try the full app experience instead?',
      'Öppna demot direkt i webbläsaren — inget konto, ingen installation. Samma app, samma trygghetsregler, redo att testas med er trupp.':
        'Open the demo straight in your browser — no account, no install. The same app, the same safety rules, ready to try with your squad.',
      'SkillStreak — byggt av en innebandytränare, med barnens trygghet först.':
        'SkillStreak — built by a floorball coach, with children’s safety first.',

      'Ladda upp 15-sekunders Shorts när du klarar en fint, ett skott eller ett pass — och utmana en lagkompis. Synligt bara för ert eget verifierade lag, aldrig utanför.':
        'Upload a 15-second Shorts clip when you land a trick, a shot or a session — and challenge a teammate. Visible only to your own verified team, never outside it.',

      /* --- demo + footer ------------------------------------------------ */
      'Öppna demot': 'Open the demo',
      'Se det själv innan ni bestämmer er.': 'See it yourself before you decide.',
      'Öppna demot →': 'Open the demo →',
      'Integritetspolicy': 'Privacy policy',
      'Tidig betaversion. Funktioner och innehåll kan ändras.':
        'Early beta. Features and content may change.'
    }
  };

  var STORAGE_KEY = 'skillstreak.site.lang';
  var originals = new Map();
  // Attribute originals live in a Map rather than dataset: attribute names
  // like `aria-label` are not valid dataset property names, and stuffing
  // them in there throws and aborts the rest of the pass.
  var attrOriginals = new Map();

  function collectTextNodes(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var tag = parent.nodeName;
        // Never touch code the page runs or styles it needs.
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        return node.nodeValue.trim().length > 2
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function apply(lang) {
    var dict = TRANSLATIONS[lang];
    var missing = [];

    collectTextNodes(document.body).forEach(function (node) {
      if (!originals.has(node)) originals.set(node, node.nodeValue);
      var source = originals.get(node);
      if (!dict) {
        // Back to Swedish: restore rather than reverse-translate, so the
        // original whitespace and line breaks survive a round trip.
        node.nodeValue = source;
        return;
      }
      var key = source.trim().replace(/\s+/g, ' ');
      if (Object.prototype.hasOwnProperty.call(dict, key)) {
        node.nodeValue = source.replace(source.trim(), dict[key]);
      } else {
        node.nodeValue = source;
        missing.push(key);
      }
    });

    // Attributes a visitor reads but a text walk cannot see.
    ['placeholder', 'aria-label', 'title'].forEach(function (attr) {
      Array.prototype.forEach.call(
        document.querySelectorAll('[' + attr + ']'),
        function (el) {
          var store = attrOriginals.get(el) || {};
          if (!(attr in store)) {
            store[attr] = el.getAttribute(attr);
            attrOriginals.set(el, store);
          }
          var source = store[attr];
          el.setAttribute(attr, (dict && dict[source]) || source);
        }
      );
    });

    document.documentElement.setAttribute('lang', lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      /* private mode — the choice just does not persist */
    }

    if (dict && missing.length) {
      // Not thrown: a missing translation degrades to Swedish, which is a
      // fine outcome for a visitor and a findable one for whoever edits
      // the copy next.
      console.warn(
        '[i18n] ' + missing.length + ' untranslated string(s) for "' + lang + '"',
        missing.slice(0, 20)
      );
    }
  }

  function preferredLanguage() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return stored;
    } catch (e) {
      /* ignore */
    }
    var nav = (navigator.language || 'sv').slice(0, 2).toLowerCase();
    return TRANSLATIONS[nav] || nav === 'sv' ? nav : 'en';
  }

  function buildSwitcher() {
    var nav = document.getElementById('topnav');
    if (!nav) return;
    var wrap = document.createElement('div');
    wrap.className = 'lang-switch';
    LANGUAGES.forEach(function (lang) {
      var b = document.createElement('button');
      b.type = 'button';
      // innerHTML with a constant from FLAGS above — no user or network
      // input reaches this, so there is nothing here to escape.
      b.innerHTML = FLAGS[lang.code] || lang.code.toUpperCase();
      b.setAttribute('aria-label', lang.label);
      b.setAttribute('title', lang.label);
      b.addEventListener('click', function () {
        apply(lang.code);
        setActive(lang.code);
      });
      b.dataset.lang = lang.code;
      wrap.appendChild(b);
    });
    // Into the right-hand group, before the CTA, so the language choice
    // reads as chrome rather than an action competing with "create an
    // account" — and, more importantly, so it does not become a fourth
    // top-level flex child. As a direct child of the nav it pushed the
    // links off-centre; `.nav-right` is a balanced column that absorbs it.
    var right = nav.querySelector('.nav-right') || nav;
    var cta = right.querySelector('.btn');
    right.insertBefore(wrap, cta || null);
  }

  function setActive(code) {
    Array.prototype.forEach.call(
      document.querySelectorAll('.lang-switch button'),
      function (b) {
        b.classList.toggle('is-active', b.dataset.lang === code);
      }
    );
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildSwitcher();
    var lang = preferredLanguage();
    apply(lang);
    setActive(lang);
    /* Announce the resolved language.
     *
     * The read counter in index.html waits for this instead of reading
     * `document.documentElement.lang` itself. That attribute is the
     * static `sv` from the markup until `apply()` above runs, and this
     * file is the last script on the page — so a counter that read it
     * directly recorded every visitor as Swedish, including one whose
     * stored preference was English. Announcing the answer keeps one
     * source of truth rather than two implementations of
     * `preferredLanguage()` that can drift apart. */
    document.dispatchEvent(
      new CustomEvent('i18n:applied', { detail: { lang: lang } })
    );
  });
})();
