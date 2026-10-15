# Personvern, sikkerhet og tilgangsstyring i Varde

Dette dokumentet beskriver hvordan Varde er bygget for å beskytte personvernet, og hva som må være på plass før Varde tas i bruk med ekte brukere. Sjekklisten for leveranse står i [LEVERANSE.md](LEVERANSE.md).

## 1. Hvem har ansvaret

| Rolle i personvernretten | Hvem |
|---|---|
| Behandlingsansvarlig | Skoleeier: **kommunen** for grunnskoler, **fylkeskommunen** for videregående skoler |
| Databehandler | Den som drifter Varde (leverandøren). Krever **databehandleravtale** med hver skoleeier |
| Underdatabehandler | Driftsleverandøren (sky eller datasenter). Må stå i databehandleravtalen |

## 2. Hvilke opplysninger Varde behandler

| Data | Innhold | Personopplysning? | Lagringstid |
|---|---|---|---|
| Brukerkontoer | Navn, e-post, rolle, skole, passord-hash (scrypt) | Ja, om ansatte | Til brukeren slettes |
| Sesjoner | Tilfeldig nøkkel (lagret som hash), utløpstid | Ja, teknisk | 12 timer |
| Endringslogg | Hvem som endret brukere, roller og kontakter, og når | Ja, om ansatte med administratorrolle | Bør settes i avtalen (forslag: 2 år) |
| Skolens kontakter | Navn/funksjon og jobbnummer for rektor, helsesykepleier osv. | Ja, jobbopplysninger | Til de endres |
| Bruksstatistikk | Skole, ISO-uke, veiviser, alvorlighet, rusmiddel/hendelsestype, åpnede sider | Nei, ikke koblet til person (se under) | 104 uker, slettes automatisk |
| Aktive brukere | Skole, uke og en ukekode | Nei, kan ikke kobles til person (se under) | 104 uker |
| Notater | **Lagres ikke** (se kapittel 6) | – | – |

**Varde lagrer aldri opplysninger om elever.** Veiviserne spør ikke om navn, og svarene sendes ikke til serveren. Bare kategorien og alvorligheten av veiledningen logges.

## 3. Slik er bruksstatistikken gjort anonym

1. **Ingen bruker-ID i statistikken.** Tabellen `hendelser` har ingen kolonne for bruker. Serveren slår opp skolen fra innloggingen og lagrer bare skole og uke.
2. **Bare uke, ikke tidspunkt.** Tid lagres som ISO-uke (f.eks. `2026-W42`). Det gjør det vanskelig å koble bruk til en bestemt hendelse.
3. **Bare faste verdier.** Serveren godtar bare forhåndsdefinerte kategorier (`validerHendelse` i `public/js/varde-core.js`). Fritekst, navn og ukjente felt avvises eller fjernes.
4. **Aktive brukere med ukekode.** For å telle aktive brukere lagres `HMAC(ukenøkkel, bruker-ID)`. Ukenøkkelen slettes når uka er over. Da kan ingen, heller ikke driftsleverandøren, finne ut hvem koden tilhørte eller følge en person fra uke til uke.
5. **Små tall skjules.** Alle tall under 5 erstattes med «<5» på serveren før de sendes til portalen (`MIN_ANTALL`). Små skoler og sjeldne hendelser kan dermed ikke kjennes igjen.
6. **Ingen innholdslogging.** Serveren skriver ikke forespørsler, IP-adresser eller innhold til logg.

**Kjent begrensning:** For svært små skoler kan totaltall minus delsummer i teorien avsløre et lite tall. For drift bør en vurdere å slå sammen svært små skoler i portalen, eller heve `MIN_ANTALL` til 10.

## 4. Tilgangsstyring

### Roller

| Rolle | Appen | Statistikk | Skolens kontakter | Brukere og tilgang | Hvem |
|---|---|---|---|---|---|
| Lærer | Ja | – | Lese | – | Alle ansatte som skal bruke appen |
| Rusansvarlig / helsesykepleier | Ja | Egen skole | Lese og endre | – | Rusansvarlig, helsesykepleier, rådgiver |
| Skoleleder | Ja | Egen skole | Lese og endre | Egen skole | Rektor og ev. assisterende rektor |
| Kommune / fylkeskommune | – | Alle egne skoler, samlet | – | – | Analytiker hos skoleeier |

Tilgangen er definert ett sted (`TILGANG` i `public/js/varde-core.js`) og **håndheves på serveren** for hver forespørsel. Knappene i portalen er bare et hjelpemiddel. Selv om noen manipulerer nettleseren, får de ikke data de ikke har tilgang til.

### Regler som er bygget inn

- En skoleleder ser og endrer bare brukere på **egen skole**.
- Kommune og fylkeskommune ser bare **sine egne skoler**, og bare samlede tall. De har ikke tilgang til skolenes brukere eller kontakter.
- Ingen kan endre **sin egen** rolle eller deaktivere seg selv.
- Skolen må alltid ha **minst én aktiv skoleleder**.
- Når en rolle endres eller en bruker deaktiveres, blir brukeren **logget ut med en gang**.
- Alle endringer i brukere, roller og kontakter lagres i **endringsloggen** med hvem og når.
- Passord lagres som scrypt-hash. Nye brukere får et tilfeldig midlertidig passord.
- Innlogging er begrenset til 10 forsøk per kvarter per IP-adresse.
- Sesjoner varer i 12 timer og ligger i en informasjonskapsel som er `HttpOnly` og `SameSite=Strict` (og `Secure` bak HTTPS).

