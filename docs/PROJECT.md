# 🔥 SkillStreak - Rörelseglädje Genom Gamification

> Det här är projektets ursprungliga vision/pitch. Letar du efter hur du
> installerar och kör appen? Se [../README.md](../README.md) i repots rot.

> ✅ **NAMNET ÄR BESTÄMT: SkillStreak** (2026-08-10). Namnfrågan är
> stängd — appens bundle-id och paketnamn (`xyz.skillstreak.app`) kodar
> namnet och är permanenta från första publicering i butikerna. Tack till
> alla som skickade in förslag (*SkillFlex, FloorGrind, StreakUp, ZorroGo*
> och *SquadPulse* var de sista kandidaterna). Nya namnförslag behövs
> alltså inte längre.

Välkommen till **SkillStreak**! Detta är ett open-source-initiativ skapat av en innebandytränare för att vända ungdomars skärmtid (TikTok, Snapchat, Instagram) till aktiv rörelse, fysträning och innebandyutveckling på egentid.

Idag har många ungdomslag endast runt 1-3 timmars halltid i veckan plus match. Resten av tiden stjäl mobilen ofta uppmärksamheten. Den här appen vill förändra detta genom att använda samma psykologiska drivkrafter som gör apparna beroendeframkallande, men med målet att få barnen att plocka upp klubban eller köra ett fyspass i vardagen.

---

## 🚀 Vision & Idé

Vi vill skapa en mobilapp där det dagliga idrottandet blir ett spel. Istället för att bara skrolla eller göra en TikTok-dans, ska spelarna inspireras till att göra innebandy- och fysövningar, registrera sina framsteg, utmana sina lagkamrater och skapa egna övningar.

### 🎮 Gamification & De Två Serierna
För att inkludera *alla* ungdomar, oavsett idrottslig nivå eller ålder, är appen uppbyggd kring två parallella ligor:

1. **Den Individuella Serien (Duolingo-style):**
   * Spelarna bygger upp sin personliga "Streak" (dagar i rad) genom att logga minst 10-15 minuters träning om dagen. Man tävlar mot sig själv och sina egna mål för att klättra i personliga nivåer.
2. **Lag-Serien (Jakten på VM-Guldet!):**
   * Här samlar hela laget poäng *tillsammans*. Denna serie är helt oberoende av ålder, talang eller kunskap. Det enda som räknas är **hur mycket man vill öva tillsammans**. 
   * Varje fystimme, zorro-fint eller löppass som en spelare loggar läggs till i lagets gemensamma pott. Kan laget samla tillräckligt med poäng under en månad eller säsong för att bärga ett virtuellt **VM-Guld**? Detta skapar en enorm lagkänsla där alla bidrar lika mycket till guldmedaljen!

### 📱 Inspiration från ungdomarnas favoritplattformar
* **TikTok-feeden (Utmaningar & Inspiration):** En intern, säker feed där spelare kan ladda upp 15-sekundersklipp på när de klarar en fint, ett skott eller en fysövning. De kan också "taga" en lagkompis och utmana dem.
* **Snapchat-känslan (Veckans Stjärna & Badges):** Digitala utmärkelser delas ut automatiskt. Inte bara för att skjuta hårdast, utan för "Bästa kämpe", "Mest kreativa övning" eller "Bästa lagkompis".

### 📋 Ledarens Dashboard
För att hjälpa ledare som saknar inspiration eller tid ska plattformen innehålla:
* **Challenge Builder:** Skapa veckoutmaningar (t.ex. *"Gör 50 zorro-finter innan fredag"* eller *"Samla 30 minuter löpning under veckan"*).
* **AI-Träningsschema:** Integrerat stöd (via LLM/Claude) där ledare kan skriva *"Ge mig ett roligt 15-minuters fyspass för 11-åringar"* och direkt kunna skicka ut det som en interaktiv uppgift till laget.

---

## 🔒 Säkerhet & GDPR (Privacy by Design)

