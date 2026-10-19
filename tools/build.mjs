#!/usr/bin/env node
/*
 * Baut die ganze Website:
 *   1. liest inhalte/kapitel.json und alle Markdown-Dateien
 *   2. erzeugt pro Praesentation HTML (offline), PDF, PDF mit Notizen und PPTX
 *   3. erzeugt pro Kapitel ein ZIP mit allen HTML-Exporten
 *   4. verschluesselt alles mit dem Passwort und schreibt die oeffentliche Seite nach build/site
 *
 * Aufruf:
 *   SITE_PASSWORT=geheim node tools/build.mjs
 *   node tools/build.mjs --passwort geheim [--schnell] [--nur k1/l2-bewertungen-datenstau]
 *
 *   --schnell  ohne PDF und PPTX (fuer eine rasche Vorschau)
 *   --nur      nur diese Praesentation(en) exportieren (Pfad wie im Viewer, mehrfach moeglich)
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { WURZEL, inhalteLaden, folienZaehlen } from "./lib/inhalte.mjs";
import { offlineHtml } from "./lib/offline.mjs";
import { browserStarten, exporteErstellen } from "./lib/exporte.mjs";
import { RUNDEN, schluesselAbleiten, verschluesseln, geheimerName, neuesSalz } from "./lib/krypto.mjs";

const TYP = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  html: "text/html",
  zip: "application/zip",
  md: "text/markdown"
};

function argumente() {
  const a = process.argv.slice(2);
  const optionen = { schnell: false, nur: [], passwort: process.env.SITE_PASSWORT || "", ausgabe: path.join(WURZEL, "build") };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--schnell") optionen.schnell = true;
    else if (a[i] === "--passwort") optionen.passwort = a[++i] || "";
    else if (a[i] === "--nur") optionen.nur.push((a[++i] || "").replace(/\.md$/, ""));
    else if (a[i] === "--ausgabe") optionen.ausgabe = path.resolve(a[++i]);
    else if (a[i] === "--hilfe" || a[i] === "-h") {
      console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
      process.exit(0);
    } else {
      console.error("Unbekannte Angabe: " + a[i]);
      process.exit(2);
    }
  }
  return optionen;
}

/** Salz und Runden fuer die Schluesselableitung. Bleiben gleich, damit Anmeldungen einen Build ueberleben. */
function zugangsDaten() {
  const datei = path.join(WURZEL, "tools", "zugang.json");
  if (!fs.existsSync(datei)) {
    const neu = { salz: neuesSalz(), runden: RUNDEN };
    fs.writeFileSync(datei, JSON.stringify(neu, null, 2) + "\n");
    console.log("Neues Salz in tools/zugang.json angelegt (bitte mit committen).");
    return neu;
  }
  return JSON.parse(fs.readFileSync(datei, "utf8"));
}

function kopieren(von, nach) {
  fs.mkdirSync(path.dirname(nach), { recursive: true });
  fs.cpSync(von, nach, { recursive: true });
}

function leeren(ordner) {
  fs.rmSync(ordner, { recursive: true, force: true });
  fs.mkdirSync(ordner, { recursive: true });
}

