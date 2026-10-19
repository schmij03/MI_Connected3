// Erzeugt PDF, PDF mit Notizen und PPTX aus dem Offline-HTML mit einem Chromium-Browser (Playwright).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { pptxErstellen } from "./pptx.mjs";

const MESSEN = fs.readFileSync(new URL("./messen.js", import.meta.url), "utf8");

export async function browserStarten() {
  const optionen = {};
  // Lokal vorinstallierter Browser, falls vorhanden (z. B. ohne Download-Moeglichkeit)
  if (process.env.CHROMIUM_PFAD) optionen.executablePath = process.env.CHROMIUM_PFAD;
  return chromium.launch(optionen);
}

async function druckansichtLaden(browser, htmlDatei, mitNotizen) {
  const seite = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const fehler = [];
  seite.on("pageerror", (e) => fehler.push(e.message));
  const url = pathToFileURL(htmlDatei).href + "?print-pdf" + (mitNotizen ? "&notizen" : "");
  await seite.goto(url, { waitUntil: "load" });
  await seite.waitForFunction(() => window.Reveal && window.Reveal.isReady(), null, { timeout: 30000 });
  // reveal.js baut die Druckseiten nach "ready" asynchron auf
  await seite.waitForFunction(() => document.querySelectorAll(".pdf-page").length > 0, null, { timeout: 30000 });
  await seite.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.complete ? null : new Promise((ok) => {
          img.onload = img.onerror = ok;
        })
      )
    );
  });
  await seite.waitForTimeout(300);
  if (fehler.length) throw new Error("Fehler in der Praesentation " + path.basename(htmlDatei) + ": " + fehler.join("; "));
  return seite;
}

async function pdfDrucken(seite, ziel) {
  await seite.pdf({ path: ziel, printBackground: true, preferCSSPageSize: true });
}

/**
 * @returns { folien: Anzahl Folien }
 */
export async function exporteErstellen(browser, htmlDatei, ziele, meta) {
  const seite = await druckansichtLaden(browser, htmlDatei, false);
  const anzahl = await seite.evaluate(() => window.Reveal.getTotalSlides());
  if (ziele.pdf) await pdfDrucken(seite, ziele.pdf);
  if (ziele.pptx) {
    await seite.addScriptTag({ content: MESSEN });
    const folien = await seite.evaluate(() => window.miFolienMessen());
    const puffer = await pptxErstellen(folien, meta);
    fs.writeFileSync(ziele.pptx, puffer);
  }
  await seite.close();

  if (ziele.pdfNotizen) {
    const mitNotizen = await druckansichtLaden(browser, htmlDatei, true);
    await pdfDrucken(mitNotizen, ziele.pdfNotizen);
    await mitNotizen.close();
  }
  return { folien: anzahl };
}
