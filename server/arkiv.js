"use strict";
/* Overføring av notater til skolens arkiv.
 *
 * Notatet holdes bare i minnet mens det sendes videre. Det skrives aldri til
 * databasen, til logg eller til disk i Varde.
 *
 * Adapter velges med VARDE_ARKIV:
 *   demo (standard)  – godtar notatet, forkaster innholdet og gir en demoreferanse
 *   fiks             – KS Fiks Arkiv (ikke ferdig, se under)
 */
const crypto = require("node:crypto");
const core = require("../public/js/varde-core.js");

const ADAPTER = process.env.VARDE_ARKIV || "demo";

const adaptere = {
  async demo({ skole }) {
    // Innholdet brukes ikke og forkastes når funksjonen er ferdig.
    const aar = new Date().getFullYear();
    return { referanse: "DEMO-" + aar + "/" + crypto.randomInt(1000, 9999) + "-1", arkiv: "Demoarkiv (notatet ble ikke lagret)", skole: skole.name };
  },

  /* KS Fiks Arkiv – for kommuner og fylkeskommuner.
   * Før dette kan tas i bruk må skoleeier:
   *  1. ha en Fiks IO-konto og tilgang til Fiks Arkiv-protokollen hos KS,
   *  2. gi Varde en egen avsenderkonto med sertifikat/nøkkel (lagres i nøkkelhvelv, ikke i koden),
   *  3. oppgi mottakerkonto for arkivsystemet (f.eks. Public 360 eller Elements),
   *  4. avklare hvordan notatet skal journalføres: dokumenttype (internt notat), arkivdel,
   *     klassering og hvordan elevens mappe finnes (f.eks. via fødselsnummer fra skolens elevsystem),
   *  5. avklare skjerming etter offentleglova § 13 og forvaltningsloven § 13.
   * Adapteren bygger da en arkivmelding med én journalpost og sender den kryptert via Fiks IO,
   * og returnerer journalpostnummeret fra arkivets kvittering. */
  async fiks() {
    const e = new Error("Koblingen til skolens arkiv er ikke satt opp ennå. Kopier notatet inn i arkivet manuelt.");
    e.status = 503;
    throw e;
  }
};

async function send({ skole, avsender, felter }) {
  const notat = core.validerNotat(felter);
  if (!notat) { const e = new Error("Notatet må ha elev og minst ett utfylt felt. Hvert felt kan ha maks 5000 tegn."); e.status = 400; throw e; }
  const fn = adaptere[ADAPTER];
  if (!fn) { const e = new Error("Ukjent arkivoppsett."); e.status = 500; throw e; }
  const dokument = { tittel: "Notat – hendelse/bekymring knyttet til rus", tekst: core.notatTekst(notat, skole.name), avsender: avsender.name + " <" + avsender.email + ">" };
  const kvittering = await fn({ skole, dokument });
  return { referanse: kvittering.referanse, arkiv: kvittering.arkiv, demo: ADAPTER === "demo" };
}

module.exports = { send, ADAPTER };
