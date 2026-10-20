#!/usr/bin/env node
// Uebersetzt die Referentenansicht von reveal.js (plugin/notes.js) ins Deutsche
// und stellt die Uhr auf 24 Stunden um. Ausserdem lassen sich Lage und Groesse des Fensters
// ueber window.miNotizenFenster vorgeben (fuer Beamer und Laptop, siehe site/js/folien.js). Kann mehrfach ausgefuehrt werden.
// Nach einem Update von reveal.js einmal ausfuehren: node tools/reveal_anpassen.mjs
import fs from "node:fs";
import path from "node:path";
import { WURZEL } from "./lib/inhalte.mjs";

const DATEI = path.join(WURZEL, "site", "vendor", "reveal.js-5.2.1", "plugin", "notes.js");
const ERSETZEN = [
  ['label\\">Upcoming</span>', 'label\\">Nächste Folie</span>'],
  ['>Time <span class=\\"reset-button\\">Click to Reset</span>', '>Zeit <span class=\\"reset-button\\">Klicken setzt zurück</span>'],
  ["toLocaleTimeString( 'en-US', { hour12: true, hour: '2-digit', minute:'2-digit' } )", "toLocaleTimeString( 'de-CH', { hour: '2-digit', minute:'2-digit' } )"],
  ['>0:00 AM</span>', '>00:00</span>'],
  ['>Pacing – Time to finish current slide</h4>', '>Zeitplan: verbleibende Zeit für diese Folie</h4>'],
  ['<h4 class=\\"label\\">Notes</h4>', '<h4 class=\\"label\\">Notizen</h4>'],
  ["'default': 'Default'", "'default': 'Standard'"],
  ["'wide': 'Wide'", "'wide': 'Breit'"],
  ["'tall': 'Tall'", "'tall': 'Hoch'"],
  ["'notes-only': 'Notes only'", "'notes-only': 'Nur Notizen'"],
  ["layoutLabel.innerHTML = 'Layout'", "layoutLabel.innerHTML = 'Ansicht'"],
  [
    "Speaker view popup failed to open. Please make sure popups are allowed and reopen the speaker view.",
    "Die Referentenansicht konnte nicht geöffnet werden. Bitte Pop-ups für diese Seite erlauben und nochmals S drücken."
  ],
  ["Cross origin error.<br>The speaker window can only be opened from the same origin.", "Die Referentenansicht kann nur aus derselben Website geöffnet werden."],
  ["Error connecting to main window.<br>Please try closing and reopening the speaker view.", "Keine Verbindung zur Präsentation.<br>Bitte dieses Fenster schliessen und mit S neu öffnen."],
  ["Loading speaker view...", "Referentenansicht wird geladen …"],
  [
    'n=window.open("about:blank","reveal.js - Notes","width=1100,height=700"),',
    'n=window.open("about:blank","reveal.js - Notes",window.miNotizenFenster||"width=1100,height=700"),window.miNotizen=n,'
  ]
];

let text = fs.readFileSync(DATEI, "utf8");
let geaendert = 0;
for (const [alt, neu] of ERSETZEN) {
  if (text.includes(alt)) {
    text = text.split(alt).join(neu);
    geaendert++;
  } else if (!text.includes(neu)) {
    console.warn("Nicht gefunden: " + alt.slice(0, 60));
  }
}
fs.writeFileSync(DATEI, text);
console.log(`${geaendert} Stelle(n) angepasst in ${path.relative(WURZEL, DATEI)}`);
