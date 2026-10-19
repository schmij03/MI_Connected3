#!/usr/bin/env node
// Zeigt die gebaute Seite (build/site) lokal im Browser: http://localhost:8080
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WURZEL } from "./lib/inhalte.mjs";

const ORDNER = path.join(WURZEL, "build", "site");
const PORT = parseInt(process.env.PORT || process.argv[2] || "8080", 10);
const TYPEN = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".bin": "application/octet-stream"
};

if (!fs.existsSync(ORDNER)) {
  console.error("Zuerst bauen: node tools/build.mjs --passwort DEIN-PASSWORT");
  process.exit(1);
}

http
  .createServer((anfrage, antwort) => {
    let pfad = decodeURIComponent(new URL(anfrage.url, "http://x").pathname);
    if (pfad.endsWith("/")) pfad += "index.html";
    const datei = path.join(ORDNER, path.normalize(pfad));
    if (!datei.startsWith(ORDNER) || !fs.existsSync(datei) || !fs.statSync(datei).isFile()) {
      antwort.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      antwort.end("Nicht gefunden");
      return;
    }
    antwort.writeHead(200, { "Content-Type": TYPEN[path.extname(datei)] || "application/octet-stream" });
    fs.createReadStream(datei).pipe(antwort);
  })
  .listen(PORT, () => console.log(`Vorschau: http://localhost:${PORT}  (beenden mit Ctrl+C)`));
