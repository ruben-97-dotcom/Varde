# Sjekkliste før leveranse

Varde er i dag en **demo**. Dette må være gjort før løsningen tas i bruk med ekte brukere. Bakgrunnen står i [PERSONVERN-OG-SIKKERHET.md](PERSONVERN-OG-SIKKERHET.md).

## Avtaler og vurderinger
- [ ] Databehandleravtale med hver skoleeier (kommune eller fylkeskommune)
- [ ] Vurdering av personvernkonsekvenser (DPIA), gjennomgått med skoleeiers personvernombud
- [ ] Avklart lagringssted i Norge eller EØS, skrevet inn i avtalen sammen med underdatabehandlere
- [ ] Personvernerklæring for ansatte
- [ ] Avviksrutine (melding til skoleeier straks, Datatilsynet innen 72 timer)
- [ ] Lagringstid for endringslogg avtalt

## Innlogging og tilgang
- [ ] Feide-innlogging registrert og godkjent hos Sikt
- [ ] Tofaktorinnlogging påkrevd for skoleleder, rusansvarlig og skoleeier
- [ ] Første skoleleder per skole opprettet av skoleeier, og rutine for dette avtalt
- [ ] Rutine for halvårlig gjennomgang av brukere og roller

## Drift
- [ ] Kjører bak HTTPS med `VARDE_SECURE_COOKIE=1`
- [ ] Eksempeldata fjernet: `VARDE_DEMO=0` og `npm run fjern-demo`
- [ ] Skrifttypen ligger på egen server, og Google Fonts er fjernet fra CSP
- [ ] Kryptert disk og daglig kryptert sikkerhetskopi, med testet gjenoppretting
- [ ] Driftslogger uten innhold, med kort lagringstid
- [ ] Penetrasjonstest gjennomført og funn lukket
- [ ] Alle tester består: `npm test`

## Innhold og kvalitet
- [ ] Faglig gjennomgang av rådene (helsesykepleier, SLT, politikontakt)
- [ ] Lovhenvisninger kontrollert mot Lovdata
- [ ] Skolens logo lagt inn med tillatelse fra skoleeier
- [ ] Universell utforming (WCAG 2.1 AA) testet, tilgjengelighetserklæring publisert
