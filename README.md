# Varde

**Varde** er en trinnvis veileder for lærere og andre ansatte i skolen om elever og rus, tobakk og snus. En portal gir skoler, kommuner og fylkeskommuner anonym oversikt over hva ansatte bruker Varde til, slik at de kan se hvor de største utfordringene er.

> **Status: demo.** Se [docs/LEVERANSE.md](docs/LEVERANSE.md) før løsningen tas i bruk med ekte brukere.

## Innhold

**Appen for ansatte** (`public/index.html`)
- Innlogging. Hver ansatt har egen bruker knyttet til en skole.
- Veivisere med ett spørsmål om gangen: elev ruset nå, bekymring, eleven forteller, funn eller salg, belastet miljø. Svarene gir en tilpasset veiledning.
- Sider om alkohol, cannabis, piller, sentralstimulerende, snus og nikotinposer, og vape og røyk.
- Skolens egne kontakter (styres i portalen), nødnummer, samtaleguide, plikter og lovverk.
- Notat som sendes rett til skolens arkiv. Det lagres aldri i Varde eller på telefonen.

**Portalen** (`public/portal.html`)
- Skoleleder og rusansvarlig: statistikk for egen skole og skolens kontakter.
- Skoleleder: brukere, roller og endringslogg.
- Kommune og fylkeskommune: samlet statistikk for sine skoler, med «største utfordringer» i klartekst.

## Personvern i korte trekk

- Bruksstatistikken har **ingen bruker-ID**. Bare skole, uke og faste kategorier lagres.
- Aktive brukere telles med en ukekode som ikke kan spores tilbake.
- Tall under 5 vises aldri.
- Ingen opplysninger om elever lagres. Notater sendes rett til skolens arkiv uten å lagres i Varde.
- Tilgang styres av roller og håndheves på serveren. Alle endringer logges.

Detaljer: [docs/PERSONVERN-OG-SIKKERHET.md](docs/PERSONVERN-OG-SIKKERHET.md).

## Kjøre lokalt

Krever Node.js 22.5 eller nyere. Ingen pakker å installere.

```bash
npm start          # http://localhost:3000
npm test           # automatiske tester av personvern og tilgang
```

Første oppstart legger inn **eksempeldata** (merket demo). Demobrukere, passord `demo1234`:

| Bruker | Rolle |
|---|---|
| laerer@karmsund.demo | Lærer, Karmsund vgs |
| rusansvarlig@karmsund.demo | Rusansvarlig / helsesykepleier, Karmsund vgs |
| rektor@karmsund.demo | Skoleleder, Karmsund vgs |
| analyse@rogfk.demo | Rogaland fylkeskommune |
| analyse@haugesund.demo | Haugesund kommune |

Tallene i demoen er generert og sier ingenting om virkelig bruk. De andre skolene i demoen er oppdiktet.

Åpnes `public/index.html` direkte i nettleseren uten server, kjører appen i **demomodus** med eksempeldata i nettleseren.

### Innstillinger

| Variabel | Standard | Betydning |
|---|---|---|
| `PORT` | 3000 | Port |
| `VARDE_DB` | `data/varde.db` | Databasefil |
| `VARDE_DEMO` | på | `0` = ikke legg inn eksempeldata |
| `VARDE_SECURE_COOKIE` | av | `1` bak HTTPS |
| `VARDE_LAGRINGSTID_UKER` | 104 | Hvor lenge statistikk lagres |
| `VARDE_ARKIV` | `demo` | `demo` = demoarkiv, `fiks` = KS Fiks Arkiv (må settes opp) |

## Struktur

```
server/server.js        API, innlogging, tilgangskontroll, statiske filer
server/db.js            database, eksempeldata, sletting av gamle data
server/arkiv.js         overføring av notater til skolens arkiv
public/js/varde-core.js roller, tilgang, tillatte hendelser, aggregering (felles for server og nettleser)
public/js/api.js        API-klient med demomodus
public/index.html       appen for ansatte
public/portal.html      portalen
test/                   tester
docs/                   personvern, sikkerhet og leveranse
```

## Skolens logo

Logoen vises i appen når feltet `logo` for skolen peker på en bildefil, for eksempel `assets/skoler/karmsund.svg`. Legg bare inn logoer dere har fått tillatelse til å bruke.

## Viktig

Appen gir generelle råd og erstatter ikke skolens beredskapsplan, kommunens rutiner eller faglig vurdering. Ved fare for liv: ring 113.
