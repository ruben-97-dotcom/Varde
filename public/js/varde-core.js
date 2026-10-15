/* Varde – felles kjerne for server og nettleser.
 * Tillatte hendelser, ukeberegning, aggregering og skjuling av små tall.
 * Brukes av server/server.js (require) og av nettleseren (window.VardeCore).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VardeCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Tall under denne grensen vises aldri, verken i portal eller API.
  var MIN_ANTALL = 5;

  var LABELS = {
    kategori: { akutt: "Elev ruset nå", bekymring: "Bekymring", forteller: "Eleven forteller", funn: "Funn eller salg", miljo: "Belastet miljø" },
    niva: { akutt: "Akutt", hoy: "Alvorlig", middels: "Følg opp", lav: "Følg med" },
    stoff: { alkohol: "Alkohol", cannabis: "Cannabis", piller: "Piller og andre stoffer", ukjent: "Ukjent stoff" },
    funn: { funn: "Funn av rusmidler", salg: "Salg på eller ved skolen", some: "Salg i sosiale medier", kjopt: "Elev har kjøpt" },
    rus: { alkohol: "Alkohol", cannabis: "Cannabis", piller: "Piller", stimulerende: "Sentralstimulerende", snus: "Snus og nikotinposer", vape: "Vape og røyk" },
    verktoy: { tegn: "Tegn å se etter", samtale: "Samtaleguide", plikter: "Plikter og lovverk", kontakter: "Kontakter", notat: "Notatmal", personvern: "Om data og personvern" }
  };

  /* ---------- Roller og tilgang ----------
   * Serveren håndhever dette. Klienten bruker det bare til å vise riktige knapper. */
  var ROLLER = {
    laerer: { label: "Lærer", beskrivelse: "Bruker appen. Ingen tilgang til portalen." },
    ressurs: { label: "Rusansvarlig / helsesykepleier", beskrivelse: "Bruker appen. Ser skolens statistikk og kan endre skolens kontakter." },
    skoleleder: { label: "Skoleleder", beskrivelse: "Alt over, og kan legge til brukere, endre roller og deaktivere brukere." },
    eier: { label: "Kommune / fylkeskommune", beskrivelse: "Ser samlet statistikk for sine skoler. Ingen tilgang til brukere eller kontakter på skolene." }
  };
  var TILGANG = {
    laerer: ["arkiv"],
    ressurs: ["arkiv", "statistikk", "kontakter"],
    skoleleder: ["arkiv", "statistikk", "kontakter", "brukere"],
    eier: ["statistikk"]
  };
  function kan(rolle, handling) { return (TILGANG[rolle] || []).indexOf(handling) > -1; }
  var SKOLEROLLER = ["laerer", "ressurs", "skoleleder"];

  // Faste kontaktroller som skolen fyller ut i portalen.
  var KONTAKTER = [
    { key: "rektor", label: "Rektor / ledelse" },
    { key: "rus", label: "Rusansvarlig på skolen" },
    { key: "helse", label: "Helsesykepleier (skolehelsetjenesten)" },
    { key: "politikontakt", label: "Politikontakt for skolen" },
    { key: "slt", label: "SLT-koordinator" },
    { key: "barnevern", label: "Barneverntjenesten (dagtid)" },
    { key: "ot", label: "Oppfølgingstjenesten / PPT" }
  ];
  function validerKontakter(liste) {
    if (!Array.isArray(liste)) return null;
    var lov = {}; KONTAKTER.forEach(function (k) { lov[k.key] = 1; });
    var ut = [], sett = {};
    for (var i = 0; i < liste.length; i++) {
      var k = liste[i] || {};
      if (!lov[k.key] || sett[k.key]) return null;
      sett[k.key] = 1;
      var navn = String(k.name || "").trim().slice(0, 100), tlf = String(k.phone || "").trim().slice(0, 30), merk = String(k.note || "").trim().slice(0, 200);
      if (tlf && !/^[0-9+ ()-]{3,30}$/.test(tlf)) return null;
      if (navn || tlf || merk) ut.push({ key: k.key, name: navn, phone: tlf, note: merk });
    }
    return ut;
  }

  /* ---------- Notat til arkiv ----------
   * Notatet sendes rett videre til skolens arkiv. Det lagres aldri i Varde. */
  var NOTATFELT = [
    { key: "tid", label: "Dato og tid" }, { key: "sted", label: "Sted" }, { key: "elev", label: "Elev" },
    { key: "obs", label: "Hva så og hørte du" }, { key: "sitat", label: "Hva sa eleven" }, { key: "tilstede", label: "Hvem var til stede" },
    { key: "tiltak", label: "Hva ble gjort" }, { key: "varslet", label: "Hvem er varslet" }, { key: "videre", label: "Videre oppfølging" }, { key: "skrevet", label: "Skrevet av" }
  ];
  function validerNotat(f) {
    if (!f || typeof f !== "object") return null;
    var ut = {}, noe = false;
    for (var i = 0; i < NOTATFELT.length; i++) {
      var k = NOTATFELT[i].key, v = f[k] == null ? "" : String(f[k]);
      if (v.length > 5000) return null;
      ut[k] = v.trim(); if (ut[k] && k !== "tid" && k !== "skrevet") noe = true;
    }
    if (!ut.elev || !noe) return null;
    return ut;
  }
  function notatTekst(f, skole) {
    var linjer = ["NOTAT – HENDELSE / BEKYMRING KNYTTET TIL RUS", skole ? "Skole: " + skole : "", ""];
    NOTATFELT.forEach(function (d) { linjer.push(d.label + ": " + (f[d.key] || "–")); });
    return linjer.filter(function (l, i) { return l !== "" || i > 1; }).join("\n");
  }

  /* Bare disse feltene og verdiene kan lagres. Alt annet avvises.
   * Ingen fritekst, ingen navn, ingen klokkeslett, ingen elevopplysninger. */
  function validerHendelse(e) {
    if (!e || typeof e !== "object") return null;
    var has = function (map, v) { return typeof v === "string" && Object.prototype.hasOwnProperty.call(map, v); };
    if (e.type === "veiviser") {
      if (!has(LABELS.kategori, e.kategori) || !has(LABELS.niva, e.niva)) return null;
      var tema = null;
      if (e.kategori === "akutt" && has(LABELS.stoff, e.tema)) tema = e.tema;
      if (e.kategori === "funn" && has(LABELS.funn, e.tema)) tema = e.tema;
      return { type: "veiviser", kategori: e.kategori, niva: e.niva, tema: tema };
    }
    if (e.type === "rusmiddel" && has(LABELS.rus, e.kategori)) return { type: "rusmiddel", kategori: e.kategori, niva: null, tema: null };
    if (e.type === "verktoy" && has(LABELS.verktoy, e.kategori)) return { type: "verktoy", kategori: e.kategori, niva: null, tema: null };
    return null;
  }

  // ISO-uke, f.eks. "2026-W42". Tid lagres aldri mer nøyaktig enn dette.
  function isoUke(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dag = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dag);
    var aar = t.getUTCFullYear();
    var uke = Math.ceil(((t - Date.UTC(aar, 0, 1)) / 86400000 + 1) / 7);
    return aar + "-W" + (uke < 10 ? "0" : "") + uke;
  }
  function ukerBakover(n, naa) {
    var ut = [], d = new Date(naa || Date.now());
    for (var i = n - 1; i >= 0; i--) ut.push(isoUke(new Date(d.getTime() - i * 7 * 86400000)));
    return ut.filter(function (w, i, a) { return a.indexOf(w) === i; });
  }

  function skjul(n) { return n > 0 && n < MIN_ANTALL ? null : n; }

  function tell(rader, felt, filter) {
    var m = {};
    rader.forEach(function (r) { if (filter && !filter(r)) return; var k = r[felt]; if (k) m[k] = (m[k] || 0) + 1; });
    return m;
  }
  function liste(map, labels) {
    return Object.keys(labels).map(function (k) { return { key: k, label: labels[k], n: map[k] || 0 }; })
      .filter(function (x) { return x.n > 0; })
      .sort(function (a, b) { return b.n - a.n; });
  }
  function skjulListe(l) { return l.map(function (x) { return { key: x.key, label: x.label, n: skjul(x.n) }; }); }

  /* hendelser: [{school_id, week, type, kategori, niva, tema}]
   * aktive:    [{school_id, week, token}]  (token kan ikke kobles mellom uker)
   * skoler:    [{id, name}]
   * Returnerer bare tall som allerede er skjult under MIN_ANTALL. */
  function aggreger(hendelser, aktive, skoler, uker) {
    var ukeSet = {}; uker.forEach(function (w) { ukeSet[w] = 1; });
    var ev = hendelser.filter(function (e) { return ukeSet[e.week]; });
    var akt = aktive.filter(function (a) { return ukeSet[a.week]; });
    var vei = ev.filter(function (e) { return e.type === "veiviser"; });

    var perUke = uker.map(function (w) { var n = vei.filter(function (e) { return e.week === w; }).length; return { week: w, n: skjul(n) }; });
    var aktivPerUke = uker.map(function (w) { return akt.filter(function (a) { return a.week === w; }).length; });
    var aktivSnitt = Math.round(aktivPerUke.reduce(function (s, x) { return s + x; }, 0) / Math.max(1, uker.length));

    var ut = {
      minAntall: MIN_ANTALL,
      uker: uker,
      perUke: perUke,
      totalt: {
        veiledninger: skjul(vei.length),
        akutt: skjul(vei.filter(function (e) { return e.kategori === "akutt"; }).length),
        alvorlig: skjul(vei.filter(function (e) { return e.niva === "akutt" || e.niva === "hoy"; }).length),
        rusoppslag: skjul(ev.filter(function (e) { return e.type === "rusmiddel"; }).length),
        aktiveSnitt: skjul(aktivSnitt)
      },
      kategori: skjulListe(liste(tell(vei, "kategori"), LABELS.kategori)),
      niva: skjulListe(liste(tell(vei, "niva"), LABELS.niva)),
      stoff: skjulListe(liste(tell(vei, "tema", function (e) { return e.kategori === "akutt"; }), LABELS.stoff)),
      funn: skjulListe(liste(tell(vei, "tema", function (e) { return e.kategori === "funn"; }), LABELS.funn)),
      rus: skjulListe(liste(tell(ev, "kategori", function (e) { return e.type === "rusmiddel"; }), LABELS.rus)),
      verktoy: skjulListe(liste(tell(ev, "kategori", function (e) { return e.type === "verktoy"; }), LABELS.verktoy))
    };

    if (skoler.length > 1) {
      ut.skoler = skoler.map(function (s) {
        var sv = vei.filter(function (e) { return e.school_id === s.id; });
        var kat = liste(tell(sv, "kategori"), LABELS.kategori);
        var st = liste(tell(sv, "tema", function (e) { return e.kategori === "akutt"; }), LABELS.stoff);
        return {
          id: s.id, name: s.name,
          veiledninger: skjul(sv.length),
          akutt: skjul(sv.filter(function (e) { return e.kategori === "akutt"; }).length),
          vanligst: kat[0] && kat[0].n >= MIN_ANTALL ? kat[0].label : null,
          rusmiddel: st[0] && st[0].n >= MIN_ANTALL ? st[0].label : null
        };
      }).sort(function (a, b) { return (b.veiledninger || 0) - (a.veiledninger || 0); });
    }
    return ut;
  }

  /* ---------- Eksempeldata (merket demo, kan slettes) ---------- */
  function prng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function velg(r, vekter) { var sum = 0, k; for (k in vekter) sum += vekter[k]; var x = r() * sum; for (k in vekter) { x -= vekter[k]; if (x <= 0) return k; } return k; }

  var DEMO = {
    eiere: [
      { id: "rogfk", name: "Rogaland fylkeskommune", type: "fylkeskommune" },
      { id: "haugesund", name: "Haugesund kommune", type: "kommune" }
    ],
    skoler: [
      { id: "karmsund", name: "Karmsund videregående skole", short: "Karmsund vgs", owner_id: "rogfk", niva: "vgs", str: 1.3 },
      { id: "eks-vgs-nord", name: "Eksempel vgs Nord", short: "Eks. vgs Nord", owner_id: "rogfk", niva: "vgs", str: 1.0 },
      { id: "eks-vgs-sor", name: "Eksempel vgs Sør", short: "Eks. vgs Sør", owner_id: "rogfk", niva: "vgs", str: 0.7 },
      { id: "eks-vgs-vest", name: "Eksempel vgs Vest", short: "Eks. vgs Vest", owner_id: "rogfk", niva: "vgs", str: 0.35 },
      { id: "eks-us-1", name: "Eksempel ungdomsskole 1", short: "Eks. u-skole 1", owner_id: "haugesund", niva: "us", str: 0.9 },
      { id: "eks-us-2", name: "Eksempel ungdomsskole 2", short: "Eks. u-skole 2", owner_id: "haugesund", niva: "us", str: 0.6 },
      { id: "eks-us-3", name: "Eksempel ungdomsskole 3", short: "Eks. u-skole 3", owner_id: "haugesund", niva: "us", str: 0.3 }
    ],
    brukere: [
      { email: "laerer@karmsund.demo", name: "Demo Lærer", role: "laerer", school_id: "karmsund" },
      { email: "rektor@karmsund.demo", name: "Demo Rektor", role: "skoleleder", school_id: "karmsund" },
      { email: "rusansvarlig@karmsund.demo", name: "Demo Rusansvarlig", role: "ressurs", school_id: "karmsund" },
      { email: "kontaktlaerer@karmsund.demo", name: "Demo Kontaktlærer", role: "laerer", school_id: "karmsund" },
      { email: "miljo@karmsund.demo", name: "Demo Miljøarbeider", role: "laerer", school_id: "karmsund" },
      { email: "analyse@rogfk.demo", name: "Demo Analytiker", role: "eier", owner_id: "rogfk" },
      { email: "analyse@haugesund.demo", name: "Demo Kommuneanalytiker", role: "eier", owner_id: "haugesund" }
    ],
    passord: "demo1234",
    // Oppdiktede kontakter og nummer, bare for å vise funksjonen.
    kontakter: {
      karmsund: [
        { key: "rektor", name: "Demo Rektor", phone: "400 00 001", note: "Eksempelnummer" },
        { key: "rus", name: "Demo Rusansvarlig", phone: "400 00 002", note: "Kontor i 2. etasje (eksempel)" },
        { key: "helse", name: "Helsesykepleier (eksempel)", phone: "400 00 003", note: "Mandag til torsdag" },
        { key: "politikontakt", name: "Politikontakt (eksempel)", phone: "400 00 004", note: "" },
        { key: "slt", name: "SLT-koordinator (eksempel)", phone: "400 00 005", note: "" }
      ]
    }
  };

  function lagDemoHendelser(naa) {
    var r = prng(20261015), uker = ukerBakover(52, naa), hendelser = [], aktive = [];
    DEMO.skoler.forEach(function (s) {
      var vgs = s.niva === "vgs";
      var kat = vgs ? { bekymring: 34, akutt: 18, forteller: 16, funn: 14, miljo: 10 } : { bekymring: 38, akutt: 8, forteller: 20, funn: 12, miljo: 8 };
      var stoff = vgs ? { cannabis: 45, alkohol: 30, piller: 15, ukjent: 10 } : { alkohol: 40, cannabis: 30, piller: 10, ukjent: 20 };
      var rus = vgs ? { cannabis: 30, snus: 26, vape: 22, alkohol: 10, piller: 8, stimulerende: 6 } : { vape: 34, snus: 30, alkohol: 14, cannabis: 14, piller: 5, stimulerende: 3 };
      uker.forEach(function (w, i) {
        var sesong = /-W(2[6-9]|3[0-2])$/.test(w) ? 0.15 : 1;   // sommerferie
        var trend = 0.75 + i / uker.length * 0.5;
        var n = Math.round((4 + r() * 6) * s.str * sesong * trend);
        for (var k = 0; k < n; k++) {
          var ka = velg(r, kat), niva = ka === "akutt" ? (r() < 0.25 ? "akutt" : "hoy") : velg(r, { hoy: 2, middels: 5, lav: 3 });
          var tema = ka === "akutt" ? velg(r, stoff) : ka === "funn" ? velg(r, { funn: 4, salg: 3, some: 3, kjopt: 2 }) : null;
          hendelser.push({ school_id: s.id, week: w, type: "veiviser", kategori: ka, niva: niva, tema: tema });
        }
        var m = Math.round((3 + r() * 6) * s.str * sesong);
        for (k = 0; k < m; k++) hendelser.push({ school_id: s.id, week: w, type: "rusmiddel", kategori: velg(r, rus), niva: null, tema: null });
        var v = Math.round((2 + r() * 4) * s.str * sesong);
        for (k = 0; k < v; k++) hendelser.push({ school_id: s.id, week: w, type: "verktoy", kategori: velg(r, { samtale: 4, tegn: 4, plikter: 2, notat: 3, kontakter: 2 }), niva: null, tema: null });
        var a = Math.round((6 + r() * 10) * s.str * sesong);
        for (k = 0; k < a; k++) aktive.push({ school_id: s.id, week: w, token: "demo-" + s.id + "-" + w + "-" + k });
      });
    });
    return { hendelser: hendelser, aktive: aktive };
  }

  return { NOTATFELT: NOTATFELT, validerNotat: validerNotat, notatTekst: notatTekst, ROLLER: ROLLER, TILGANG: TILGANG, kan: kan, SKOLEROLLER: SKOLEROLLER, KONTAKTER: KONTAKTER, validerKontakter: validerKontakter, MIN_ANTALL: MIN_ANTALL, LABELS: LABELS, validerHendelse: validerHendelse, isoUke: isoUke, ukerBakover: ukerBakover, aggreger: aggreger, DEMO: DEMO, lagDemoHendelser: lagDemoHendelser };
});
