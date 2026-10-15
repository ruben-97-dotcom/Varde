"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "varde-test-"));
process.env.VARDE_DB = path.join(dir, "test.db");
const core = require("../public/js/varde-core.js");
const server = require("../server/server.js");
const { DatabaseSync } = require("node:sqlite");

let base;
test.before(() => new Promise((ok) => server.listen(0, () => { base = "http://127.0.0.1:" + server.address().port; ok(); })));
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function login(email) {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, passord: core.DEMO.passord }) });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const get = (p, c) => fetch(base + p, { headers: { cookie: c } });
const post = (p, c, body) => fetch(base + p, { method: "POST", headers: { cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("bare forhåndsdefinerte hendelser godtas", () => {
  assert.equal(core.validerHendelse({ type: "veiviser", kategori: "akutt", niva: "hoy", tema: "cannabis" }).tema, "cannabis");
  assert.equal(core.validerHendelse({ type: "veiviser", kategori: "akutt", niva: "hoy", tema: "Ola i 2B" }).tema, null);
  assert.equal(core.validerHendelse({ type: "fritekst", kategori: "noe" }), null);
  assert.equal(core.validerHendelse({ type: "rusmiddel", kategori: "heroin" }), null);
});

test("tall under minstegrensen skjules", () => {
  const uker = ["2026-W40"];
  const h = [1, 2, 3].map(() => ({ school_id: "a", week: "2026-W40", type: "veiviser", kategori: "akutt", niva: "hoy", tema: "alkohol" }));
  const s = core.aggreger(h, [], [{ id: "a", name: "A" }], uker);
  assert.equal(s.totalt.veiledninger, null);
  assert.equal(s.stoff[0].n, null);
  assert.equal(s.perUke[0].n, null);
});

test("lærer kan logge bruk, men lagringen har ingen bruker-ID eller tidspunkt", async () => {
  const c = await login("laerer@karmsund.demo");
  assert.equal((await post("/api/hendelser", c, { type: "veiviser", kategori: "miljo", niva: "lav" })).status, 202);
  assert.equal((await post("/api/hendelser", c, { type: "veiviser", kategori: "miljo", niva: "lav", navn: "Ola" })).status, 202);
  assert.equal((await post("/api/hendelser", c, { type: "notat", tekst: "hemmelig" })).status, 400);
  const db = new DatabaseSync(process.env.VARDE_DB);
  const kolonner = db.prepare("PRAGMA table_info(hendelser)").all().map((k) => k.name);
  assert.deepEqual(kolonner.sort(), ["demo", "id", "kategori", "niva", "school_id", "tema", "type", "week"]);
  const rader = db.prepare("SELECT * FROM hendelser WHERE demo = 0").all();
  assert.equal(rader.length, 2);
  assert.ok(rader.every((r) => r.school_id === "karmsund" && /^\d{4}-W\d{2}$/.test(r.week)));
});

test("aktive brukere telles med ukekode som ikke er bruker-ID", async () => {
  const c = await login("laerer@karmsund.demo");
  await post("/api/aktiv", c, {}); await post("/api/aktiv", c, {});
  const db = new DatabaseSync(process.env.VARDE_DB);
  const rader = db.prepare("SELECT * FROM aktive WHERE demo = 0").all();
  assert.equal(rader.length, 1);
  assert.match(rader[0].token, /^[0-9a-f]{64}$/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ukenokler").get().n, 1);
});

test("lærere har ikke tilgang til portalen", async () => {
  const c = await login("laerer@karmsund.demo");
  assert.equal((await get("/api/statistikk", c)).status, 403);
  assert.equal((await get("/api/brukere", c)).status, 403);
});

test("skoleleder ser bare egen skole, eier ser bare egne skoler", async () => {
  const s = await (await get("/api/statistikk?uker=12", await login("rektor@karmsund.demo"))).json();
  assert.equal(s.antallSkoler, 1);
  assert.equal(s.skoler, undefined);
  const k = await (await get("/api/statistikk?uker=12", await login("analyse@haugesund.demo"))).json();
  assert.ok(k.skoler.every((x) => x.id.startsWith("eks-us")));
  const f = await (await get("/api/statistikk?uker=52", await login("analyse@rogfk.demo"))).json();
  assert.ok(f.skoler.some((x) => x.id === "karmsund"));
  const alle = [].concat(f.perUke.map((x) => x.n), f.kategori.map((x) => x.n), f.skoler.map((x) => x.akutt));
  assert.ok(alle.every((n) => n === null || n === 0 || n >= core.MIN_ANTALL));
});

test("skoleleder kan legge til og deaktivere lærere på egen skole", async () => {
  const c = await login("rektor@karmsund.demo");
  const r = await (await post("/api/brukere", c, { name: "Ny Lærer", email: "ny@karmsund.demo" })).json();
  assert.ok(r.midlertidigPassord.length >= 10);
  const liste = (await (await get("/api/brukere", c)).json()).brukere;
  const ny = liste.find((u) => u.email === "ny@karmsund.demo");
  assert.equal((await post("/api/brukere/" + ny.id + "/deaktiver", c, {})).status, 200);
  const l2 = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "ny@karmsund.demo", passord: r.midlertidigPassord }) });
  assert.equal(l2.status, 401);
});

