# MI Präsentationen (connected 3, 1. Sek)

Öffentliche Website für alle Unterrichtspräsentationen in Medien und Informatik.
Die Präsentationen laufen im Browser (reveal.js) und lassen sich als PDF, PDF mit Notizen,
PPTX und eigenständige HTML-Datei herunterladen.

## So funktioniert es

```
Dieses Repository (öffentlich)                        GitHub Pages
quellen/   Original-PowerPoint                        index.html          Startseite
inhalte/   Markdown, Bilder, kapitel.json  ────────►  praesentation.html  Viewer
site/      Startseite, Viewer, Design      Build      daten/              Präsentationen und Downloads
tools/     Skripte                         (GitHub    css/, js/, fonts/, vendor/
                                            Actions)
```

Bei jedem Push auf den Hauptbranch läuft `.github/workflows/build.yml`:

1. Neue PowerPoint-Dateien in `quellen/` werden automatisch in Markdown umgewandelt.
2. Für jede Präsentation entstehen HTML (offline), PDF, PDF mit Notizen und PPTX, pro Kapitel ein ZIP.
3. Ein Browsertest prüft Startseite, alle Präsentationen und die Downloads.
4. GitHub Pages veröffentlicht das Ergebnis direkt aus diesem Repository.

Alles ist öffentlich: dieses Repository mit den Original-PowerPoint-Dateien, den Notizen und den Bildern
genauso wie die Website. `robots.txt` und `noindex` halten Suchmaschinen fern, sind aber kein Schutz.
Bilder aus dem Lehrmittel connected 3 (© Lehrmittelverlag Zürich) und andere geschützte Bilder deshalb nur
einbinden, wenn sie öffentlich gezeigt werden dürfen.

## Einrichtung (einmalig)

Settings → Pages → Build and deployment → Source: «GitHub Actions».

Danach einen Commit auf den Hauptbranch pushen oder unter *Actions > Website bauen > Run workflow* starten.
Nach etwa drei Minuten ist die Seite unter `https://schmij03.github.io/MI_Connected3/` erreichbar.
Secrets oder ein zweites Repository braucht es nicht.

## Neue Präsentation ergänzen

### Variante A: PowerPoint hochladen (ohne Programmierkenntnisse)

1. Die Datei nach dem Schema `MI_<Kapitel>_<Lektion>_<Kurztitel>.pptx` benennen, zum Beispiel
   `MI_K2_L4_Smartphone_Sensoren.pptx` oder `MI_K1_L5_NiveauA_Datenpakete.pptx`.
   Kapitel: `Einfuehrung`, `K1` bis `K5`, `Word`.
2. Auf GitHub den Ordner `quellen/` öffnen, *Add file > Upload files*, Datei hineinziehen, *Commit changes*.
3. Der Workflow wandelt die Datei um, trägt sie in `inhalte/kapitel.json` ein und veröffentlicht sie.
4. Datum ergänzen: `inhalte/kapitel.json` auf GitHub öffnen, Stift-Symbol, beim neuen Eintrag
   `"datum": "2026-10-27",` einfügen, speichern. Ohne Datum steht die Lektion am Ende des Kapitels.
5. Präsentation auf der Website ansehen und wenn nötig die Markdown-Datei in `inhalte/` korrigieren (siehe unten).

Konnte der Workflow Kapitel oder Lektion nicht aus dem Namen lesen, steht ein Hinweis in der Zusammenfassung
des Laufs unter *Actions*. Bestehende Markdown-Dateien werden nie automatisch überschrieben.

### Variante B: Direkt in Markdown schreiben

1. `inhalte/vorlagen/muster.md` ansehen (zeigt alle Layouts) und als Vorlage kopieren, zum Beispiel nach
   `inhalte/k2/l4-sensoren.md`.
2. In `inhalte/kapitel.json` beim passenden Kapitel einen Eintrag ergänzen:
   ```json
   {
     "id": "l4-sensoren",
     "titel": "Was misst mein Smartphone?",
     "untertitel": "Sensoren im Alltag",
     "datum": "2026-11-03",
     "niveau": "A",
     "datei": "k2/l4-sensoren.md"
   }
   ```
   Bilder kommen nach `inhalte/k2/bilder/` und werden mit `![Beschreibung](bilder/name.png)` eingebunden.

### Variante C: Lokal umwandeln

```
pip install -r requirements.txt
python tools/pptx_zu_md.py quellen/datei.pptx --kapitel k1 --id l3-bewertungen-datenstau --datum 2026-09-22
```
Besteht eine Lektion aus mehreren PowerPoint-Dateien, kann `"original"` in `kapitel.json` auch eine Liste sein;
dann gibt es mehrere Buttons «Original Teil 1/2».