Eftersom appen riktar sig till barn i alla åldrar från grön- till svart- nivå är säkerheten vår högsta prioritet från dag ett:
* **Slutna Lagbubblor:** Ingen data, video eller kommentar är publik för omvärlden i standardläget. Man ser bara sitt egna verifierade lag.
* **Anonymisering:** Möjlighet att använda skärmnamn (t.ex. *FloorballStar15*) istället för fullständiga personuppgifter.
* **Föräldragodkännande:** Inbyggt flöde där föräldrar/myndig person måste godkänna kontot innan video/media kan laddas upp.
* **Ingen Platsspårning:** Vi loggar aldrig *var* barnen tränar, bara *att* de har tränat.

---

## 🛠 Teknisk Arkitektur (Open Source & Cloud Native)

Projektet byggs med en modern stack som är optimerad för att utvecklas effektivt med AI-verktyg (som Claude Code) och köras stabilt i produktion.

* **Frontend (Mobilapp):** `React Native` med `Expo` (TypeScript). Detta ger oss äkta native-appar till både **iOS (iPhone)** och **Android** från en och samma kodbas, samtidigt som det är extremt kompatibelt med AI-genererad kod.
* **Backend (API):** `NestJS` (TypeScript) — valt istället för det ursprungligen
  föreslagna FastAPI, se [`docs/adr/0001-backend-framework.md`](adr/0001-backend-framework.md)
  för resonemanget (delad TypeScript-kod med mobilappen väger tyngre än
  Pythons AI/ML-ekosystem, som denna app inte faktiskt behöver).
* **Databas:** `PostgreSQL` (relationsdata för lag/användare) + `Redis` (för snabb hantering av Streaks och realtidstopplistor).
* **Infrastruktur:** Fullt containeriserat med `Docker`. Arkitekturen designas för att distribueras i `Kubernetes (K8s)`, vilket gör den extremt skalbar för föreningar över hela världen.

---

## 🗺 Utvecklingsplan (Roadmap)

> **2026-07-26:** roadmapen nedan är omskriven för att (a) faktiskt matcha
> vad som är klart — Fas 1-3 var kraftigt eftersläpande här jämfört med
> `docs/internal/ACTION_PLAN.md`s levande checklista — och (b) slå
> ihop `docs/BACKLOG.md`s tidigare oprioriterade idélista med rätt fas,
> i prioritetsordning inom varje fas. `docs/BACKLOG.md` är kvar som en
> ren "inkorg" för nya, ännu otriagerade idéer — så fort en idé får en
> plats här är det härifrån den planeras, inte därifrån.

### Fas 1: MVP & Arkitektur — klar ✅
* [x] Sätta upp repository och Docker-miljö (`Dockerfile` & `docker-compose`).
* [x] Definiera databasmodellen för Lag, Spelare och Tränare (GDPR-kompatibel, med stöd för både individ- och lagpoäng).
* [x] Skapa den första startskärmen i React Native där en spelare kan trycka på "Jag har tränat" och starta en Streak samt lägga till poäng till laget.
* [x] (Utöver planen) Riktigt föräldragodkännande via e-post, med en säker länk som endast en förälder kan klicka på.

### Fas 2: Ledargränssnitt & Utmaningar — klar ✅ (pivoterad, se nedan)
* [x] ~~Bygga tränarvyn för att skicka utmaningar~~ — pivoterad 2026-07-05:
  ingen separat vuxen-inloggning. En spelare flaggas manuellt som
  **Kapten** och sätter veckans lagmål med sitt eget spelarkonto — se
  `docs/adr/0005-kapten-and-weekly-team-goal.md` för varför.
* [x] Duolingo-streaklogik + lagets "VM-guld"-mätare på backend.
* [x] Fas 2.6a-2.9: kaptensbyte, lagchatt, målhistorik, VM-guld-tabellen
  (jämförelse mot andra lag), självbetjänad lagskapande vid onboarding.

### Fas 3: Media & Socialt (Säkrad TikTok-funktion) — klar ✅
* [x] Säker, lagbunden videouppladdning + feed (`docs/adr/0010-video-storage-and-serving.md`).
* [x] "Tagga en lagkompis" för att utmana dem, rapportera/dölj-flöde för klipp.

### Fas 4: Kubernetes & Publik Lansering — pågår 🚧
K8s-manifest finns redan (`k8s/`, tidigarelagt från ursprunglig plan). Kvar,
**i prioritetsordning** — de tre första är riktiga blockerare för en publik
lansering, inte bara förbättringar:

