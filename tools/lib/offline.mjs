// Erzeugt eine eigenstaendige HTML-Datei: reveal.js, Design, Schrift und Bilder sind eingebettet.
import fs from "node:fs";
import path from "node:path";
import { WURZEL } from "./inhalte.mjs";

const SITE = path.join(WURZEL, "site");
const REVEAL = path.join(SITE, "vendor", "reveal.js-5.2.1");

function lesen(datei) {
  return fs.readFileSync(datei, "utf8");
}

function dataUri(datei, typ) {
  return `data:${typ};base64,${fs.readFileSync(datei).toString("base64")}`;
}

/** Schriftverweise url("../fonts/x.woff2") durch eingebettete Daten ersetzen */
function schriftenEinbetten(css) {
  return css.replace(/url\("\.\.\/fonts\/([^"]+)"\)/g, (_, name) => `url("${dataUri(path.join(SITE, "fonts", name), "font/woff2")}")`);
}

/** Verhindert, dass ein eingebettetes Skript den <script>-Block vorzeitig beendet */
function skriptSicher(js) {
  return js.replace(/<\/script/gi, "<\\/script");
}

let bausteine = null;
function bausteineLaden() {
  if (bausteine) return bausteine;
  bausteine = {
    css: [
      lesen(path.join(REVEAL, "reset.css")),
      lesen(path.join(REVEAL, "reveal.css")),
      schriftenEinbetten(lesen(path.join(SITE, "css", "basis.css"))),
      lesen(path.join(SITE, "css", "folien.css"))
    ].join("\n"),
    js: [
      lesen(path.join(REVEAL, "reveal.js")),
      lesen(path.join(REVEAL, "plugin", "markdown.js")),
      lesen(path.join(REVEAL, "plugin", "notes.js")),
      lesen(path.join(REVEAL, "plugin", "zoom.js")),
      lesen(path.join(SITE, "js", "folien.js"))
    ]
      .map(skriptSicher)
      .join("\n;\n")
  };
  return bausteine;
}

function htmlText(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Markdown mit eingebetteten Bildern (data:-Adressen) */
export function markdownMitBildern(lektion) {
  let md = lektion.markdown;
  const namen = Object.keys(lektion.bilder).sort((a, b) => b.length - a.length);
  for (const name of namen) {
    const b = lektion.bilder[name];
    md = md.split(name).join(dataUri(b.pfad, b.typ));
  }
  return md;
}

export function offlineHtml(lektion) {
  const { css, js } = bausteineLaden();
  const daten = {
    markdown: markdownMitBildern(lektion),
    titel: lektion.titel,
    nummer: lektion.nummer
  };
  const json = JSON.stringify(daten).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${htmlText(lektion.titel)}</title>
<style>
${css}
</style>
</head>
<body>
<div class="reveal"><div class="slides"></div></div>
<script id="praesentation-daten" type="application/json">${json}</script>
<script>
${js}
</script>
<script>
(function () {
  var daten = JSON.parse(document.getElementById("praesentation-daten").textContent);
  MiFolien.starten({ markdown: daten.markdown, titel: daten.titel, nummer: daten.nummer });
})();
</script>
</body>
</html>
`;
}
