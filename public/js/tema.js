/* Lys/mørk modus. Lastes i <head> så siden ikke blinker hvit.
 * Valget huskes på enheten. Uten valg følges systemets innstilling. */
(function () {
  "use strict";
  var KEY = "varde-tema", root = document.documentElement;
  function lagret() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function system() { return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  function bruk(t) {
    root.classList.toggle("dark", t === "dark");
    var m = document.querySelector("meta[name=theme-color]"); if (m) m.content = t === "dark" ? "#0e0f12" : "#f7f7f9";
    document.querySelectorAll("[data-tema]").forEach(function (b) { b.setAttribute("aria-label", t === "dark" ? "Bytt til lys modus" : "Bytt til mørk modus"); b.setAttribute("aria-pressed", t === "dark"); });
  }
  bruk(lagret() || system());
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (!lagret()) bruk(system()); });
  document.addEventListener("click", function (e) {
    if (!e.target.closest("[data-tema]")) return;
    var ny = root.classList.contains("dark") ? "light" : "dark";
    try { localStorage.setItem(KEY, ny); } catch (er) {}
    bruk(ny);
  });
  document.addEventListener("DOMContentLoaded", function () { bruk(root.classList.contains("dark") ? "dark" : "light"); });
})();