Alle reglene over er dekket av automatiske tester (`npm test`).

### Anbefalt for ekte bruk: Feide

Brukernavn og passord er greit for demo, men for ekte bruk bør innlogging skje med **Feide** (Sikt), som skolene allerede bruker:

- Ansatte bruker samme innlogging som ellers. Ingen nye passord.
- Skoletilhørighet kommer automatisk fra Feide.
- Når en ansatt slutter, mister hen tilgang automatisk.
- Feide støtter tofaktorinnlogging. Det bør være **påkrevd** for skoleledere, rusansvarlige og skoleeiere.
- Rollene i Varde (rusansvarlig, skoleleder) styres fortsatt i portalen eller via Feide-grupper.

Feide krever at tjenesten registreres og godkjennes hos Sikt.

## 5. Hvor data lagres

Dagens kode lagrer alt i én SQLite-fil (`data/varde.db`). Før leveranse må dette avklares og skrives inn i databehandleravtalen:

- **Lagringssted i Norge eller EØS.** Velg en driftsleverandør med datasenter i Norge eller EU/EØS, og unngå overføring til land utenfor EØS (herunder tilgang fra amerikanske selskaper uten gyldig overføringsgrunnlag).
- **Kryptering:** HTTPS (TLS) for all trafikk. Kryptert disk og krypterte sikkerhetskopier.
- **Sikkerhetskopi:** Daglig, kryptert, med testet gjenoppretting og samme lagringssted-krav.
- **Skrifttyper:** Appen henter i dag skrifttypen Geist fra Google Fonts. Det sender brukerens IP-adresse til Google. **Før leveranse skal skrifttypen lastes ned og ligge på egen server**, og Google fjernes fra innholdssikkerhetsregelen (CSP) i `server/server.js`.
- **Driftslogger:** Webserver og plattform må ikke logge IP-adresser eller URL-er lenger enn nødvendig for sikkerhet (forslag: 30 dager).

## 6. Notatfunksjonen

Notater om elever vil nesten alltid inneholde **navn og helseopplysninger om barn** (rusbruk regnes som helseopplysning). Det er en *særlig kategori* personopplysninger etter personvernforordningen artikkel 9, og krever den strengeste beskyttelsen.

### Slik fungerer det nå (anbefalt)

- Notatet skrives i nettleseren og **lagres ikke** i Varde, verken på serveren eller i nettleserens lagring.
- Innholdet sendes aldri til serveren. Statistikken registrerer bare at notatmalen ble åpnet.
- Den ansatte kopierer teksten inn i **skolens eget arkiv eller saksbehandlingssystem**. Der finnes allerede tilgangsstyring, journalføring og arkivering som oppfyller opplæringslova, forvaltningsloven og arkivlova.

### Hvis notater skal lagres i Varde

Da må alt dette være på plass før funksjonen slås på:

1. **Vurdering av personvernkonsekvenser (DPIA)**, og forhåndsdrøfting med Datatilsynet hvis restrisikoen er høy.
2. **Rettslig grunnlag** for å behandle helseopplysninger om elever, avklart med skoleeiers personvernombud.
3. **Arkivplikt:** Notater kan være saksdokumenter som skal journalføres og arkiveres etter arkivlova. Varde må da kunne overføre dem til skolens arkivsystem, og de må slettes i Varde etterpå.
4. **Streng tilgang:** Bare den som skrev notatet, og navngitte roller (rektor, rusansvarlig) i saker de er tildelt, kan lese det. Kommune og fylkeskommune skal aldri ha tilgang.
5. **Tilgangslogg** for hver gang et notat leses, endres eller slettes, som skoleleder og personvernombud kan gå gjennom.
6. **Kryptering** av notatinnholdet i databasen med nøkler som holdes adskilt fra databasen (nøkkelhvelv).
7. **Tofaktorinnlogging** (Feide med MFA) for alle som kan skrive eller lese notater.
8. **Kort lagringstid** og automatisk sletting, og retting og sletting på forespørsel.
9. **Innsynsrett:** Elever og foresatte har rett til innsyn i opplysninger om seg selv. Det må finnes en rutine for å hente ut alt om én elev.
10. **Sikkerhetstest** (penetrasjonstest) av funksjonen før den tas i bruk.
11. **Ingen kobling til statistikken.** Notatinnhold skal aldri brukes i portalen.

Anbefalingen er å la Varde være uten notatlagring, og heller lage en eksport til skolens arkivsystem hvis dere ønsker det.

## 7. Øvrige krav før leveranse

- **DPIA** for løsningen som helhet. Konteksten (rus, barn, skole) gjør dette sterkt anbefalt selv om statistikken er anonym.
- **Personvernerklæring** for ansatte. Siden «Om data og personvern» i appen kan brukes som grunnlag.
- **Rutine for avvik:** Brudd på personopplysningssikkerheten meldes til skoleeier straks og til Datatilsynet innen 72 timer.
- **Tilgangsgjennomgang:** Skoleleder går gjennom brukere og roller minst hvert halvår.
- **Universell utforming:** Løsningen må oppfylle WCAG 2.1 nivå AA (likestillings- og diskrimineringsloven) og ha en tilgjengelighetserklæring.
- **Fagkvalitet:** Rådene i appen gjennomgås av helsesykepleier, SLT-koordinator eller politikontakt i hver kommune.
