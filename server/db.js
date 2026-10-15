"use strict";
/* Database for Varde (SQLite, innebygd i Node 22+).
 *
 * Personvern i datamodellen:
 * - Tabellen `hendelser` har ingen bruker-ID. Bare skole, ISO-uke og
 *   forhåndsdefinerte kategorier lagres.
 * - `aktive` teller unike brukere per uke med et token = HMAC(ukenøkkel, bruker-ID).
 *   Ukenøkkelen slettes når uka er over, så tokens kan ikke kobles mellom uker
 *   eller tilbake til en person.
 * - Hendelser eldre enn LAGRINGSTID_UKER slettes automatisk.
 */
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const core = require("../public/js/varde-core.js");

const LAGRINGSTID_UKER = Number(process.env.VARDE_LAGRINGSTID_UKER || 104);

function hashPassord(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(pw, salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + h;
}
function sjekkPassord(pw, lagret) {
  const [alg, salt, h] = String(lagret || "").split("$");
  if (alg !== "scrypt" || !salt || !h) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const fasit = Buffer.from(h, "hex");
  return fasit.length === test.length && crypto.timingSafeEqual(fasit, test);
}

function apne(fil) {
  fs.mkdirSync(path.dirname(fil), { recursive: true });
  const db = new DatabaseSync(fil);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS eiere (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('kommune','fylkeskommune')),
      demo INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS skoler (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, short TEXT,
      owner_id TEXT NOT NULL REFERENCES eiere(id),
      logo TEXT, demo INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS brukere (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('laerer','ressurs','skoleleder','eier')),
      school_id TEXT REFERENCES skoler(id), owner_id TEXT REFERENCES eiere(id),
      active INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0,
      created_week TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sesjoner (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES brukere(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL);
    -- Ingen bruker-ID her.
    CREATE TABLE IF NOT EXISTS hendelser (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id TEXT NOT NULL REFERENCES skoler(id),
      week TEXT NOT NULL, type TEXT NOT NULL, kategori TEXT NOT NULL,
      niva TEXT, tema TEXT, demo INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS hendelser_skole_uke ON hendelser(school_id, week);
    CREATE TABLE IF NOT EXISTS aktive (
      school_id TEXT NOT NULL, week TEXT NOT NULL, token TEXT NOT NULL,
      demo INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (school_id, week, token));
    CREATE TABLE IF NOT EXISTS ukenokler (week TEXT PRIMARY KEY, secret TEXT NOT NULL);
    -- Skolens kontakter, styres i portalen.
    CREATE TABLE IF NOT EXISTS kontakter (
      school_id TEXT NOT NULL REFERENCES skoler(id), key TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (school_id, key));
    -- Endringslogg for tilgang og kontakter (hvem endret hva og når). Ikke bruksdata.
    CREATE TABLE IF NOT EXISTS endringslogg (
      id INTEGER PRIMARY KEY AUTOINCREMENT, school_id TEXT NOT NULL, tid TEXT NOT NULL,
      utfort_av TEXT NOT NULL, handling TEXT NOT NULL, detalj TEXT NOT NULL DEFAULT '');
  `);
  return db;
}

function seedDemo(db) {
  const har = db.prepare("SELECT COUNT(*) AS n FROM eiere").get().n;
  if (har > 0) return false;
  const D = core.DEMO;
  const uke = core.isoUke(new Date());
  db.exec("BEGIN");
  try {
    const ie = db.prepare("INSERT INTO eiere (id, name, type, demo) VALUES (?, ?, ?, 1)");
    D.eiere.forEach((e) => ie.run(e.id, e.name, e.type));
    const is = db.prepare("INSERT INTO skoler (id, name, short, owner_id, logo, demo) VALUES (?, ?, ?, ?, NULL, 1)");
    D.skoler.forEach((s) => is.run(s.id, s.name, s.short, s.owner_id));
    const ib = db.prepare("INSERT INTO brukere (email, name, password_hash, role, school_id, owner_id, demo, created_week) VALUES (?, ?, ?, ?, ?, ?, 1, ?)");
    D.brukere.forEach((b) => ib.run(b.email, b.name, hashPassord(D.passord), b.role, b.school_id || null, b.owner_id || null, uke));
    const ik = db.prepare("INSERT INTO kontakter (school_id, key, name, phone, note) VALUES (?, ?, ?, ?, ?)");
    Object.keys(D.kontakter).forEach((sid) => D.kontakter[sid].forEach((k) => ik.run(sid, k.key, k.name, k.phone, k.note)));
    const data = core.lagDemoHendelser(Date.now());
    const ih = db.prepare("INSERT INTO hendelser (school_id, week, type, kategori, niva, tema, demo) VALUES (?, ?, ?, ?, ?, ?, 1)");
    data.hendelser.forEach((h) => ih.run(h.school_id, h.week, h.type, h.kategori, h.niva, h.tema));
    const ia = db.prepare("INSERT OR IGNORE INTO aktive (school_id, week, token, demo) VALUES (?, ?, ?, 1)");
    data.aktive.forEach((a) => ia.run(a.school_id, a.week, a.token));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return true;
}

function fjernDemo(db) {
  db.exec(`DELETE FROM kontakter WHERE school_id IN (SELECT id FROM skoler WHERE demo = 1);
           DELETE FROM hendelser WHERE demo = 1; DELETE FROM aktive WHERE demo = 1;
           DELETE FROM sesjoner WHERE user_id IN (SELECT id FROM brukere WHERE demo = 1);
           DELETE FROM brukere WHERE demo = 1;`);
}

// Ukenøkkel for aktive-token. Gamle nøkler slettes, så gamle tokens blir umulige å gjenskape.
function ukenokkel(db, uke) {
  db.prepare("DELETE FROM ukenokler WHERE week <> ?").run(uke);
  let rad = db.prepare("SELECT secret FROM ukenokler WHERE week = ?").get(uke);
  if (!rad) {
    const s = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT OR IGNORE INTO ukenokler (week, secret) VALUES (?, ?)").run(uke, s);
    rad = db.prepare("SELECT secret FROM ukenokler WHERE week = ?").get(uke);
  }
  return rad.secret;
}

function rydd(db) {
  const behold = new Set(core.ukerBakover(LAGRINGSTID_UKER, Date.now()));
  const eldste = [...behold].sort()[0];
  db.prepare("DELETE FROM hendelser WHERE week < ?").run(eldste);
  db.prepare("DELETE FROM aktive WHERE week < ?").run(eldste);
  db.prepare("DELETE FROM sesjoner WHERE expires < ?").run(Date.now());
}

function logg(db, skole, bruker, handling, detalj) {
  db.prepare("INSERT INTO endringslogg (school_id, tid, utfort_av, handling, detalj) VALUES (?, ?, ?, ?, ?)")
    .run(skole, new Date().toISOString().slice(0, 16).replace("T", " "), bruker.name + " (" + bruker.email + ")", handling, detalj || "");
}

module.exports = { logg, apne, seedDemo, fjernDemo, hashPassord, sjekkPassord, ukenokkel, rydd, LAGRINGSTID_UKER };