1. [ ] **Extern ingress/DNS för det publika klustret.** **Uppdaterad
   2026-07-29** — arkitekturen är nu tvådelad, inte den enda-klustret-plan
   som beskrevs här tidigare (den planen — göra `ubuntu01` självt publikt
   via router-portvidarebefordran — är övergiven, se nedan):
   - **Publikt kluster: `isstech-2`** (Safespring Kubernetes Engine, delad
     PaaS) — produktionsklustret, kör bara det som byggs från `main`.
     Domänen är skaffad: **`skillstreak.xyz`**. `k8s/README.md`s
     ursprungliga resonemang ("delad intern PaaS med avstängd LBaaS")
     stämde för `ingress-nginx`, men den riktiga lösningen blev Cilium
     Gateway API istället (inte `ingress-nginx`/`metallb`) — `cert-manager`
     löser in Let's Encrypt-cert via Gateway API:s HTTP01-solver (krävde
     flaggan `--enable-gateway-api` på `cert-manager`, fixat 2026-07-29).
     Kvarstående blockerare, båda utanför vad `kubectl` ensamt kan lösa:
     (1) ingen publik DNS-post för `skillstreak.xyz` än, (2) klustrets
     publika IP svarar bara på `:6443` (k8s-API:t) — `:80`/`:443`
     vidarebefordras inte, eftersom en Safespring "Elastic IP" (deras
     BGP-anycast-lastbalanserare, inte en enkel port-forward) aldrig
     beställts för det här projektet. Supportärende till Safespring är
     skrivet (kräver projektägarens konto-/projektnamn och att faktiskt
     skickas in) för att antingen aktivera vidarebefordran eller ge
     BGP-peer/AS-nummer så Ciliums LB-IPAM + BGP-kontrollplan kan
     konfigureras. Blockerar en riktig publik lansering tills det är löst.
   - **Internt testkluster: `ubuntu01`** (microk8s, `192.168.55.x`, bara på
     det lokala nätverket) — uteslutande testmiljön, aldrig tänkt att bli
     publikt. Kör bara det som byggs från `prerelease`:
     `.github/workflows/ci-cd.yml`s `internal-images`-jobb bygger
     `prerelease-<sha>`-taggade images (site-imagen med klustrets egna
     LAN-adresser inbakade, `192.168.55.71` api / `192.168.55.72` site och
     try-it, istället för `skillstreak.xyz`), och
     `tools/local-release-poller` (en systemd-timer på maskinen själv,
     inte denna repos CI) pollar `prerelease` och deployar automatiskt.
     Egen testdatabas, helt separat från produktionens. Ingen TLS/Ingress
     behövs eller är planerad här — nås direkt via metallb:s
     LoadBalancer-IP:er över vanlig HTTP; se `k8s/README.md`s egna avsnitt
     om det här klustret för detaljer.
2. [x] **Ny enhet-inloggning ("session reissue")** — klar 2026-07-27.
   Den enda tidigare mekanismen för detta byggdes och stängdes av efter
   ett bekräftat kritiskt säkerhetsfel (se `docs/adr/0004-coach-auth-and-
   session-reissue.md`): koden returnerades direkt till den som utlöste
   den, så en kapten kunde lösa in en lagkompis kod själv och ta över
   kontot. Redesignad så att koden mejlas till spelarens eget
   `parent_contact` — aldrig tillbaka i något API-svar, oavsett vem som
   utlöser det. Två sätt att utlösa: kaptenen hjälper en lagkompis
   direkt (den ursprungliga, nu fixade rutten), och ett nytt
   självbetjänings-alternativ ("Har du redan ett konto?", lagkod +
   användarnamn, ingen inloggning krävs) för det bekräftade verkliga
   glappet nedan. Dubbla hastighetsgränser (5 min + 3/dag) efter en
   oberoende säkerhetsgranskning som flaggade att bara 5-minutersgränsen
   fortfarande tillät ~288 påtvingade utloggningar + mejl till en
   familj per dag. Live-verifierad end-to-end mot det riktiga klustret.
   **Konfirmerat live 2026-07-26:** en riktig användare försökte
   återansluta sitt befintliga konto (session borta — nytt
   testtillfälle på try-it-demot, inte en ny riktig enhet) och kunde
   inte, eftersom onboarding-flödet (O1-O6) bara någonsin skapar en NY
   spelare — det var exakt den lucka den här punkten redan förutsåg,
   nu stängd på både mobilappen och webbplatsen.
   Starkare autentisering (Sign in with Apple/Google) är fortfarande
   ett separat, större beslut — inte löst här, se `docs/BACKLOG.md`.
