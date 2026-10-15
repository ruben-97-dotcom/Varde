/* Varde API-klient.
 * Med server: snakker med /api. Uten server (f.eks. åpnet som fil eller som
 * forhåndsvisning): bruker en demomodus i nettleseren med eksempeldata.
 */
(function () {
  "use strict";
  var C = window.VardeCore;
  var modus = null; // "server" | "demo"

  function ls(k, v) {
    try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; }
  }

  /* ---------- demomodus ---------- */
  var demoData = null;
  function demo() {
    if (!demoData) {
      var d = C.lagDemoHendelser(Date.now());
      demoData = { hendelser: d.hendelser.concat(ls("varde-demo-hendelser") || []), aktive: d.aktive.concat(ls("varde-demo-aktive") || []) };
    }
    return demoData;
  }
  function demoBrukere() {
    var ekstra = ls("varde-demo-brukere") || [];
    var av = ls("varde-demo-deaktivert") || [], roller = ls("varde-demo-roller") || {};
    return C.DEMO.brukere.concat(ekstra).map(function (b, i) { var u = Object.assign({ id: i + 1, active: av.indexOf(b.email) === -1 }, b); if (roller[b.email]) u.role = roller[b.email]; return u; });
  }
  function offentlig(b) {
    var skole = b.school_id ? C.DEMO.skoler.filter(function (s) { return s.id === b.school_id; })[0] : null;
    var eierId = b.owner_id || (skole && skole.owner_id);
    var eier = C.DEMO.eiere.filter(function (e) { return e.id === eierId; })[0] || null;
    return { name: b.name, email: b.email, role: b.role, tilganger: C.TILGANG[b.role] || [], skole: skole ? { id: skole.id, name: skole.name, short: skole.short, logo: skole.logo || null } : null, eier: eier, demo: true };
  }
  function demoMeg() { var e = ls("varde-demo-sesjon"); var b = e && demoBrukere().filter(function (x) { return x.email === e && x.active; })[0]; return b || null; }
  function leder() { var b = demoMeg(); return b && C.kan(b.role, "brukere") ? b : null; }
  function annen(b, id) {
    var u = demoBrukere().filter(function (x) { return x.id === id && x.school_id === b.school_id; })[0];
    if (!u) return { feil: feil(404, "Fant ikke brukeren.") };
    if (u.email === b.email) return { feil: feil(400, "Du kan ikke endre din egen tilgang. Be en annen skoleleder om å gjøre det.") };
    return u;
  }
  function antallLedere(b) { return demoBrukere().filter(function (x) { return x.school_id === b.school_id && x.role === "skoleleder" && x.active; }).length; }
  function demoLogg(b, handling, detalj) {
    var k = "varde-demo-logg-" + b.school_id, l = ls(k) || [];
    l.push({ tid: new Date().toISOString().slice(0, 16).replace("T", " "), utfort_av: b.name + " (" + b.email + ")", handling: handling, detalj: detalj }); ls(k, l.slice(-100));
  }
  function feil(status, melding) { var e = new Error(melding); e.status = status; return Promise.reject(e); }

  var DEMO_API = {
    login: function (email, passord) {
      var b = demoBrukere().filter(function (x) { return x.email.toLowerCase() === String(email).trim().toLowerCase() && x.active; })[0];
      if (!b || passord !== (b.passord || C.DEMO.passord)) return feil(401, "Feil e-post eller passord.");
      ls("varde-demo-sesjon", b.email);
      return Promise.resolve({ bruker: offentlig(b) });
    },
    logout: function () { ls("varde-demo-sesjon", null); return Promise.resolve({ ok: true }); },
    me: function () { var b = demoMeg(); return b ? Promise.resolve({ bruker: offentlig(b) }) : feil(401, "Du er ikke logget inn."); },
    hendelse: function (h) {
      var b = demoMeg(); if (!b || !b.school_id) return Promise.resolve({});
      var v = C.validerHendelse(h); if (!v) return Promise.resolve({});
      var rad = Object.assign({ school_id: b.school_id, week: C.isoUke(new Date()) }, v);
      demo().hendelser.push(rad);
      var lagret = ls("varde-demo-hendelser") || []; lagret.push(rad); ls("varde-demo-hendelser", lagret.slice(-500));
      return Promise.resolve({ ok: true });
    },
    aktiv: function () {
      var b = demoMeg(); if (!b || !b.school_id) return Promise.resolve({});
      var rad = { school_id: b.school_id, week: C.isoUke(new Date()), token: "demo-bruker-" + b.email };
      var lagret = ls("varde-demo-aktive") || [];
      if (!lagret.some(function (a) { return a.token === rad.token && a.week === rad.week; })) { lagret.push(rad); ls("varde-demo-aktive", lagret); demo().aktive.push(rad); }
      return Promise.resolve({ ok: true });
    },
    statistikk: function (antall) {
      var b = demoMeg(); if (!b) return feil(401, "Du er ikke logget inn.");
      if (!C.kan(b.role, "statistikk")) return feil(403, "Du har ikke tilgang til portalen.");
      var skoler = b.role === "eier" ? C.DEMO.skoler.filter(function (s) { return s.owner_id === b.owner_id; }) : C.DEMO.skoler.filter(function (s) { return s.id === b.school_id; });
      var ids = skoler.map(function (s) { return s.id; }), d = demo();
      var uker = C.ukerBakover(antall, Date.now());
      var r = C.aggreger(d.hendelser.filter(function (h) { return ids.indexOf(h.school_id) > -1; }), d.aktive.filter(function (a) { return ids.indexOf(a.school_id) > -1; }),
        skoler.map(function (s) { return { id: s.id, name: s.name }; }), uker);
      r.demo = true; r.antallSkoler = skoler.length;
      return Promise.resolve(r);
    },
    brukere: function () {
      var b = leder(); if (!b) return feil(403, "Bare skoleledere kan administrere brukere og tilganger.");
      return Promise.resolve({ brukere: demoBrukere().filter(function (x) { return x.school_id === b.school_id; }).map(function (x) { return { id: x.id, name: x.name, email: x.email, role: x.role, active: x.active ? 1 : 0 }; }) });
    },
    nyBruker: function (name, email, role) {
      var b = leder(); if (!b) return feil(403, "Bare skoleledere kan administrere brukere og tilganger.");
      email = String(email || "").trim().toLowerCase(); name = String(name || "").trim(); role = role || "laerer";
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return feil(400, "Skriv inn navn og en gyldig e-postadresse.");
      if (C.SKOLEROLLER.indexOf(role) === -1) return feil(400, "Ugyldig rolle.");
      if (demoBrukere().some(function (x) { return x.email === email; })) return feil(409, "Det finnes allerede en bruker med denne e-postadressen.");
      var pw = Math.random().toString(36).slice(2, 10);
      var ekstra = ls("varde-demo-brukere") || []; ekstra.push({ email: email, name: name, role: role, school_id: b.school_id, passord: pw }); ls("varde-demo-brukere", ekstra);
      demoLogg(b, "La til bruker", email + " som " + C.ROLLER[role].label);
      return Promise.resolve({ ok: true, midlertidigPassord: pw });
    },
    settAktiv: function (id, aktiv) {
      var b = leder(); if (!b) return feil(403, "Bare skoleledere kan administrere brukere og tilganger.");
      var u = annen(b, id); if (u.feil) return u.feil;
      if (!aktiv && u.role === "skoleleder" && antallLedere(b) <= 1) return feil(400, "Skolen må ha minst én aktiv skoleleder.");
      var av = (ls("varde-demo-deaktivert") || []).filter(function (e) { return e !== u.email; });
      if (!aktiv) av.push(u.email);
      ls("varde-demo-deaktivert", av);
      demoLogg(b, aktiv ? "Aktiverte bruker" : "Deaktiverte bruker", u.email);
      return Promise.resolve({ ok: true });
    },
    settRolle: function (id, role) {
      var b = leder(); if (!b) return feil(403, "Bare skoleledere kan administrere brukere og tilganger.");
      var u = annen(b, id); if (u.feil) return u.feil;
      if (C.SKOLEROLLER.indexOf(role) === -1) return feil(400, "Ugyldig rolle.");
      if (u.role === "skoleleder" && role !== "skoleleder" && u.active && antallLedere(b) <= 1) return feil(400, "Skolen må ha minst én aktiv skoleleder.");
      var r = ls("varde-demo-roller") || {}; r[u.email] = role; ls("varde-demo-roller", r);
      demoLogg(b, "Endret rolle", u.email + ": " + C.ROLLER[u.role].label + " → " + C.ROLLER[role].label);
      return Promise.resolve({ ok: true });
    },
    kontakter: function () {
      var b = demoMeg(); if (!b || !b.school_id) return feil(403, "Kontakter finnes bare for skolebrukere.");
      var lagret = ls("varde-demo-kontakter-" + b.school_id);
      return Promise.resolve({ kontakter: lagret || C.DEMO.kontakter[b.school_id] || [], kanEndre: C.kan(b.role, "kontakter") });
    },
    lagreKontakter: function (liste) {
      var b = demoMeg(); if (!b || !C.kan(b.role, "kontakter")) return feil(403, "Du har ikke tilgang til å endre kontaktene.");
      var v = C.validerKontakter(liste); if (!v) return feil(400, "Ugyldige kontakter. Telefonnummer kan bare inneholde tall, mellomrom og +.");
      ls("varde-demo-kontakter-" + b.school_id, v);
      demoLogg(b, "Endret skolens kontakter", v.length + " kontakter");
      return Promise.resolve({ ok: true });
    },
    endringslogg: function () {
      var b = leder(); if (!b) return feil(403, "Bare skoleledere kan administrere brukere og tilganger.");
      return Promise.resolve({ logg: (ls("varde-demo-logg-" + b.school_id) || []).slice().reverse() });
    }
  };

  /* ---------- servermodus ---------- */
  function kall(metode, sti, body) {
    return fetch(sti, { method: metode, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.feil || "Noe gikk galt."); e.status = r.status; throw e; } return j; }); });
  }
  var SERVER_API = {
    login: function (email, passord) { return kall("POST", "api/login", { email: email, passord: passord }); },
    logout: function () { return kall("POST", "api/logout", {}); },
    me: function () { return kall("GET", "api/me"); },
    hendelse: function (h) { return kall("POST", "api/hendelser", h).catch(function () { return {}; }); },
    aktiv: function () { return kall("POST", "api/aktiv", {}).catch(function () { return {}; }); },
    statistikk: function (uker) { return kall("GET", "api/statistikk?uker=" + uker); },
    brukere: function () { return kall("GET", "api/brukere"); },
    nyBruker: function (name, email, role) { return kall("POST", "api/brukere", { name: name, email: email, role: role }); },
    settAktiv: function (id, aktiv) { return kall("POST", "api/brukere/" + id + "/" + (aktiv ? "aktiver" : "deaktiver"), {}); },
    settRolle: function (id, role) { return kall("POST", "api/brukere/" + id + "/rolle", { role: role }); },
    kontakter: function () { return kall("GET", "api/kontakter"); },
    lagreKontakter: function (liste) { return kall("PUT", "api/kontakter", { kontakter: liste }); },
    endringslogg: function () { return kall("GET", "api/endringslogg"); }
  };

  var klar = new Promise(function (ok) {
    if (location.protocol === "file:") { modus = "demo"; return ok(); }
    var ferdig = false, t = setTimeout(function () { if (!ferdig) { ferdig = true; modus = "demo"; ok(); } }, 2000);
    fetch("api/health", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (ferdig) return; ferdig = true; clearTimeout(t); modus = j && j.app === "varde" ? "server" : "demo"; ok(); })
      .catch(function () { if (ferdig) return; ferdig = true; clearTimeout(t); modus = "demo"; ok(); });
  });

  var API = {};
  ["login", "logout", "me", "hendelse", "aktiv", "statistikk", "brukere", "nyBruker", "settAktiv", "settRolle", "kontakter", "lagreKontakter", "endringslogg"].forEach(function (k) {
    API[k] = function () { var a = arguments; return klar.then(function () { return (modus === "server" ? SERVER_API : DEMO_API)[k].apply(null, a); }); };
  });
  API.klar = klar;
  API.erDemo = function () { return modus === "demo"; };
  window.VardeAPI = API;
})();
