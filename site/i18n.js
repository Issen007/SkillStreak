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

  var LANGUAGES = [
    { code: 'sv', label: 'Svenska' },
    { code: 'en', label: 'English' }
  ];

  var TRANSLATIONS = {
    en: {
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
      'Visning': 'Live demo',
      'Kom på visningen': 'Come to the live demo',
      'I början av september visar vi SkillStreak live — hur en träning\n        loggas, hur laget jagar VM-guldet ihop, och hur trygghetsreglerna\n        faktiskt fungerar. Vi ses över Google Meet, och du får länken via\n        mejl när tiden är spikad.':
        'In early September we are showing SkillStreak live — how a session gets logged, how a team chases its World Championship gold together, and how the safety rules actually work. We meet over Google Meet, and you get the link by email once the time is set.',
      'Namn': 'Name',
      'E-post': 'Email',
      'Vad är ditt intresse?': 'What brings you here?',
      'Jag är bara nyfiken': 'Just curious',
      'Jag vill bli tränare i appen': 'I want to be a trainer in the app',
      'Jag vill vara med och bygga': 'I want to help build it',
      'Jag vill veta mer om investering': 'I want to know more about investing',
      'Annat': 'Something else',
      'Något särskilt du vill se? (frivilligt)': 'Anything in particular you want to see? (optional)',
      'Ja, spara mitt namn och min mejladress så ni kan bjuda in mig. Vi använder dem bara till det här, och du kan be oss radera dem när som helst.':
        'Yes, keep my name and email so you can invite me. We use them only for this, and you can ask us to delete them at any time.',
      'Anmäl mig': 'Sign me up',
      'Webbplats': 'Website',

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
      'Inget syns utanför ditt eget verifierade lag — som standard, inte som inställning.':
        'Nothing is visible outside your own verified team — by default, not as a setting.',
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
      b.textContent = lang.code.toUpperCase();
      b.setAttribute('aria-label', lang.label);
      b.addEventListener('click', function () {
        apply(lang.code);
        setActive(lang.code);
      });
      b.dataset.lang = lang.code;
      wrap.appendChild(b);
    });
    // Before the CTA so the language choice reads as chrome, not as an
    // action competing with "create an account".
    var cta = nav.querySelector('.btn');
    nav.insertBefore(wrap, cta || null);
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
  });
})();
