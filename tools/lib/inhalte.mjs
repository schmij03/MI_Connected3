// Liest inhalte/kapitel.json und die Markdown-Dateien und ergaenzt abgeleitete Angaben.
import fs from "node:fs";
import path from "node:path";

export const WURZEL = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
export const INHALTE = path.join(WURZEL, "inhalte");
export const QUELLEN = path.join(WURZEL, "quellen");

const BILD_TYPEN = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp"
};

export function bildTyp(datei) {
  return BILD_TYPEN[path.extname(datei).toLowerCase()] || null;
}

/** Umlaute ersetzen, alles ausser Buchstaben, Ziffern, _ und - entfernen */
export function dateinamenTeil(text) {
  return String(text || "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function grossAnfang(wort) {
  return wort ? wort.charAt(0).toUpperCase() + wort.slice(1) : wort;
}

/** Teilt wie reveal.js: "---" auf eigener Zeile, davor und danach eine Leerzeile */
export function folienTeilen(markdown) {
  return markdown.replace(/\r\n/g, "\n").split(/\n\n---\n(?=\n|$)/);
}

/** Zaehlt die Folien wie reveal.js: Trenner "---" auf eigener Zeile mit Leerzeilen davor und danach */
export function folienZaehlen(markdown) {
  return folienTeilen(markdown).filter((teil) => teil.trim() !== "").length;
}

/** Findet alle Bildverweise (bilder/...) im Markdown */
export function bildVerweise(markdown) {
  const treffer = new Set();
  const muster = /(?:^|[("'\s=])(bilder\/[^\s)"'<>]+)/g;
  let m;
  while ((m = muster.exec(markdown))) treffer.add(decodeURI(m[1]));
  return [...treffer];
}

/** Text fuer die Suche: Markdown ohne Steuerzeichen, Notizen und Bildpfade */
export function suchText(markdown) {
  return folienTeilen(markdown)
    .map((folie) => folie.split(/^Note:/m)[0])
    .join(" ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#*_>|`\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export function kapitelLesen() {
  const roh = fs.readFileSync(path.join(INHALTE, "kapitel.json"), "utf8");
  let daten;
  try {
    daten = JSON.parse(roh);
  } catch (e) {
    throw new Error("inhalte/kapitel.json ist kein gueltiges JSON: " + e.message);
  }
  if (!Array.isArray(daten.kapitel)) throw new Error("inhalte/kapitel.json: Es fehlt die Liste \"kapitel\".");
  return daten;
}

/**
 * Liefert alle Kapitel mit vollstaendig aufbereiteten Lektionen.
 * Wirft einen Fehler mit verstaendlicher Meldung, wenn etwas nicht stimmt.
 */
export function inhalteLaden() {
  const daten = kapitelLesen();
  const fehler = [];
  const ids = new Set();

  const kapitel = daten.kapitel.map((k) => {
    if (!k.id || !k.titel) fehler.push(`Ein Kapitel hat keine "id" oder keinen "titel".`);
    const kuerzel = dateinamenTeil(k.kuerzel || k.id.toUpperCase());
    const lektionen = (k.lektionen || []).map((l, position) => {
      const ort = `Kapitel "${k.id}", Lektion "${l.id || "?"}"`;
      if (!l.id) fehler.push(`${ort}: Es fehlt die "id".`);
      if (!l.titel) fehler.push(`${ort}: Es fehlt der "titel".`);
      const datei = l.datei || `${k.id}/${l.id}.md`;
      const mdPfad = path.join(INHALTE, datei);
      if (!fs.existsSync(mdPfad)) {
        fehler.push(`${ort}: Die Datei inhalte/${datei} gibt es nicht.`);
        return null;
      }
      const pfad = datei.replace(/\.md$/, "");
      if (ids.has(pfad)) fehler.push(`${ort}: Die Datei ${datei} ist doppelt eingetragen.`);
      ids.add(pfad);

      const markdown = fs.readFileSync(mdPfad, "utf8").replace(/\r\n/g, "\n");
      const nummerTreffer = String(l.id || "").match(/^l(\d+)/i);
      const nummer = l.nummer != null ? String(l.nummer) : nummerTreffer ? nummerTreffer[1] : "";
      const kurz =
        dateinamenTeil(l.kurztitel) ||
        dateinamenTeil(
          String(l.id || "")
            .replace(/^l\d+[-_]?/i, "")
            .split(/[-_]/)
            .map(grossAnfang)
            .join("_")
        ) ||
        dateinamenTeil(l.titel);
      const basisName = ["MI", kuerzel, nummer ? "L" + nummer : "", kurz].filter(Boolean).join("_");

      const ordner = path.dirname(mdPfad);
      const bilder = {};
      for (const verweis of bildVerweise(markdown)) {
        const bildPfad = path.join(ordner, verweis);
        if (!fs.existsSync(bildPfad)) {
          fehler.push(`${ort}: Das Bild ${verweis} fehlt (erwartet in inhalte/${path.dirname(datei)}/${verweis}).`);
          continue;
        }
        const typ = bildTyp(bildPfad);
        if (!typ) {
          fehler.push(`${ort}: Das Bildformat von ${verweis} wird nicht unterstuetzt.`);
          continue;
        }
        bilder[verweis] = { pfad: bildPfad, typ };
      }

      // "original" ist ein Dateiname oder eine Liste (Praesentation aus mehreren PowerPoint-Dateien)
      const originale = [];
      for (const name of [].concat(l.original || [])) {
        const o = path.join(QUELLEN, name);
        if (fs.existsSync(o)) originale.push(o);
        else console.warn(`Hinweis: ${ort}: Original quellen/${name} nicht gefunden, Button entfaellt.`);
      }

      return {
        id: l.id,
        pfad,
        kapitel: k.id,
        titel: l.titel,
        untertitel: l.untertitel || "",
        datum: l.datum || "",
        niveau: l.niveau || "",
        nummer,
        position,
        markdown,
        mdPfad,
        bilder,
        originale,
        basisName,
        suchtext: suchText(markdown)
      };
    });

    const gefiltert = lektionen.filter(Boolean);
    // Innerhalb des Kapitels nach Datum sortieren, Lektionen ohne Datum am Schluss
    gefiltert.sort((a, b) => {
      if (a.datum && b.datum && a.datum !== b.datum) return a.datum < b.datum ? -1 : 1;
      if (a.datum && !b.datum) return -1;
      if (!a.datum && b.datum) return 1;
      const na = parseInt(a.nummer, 10);
      const nb = parseInt(b.nummer, 10);
      if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
      return a.position - b.position;
    });
    return { id: k.id, titel: k.titel, kuerzel, lektionen: gefiltert };
  });

  if (fehler.length) {
    const e = new Error("Fehler in den Inhalten:\n  - " + fehler.join("\n  - "));
    e.liste = fehler;
    throw e;
  }
  return kapitel;
}