Weitere Angaben: `--titel`, `--untertitel`, `--niveau`, `--ueberschreiben` (ersetzt eine bestehende Datei,
Handkorrekturen gehen verloren). `python tools/pptx_zu_md.py --help` zeigt alles.

## Markdown-Format

```markdown
<!-- .slide: class="titel" -->
# Kann man Bewertungen trauen?

Und: Warum ruckelt das Video in den Ferien?

Note:
Notizen für die Referentenansicht.

---

## Normale Folie

- Aufzählung mit **fett** und *kursiv*
  - Unterpunkt (zwei Leerzeichen Einzug)

> Ein Zitat wird zum Hinweiskasten unten auf der Folie.
```

- Folien werden mit `---` auf einer eigenen Zeile getrennt (mit je einer Leerzeile davor und danach).
- Sprechernotizen beginnen mit einer Zeile `Note:`.
- Ausgeblendete Folien aus PowerPoint stehen in den Notizen der ersten Folie.

| Layout | Schreibweise | Wirkung |
|---|---|---|
| Titel | `<!-- .slide: class="titel" -->` | dunkelblauer Hintergrund, Lektionsnummer im orangen Kreis und «Lektion N» (aus `kapitel.json`; abweichend mit `data-nummer="3"`); Text nach `***` steht klein am unteren Rand |
| Frage | `<!-- .slide: class="frage" -->` | Impulsfolie auf blauem Grund |
| Auftrag | `<!-- .slide: class="auftrag" -->` | erste Liste mit `Auftrag: 1`, `Zeit:`, `Sozialform:`, `Material:`, `Arbeitsbuch:` wird zur Seitenleiste, rechts die Arbeitsschritte |
| Lösung | `<!-- .slide: class="loesung" -->` | grüner Rand und Band «Lösung»; `**1. Falsch: ...**` färbt «Falsch», «Richtig», «Möglich» |
| Merke | `<!-- .slide: class="merke" -->` | dunkle Merksatzfolie, Merksatz als `##`, Erklärung unten |
| Ziele | `<!-- .slide: class="ziele" -->` | nummerierte Liste als Kästen mit Nummernkreis («Das lernst du heute») |
| Karten | `<!-- .slide: class="karten" -->` | jede `### Überschrift` wird ein Kasten, bis 4 nebeneinander (mehr in Reihen, `data-spalten="2"` legt die Spaltenzahl fest); `***` beendet die Karten |
| Karten-Varianten | `class="karten nummeriert"`, `class="karten untereinander"` | Nummernkreise in den Karten, oder Kästen untereinander (z. B. «Zum Schluss») |
| Hervorheben | `### Titel <!-- .element: class="hervor" -->` | eine Karte dunkel hervorheben |
| Spalten | `<!-- .slide: class="spalten" -->` | Text links, Bild rechts; mit `***` selbst trennen |
| Kennzahl | `<!-- .slide: class="kennzahl" -->` | grosse Zahl als `###` links, Erklärung nach `***` rechts |
| Dicht | `class="... dicht"` | etwas kleinere Schrift für textreiche Folien (nie unter 24 px) |
| Zeitbadge | `<!-- .slide: data-zeit="7" -->` | oranger Kreis «7'» oben rechts, Countdown mit T |

Videos: `[![Beschreibung](bilder/vorschau.jpg)](https://www.youtube.com/watch?v=...)` zeigt ein Vorschaubild; ein Klick spielt das Video im Overlay auf der Folie ab (braucht Internet).

Klassen lassen sich kombinieren, zum Beispiel `class="auftrag loesung"`.

## Bedienung beim Präsentieren

| Taste | Funktion |
|---|---|
| Pfeiltasten, Leertaste | vor und zurück |
| F | Vollbild |
| Esc | Folienübersicht |
| S | Referentenansicht mit Notizen, nächster Folie und Uhr (eigenes Fenster) |
| B | Bildschirm schwarz |
| T | Countdown auf Folien mit Zeitangabe starten oder anhalten, Shift+T schliesst ihn |
| D | Download-Leiste (PDF, PPTX, HTML) ein- und ausblenden |
| W | aktuelle Folie auf der interaktiven Tafel öffnen (neuer Tab) |
| Alt + Klick | Zoom |

Der Button «Referentenansicht» auf der Startseite öffnet die Präsentation mit einem Hinweis; ein Klick öffnet dann
das Notizenfenster. Browser erlauben neue Fenster nur nach einem Klick. Erscheint nichts, Pop-ups für die Seite erlauben.

Die HTML-Datei (offline) enthält alles: Schrift, Bilder und reveal.js. Sie funktioniert per Doppelklick ohne Internet,
auch die Referentenansicht. «Kapitel offline (ZIP)» enthält alle HTML-Dateien eines Kapitels.

