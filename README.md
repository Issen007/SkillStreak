# 🔥 SkillStreak / [Söker Namn!] - Rörelseglädje Genom Gamification

> 💡 **PROJEKTET SÖKER NAMN:** Just nu letar vi efter det ultimata, moderna namnet på den här appen! Har du ett förslag som går hem hos kidsen 2026? Skapa en Issue eller var med i diskussionen! Namnidéer vi bollar just nu är bland annat *SkillFlex, FloorGrind, StreakUp, ZorroGo* och *SquadPulse*.

Välkommen till **SkillStreak** (arbetstitel)! Detta är ett open-source-initiativ skapat av en innebandytränare för att vända ungdomars skärmtid (TikTok, Snapchat, Instagram) till aktiv rörelse, fysträning och innebandyutveckling på egentid.

Idag har många ungdomslag (t.ex. tjejer födda 2013 och killar födda 2015) endast runt 2 timmars halltid i veckan plus match. Resten av tiden stjäl mobilen ofta uppmärksamheten. Den här appen vill förändra detta genom att använda samma psykologiska drivkrafter som gör apparna beroendeframkallande, men med målet att få barnen att plocka upp klubban eller köra ett fyspass i vardagen.

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
* **Backend (API):** `Python (FastAPI)` för Python detta är bäst platformen ihop med AI.
* **Databas:** `PostgreSQL` (relationsdata för lag/användare) + `Redis` (för snabb hantering av Streaks och realtidstopplistor).
* **Infrastruktur:** Fullt containeriserat med `Docker`. Arkitekturen designas för att distribueras i `Kubernetes (K8s)`, vilket gör den extremt skalbar för föreningar över hela världen.

---

## 🗺 Utvecklingsplan (Roadmap)

### Fas 1: MVP & Arkitektur (Där vi är nu)
* [ ] Sätta upp repository och Docker-miljö (`Dockerfile` & `docker-compose`).
* [ ] Definiera databasmodellen för Lag, Spelare och Tränare (GDPR-kompatibel, med stöd för både individ- och lagpoäng).
* [ ] Skapa den första startskärmen i React Native där en spelare kan trycka på "Jag har tränat" och starta en Streak samt lägga till poäng till laget.

### Fas 2: Ledargränssnitt & Utmaningar
* [ ] Bygga tränarvyn för att skicka utmaningar.
* [ ] Implementera Duolingo-streakslogiken på backend samt lagets "VM-guld"-mätare.

### Fas 3: Media & Socialt (Säkrad TikTok-funktion)
* [ ] Implementera säker videouppladdning och lagbunden feed.

### Fas 4: Kubernetes & Publik Lansering
* [ ] Skriva Helm-charts / K8s-manifest för distribution.
* [ ] Göra appen tillgänglig för fler innebandyföreningar internationellt.

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
