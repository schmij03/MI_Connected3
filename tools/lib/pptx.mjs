// Baut aus den ausgemessenen Folien (messen.js) eine PowerPoint-Datei mit echten Textfeldern.
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";

const PX_ZU_ZOLL = 13.333 / 1280; // Folie 16:9, 13,333 x 7,5 Zoll
const PX_ZU_PT = 0.75;
const SCHRIFT = "Calibri";

function zoll(wert) {
  return Math.round(wert * PX_ZU_ZOLL * 10000) / 10000;
}

function pt(wert) {
  return Math.round(wert * PX_ZU_PT * 10) / 10;
}

/** Ein Absatz aus messen.js als Laeufe fuer pptxgenjs */
function absatzLaeufe(absatz, istLetzter) {
  const ergebnis = [];
  const absatzOptionen = {
    align: absatz.ausrichtung === "center" ? "center" : absatz.ausrichtung === "right" ? "right" : "left",
    paraSpaceAfter: pt(absatz.abstandNach || 0),
    lineSpacingMultiple: Math.max(0.8, Math.min(2, (absatz.zeilenhoehe || 1.2) / 1.22))
  };
  if (absatz.aufzaehlung) {
    const einzug = pt(absatz.einzug || 30);
    absatzOptionen.bullet =
      absatz.aufzaehlung === "zahl"
        ? { type: "number", numberStartAt: absatz.start || 1, indent: einzug }
        : { code: "2022", indent: einzug };
    if (absatz.ebene) absatzOptionen.indentLevel = absatz.ebene;
  }
  const laeufe = absatz.laeufe.length ? absatz.laeufe : [{ text: " ", groesse: absatz.groesse, farbe: absatz.farbe }];
  laeufe.forEach((lauf) => {
    // Absatz-Optionen an jedem Lauf, sonst verliert PowerPoint z. B. Aufzaehlungszeichen
    const optionen = { ...absatzOptionen };
    if (lauf.umbruch) {
      ergebnis.push({ text: "", options: { ...optionen, softBreakBefore: true } });
      return;
    }
    optionen.lang = "de-CH";
    optionen.fontSize = pt(lauf.groesse || absatz.groesse);
    optionen.color = lauf.farbe || absatz.farbe;
    optionen.bold = !!lauf.fett;
    optionen.italic = !!lauf.kursiv;
    if (lauf.link) optionen.hyperlink = { url: lauf.link };
    ergebnis.push({ text: lauf.text, options: optionen });
  });
  if (!istLetzter && ergebnis.length) {
    ergebnis[ergebnis.length - 1].options.breakLine = true;
  }
  return ergebnis;
}

function textForm(pptx, folie, form) {
  const laeufe = [];
  form.absaetze.forEach((absatz, i) => {
    laeufe.push(...absatzLaeufe(absatz, i === form.absaetze.length - 1));
  });
  if (!laeufe.length) return;
  // Etwas Reserve in der Breite, damit PowerPoint nicht frueher umbricht als der Browser
  const reserve = form.einzeilig ? 0.06 : 0.025;
  const breite = form.w * (1 + reserve);
  const x = form.mitte ? form.x - (breite - form.w) / 2 : form.absaetze[0].ausrichtung === "center" ? form.x - (breite - form.w) / 2 : form.x;
  folie.addText(laeufe, {
    x: zoll(x),
    y: zoll(form.y),
    w: zoll(breite),
    h: zoll(Math.max(form.h, 10)),
    margin: 0,
    valign: form.mitte ? "middle" : "top",
    fontFace: form.schrift || SCHRIFT,
    wrap: !form.einzeilig,
    fit: "none",
    autoFit: false
  });
}

function rechteckForm(pptx, folie, form) {
  const istPille = form.radius && form.radius >= form.h / 2 - 1;
  let art = pptx.ShapeType.rect;
  const optionen = {
    x: zoll(form.x),
    y: zoll(form.y),
    w: zoll(form.w),
    h: zoll(form.h),
    fill: { color: form.farbe },
    line: { color: form.farbe, width: 0 }
  };
  if (form.art === "ellipse") art = pptx.ShapeType.ellipse;
  else if (form.radius > 0.5) {
    art = pptx.ShapeType.roundRect;
    optionen.rectRadius = istPille ? zoll(form.h / 2) : zoll(form.radius);
  }
  folie.addShape(art, optionen);
}

function tabellenForm(folie, form) {
  const zeilen = form.zeilen.map((zeile) =>
    zeile.zellen.map((zelle) => {
      const a = zelle.absatz;
      const laeufe = absatzLaeufe({ ...a, abstandNach: 0 }, true);
      return {
        text: laeufe,
        options: {
          fill: zelle.fuellung ? { color: zelle.fuellung } : undefined,
          color: a.farbe,
          bold: a.fett,
          fontSize: pt(a.groesse),
          margin: zelle.innen.map((wert) => pt(wert)),
          valign: "top"
        }
      };
    })
  );
  folie.addTable(zeilen, {
    x: zoll(form.x),
    y: zoll(form.y),
    w: zoll(form.w),
    colW: form.spalten.map(zoll),
    rowH: form.zeilen.map((z) => zoll(z.h)),
    fontFace: SCHRIFT,
    border: { type: "solid", pt: Math.max(0.5, pt(form.rand ? form.rand.breite : 1)), color: form.rand ? form.rand.farbe : "D9D9D9" },
    autoPage: false
  });
}

/**
 * @param folien Ergebnis von miFolienMessen()
 * @param meta { titel, autor }
 * @returns Buffer der .pptx-Datei
 */
export async function pptxErstellen(folien, meta) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = meta.titel || "";
  pptx.subject = "Medien und Informatik";
  pptx.author = meta.autor || "";
  pptx.company = "";
  pptx.theme = { headFontFace: SCHRIFT, bodyFontFace: SCHRIFT };

  for (const daten of folien) {
    const folie = pptx.addSlide();
    folie.background = { color: daten.hintergrund || "FFFFFF" };
    for (const form of daten.formen) {
      if (form.art === "rechteck" || form.art === "ellipse") rechteckForm(pptx, folie, form);
      else if (form.art === "text") textForm(pptx, folie, form);
      else if (form.art === "bild") {
        folie.addImage({
          data: form.daten.replace(/^data:/, ""),
          x: zoll(form.x),
          y: zoll(form.y),
          w: zoll(form.w),
          h: zoll(form.h),
          altText: form.alt || ""
        });
      } else if (form.art === "tabelle") tabellenForm(folie, form);
    }
    if (daten.notizen) folie.addNotes(daten.notizen);
  }
  const puffer = await pptx.write({ outputType: "nodebuffer", compression: true });
  return aufzaehlungenFaerben(puffer);
}

/** Aufzaehlungszeichen und Nummern in Textfarbe wie im Browser (pptxgenjs kennt dafuer keine Option) */
async function aufzaehlungenFaerben(puffer) {
  const zip = await JSZip.loadAsync(puffer);
  const farbe = '<a:buClr><a:srgbClr val="1F2933"/></a:buClr>';
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    let xml = await zip.file(name).async("string");
    xml = xml
      .replace(/<a:buChar /g, farbe + '<a:buSzPct val="100000"/><a:buChar ')
      .replace(/<a:buAutoNum /g, farbe + "<a:buAutoNum ");
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
