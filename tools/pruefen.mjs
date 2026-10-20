#!/usr/bin/env node
/*
 * Prueft die gebaute Seite (build/site) automatisch im Browser:
 * Startseite, jede Praesentation, Downloads, Referentenansicht und interaktive Tafel.
 *
 * Aufruf: node tools/pruefen.mjs [--bilder ordner]
 *   --bilder  speichert Bildschirmfotos aller Folien in diesem Ordner
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { WURZEL } from "./lib/inhalte.mjs";

const ORDNER = path.join(WURZEL, "build", "site");
const args = process.argv.slice(2);
let bilderOrdner = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--bilder") bilderOrdner = path.resolve(args[++i]);
}

const TYPEN = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf"
};
const server = http.createServer((anfrage, antwort) => {
  let pfad = decodeURIComponent(new URL(anfrage.url, "http://x").pathname);
  if (pfad.endsWith("/")) pfad += "index.html";
  const datei = path.join(ORDNER, path.normalize(pfad));
  if (!datei.startsWith(ORDNER) || !fs.existsSync(datei) || !fs.statSync(datei).isFile()) {
    antwort.writeHead(404);
    antwort.end();
    return;
  }
  antwort.writeHead(200, { "Content-Type": TYPEN[path.extname(datei)] || "application/octet-stream" });
  fs.createReadStream(datei).pipe(antwort);
});
await new Promise((ok) => server.listen(0, ok));
const BASIS = `http://localhost:${server.address().port}/`;

let fehler = 0;
function pruefe(bedingung, text) {
  console.log((bedingung ? "  ok    " : "  FEHLER ") + text);
  if (!bedingung) fehler++;
}

const browser = await chromium.launch(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {});
const kontext = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const seite = await kontext.newPage();
const seitenFehler = [];
seite.on("pageerror", (e) => seitenFehler.push(e.message));

try {
  console.log("Startseite");
  await seite.goto(BASIS);
  await seite.waitForSelector(".kapitel", { timeout: 20000 });
  const robots = await (await fetch(BASIS + "robots.txt")).text();
  pruefe(/Disallow: \//.test(robots), "robots.txt sperrt Suchmaschinen");
  pruefe((await seite.locator('meta[name="robots"]').getAttribute("content")).includes("noindex"), "noindex gesetzt");

  const kapitel = await seite.locator(".kapitel").count();
  const karten = await seite.locator(".lektion").count();
  pruefe(kapitel > 0, `${kapitel} Kapitel sichtbar`);
  pruefe(karten > 0, `${karten} Praesentation(en) sichtbar`);
  const leer = await seite.locator(".kapitel-leer").count();
  console.log(`        ${leer} Kapitel mit Hinweis «Noch keine Präsentation»`);

  // Suche
  const ersteTitel = (await seite.locator(".lektion h3").first().textContent()).trim();
  await seite.fill("#suche", ersteTitel.split(" ")[0]);
  pruefe((await seite.locator(".lektion:not([hidden])").count()) >= 1, "Suche findet die erste Praesentation");
  await seite.fill("#suche", "xyzxyz-gibt-es-nicht");
  pruefe(await seite.locator("#kein-treffer").isVisible(), "Suche ohne Treffer zeigt Hinweis");
  await seite.fill("#suche", "");

  // Download von der Startseite
  const [download] = await Promise.all([
    seite.waitForEvent("download", { timeout: 30000 }),
    seite.locator(".lektion").first().getByRole("link", { name: "PDF", exact: true }).click()
  ]);
  const ziel = path.join(WURZEL, "build", "pruefung-download.pdf");
  await download.saveAs(ziel);
  const kopf = fs.readFileSync(ziel).subarray(0, 5).toString();
  pruefe(kopf === "%PDF-", `PDF-Download funktioniert (${download.suggestedFilename()})`);
  pruefe(/^MI_[A-Za-z0-9_]+\.pdf$/.test(download.suggestedFilename()), "Dateiname nach Schema MI_<Kapitel>_<Lektion>_<Kurztitel>");

  console.log("Praesentationen");
  const links = await seite.$$eval(".lektion .knopf-haupt", (a) => a.map((x) => x.getAttribute("href")));
  for (const link of links) {
    seitenFehler.length = 0;
    await seite.goto(BASIS + link);
    await seite.waitForFunction(() => window.Reveal && Reveal.isReady(), null, { timeout: 30000 });
    const anzahl = await seite.evaluate(() => Reveal.getTotalSlides());
    pruefe(anzahl > 0 && seitenFehler.length === 0, `${link}: ${anzahl} Folien, keine Fehler ${seitenFehler.join(" ")}`);
    const bilderKaputt = await seite.$$eval(".reveal .slides img", (bilder) => bilder.filter((b) => b.complete && b.naturalWidth === 0).length);
    pruefe(bilderKaputt === 0, `${link}: alle Bilder geladen`);
    if (bilderOrdner) {
      const name = link.replace(/^.*p=/, "").replace(/[^a-z0-9]+/gi, "_");
      fs.mkdirSync(bilderOrdner, { recursive: true });
      for (let i = 0; i < anzahl; i++) {
        await seite.evaluate((n) => Reveal.slide(n), i);
        await seite.waitForTimeout(450);
        await seite.screenshot({ path: path.join(bilderOrdner, `${name}_${String(i + 1).padStart(2, "0")}.png`) });
      }
    }
  }

  console.log("Bedienung");
  await seite.goto(BASIS + links[0]);
  await seite.waitForFunction(() => window.Reveal && Reveal.isReady());
  const zeitFolie = await seite.evaluate(() => {
    const folien = Reveal.getSlides();
    return folien.findIndex((f) => f.hasAttribute("data-zeit"));
  });
  if (zeitFolie >= 0) {
    await seite.evaluate((n) => Reveal.slide(n), zeitFolie);
    await seite.keyboard.press("t");
    await seite.waitForTimeout(1200);
    pruefe(await seite.locator(".mi-countdown").isVisible(), "Countdown startet mit T");
    await seite.keyboard.press("Shift+T");
  }
  await seite.keyboard.press("d");
  pruefe(await seite.locator(".mi-leiste.offen").isVisible(), "Download-Leiste mit D");
  await seite.keyboard.press("b");
  pruefe(await seite.evaluate(() => Reveal.isPaused()), "Bildschirm schwarz mit B");
  await seite.keyboard.press("b");
  await seite.keyboard.press("Escape");
  pruefe(await seite.evaluate(() => Reveal.isOverview()), "Folienuebersicht mit Esc");
  await seite.keyboard.press("Escape");

  console.log("Referentenansicht");
  await seite.goto(BASIS + links[0] + "&referent=1");
  await seite.waitForSelector(".mi-dialog button.referent");
  const [fenster] = await Promise.all([kontext.waitForEvent("page"), seite.click(".mi-dialog button.referent")]);
  await fenster.waitForSelector("#current-slide iframe", { timeout: 20000 });
  const rahmen = fenster.frames().find((f) => /receiver/.test(f.url()));
  await rahmen.waitForFunction(() => window.Reveal && Reveal.isReady(), null, { timeout: 30000 });
  pruefe(true, "Referentenansicht zeigt die aktuelle Folie");
  await seite.keyboard.press("ArrowRight");
  await fenster.waitForTimeout(800);
  const notizen = await fenster.textContent(".speaker-controls-notes");
  pruefe(notizen !== null, "Notizenbereich vorhanden");
  if (bilderOrdner) await fenster.screenshot({ path: path.join(bilderOrdner, "referentenansicht.png") });
  await fenster.close();

  console.log("Beamer und Laptop");
  // Zwei Bildschirme simulieren: Laptop (eingebaut) links, Beamer rechts. Headless zeigt das Vollbild
  // nicht wirklich auf dem zweiten Bildschirm, geprueft wird die Verteilung der Fenster.
  const zwei = await chromium.launch({
    ...(process.env.CHROMIUM_PFAD ? { executablePath: process.env.CHROMIUM_PFAD } : {}),
    args: ["--screen-info={0,0 1280x800 isInternal=1}{1280,0 1920x1080}"]
  });
  try {
    const kontext2 = await zwei.newContext({ viewport: null });
    const seite2 = await kontext2.newPage();
    const { targetInfo } = await (await kontext2.newCDPSession(seite2)).send("Target.getTargetInfo");
    await (await zwei.newBrowserCDPSession()).send("Browser.grantPermissions", {
      permissions: ["windowManagement"],
      origin: BASIS.replace(/\/$/, ""),
      browserContextId: targetInfo.browserContextId
    });
    await seite2.goto(BASIS + links[0] + "&referent=1");
    await seite2.waitForSelector(".mi-dialog button.beamer");
    const [notizen2] = await Promise.all([kontext2.waitForEvent("page"), seite2.click(".mi-dialog button.beamer")]);
    await notizen2.waitForSelector("#current-slide iframe", { timeout: 20000 });
    const lage = await notizen2.evaluate(() => [screenX, screenY, outerWidth, outerHeight]);
    pruefe(lage.join() === "0,0,1280,800", `Referentenansicht füllt den Laptop (${lage.join(", ")})`);
  } finally {
    await zwei.close();
  }

  console.log("Interaktive Tafel");
  seitenFehler.length = 0;
  await seite.goto(BASIS);
  await seite.waitForSelector(".knopf-tafel");
  const tafel = await seite.locator(".knopf-tafel").first().getAttribute("href");
  await seite.goto(BASIS + tafel + "&folie=2");
  await seite.waitForSelector(".element-folie iframe", { timeout: 20000 });
  const folienRahmen = seite.frames().find((f) => /tafel=1/.test(f.url()));
  await folienRahmen.waitForFunction(() => window.Reveal && Reveal.isReady(), null, { timeout: 30000 });
  pruefe((await folienRahmen.evaluate(() => Reveal.getIndices().h)) === 1, "Folie 2 liegt auf der Tafel");
  const folienAnzahl = await folienRahmen.evaluate(() => Reveal.getTotalSlides());
  pruefe((await seite.locator(".folie-eintrag").count()) === folienAnzahl, `Folienliste mit ${folienAnzahl} Folien`);
  await seite.click('[data-neu="text"]');
  await seite.keyboard.type("Prüftext");
  await seite.click('[data-neu="zufall"]');
  await seite.locator(".element-zufall textarea").fill("Anna\nBen");
  await seite.locator(".element-zufall .w-haupt").click();
  await seite.locator(".element-zufall .w-haupt").click();
  await seite.waitForTimeout(1200);
  pruefe(["Anna", "Ben"].includes(await seite.locator(".zufall-name").textContent()), "Zufallsgenerator zieht einen Namen");
  await seite.keyboard.press("z");
  const flaeche = await seite.locator("#tafel").boundingBox();
  await seite.mouse.move(flaeche.x + 100, flaeche.y + flaeche.height - 60);
  await seite.mouse.down();
  await seite.mouse.move(flaeche.x + 400, flaeche.y + flaeche.height - 80, { steps: 10 });
  await seite.mouse.up();
  pruefe((await seite.evaluate(() => MiTafel.zustand().striche.length)) === 1, "Zeichnen mit dem Stift");
  await seite.keyboard.press("Control+z");
  pruefe((await seite.evaluate(() => MiTafel.zustand().striche.length)) === 0, "Rückgängig mit Ctrl+Z");
  await seite.waitForTimeout(600);
  await seite.reload();
  await seite.waitForSelector(".element-text");
  pruefe((await seite.locator(".element-text .textfeld").textContent()) === "Prüftext", "Tafel bleibt nach Neuladen erhalten");
  if (bilderOrdner) await seite.screenshot({ path: path.join(bilderOrdner, "tafel.png") });
  pruefe(seitenFehler.length === 0, "Tafel ohne Fehler " + seitenFehler.join(" "));

} catch (e) {
  fehler++;
  console.error("  FEHLER " + e.message);
} finally {
  await browser.close();
  server.close();
}

if (fehler) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log("\nAlle Pruefungen bestanden.");