## Interaktive Tafel

Der Button «Interaktive Tafel» auf der Startseite (oder W in der Präsentation) öffnet `tafel.html?p=...`:
eine digitale Tafel nach dem Vorbild der fobizz-Tafel, mit den Folien der Präsentation in der Seitenleiste.

| Bereich | Funktion |
|---|---|
| Bearbeiten | Text, Notiz, Bild (auch Ctrl+V oder Hineinziehen), Link oder YouTube-Video, Timer, Stoppuhr, Zufallsgenerator, Gruppen, Würfel; Elemente an der Kopfleiste verschieben, am orangen Punkt vergrössern, duplizieren, löschen (Entf) |
| Folien | Klick in der Seitenleiste legt eine Folie auf die Tafel; im Element mit ‹ › blättern |
| Zeichnen (Z) | Stift, Textmarker, Radierer, sechs Farben, drei Dicken; schreibt über die ganze Tafel, auch über Folien |
| Hintergrund | Weiss, kariert, liniert, Punkte, Wandtafel, Dunkelblau |
| Rückgängig | Ctrl+Z, wiederholen mit Ctrl+Y |
| Datei | Tafel als JSON-Datei speichern, wieder öffnen (auch per Hineinziehen), Tafel leeren |
| F | Vollbild |

Die Tafel wird automatisch im Browser gespeichert (eine Tafel pro Präsentation, `tafel.html` ohne `?p=` ist
eine leere Tafel). Sie liegt nur auf diesem Gerät und in diesem Browser. Zum Weitergeben oder Sichern
«Datei > Tafel als Datei speichern» verwenden. Anders als bei fobizz gibt es kein Konto, keinen Server und
kein gemeinsames Bearbeiten in Echtzeit: Die Website ist statisch (GitHub Pages).

## Dateinamen beim Download

`MI_<Kapitel>_<Lektion>_<Kurztitel>`, ohne Umlaute, Leer- und Sonderzeichen, zum Beispiel
`MI_K1_L2_Bewertungen_Datenstau.pdf`, `..._mit_Notizen.pdf`, `.pptx`, `.html`, `..._Original.pptx`,
`MI_K1_offline.zip`. Der Kurztitel kommt aus der ID (`l3-bewertungen-datenstau`) oder aus dem Feld `kurztitel`.

## Farben

Die Farben stehen als Variablen oben in `site/css/basis.css` (`--dunkelblau`, `--petrol`, `--orange`,
`--hellgrau`). Aus einer PowerPoint-Datei auslesen und übernehmen:

```
python tools/pptx_zu_md.py quellen/datei.pptx --farben            # nur anzeigen
python tools/pptx_zu_md.py quellen/datei.pptx --farben-schreiben  # in basis.css übernehmen
```

Schrift: Calibri, sonst die metrisch gleiche Carlito (lokal in `site/fonts/`, SIL Open Font License).

## Lokal arbeiten

```
npm ci                                              # einmalig (Node.js 20 oder neuer)
npx playwright install chromium                     # einmalig
node tools/build.mjs                                # alles bauen, --schnell ohne PDF/PPTX
npm run vorschau                                    # http://localhost:8080
node tools/pruefen.mjs                              # Browsertest
python -m unittest discover tools/tests             # Konvertertest
```

`build/exporte/` enthält die Exporte zum Ansehen, `build/site/` die veröffentlichte Seite.
Der Ordner `build/` wird nicht eingecheckt.

## Technik

| Teil | Datei |
|---|---|
| Startseite, Viewer | `site/index.html`, `site/praesentation.html?p=k1/l2-...` |
| Folienlayouts, Countdown, Download-Leiste | `site/js/folien.js`, `site/css/folien.css` |
| Interaktive Tafel | `site/tafel.html`, `site/js/tafel.js`, `site/css/tafel.css` |
| reveal.js 5.2.1 mit Markdown, Notes, Zoom | `site/vendor/reveal.js-5.2.1/` (Referentenansicht übersetzt mit `tools/reveal_anpassen.mjs`) |
| Build und Exporte | `tools/build.mjs`, `tools/lib/` |
| PowerPoint zu Markdown | `tools/pptx_zu_md.py`, `tools/neue_quellen.py` |

Das PPTX wird aus der Darstellung im Browser erzeugt: Jede Folie wird ausgemessen und mit echten Textfeldern,
Tabellen und Bildern nachgebaut, damit sie in PowerPoint bearbeitbar bleibt.

Die Exporte jedes Workflow-Laufs liegen zusätzlich 7 Tage lang als Artefakt «exporte» unter *Actions*,
auch für Branches, die nicht veröffentlicht werden.