3. [x] **Åldersbaserad självverifiering (13+, bara e-post — ingen
   förälder)** — klar 2026-07-27. Reverserar Fas 1-beslutet
   (föräldragodkännande för *alla* spelare oavsett ålder,
   `docs/adr/0002-data-model.md`s tillägg §2) efter research av gällande
   svensk lag (Dataskyddslagen 2018:218 kap. 2 §4 — GDPR art. 8:s
   självsamtyckesålder, satt till 13 i Sverige, bekräftat 2026-07-27) och
   explicit godkännande av projektägaren. **13, inte 14 eller 15** — 14
   var aldrig korrekt; 15 är en separat, ännu ej beslutad
   proposition specifikt för inloggad social medial (Kommittédirektiv
   2025:91, förslag juni 2026), inte dagens gällande samtyckesålder.
   Samma mekanism (token + e-postlänk + godkännande) som tidigare, bara
   mottagare och text skiljer sig — se
   `backend/src/common/age/self-verification-age.util.ts` och ADR-0002s
   tilläggs 2026-07-27-uppdatering för hela resonemanget.
4. [x] **Missbruksskydd för webbsidans anmälningsflöde** — klar 2026-07-27.
   `POST /players`s `10/min/IP`-gräns använde `@nestjs/throttler`s
   in-memory-lagring, per-pod snarare än klusterbrett — flaggad av
   security-reviewer i Fas 2.9-granskningen (`docs/ACTION_PLAN.md`). Fixad
   med en Redis-baserad `ThrottlerStorage` (samma fixed-window
   INCR+EXPIRE-mönster som appens övriga rate limits, `RedisService`), så
   gränsen gäller hela klustret, inte per pod. Live-verifierad: skalade
   `api`-deploymenten till 2 repliker tillfälligt, skickade 15 snabba
   `POST /players`-anrop genom den lastbalanserande Servicen, bekräftade
   exakt 10 lyckades och resten fick `429` (delad gräns över båda
   poddarna), skalade sedan tillbaka till `replicas: 1`
   (`k8s/api-deployment.yaml`s nuvarande, av annan anledning låsta värde).
5. [ ] **Flerspråksstöd, tidigarelagt 2026-07-27** — projektägarens
   uttryckliga önskan: en spelare ska kunna **välja språk vid onboarding**
   redan i en tidig version, inte som en efterhandskonstruktion. Flyttad
   upp från punkt 7 (var sist i listan) till direkt efter
   missbruksskyddet, eftersom det påverkar datamodellen (ett
   språk-/locale-fält på `Player` eller motsvarande) och bör finnas innan
   fler skärmar/e-postmallar byggs som annars behöver migreras i
   efterhand. Two separata delar, inte nödvändigtvis samtidiga: (a) en
   språkväljare + ett lagrat `locale`-fält (arkitekturen), byggs tidigt;
   (b) fullständig översättning av varje skärm/e-postmall till engelska,
   finska, danska, norska (innehållet) — kan färdigställas gradvis efter
   att (a) finns på plats. **architect**: designa var `locale` lagras och
   hur det påverkar redan skickade e-postmallar (parental-consent,
   self-verification) som idag bara finns på svenska.
6. [x] **Kryptering av data i vila** — klar 2026-07-28 (delvis). AES-256-GCM
   på applikationsnivå för `parent_contact`/`real_name` (de enda fälten
   appens hotmodell redan behandlar som riktigt känsliga, ADR-0002s
   tillägg §1) — se `docs/adr/0011-encryption-at-rest.md` för hela
   resonemanget, inklusive varför Postgres `pgcrypto` medvetet valdes bort
   (nyckeln skulle annars kunna läcka in i Postgres egna query-loggar/WAL).
   **Inte löst, medvetet uppskjutet, inte tyst struket:** full
   diskkryptering (LUKS på värdnivå) — kräver root-åtkomst den här
   sessionen inte har och riktig samordnad drifttid (backup → omformatera
   → återställ), inte en rullande ändring. Live-verifierad mot det
   riktiga klustret: alla 38 befintliga produktionsrader omkrypterade,
   både skriv- och läsvägen bekräftat fungera end-to-end.
