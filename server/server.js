"use strict";
/* Varde-server: innlogging, anonym bruksstatistikk og portal-API.
 * Ingen eksterne pakker. Start med: npm start
 *
 * Miljøvariabler:
 *   PORT                    (standard 3000)
 *   VARDE_DB                (standard data/varde.db)
 *   VARDE_DEMO=0            ikke legg inn eksempeldata ved første oppstart
 *   VARDE_SECURE_COOKIE=1   sett Secure på informasjonskapselen (bruk bak HTTPS)
 *   VARDE_LAGRINGSTID_UKER  hvor lenge statistikk lagres (standard 104 uker)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const core = require("../public/js/varde-core.js");
const D = require("./db.js");

const PORT = Number(process.env.PORT || 3000);
const DB_FIL = process.env.VARDE_DB || path.join(__dirname, "..", "data", "varde.db");
const PUBLIC = path.join(__dirname, "..", "public");
const SECURE = process.env.VARDE_SECURE_COOKIE === "1";
const SESJON_TIMER = 12;

const db = D.apne(DB_FIL);
if (process.env.VARDE_DEMO !== "0" && D.seedDemo(db)) console.log("Eksempeldata lagt inn (merket demo).");
if (process.argv.includes("--fjern-demo")) { D.fjernDemo(db); console.log("Eksempeldata fjernet."); process.exit(0); }
D.rydd(db);
setInterval(() => D.rydd(db), 6 * 3600 * 1000).unref();

/* ---------- hjelpere ---------- */
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function send(res, status, body, extra) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, extra || {}));
  res.end(data);
}
function feil(res, status, melding) { send(res, status, { feil: melding }); }
function lesJson(req) {
  return new Promise((ok, nei) => {
    if (!/^application\/json/.test(req.headers["content-type"] || "")) return nei(Object.assign(new Error("Forventet JSON"), { status: 415 }));
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 10000) { req.destroy(); nei(Object.assign(new Error("For stor forespørsel"), { status: 413 })); } });
    req.on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { nei(Object.assign(new Error("Ugyldig JSON"), { status: 400 })); } });
  });
}
function cookies(req) {
  const ut = {};
  (req.headers.cookie || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) ut[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return ut;
}
function sidCookie(verdi, maxAge) {
  return "varde_sid=" + verdi + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + (SECURE ? "; Secure" : "");
}

function brukerFraReq(req) {
  const sid = cookies(req).varde_sid;
  if (!sid) return null;
  const rad = db.prepare(`SELECT b.* FROM sesjoner s JOIN brukere b ON b.id = s.user_id
                          WHERE s.token_hash = ? AND s.expires > ? AND b.active = 1`).get(sha(sid), Date.now());
  return rad || null;
}
function offentligBruker(b) {
  const skole = b.school_id ? db.prepare("SELECT id, name, short, logo, owner_id FROM skoler WHERE id = ?").get(b.school_id) : null;
  const eierId = b.owner_id || (skole && skole.owner_id);
  const eier = eierId ? db.prepare("SELECT id, name, type FROM eiere WHERE id = ?").get(eierId) : null;
  return { name: b.name, email: b.email, role: b.role, tilganger: core.TILGANG[b.role] || [], skole: skole, eier: eier, demo: !!b.demo };
}

// Enkel begrensning av innloggingsforsøk per IP.
const forsok = new Map();
function forMangeForsok(ip) {
  const naa = Date.now(), f = (forsok.get(ip) || []).filter((t) => naa - t < 15 * 60 * 1000);
  forsok.set(ip, f);
  return f.length >= 10;
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const rute = req.method + " " + url.pathname;

  if (rute === "GET /api/health") return send(res, 200, { app: "varde", ok: true });

  if (rute === "POST /api/login") {
    const ip = req.socket.remoteAddress || "";
    if (forMangeForsok(ip)) return feil(res, 429, "For mange forsøk. Vent et kvarter og prøv igjen.");
    const { email, passord } = await lesJson(req);
    const b = db.prepare("SELECT * FROM brukere WHERE email = ? AND active = 1").get(String(email || "").trim());
    if (!b || !D.sjekkPassord(String(passord || ""), b.password_hash)) {
      forsok.get(ip).push(Date.now());
      return feil(res, 401, "Feil e-post eller passord.");
    }
    const sid = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sesjoner (token_hash, user_id, expires) VALUES (?, ?, ?)").run(sha(sid), b.id, Date.now() + SESJON_TIMER * 3600 * 1000);
    return send(res, 200, { bruker: offentligBruker(b) }, { "Set-Cookie": sidCookie(sid, SESJON_TIMER * 3600) });
  }

  if (rute === "POST /api/logout") {
    const sid = cookies(req).varde_sid;
    if (sid) db.prepare("DELETE FROM sesjoner WHERE token_hash = ?").run(sha(sid));
    return send(res, 200, { ok: true }, { "Set-Cookie": sidCookie("", 0) });
  }

  const b = brukerFraReq(req);
  if (!b) return feil(res, 401, "Du er ikke logget inn.");

  if (rute === "GET /api/me") return send(res, 200, { bruker: offentligBruker(b) });

  // Bruksstatistikk. Bruker-ID lagres ikke, bare skole og uke.
  if (rute === "POST /api/hendelser") {
    if (!b.school_id) return send(res, 202, { ok: true });
    const h = core.validerHendelse(await lesJson(req));
    if (!h) return feil(res, 400, "Ukjent hendelse.");
    db.prepare("INSERT INTO hendelser (school_id, week, type, kategori, niva, tema) VALUES (?, ?, ?, ?, ?, ?)")
      .run(b.school_id, core.isoUke(new Date()), h.type, h.kategori, h.niva, h.tema);
    return send(res, 202, { ok: true });
  }
  if (rute === "POST /api/aktiv") {
    if (!b.school_id) return send(res, 202, { ok: true });
    const uke = core.isoUke(new Date());
    const token = crypto.createHmac("sha256", D.ukenokkel(db, uke)).update(String(b.id)).digest("hex");
    db.prepare("INSERT OR IGNORE INTO aktive (school_id, week, token) VALUES (?, ?, ?)").run(b.school_id, uke, token);
    return send(res, 202, { ok: true });
  }

  // Portal: bare skoleledere (egen skole) og eiere (egne skoler).
  if (rute === "GET /api/statistikk") {
    if (!core.kan(b.role, "statistikk")) return feil(res, 403, "Du har ikke tilgang til portalen.");
    const skoler = b.role === "eier"
      ? db.prepare("SELECT id, name FROM skoler WHERE owner_id = ? ORDER BY name").all(b.owner_id)
      : db.prepare("SELECT id, name FROM skoler WHERE id = ?").all(b.school_id);
    const antall = [4, 12, 52].includes(Number(url.searchParams.get("uker"))) ? Number(url.searchParams.get("uker")) : 12;
    const uker = core.ukerBakover(antall, Date.now());
    const ids = skoler.map((s) => s.id);
    const ph = ids.map(() => "?").join(",") || "''";
    const hendelser = db.prepare(`SELECT school_id, week, type, kategori, niva, tema FROM hendelser WHERE school_id IN (${ph}) AND week >= ?`).all(...ids, uker[0]);
    const aktive = db.prepare(`SELECT school_id, week, token FROM aktive WHERE school_id IN (${ph}) AND week >= ?`).all(...ids, uker[0]);
    const demo = db.prepare(`SELECT COUNT(*) AS n FROM hendelser WHERE demo = 1 AND school_id IN (${ph})`).get(...ids).n > 0;
    return send(res, 200, Object.assign(core.aggreger(hendelser, aktive, skoler, uker), { demo: demo, antallSkoler: skoler.length }));
  }

  // Skolens kontakter: alle på skolen kan lese, bare roller med tilgangen «kontakter» kan endre.
  if (url.pathname === "/api/kontakter") {
    if (!b.school_id) return feil(res, 403, "Kontakter finnes bare for skolebrukere.");
    if (req.method === "GET") return send(res, 200, { kontakter: db.prepare("SELECT key, name, phone, note FROM kontakter WHERE school_id = ?").all(b.school_id), kanEndre: core.kan(b.role, "kontakter") });
    if (req.method === "PUT") {
      if (!core.kan(b.role, "kontakter")) return feil(res, 403, "Du har ikke tilgang til å endre kontaktene.");
      const liste = core.validerKontakter((await lesJson(req)).kontakter);
      if (!liste) return feil(res, 400, "Ugyldige kontakter. Telefonnummer kan bare inneholde tall, mellomrom og +.");
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM kontakter WHERE school_id = ?").run(b.school_id);
        const ins = db.prepare("INSERT INTO kontakter (school_id, key, name, phone, note) VALUES (?, ?, ?, ?, ?)");
        liste.forEach((k) => ins.run(b.school_id, k.key, k.name, k.phone, k.note));
        D.logg(db, b.school_id, b, "Endret skolens kontakter", liste.length + " kontakter");
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      return send(res, 200, { ok: true });
    }
  }

  // Brukere og tilgang: bare skoleleder, og bare på egen skole.
  if (url.pathname.startsWith("/api/brukere") || url.pathname === "/api/endringslogg") {
    if (!core.kan(b.role, "brukere")) return feil(res, 403, "Bare skoleledere kan administrere brukere og tilganger.");
    const aktiveLedere = () => db.prepare("SELECT COUNT(*) AS n FROM brukere WHERE school_id = ? AND role = 'skoleleder' AND active = 1").get(b.school_id).n;
    if (rute === "GET /api/endringslogg") {
      return send(res, 200, { logg: db.prepare("SELECT tid, utfort_av, handling, detalj FROM endringslogg WHERE school_id = ? ORDER BY id DESC LIMIT 100").all(b.school_id) });
    }
    if (rute === "GET /api/brukere") {
      return send(res, 200, { brukere: db.prepare("SELECT id, name, email, role, active FROM brukere WHERE school_id = ? ORDER BY active DESC, name").all(b.school_id) });
    }
    if (rute === "POST /api/brukere") {
      const { name, email, role } = await lesJson(req);
      const navn = String(name || "").trim().slice(0, 100), epost = String(email || "").trim().toLowerCase().slice(0, 200), rolle = role || "laerer";
      if (!navn || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(epost)) return feil(res, 400, "Skriv inn navn og en gyldig e-postadresse.");
      if (!core.SKOLEROLLER.includes(rolle)) return feil(res, 400, "Ugyldig rolle.");
      if (db.prepare("SELECT 1 FROM brukere WHERE email = ?").get(epost)) return feil(res, 409, "Det finnes allerede en bruker med denne e-postadressen.");
      const passord = crypto.randomBytes(9).toString("base64url");
      db.prepare("INSERT INTO brukere (email, name, password_hash, role, school_id, created_week) VALUES (?, ?, ?, ?, ?, ?)")
        .run(epost, navn, D.hashPassord(passord), rolle, b.school_id, core.isoUke(new Date()));
      D.logg(db, b.school_id, b, "La til bruker", epost + " som " + core.ROLLER[rolle].label);
      return send(res, 201, { ok: true, midlertidigPassord: passord });
    }
    const m = url.pathname.match(/^\/api\/brukere\/(\d+)\/(deaktiver|aktiver|rolle)$/);
    if (req.method === "POST" && m) {
      const id = Number(m[1]);
      if (id === b.id) return feil(res, 400, "Du kan ikke endre din egen tilgang. Be en annen skoleleder om å gjøre det.");
      const u = db.prepare("SELECT * FROM brukere WHERE id = ? AND school_id = ?").get(id, b.school_id);
      if (!u) return feil(res, 404, "Fant ikke brukeren.");
      if (m[2] === "rolle") {
        const { role } = await lesJson(req);
        if (!core.SKOLEROLLER.includes(role)) return feil(res, 400, "Ugyldig rolle.");
        if (u.role === "skoleleder" && role !== "skoleleder" && u.active && aktiveLedere() <= 1) return feil(res, 400, "Skolen må ha minst én aktiv skoleleder.");
        db.prepare("UPDATE brukere SET role = ? WHERE id = ?").run(role, id);
        db.prepare("DELETE FROM sesjoner WHERE user_id = ?").run(id);
        D.logg(db, b.school_id, b, "Endret rolle", u.email + ": " + core.ROLLER[u.role].label + " → " + core.ROLLER[role].label);
        return send(res, 200, { ok: true });
      }
      const aktiv = m[2] === "aktiver";
      if (!aktiv && u.role === "skoleleder" && u.active && aktiveLedere() <= 1) return feil(res, 400, "Skolen må ha minst én aktiv skoleleder.");
      db.prepare("UPDATE brukere SET active = ? WHERE id = ?").run(aktiv ? 1 : 0, id);
      if (!aktiv) db.prepare("DELETE FROM sesjoner WHERE user_id = ?").run(id);
      D.logg(db, b.school_id, b, aktiv ? "Aktiverte bruker" : "Deaktiverte bruker", u.email);
      return send(res, 200, { ok: true });
    }
  }
  return feil(res, 404, "Ukjent adresse.");
}

/* ---------- statiske filer ---------- */
const TYPER = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json" };
const SIKKERHET = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};
function statisk(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  if (p === "/portal") p = "/portal.html";
  const fil = path.normalize(path.join(PUBLIC, p));
  if (!fil.startsWith(PUBLIC + path.sep)) return feil(res, 403, "Ingen tilgang.");
  fs.readFile(fil, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Fant ikke siden."); }
    res.writeHead(200, Object.assign({ "Content-Type": TYPER[path.extname(fil)] || "application/octet-stream", "Cache-Control": "no-cache" }, SIKKERHET));
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") statisk(req, res, url);
    else feil(res, 405, "Ikke tillatt.");
  } catch (e) {
    // Logger aldri innholdet i forespørselen.
    if (!e.status) console.error("Feil:", e.message);
    if (!res.headersSent) feil(res, e.status || 500, e.status ? e.message : "Noe gikk galt.");
  }
});
if (require.main === module) server.listen(PORT, () => console.log("Varde kjører på http://localhost:" + PORT));
module.exports = server;
