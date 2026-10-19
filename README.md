# MI Präsentationen (connected 3, 1. Sek)

Passwortgeschützte Website für alle Unterrichtspräsentationen in Medien und Informatik.
Die Präsentationen laufen im Browser (reveal.js) und lassen sich als PDF, PDF mit Notizen,
PPTX und eigenständige HTML-Datei herunterladen.

## So funktioniert es

```
Dieses Repository (privat)                         Pages-Repository (öffentlich)
quellen/   Original-PowerPoint                     index.html  Anmeldung
inhalte/   Markdown, Bilder, kapitel.json  ──────► start.html, praesentation.html, css/, js/
site/      Startseite, Viewer, Design     Build    daten/*.bin  alles verschlüsselt
tools/     Skripte                       (GitHub   robots.txt, .nojekyll
                                          Actions)
```

Bei jedem Push auf den Hauptbranch läuft `.github/workflows/build.yml`:

1. Neue PowerPoint-Dateien in `quellen/` werden automatisch in Markdown umgewandelt.
2. Für jede Präsentation entstehen HTML (offline), PDF, PDF mit Notizen und PPTX, pro Kapitel ein ZIP.
3. Alles wird mit dem Passwort verschlüsselt (AES-256-GCM, Schlüssel aus PBKDF2-SHA-256 mit 600 000 Runden).
4. Ein Browsertest prüft Anmeldung, Startseite, alle Präsentationen und die Downloads.
5. Das Ergebnis geht mit dem Deploy Key ins Pages-Repository.

Im Pages-Repository steht kein lesbarer Inhalt: keine Titel, keine Texte, keine Bilder, keine Dateinamen.
Wer das Passwort nicht kennt, sieht nur die Anmeldeseite und verschlüsselte `.bin`-Dateien.

## Einrichtung (einmalig)

1. **Pages-Repository anlegen:** Auf GitHub ein neues, **öffentliches** Repository `mi-praesentationen` erstellen
   (ohne README). Unter *Settings > Pages* als Quelle *Deploy from a branch*, Branch `main`, Ordner `/ (root)` wählen.
   Das geht erst nach dem ersten Build, wenn der Branch `main` existiert.
2. **Deploy Key erzeugen** (im Terminal):
   ```
   ssh-keygen -t ed25519 -C "mi-praesentationen" -f pages_key -N ""
   ```
   - Im **Pages-Repository** unter *Settings > Deploy keys > Add deploy key* den Inhalt von `pages_key.pub`
     einfügen und **Allow write access** ankreuzen.
   - In **diesem Repository** unter *Settings > Secrets and variables > Actions > New repository secret*
     ein Secret `PAGES_DEPLOY_KEY` mit dem Inhalt von `pages_key` (ohne `.pub`) anlegen.
   - Danach beide Dateien löschen.
3. **Passwort festlegen:** ebenfalls als Secret, Name `SITE_PASSWORT`. Mindestens 12 Zeichen, am besten
   mehrere Wörter. Wer das Passwort kennt, kann alles lesen. Es lässt sich jederzeit ändern: Secret neu setzen
   und den Workflow unter *Actions > Website bauen > Run workflow* starten. Danach müssen sich alle neu anmelden.
4. Heisst das Pages-Repository anders als `mi-praesentationen`, unter *Settings > Secrets and variables >
   Actions > Variables* eine Variable `PAGES_REPOSITORY` mit `benutzer/name` anlegen.
5. Einen Commit auf den Hauptbranch pushen oder den Workflow von Hand starten. Nach etwa drei Minuten ist die
   Seite unter `https://<benutzer>.github.io/mi-praesentationen/` erreichbar.

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
python tools/pptx_zu_md.py quellen/datei.pptx --kapitel k1 --id l2-bewertungen-datenstau --datum 2026-09-22
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
| Alt + Klick | Zoom |

Der Button «Referentenansicht» auf der Startseite öffnet die Präsentation mit einem Hinweis; ein Klick öffnet dann
das Notizenfenster. Browser erlauben neue Fenster nur nach einem Klick. Erscheint nichts, Pop-ups für die Seite erlauben.

Die HTML-Datei (offline) enthält alles: Schrift, Bilder und reveal.js. Sie funktioniert per Doppelklick ohne Internet,
auch die Referentenansicht. «Kapitel offline (ZIP)» enthält alle HTML-Dateien eines Kapitels.

## Dateinamen beim Download

`MI_<Kapitel>_<Lektion>_<Kurztitel>`, ohne Umlaute, Leer- und Sonderzeichen, zum Beispiel
`MI_K1_L2_Bewertungen_Datenstau.pdf`, `..._mit_Notizen.pdf`, `.pptx`, `.html`, `..._Original.pptx`,
`MI_K1_offline.zip`. Der Kurztitel kommt aus der ID (`l2-bewertungen-datenstau`) oder aus dem Feld `kurztitel`.

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
node tools/build.mjs --passwort test1234            # alles bauen, --schnell ohne PDF/PPTX
npm run vorschau                                    # http://localhost:8080
node tools/pruefen.mjs --passwort test1234          # Browsertest
python -m unittest discover tools/tests             # Konvertertest
```

`build/exporte/` enthält die unverschlüsselten Exporte zum Ansehen, `build/site/` die veröffentlichte Seite.
Der Ordner `build/` wird nicht eingecheckt.

## Technik

| Teil | Datei |
|---|---|
| Anmeldung, Startseite, Viewer | `site/index.html`, `site/start.html`, `site/praesentation.html?p=k1/l2-...` |
| Entschlüsselung im Browser | `site/js/krypto.js` (Web Crypto API) |
| Folienlayouts, Countdown, Download-Leiste | `site/js/folien.js`, `site/css/folien.css` |
| reveal.js 5.2.1 mit Markdown, Notes, Zoom | `site/vendor/reveal.js-5.2.1/` (Referentenansicht übersetzt mit `tools/reveal_anpassen.mjs`) |
| Build, Exporte, Verschlüsselung | `tools/build.mjs`, `tools/lib/` |
| PowerPoint zu Markdown | `tools/pptx_zu_md.py`, `tools/neue_quellen.py` |

Das PPTX wird aus der Darstellung im Browser erzeugt: Jede Folie wird ausgemessen und mit echten Textfeldern,
Tabellen und Bildern nachgebaut, damit sie in PowerPoint bearbeitbar bleibt.

Hinweise zur Sicherheit: Die Verschlüsselung schützt die Inhalte gut, solange das Passwort stark ist. Nach dem
Anmelden liegt der abgeleitete Schlüssel (nicht das Passwort) im Browser, bei «angemeldet bleiben» dauerhaft.
Auf fremden Geräten deshalb immer «Abmelden». Die Exporte des Workflows (Artefakt «exporte») sind unverschlüsselt
und nur für Personen mit Zugriff auf dieses private Repository sichtbar; sie werden nach 7 Tagen gelöscht.