7. [ ] 24/7 drifts-/hälsoövervakning (från backlogen) — **blockerad på
   punkt 1** ovan, ingen publik URL att bevaka förrän dess. Börja med en
   enkel schemalagd hälsokontroll, inte den större "AI-driven"-idén.
8. [ ] Helm-charts (plana K8s-manifest räcker för nuvarande betaskala).
9. [ ] Göra appen tillgänglig för fler innebandyföreningar internationellt.

### Fas 4.1: Profilsida (ej designad)
Tillagd 2026-07-28 direkt av projektägaren. En profilsida nåbar via en
profilikon uppe till höger: valfritt riktigt namn, se (inte nödvändigtvis
ändra fritt — se nedan) födelseår, och ändra inloggnings-relaterade
e-postadresser — spelarens egen (som redan dubblar som inloggnings-
e-post för 13+-kohorten, `docs/adr/0002-data-model.md`s tillägg §2) och
förälderns. En ändring ska automatiskt mejla både föräldern och spelarens
egen e-post om att uppgifterna ändrats.

**Flaggat, inte tyst nedskalat — detta är exakt samma riskklass som
`docs/adr/0004-coach-auth-and-session-reissue.md`s 2026-07-27
redesign, inte en vanlig CRUD-profilsida:** `parent_contact` är i
praktiken tillitsroten för hela konto-återställningsmekanismen (session-
reissue mejlar dit; självverifiering för 13+ mejlar dit). En funktion som
låter en användare ändra den e-posten är därför i praktiken "byt ut
kontots återställningsväg", inte en ofarlig inställning — samma
riskklass som orsakade den ursprungliga session-reissue-sårbarheten.
Öppna frågor för en riktig design (architect + security-reviewer,
blockerande innan kod skrivs, enligt CLAUDE.md):
- **Mejla den GAMLA kontakten, inte bara den nya, vid en ändring** — annars
  kan en angripare som redan kapat sessionen tyst byta bort den riktiga
  förälderns adress och permanent stänga ute den verkliga vårdnadshavaren
  från återställningsvägen. Standardmönstret (som redan används i stora
  produkter) är: mejla båda — den gamla adressen som en varning ("detta
  ändrades, var det du?"), och kräv bekräftelse via den NYA adressen
  innan ändringen faktiskt träder i kraft (färdig session-reissue-kod-
  infrastruktur finns redan att återanvända för det senare).
- **Bör födelseår ens vara fritt redigerbart efter onboarding?** Året
  driver självverifieringströskeln (13+, `isSelfVerificationAge`) —
  vilket i sin tur avgör om ett konto kräver förälder-godkännande eller
  bara spelarens egen e-post. En fri ändring efter kontoskapande är
  potentiellt ett sätt att kringgå föräldragodkännande-kravet, inte bara
  en stavfelsrättning. Kan behöva vara låst efter första godkännandet,
  eller kräva samma godkännandeflöde igen vid en ändring som korsar
  13-årsgränsen.
- **"E-post som inloggning"** — appen har idag ingen lösenordsbaserad
  inloggning alls (se ADR-0004:s uttryckliga beslut att INTE bygga
  lösenordsinloggning för den här användargruppen). Den här punkten bör
  troligen återanvända session-reissue-mekanismen (skicka en kod till
  den nya/gamla adressen) snarare än att uppfinna ett nytt
  lösenordssystem — architects beslut, inte förutsatt här.
- Riktigt namn är lägre risk (redan valfritt, redan isolerat i
  `PlayerPrivateInfo` per ADR-0002s tillägg §1) — den delen av
  funktionen är okomplicerad.

### Fas 5: Tillväxt & nya affärsmöjligheter (efter lansering)
Idéer som förutsätter en riktig, publik användarbas innan de är meningsfulla
att bygga — **i prioritetsordning**:

*(Se även Fas 6 nedan — en separat, senare tillagd idé (2026-07-27) om en
publik Shorts-feed, reaktioner och ett personligt arkiv. Numrerad efter
denna fas snarare än in i den, eftersom det är en produktfunktion, inte en
tillväxt-/affärsidé — men ordningen är inte slutgiltigt beslutad.)*

1. [ ] **Användningsanalys/produktmått** (från backlogen) — förstå hur
   riktiga lag faktiskt använder appen innan nästa stora satsning väljs.
   Kräver egen arkitekt- och säkerhetsgranskning (barndata), se backlogen.
2. [ ] **PT/Tränare-roll — affärsidé** (från backlogen): lag kan ta in en
   egen Personal Trainer/tränare, med sikte på en betald plan för att
   finansiera projektet. Störst och mest osäker idé i den här fasen —
   återinför en typ av vuxen-auktoritet över barn som redan en gång
   byggdes bort (se Fas 2:s pivot ovan), så kräver en riktig
   arkitekt-/säkerhetsgenomgång innan design ens påbörjas. En framtida
   AI-driven version av samma roll, och själva betalplanen, är separata
   delbeslut — se backlogen för varför.
3. [ ] LLM-baserad moderering av lagchatten (från backlogen) — dagens
   nyckelordsfilter är godkänt för nuvarande litet-och-slutet betaläge,
   men bör förbättras innan laget skalar utöver "alla känner alla
   IRL"-storlek.

**Finansiering:** fortfarande olöst (se "Vill du vara med på resan?" nedan)
— frågan om en betald PT-plan (Fas 5, punkt 2) och en eventuell
sponsor-/bidragsmodell hänger ihop och bör beslutas tillsammans, inte var
för sig.

### Fas 6: Publik Shorts-feed, reaktioner & personligt arkiv (ej designad)
Tillagd 2026-07-27 direkt av projektägaren — se `docs/ACTION_PLAN.md`s
Fas 6-avsnitt för hela resonemanget. I korthet: en oändligt scrollbar feed
av klipp andra spelare valt att göra publika (inspiration från Snapchat/
TikTok/Instagram/YouTube för scroll-/reaktionsmekaniken), ett sätt att
spara andras klipp till ett eget arkiv för nya streak-idéer, och en ny
"Arkiv"-flik i Shorts som visar lagets klipp + egna klipp, varifrån man
kan publicera ett klipp till den publika feeden.

**Flaggat, inte tyst nedskalat:** varje klipp i appen är idag strukturellt
lagbundet enbart — ingen läsväg mellan lag finns någonstans i arkitekturen
(`docs/adr/0010-video-storage-and-serving.md`, säkerhetsgranskad). En
publik feed är per definition en andra, lagöverskridande synlighetsväg för
video av barn — högre risk än Fas 3 var, som redan var projektets hittills
mest känsliga fas. Måste gå igenom samma arkitekt → UX → säkerhetsgranskning
som Fas 3, med säkerhetsgranskning som **blockerande**, innan någon kod
skrivs. Se ACTION_PLAN.md för de öppna designfrågorna (vems godkännande
krävs för att publicera en minderårigs video, hur brett "publikt" är,
extra anonymisering, moderering av reaktioner, retention/borttag, samt
arkiv-datamodellen).

---

## 🤝 Vill du vara med på resan? (Bidra till projektet)

Vi letar efter innebandytränare, utvecklare, UI/UX-designers och eldsjälar som vill hjälpa till att hålla ungdomar aktiva i den digitala tidsåldern!
Just nu, är vi bara intresserade av hur många är villiga att lägga ner tid på detta och sammanstråla.

### Hur du kommer igång:
1.  **Folk inom idrotten:** Bidra med idéer på namn, utmaningar, fyspass och hur vi bäst motiverar era lag. Skapa en *Issue* med dina tankar!
2.  **Utvecklare:** Kika på vår `Fas 1` i roadmappen. Vi välkomnar Pull Requests för projektstruktur, Docker-konfigurationer och React Native-komponenter.
3.  **Håll diskussionen igång:** Detta är ett levande projekt. Dela gärna repot till andra ledare i din förening!
4.  **Finansiel plan:** Vi kommer behöva fixa ihop en finansiel plan för detta, antingen via sponsorer, bidrag eller något annat. Om någon är kunnig på detta så får man gärna hänga med. Vår grundtanke är att inte ha som Youtube eller Duolingo att det poppar upp en reklamfilm titt som tätt.

---
*Skapat med 🧡 för innebandyn och en mer aktiv vardag för våra ungdomar.*