test("feil passord avvises og passord lagres ikke i klartekst", async () => {
  const r = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "laerer@karmsund.demo", passord: "feil" }) });
  assert.equal(r.status, 401);
  const db = new DatabaseSync(process.env.VARDE_DB);
  assert.ok(db.prepare("SELECT password_hash FROM brukere").all().every((b) => b.password_hash.startsWith("scrypt$") && !b.password_hash.includes(core.DEMO.passord)));
});

/* ---------- tilgangsstyring ---------- */
const put = (p, c, body) => fetch(base + p, { method: "PUT", headers: { cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("rusansvarlig ser statistikk og kan endre kontakter, men ikke brukere", async () => {
  const c = await login("rusansvarlig@karmsund.demo");
  assert.equal((await get("/api/statistikk", c)).status, 200);
  assert.equal((await put("/api/kontakter", c, { kontakter: [{ key: "helse", name: "Helsesykepleier", phone: "400 00 010" }] })).status, 200);
  assert.equal((await get("/api/brukere", c)).status, 403);
  assert.equal((await get("/api/endringslogg", c)).status, 403);
});

test("lærer kan lese, men ikke endre, skolens kontakter", async () => {
  const c = await login("laerer@karmsund.demo");
  const r = await (await get("/api/kontakter", c)).json();
  assert.equal(r.kanEndre, false);
  assert.ok(r.kontakter.some((k) => k.key === "helse"));
  assert.equal((await put("/api/kontakter", c, { kontakter: [] })).status, 403);
});

test("ugyldige kontakter avvises", async () => {
  const c = await login("rektor@karmsund.demo");
  assert.equal((await put("/api/kontakter", c, { kontakter: [{ key: "ukjent", name: "x" }] })).status, 400);
  assert.equal((await put("/api/kontakter", c, { kontakter: [{ key: "rektor", phone: "<script>" }] })).status, 400);
});

test("kommune og fylkeskommune har ikke tilgang til skolenes kontakter eller brukere", async () => {
  const c = await login("analyse@rogfk.demo");
  assert.equal((await get("/api/kontakter", c)).status, 403);
  assert.equal((await get("/api/brukere", c)).status, 403);
});

test("skoleleder kan ikke endre egen rolle, og siste skoleleder kan ikke fjernes", async () => {
  const c = await login("rektor@karmsund.demo");
  const brukere = (await (await get("/api/brukere", c)).json()).brukere;
  const meg = brukere.find((u) => u.email === "rektor@karmsund.demo");
  assert.equal((await post("/api/brukere/" + meg.id + "/rolle", c, { role: "laerer" })).status, 400);
  assert.equal((await post("/api/brukere/" + meg.id + "/deaktiver", c, {})).status, 400);
  // gjør en lærer til skoleleder, og prøv så å degradere ham tilbake: lov, fordi det fortsatt finnes en leder
  const l = brukere.find((u) => u.email === "kontaktlaerer@karmsund.demo");
  assert.equal((await post("/api/brukere/" + l.id + "/rolle", c, { role: "skoleleder" })).status, 200);
  assert.equal((await post("/api/brukere/" + l.id + "/rolle", c, { role: "laerer" })).status, 200);
  assert.equal((await post("/api/brukere/" + l.id + "/rolle", c, { role: "eier" })).status, 400);
});

test("rolleendring logger brukeren ut med en gang", async () => {
  const lc = await login("miljo@karmsund.demo");
  assert.equal((await get("/api/me", lc)).status, 200);
  const c = await login("rektor@karmsund.demo");
  const u = (await (await get("/api/brukere", c)).json()).brukere.find((x) => x.email === "miljo@karmsund.demo");
  assert.equal((await post("/api/brukere/" + u.id + "/rolle", c, { role: "ressurs" })).status, 200);
  assert.equal((await get("/api/me", lc)).status, 401);
});

test("skoleleder kan ikke endre brukere på en annen skole", async () => {
  const db = new DatabaseSync(process.env.VARDE_DB);
  db.prepare("INSERT INTO brukere (email, name, password_hash, role, school_id, created_week) VALUES ('annen@nord.demo', 'Annen', 'x', 'laerer', 'eks-vgs-nord', '2026-W01')").run();
  const id = db.prepare("SELECT id FROM brukere WHERE email = 'annen@nord.demo'").get().id;
  const c = await login("rektor@karmsund.demo");
  assert.equal((await post("/api/brukere/" + id + "/deaktiver", c, {})).status, 404);
  assert.equal(db.prepare("SELECT active FROM brukere WHERE id = ?").get(id).active, 1);
});

test("endringer i tilgang og kontakter havner i endringsloggen", async () => {
  const c = await login("rektor@karmsund.demo");
  const logg = (await (await get("/api/endringslogg", c)).json()).logg;
  assert.ok(logg.some((l) => l.handling === "Endret rolle"));
  assert.ok(logg.some((l) => l.handling === "Endret skolens kontakter" && l.utfort_av.includes("rusansvarlig@karmsund.demo")));
});