async function main() {
  const optionen = argumente();
  if (!optionen.passwort) {
    console.error(
      "Es fehlt das Passwort.\n" +
        "  Lokal:  node tools/build.mjs --passwort DEIN-PASSWORT\n" +
        "  GitHub: Secret SITE_PASSWORT im Quell-Repository anlegen (siehe README)."
    );
    process.exit(1);
  }
  if (optionen.passwort.length < 8) {
    console.warn("Warnung: Das Passwort ist kuerzer als 8 Zeichen. Ein laengeres Passwort ist deutlich sicherer.");
  }

  const start = Date.now();
  const kapitel = inhalteLaden();
  const zugang = zugangsDaten();
  const schluessel = schluesselAbleiten(optionen.passwort, zugang.salz, zugang.runden);

  const EXPORTE = path.join(optionen.ausgabe, "exporte");
  const SITE = path.join(optionen.ausgabe, "site");
  const DATEN = path.join(SITE, "daten");
  leeren(SITE);
  fs.mkdirSync(EXPORTE, { recursive: true });
  fs.mkdirSync(DATEN, { recursive: true });

  const geschrieben = new Set();
  /** Verschluesselt Daten und gibt den Namen der .bin-Datei zurueck */
  function ablegen(logischerPfad, daten) {
    const puffer = Buffer.isBuffer(daten) ? daten : Buffer.from(daten);
    const name = geheimerName(schluessel, logischerPfad, puffer);
    if (!geschrieben.has(name)) {
      fs.writeFileSync(path.join(DATEN, name), verschluesseln(schluessel, puffer));
      geschrieben.add(name);
    }
    return name;
  }

  const alleLektionen = kapitel.flatMap((k) => k.lektionen);
  const exportieren = (l) => !optionen.nur.length || optionen.nur.includes(l.pfad);
  console.log(`${alleLektionen.length} Praesentation(en) in ${kapitel.length} Kapiteln gefunden.`);

  let browser = null;
  if (!optionen.schnell && alleLektionen.some(exportieren)) {
    browser = await browserStarten();
  }

  const index = { erstellt: new Date().toISOString(), kapitel: [] };
  try {
    for (const k of kapitel) {
      const kapitelEintrag = { id: k.id, titel: k.titel, lektionen: [] };
      const zip = new JSZip();
      let zipLeer = true;

      for (const l of k.lektionen) {
        const ordner = path.join(EXPORTE, k.id);
        fs.mkdirSync(ordner, { recursive: true });
        const basis = path.join(ordner, l.basisName);
        const dateien = {
          html: basis + ".html",
          pdf: basis + ".pdf",
          pdfNotizen: basis + "_mit_Notizen.pdf",
          pptx: basis + ".pptx"
        };

        const html = offlineHtml(l);
        fs.writeFileSync(dateien.html, html);
        let folien = folienZaehlen(l.markdown);

        if (browser && exportieren(l)) {
          process.stdout.write(`  ${l.pfad}: PDF, PDF mit Notizen, PPTX ... `);
          const ergebnis = await exporteErstellen(
            browser,
            dateien.html,
            { pdf: dateien.pdf, pdfNotizen: dateien.pdfNotizen, pptx: dateien.pptx },
            { titel: l.titel }
          );
          folien = ergebnis.folien;
          console.log(`fertig (${folien} Folien)`);
        } else if (!browser) {
          console.log(`  ${l.pfad}: nur HTML (--schnell)`);
        }

        const downloads = {};
        const anbieten = (schluesselName, datei, name, typ) => {
          if (!fs.existsSync(datei)) return;
          downloads[schluesselName] = { datei: ablegen(`${l.pfad}/${schluesselName}`, fs.readFileSync(datei)), name, typ };
        };
        anbieten("pdf", dateien.pdf, l.basisName + ".pdf", TYP.pdf);
        anbieten("pdfNotizen", dateien.pdfNotizen, l.basisName + "_mit_Notizen.pdf", TYP.pdf);
        anbieten("pptx", dateien.pptx, l.basisName + ".pptx", TYP.pptx);
        anbieten("html", dateien.html, l.basisName + ".html", TYP.html);
        if (l.original) anbieten("original", l.original, l.basisName + "_Original.pptx", TYP.pptx);

        zip.file(l.basisName + ".html", html);
        zipLeer = false;

        const bilder = {};
        for (const [verweis, b] of Object.entries(l.bilder)) {
          bilder[verweis] = { datei: ablegen(`${l.pfad}/${verweis}`, fs.readFileSync(b.pfad)), typ: b.typ };
        }

        kapitelEintrag.lektionen.push({
          id: l.id,
          pfad: l.pfad,
          titel: l.titel,
          untertitel: l.untertitel,
          datum: l.datum,
          niveau: l.niveau,
          nummer: l.nummer,
          folien,
          suchtext: l.suchtext,
          md: ablegen(`${l.pfad}.md`, l.markdown),
          bilder,
          downloads
        });
      }

      if (!zipLeer) {
        const zipName = `MI_${k.kuerzel}_offline.zip`;
        const zipDaten = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
        fs.writeFileSync(path.join(EXPORTE, zipName), zipDaten);
        kapitelEintrag.zip = { datei: ablegen(`${k.id}/zip`, zipDaten), name: zipName, typ: TYP.zip };
      }
      index.kapitel.push(kapitelEintrag);
    }
  } finally {
    if (browser) await browser.close();
  }

  // Index und oeffentliche Zugangsdaten
  const indexName = ablegen("index", JSON.stringify(index));
  fs.writeFileSync(
    path.join(DATEN, "zugang.json"),
    JSON.stringify({ salz: zugang.salz, runden: zugang.runden, index: indexName }) + "\n"
  );

  // Oeffentliche Programmdateien
  const QUELLE = path.join(WURZEL, "site");
  for (const datei of ["index.html", "start.html", "praesentation.html"]) {
    kopieren(path.join(QUELLE, datei), path.join(SITE, datei));
  }
  for (const ordner of ["css", "js", "fonts"]) kopieren(path.join(QUELLE, ordner), path.join(SITE, ordner));
  const reveal = path.join("vendor", "reveal.js-5.2.1");
  for (const datei of ["reveal.js", "reveal.css", "reset.css", "LICENSE", "plugin/markdown.js", "plugin/notes.js", "plugin/zoom.js"]) {
    kopieren(path.join(QUELLE, reveal, datei), path.join(SITE, reveal, datei));
  }
  fs.writeFileSync(path.join(SITE, ".nojekyll"), "");
  fs.writeFileSync(path.join(SITE, "robots.txt"), "User-agent: *\nDisallow: /\n");

  // Kontrolle: keine Klartext-Inhalte in der oeffentlichen Seite
  const verboten = alleLektionen.map((l) => l.titel).filter((t) => t && t.length > 6);
  for (const datei of fs.readdirSync(SITE, { recursive: true })) {
    const voll = path.join(SITE, datei);
    if (!fs.statSync(voll).isFile() || voll.endsWith(".bin") || voll.endsWith(".woff2")) continue;
    const text = fs.readFileSync(voll, "utf8");
    for (const titel of verboten) {
      if (text.includes(titel)) throw new Error(`Sicherheitspruefung: Der Titel "${titel}" steht unverschluesselt in ${datei}.`);
    }
  }

  const sekunden = Math.round((Date.now() - start) / 1000);
  console.log(`Fertig in ${sekunden} s. Oeffentliche Seite: ${path.relative(WURZEL, SITE)}  Exporte (Klartext, nicht veroeffentlicht): ${path.relative(WURZEL, EXPORTE)}`);
}

main().catch((e) => {
  console.error("\nBuild fehlgeschlagen:\n" + (e && e.message ? e.message : e));
  process.exit(1);
});
