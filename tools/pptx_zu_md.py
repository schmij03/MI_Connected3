#!/usr/bin/env python3
"""
Wandelt eine PowerPoint-Datei in eine Markdown-Praesentation fuer reveal.js um.

Aufruf:
  python tools/pptx_zu_md.py quellen/datei.pptx --kapitel k1 --id l2-bewertungen-datenstau

Weitere Angaben (alle freiwillig):
  --titel "..."        Titel auf der Startseite (sonst: Titel der ersten Folie)
  --untertitel "..."   Untertitel (sonst: Untertitel der ersten Folie)
  --datum 2026-09-22   Datum der Lektion
  --niveau B           Niveau (sonst aus dem Dateinamen, z. B. "NiveauB")
  --ueberschreiben     eine bestehende Markdown-Datei ersetzen (Handkorrekturen gehen verloren!)
  --farben             nur die Farben der Vorlage anzeigen, nichts umwandeln
  --farben-schreiben   Farben der Vorlage in site/css/basis.css uebernehmen

Ergebnis:
  inhalte/<kapitel>/<id>.md, Bilder in inhalte/<kapitel>/bilder/
  und ein neuer oder aktualisierter Eintrag in inhalte/kapitel.json.

Ausgeblendete Folien erscheinen nicht als Folie. Ihr Inhalt steht in den
Notizen der ersten Folie.
"""

from __future__ import annotations

import argparse
import colorsys
import io
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

try:
    from lxml import etree
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE, PP_PLACEHOLDER
    from pptx.opc.constants import RELATIONSHIP_TYPE as RT
    from pptx.util import Emu
except ImportError:  # pragma: no cover
    sys.exit("Bitte zuerst installieren: pip install -r requirements.txt")

WURZEL = Path(__file__).resolve().parent.parent
import os

# Fuer Tests umleitbar
INHALTE = Path(os.environ.get("MI_INHALTE", WURZEL / "inhalte"))
QUELLEN = Path(os.environ.get("MI_QUELLEN", WURZEL / "quellen"))
BASIS_CSS = WURZEL / "site" / "css" / "basis.css"

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

# Begriffe der Seitenleiste auf Auftragsfolien
SEITENLEISTE = [
    ("Auftrag", r"auftrag"),
    ("Zeit", r"zeit|dauer"),
    ("Sozialform", r"sozialform|arbeitsform"),
    ("Material", r"material(ien)?"),
    ("Arbeitsbuch", r"arbeitsbuch|ab|buch|lehrmittel|arbeitsheft"),
]
ZEIT_MUSTER = re.compile(r"^\s*(?:ca\.\s*)?(\d+(?:[.,]\d+)?)\s*(?:['’′]|min\.?|minuten)\s*$", re.I)


# ---------------------------------------------------------------- Farben


class Farben:
    """Loest Designfarben (schemeClr) der Vorlage in RGB auf."""

    def __init__(self, praesentation):
        self.schema: dict[str, str] = {}
        try:
            master = praesentation.slide_masters[0]
            theme = master.part.part_related_by(RT.THEME)
            wurzel = etree.fromstring(theme.blob)
            schema = wurzel.find(".//a:clrScheme", NS)
            for el in schema if schema is not None else []:
                name = etree.QName(el).localname
                kind = el[0] if len(el) else None
                if kind is None:
                    continue
                if etree.QName(kind).localname == "srgbClr":
                    self.schema[name] = kind.get("val").upper()
                elif etree.QName(kind).localname == "sysClr":
                    self.schema[name] = (kind.get("lastClr") or "000000").upper()
            # Farbzuordnung des Masters (bg1 -> lt1 usw.)
            karte = master._element.find("p:clrMap", NS)
            zuordnung = dict(karte.attrib) if karte is not None else {}
        except Exception:
            zuordnung = {}
        standard = {"bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2"}
        for alias, ziel in standard.items():
            ziel = zuordnung.get(alias, ziel)
            if ziel in self.schema:
                self.schema[alias] = self.schema[ziel]

    @staticmethod
    def _anpassen(hexwert: str, el) -> str:
        r, g, b = (int(hexwert[i : i + 2], 16) / 255 for i in (0, 2, 4))
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        for mod in el:
            name = etree.QName(mod).localname
            wert = int(mod.get("val", "100000")) / 100000
            if name == "lumMod":
                l *= wert
            elif name == "lumOff":
                l += wert
            elif name == "shade":
                l *= wert
            elif name == "tint":
                l = l + (1 - l) * (1 - wert)
        l = max(0.0, min(1.0, l))
        r, g, b = colorsys.hls_to_rgb(h, l, s)
        return "".join(f"{round(x * 255):02X}" for x in (r, g, b))

    def aus_fuellung(self, el) -> str | None:
        """el: ein Element, das a:solidFill enthaelt (oder selbst ist)."""
        if el is None:
            return None
        fill = el if etree.QName(el).localname == "solidFill" else el.find("a:solidFill", NS)
        if fill is None or not len(fill):
            return None
        farbe = fill[0]
        art = etree.QName(farbe).localname
        if art == "srgbClr":
            wert = farbe.get("val").upper()
        elif art == "schemeClr":
            wert = self.schema.get(farbe.get("val"))
        elif art == "sysClr":
            wert = (farbe.get("lastClr") or "000000").upper()
        else:
            wert = None
        if not wert:
            return None
        return self._anpassen(wert, farbe)


def helligkeit(hexwert: str | None) -> float:
    if not hexwert:
        return 1.0
    r, g, b = (int(hexwert[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def hintergrund(folie, farben: Farben) -> str | None:
    """Hintergrundfarbe der Folie, auch wenn sie vom Layout oder Master kommt."""
    for teil in (folie, folie.slide_layout, folie.slide_layout.slide_master):
        bg = teil._element.find("p:cSld/p:bg", NS)
        if bg is None:
            continue
        pr = bg.find("p:bgPr", NS)
        if pr is not None:
            farbe = farben.aus_fuellung(pr)
            if farbe:
                return farbe
            if pr.find("a:gradFill", NS) is not None:
                stopp = pr.find(".//a:gs", NS)
                if stopp is not None:
                    return farben.aus_fuellung(etree.fromstring(
                        b'<a:solidFill xmlns:a="%s">' % NS["a"].encode()
                        + b"".join(etree.tostring(k) for k in stopp)
                        + b"</a:solidFill>"
                    ))
            return None
        ref = bg.find("p:bgRef", NS)
        if ref is not None:
            return farben.aus_fuellung(etree.fromstring(
                b'<a:solidFill xmlns:a="%s">' % NS["a"].encode() + b"".join(etree.tostring(k) for k in ref) + b"</a:solidFill>"
            ))
    return None


def form_fuellung(form, farben: Farben) -> str | None:
    sp_pr = form._element.find(".//p:spPr", NS)
    if sp_pr is None:
        return None
    if sp_pr.find("a:noFill", NS) is not None:
        return None
    farbe = farben.aus_fuellung(sp_pr)
    if farbe:
        return farbe
    # Fuellung aus dem Formatvorlagen-Verweis (p:style/a:fillRef)
    ref = form._element.find("p:style/a:fillRef", NS)
    if ref is not None and ref.get("idx") not in (None, "0") and len(ref):
        return farben.aus_fuellung(etree.fromstring(
            b'<a:solidFill xmlns:a="%s">' % NS["a"].encode() + b"".join(etree.tostring(k) for k in ref) + b"</a:solidFill>"
        ))
    return None


# ---------------------------------------------------------------- Text


def md_escape(text: str) -> str:
    text = text.replace("\\", "\\\\")
    text = re.sub(r"([*_`\[\]])", r"\\\1", text)
    text = text.replace("<", "&lt;")
    return text


def zeilenanfang_escape(zeile: str) -> str:
    if re.match(r"^\s*([-+#>]|\d+[.)]\s)", zeile):
        return "\\" + zeile.lstrip()
    return zeile


def laeufe_zu_md(absatz) -> str:
    """Runs eines Absatzes mit fett/kursiv als Markdown."""
    teile: list[tuple[str, bool, bool]] = []
    for knoten in absatz._p.iterchildren():
        name = etree.QName(knoten).localname
        if name == "br":
            teile.append(("\n", False, False))
            continue
        if name not in ("r", "fld"):
            continue
        t = knoten.find("a:t", NS)
        text = t.text if t is not None and t.text else ""
        if not text:
            continue
        rpr = knoten.find("a:rPr", NS)
        fett = rpr is not None and rpr.get("b") in ("1", "true")
        kursiv = rpr is not None and rpr.get("i") in ("1", "true")
        if teile and teile[-1][1:] == (fett, kursiv) and teile[-1][0] != "\n":
            teile[-1] = (teile[-1][0] + text, fett, kursiv)
        else:
            teile.append((text, fett, kursiv))
    ergebnis = []
    ganzer_absatz_fett = all(f for t, f, _ in teile if t.strip()) and any(t.strip() for t, _, _ in teile)
    for text, fett, kursiv in teile:
        if text == "\n":
            ergebnis.append("<br>")
            continue
        vorne = text[: len(text) - len(text.lstrip())]
        hinten = text[len(text.rstrip()) :]
        kern = md_escape(text.strip())
        if not kern:
            ergebnis.append(text)
            continue
        if fett and not ganzer_absatz_fett:
            kern = f"**{kern}**"
        if kursiv:
            kern = f"*{kern}*"
        ergebnis.append(vorne + kern + hinten)
    md = "".join(ergebnis).replace("\u000b", "<br>")
    md = re.sub(r"[ \t]+", " ", md).strip()
    return md


def ist_fett(absatz) -> bool:
    runs = [r for r in absatz.runs if r.text.strip()]
    return bool(runs) and all(r.font.bold for r in runs)


@dataclass
class Absatz:
    text: str  # Markdown
    roh: str  # reiner Text
    ebene: int
    art: str  # "punkt", "zahl", "text"
    fett: bool = False


@dataclass
class Element:
    art: str  # "text", "titel", "untertitel", "bild", "tabelle", "sonst"
    x: int
    y: int
    w: int
    h: int
    absaetze: list[Absatz] = field(default_factory=list)
    fuellung: str | None = None
    platzhalter: str | None = None
    bild: str | None = None  # Markdown-Pfad
    alt: str = ""
    tabelle: list[list[str]] | None = None
    name: str = ""
    groesse: float = 0.0  # groesste Schrift in Punkt (0 = unbekannt)

    @property
    def roh(self) -> str:
        return "\n".join(a.roh for a in self.absaetze).strip()


def aufzaehlung(absatz, im_platzhalter: bool) -> str:
    ppr = absatz._p.find("a:pPr", NS)
    if ppr is not None:
        if ppr.find("a:buAutoNum", NS) is not None:
            return "zahl"
        if ppr.find("a:buChar", NS) is not None or ppr.find("a:buBlip", NS) is not None:
            return "punkt"
        if ppr.find("a:buNone", NS) is not None:
            return "text"
    return "punkt" if im_platzhalter else "text"


def absaetze_lesen(text_frame, im_platzhalter: bool) -> list[Absatz]:
    liste = []
    for p in text_frame.paragraphs:
        roh = "".join(r.text for r in p.runs).replace("\u000b", " ").strip()
        if not roh:
            continue
        liste.append(
            Absatz(
                text=laeufe_zu_md(p),
                roh=roh,
                ebene=p.level or 0,
                art=aufzaehlung(p, im_platzhalter),
                fett=ist_fett(p),
            )
        )
    return liste


# ---------------------------------------------------------------- Formen lesen


class Leser:
    def __init__(self, praesentation, kapitel: str, lektion: str, bildordner: Path):
        self.prs = praesentation
        self.farben = Farben(praesentation)
        self.breite = praesentation.slide_width or Emu(12192000)
        self.hoehe = praesentation.slide_height or Emu(6858000)
        self.lektion = lektion
        self.bildordner = bildordner
        self.bilder_gespeichert: dict[str, str] = {}
        self.warnungen: list[str] = []

    def bild_speichern(self, form, folien_nr: int, nummer: int) -> str | None:
        try:
            bild = form.image
        except Exception:
            return None
        daten = bild.blob
        endung = (bild.ext or "png").lower()
        if endung in ("wmf", "emf", "tiff", "tif"):
            umgewandelt = in_png(daten)
            if umgewandelt is None:
                self.warnungen.append(f"Folie {folien_nr}: Bildformat {endung} konnte nicht umgewandelt werden.")
                return None
            daten, endung = umgewandelt, "png"
        daten = zuschneiden(form, daten, endung)
        schluessel = f"{len(daten)}:{hash(daten)}"
        if schluessel in self.bilder_gespeichert:
            return self.bilder_gespeichert[schluessel]
        name = f"{self.lektion}-f{folien_nr:02d}-{nummer}.{'jpg' if endung == 'jpeg' else endung}"
        self.bildordner.mkdir(parents=True, exist_ok=True)
        (self.bildordner / name).write_bytes(daten)
        pfad = f"bilder/{name}"
        self.bilder_gespeichert[schluessel] = pfad
        return pfad

    def formen(self, folie, folien_nr: int) -> list[Element]:
        elemente: list[Element] = []
        zaehler = [0]

        def gehen(formen, dx=0, dy=0):
            for form in formen:
                try:
                    x = (form.left or 0) + dx
                    y = (form.top or 0) + dy
                    w = form.width or 0
                    h = form.height or 0
                except Exception:
                    x = y = w = h = 0
                if form.shape_type == MSO_SHAPE_TYPE.GROUP:
                    gehen(form.shapes)
                    continue
                platzhalter = None
                if form.is_placeholder:
                    try:
                        platzhalter = form.placeholder_format.type
                    except Exception:
                        platzhalter = None
                    # Position vom Layout uebernehmen, falls nicht gesetzt
                    if not w or not h:
                        x, y, w, h = 0, 0, int(self.breite), int(self.hoehe * 0.2)
                el = Element(art="sonst", x=int(x), y=int(y), w=int(w), h=int(h), name=form.name or "")
                el.fuellung = form_fuellung(form, self.farben)

                if getattr(form, "has_table", False) and form.has_table:
                    el.art = "tabelle"
                    el.tabelle = tabelle_lesen(form.table)
                    elemente.append(el)
                    continue
                if form.shape_type == MSO_SHAPE_TYPE.PICTURE or (
                    platzhalter == PP_PLACEHOLDER.PICTURE and hasattr(form, "image")
                ):
                    zaehler[0] += 1
                    pfad = self.bild_speichern(form, folien_nr, zaehler[0])
                    if pfad:
                        el.art = "bild"
                        el.bild = pfad
                        el.alt = bild_alt(form)
                        elemente.append(el)
                    continue
                if getattr(form, "has_chart", False) and form.has_chart:
                    self.warnungen.append(f"Folie {folien_nr}: Diagramm «{form.name}» wurde nicht uebernommen (bitte als Bild einfuegen).")
                    continue
                if form._element.tag.endswith("graphicFrame"):
                    self.warnungen.append(f"Folie {folien_nr}: Grafik «{form.name}» (z. B. SmartArt) wurde nicht uebernommen.")
                    continue
                if form.has_text_frame and form.text_frame.text.strip():
                    im_platzhalter = platzhalter in (PP_PLACEHOLDER.BODY, PP_PLACEHOLDER.OBJECT)
                    el.absaetze = absaetze_lesen(form.text_frame, im_platzhalter)
                    groessen = [r.font.size.pt for p in form.text_frame.paragraphs for r in p.runs if r.font.size]
                    el.groesse = max(groessen) if groessen else 0.0
                    if platzhalter in (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE):
                        el.art = "titel"
                    elif platzhalter == PP_PLACEHOLDER.SUBTITLE:
                        el.art = "untertitel"
                    elif platzhalter in (PP_PLACEHOLDER.SLIDE_NUMBER, PP_PLACEHOLDER.FOOTER, PP_PLACEHOLDER.DATE):
                        continue
                    else:
                        el.art = "text"
                    el.platzhalter = str(platzhalter) if platzhalter else None
                    elemente.append(el)
                    continue
                if el.fuellung:
                    # Leere farbige Form (z. B. Kasten hinter Text), fuer die Erkennung behalten
                    el.art = "flaeche"
                    elemente.append(el)

        gehen(folie.shapes)
        return elemente


def bild_alt(form) -> str:
    try:
        cnv = form._element.find(".//p:cNvPr", NS)
        text = (cnv.get("descr") or "").strip() if cnv is not None else ""
    except Exception:
        text = ""
    if not text or len(text) > 200 or "automatisch generiert" in text.lower():
        text = ""
    return text.replace("\n", " ").replace("]", ")").replace("[", "(")


def in_png(daten: bytes) -> bytes | None:
    try:
        from PIL import Image

        bild = Image.open(io.BytesIO(daten))
        aus = io.BytesIO()
        bild.save(aus, "PNG")
        return aus.getvalue()
    except Exception:
        return None


def zuschneiden(form, daten: bytes, endung: str) -> bytes:
    """Wendet einen Zuschnitt aus PowerPoint auf das Bild an."""
    try:
        links, rechts, oben, unten = form.crop_left, form.crop_right, form.crop_top, form.crop_bottom
    except Exception:
        return daten
    if not any(abs(v) > 0.001 for v in (links, rechts, oben, unten)):
        return daten
    try:
        from PIL import Image

        bild = Image.open(io.BytesIO(daten))
        b, h = bild.size
        kasten = (
            max(0, round(b * links)),
            max(0, round(h * oben)),
            min(b, round(b * (1 - rechts))),
            min(h, round(h * (1 - unten))),
        )
        if kasten[2] <= kasten[0] or kasten[3] <= kasten[1]:
            return daten
        aus = io.BytesIO()
        format_ = {"jpg": "JPEG", "jpeg": "JPEG"}.get(endung, "PNG")
        bild.crop(kasten).save(aus, format_)
        return aus.getvalue()
    except Exception:
        return daten


def tabelle_lesen(tabelle) -> list[list[str]]:
    zeilen = []
    for zeile in tabelle.rows:
        zellen = []
        for zelle in zeile.cells:
            teile = []
            for p in zelle.text_frame.paragraphs:
                md = laeufe_zu_md(p)
                if md:
                    teile.append(md)
            text = "<br>".join(teile).replace("|", "\\|")
            zellen.append(text)
        zeilen.append(zellen)
    return zeilen


# ---------------------------------------------------------------- Folie zu Markdown


def absaetze_zu_md(absaetze: list[Absatz]) -> str:
    zeilen: list[str] = []
    vorher = None
    zahl_zaehler: dict[int, int] = {}
    for a in absaetze:
        if a.art in ("punkt", "zahl"):
            einzug = "   " * a.ebene if a.art == "zahl" or vorher == "zahl" else "  " * a.ebene
            if a.art == "zahl":
                zahl_zaehler[a.ebene] = zahl_zaehler.get(a.ebene, 0) + 1
                marke = f"{zahl_zaehler[a.ebene]}."
            else:
                marke = "-"
            if vorher == "text":
                zeilen.append("")
            zeilen.append(f"{einzug}{marke} {a.text}")
        else:
            zahl_zaehler = {}
            if zeilen:
                zeilen.append("")
            zeilen.append(zeilenanfang_escape(a.text))
        vorher = a.art if a.art != "punkt" or a.ebene == 0 else vorher
    return "\n".join(zeilen)


def tabelle_zu_md(tabelle: list[list[str]]) -> str:
    if not tabelle:
        return ""
    spalten = max(len(z) for z in tabelle)
    zeilen = [z + [""] * (spalten - len(z)) for z in tabelle]
    md = ["| " + " | ".join(zeilen[0]) + " |", "|" + "---|" * spalten]
    for z in zeilen[1:]:
        md.append("| " + " | ".join(z) + " |")
    return "\n".join(md)


def element_zu_md(el: Element) -> str:
    if el.art == "bild":
        return f"![{el.alt}]({el.bild})"
    if el.art == "tabelle":
        return tabelle_zu_md(el.tabelle or [])
    return absaetze_zu_md(el.absaetze)


def lesereihenfolge(elemente: list[Element]) -> list[Element]:
    """Oben nach unten, bei gleicher Hoehe links nach rechts."""
    if not elemente:
        return []
    zeilenhoehe = max(1, min(e.h for e in elemente if e.h) // 2) if any(e.h for e in elemente) else 1
    return sorted(elemente, key=lambda e: (e.y // max(zeilenhoehe, 1), e.x))


@dataclass
class FolienErgebnis:
    markdown: str
    titel: str
    untertitel: str
    klasse: str | None


def seitenleisten_paare(texte: list[str]) -> list[tuple[str, str]]:
    """Findet "Zeit: 7'" oder "Zeit" gefolgt von "7'" in einer Liste von Zeilen."""
    paare = []
    i = 0
    while i < len(texte):
        zeile = texte[i].strip()
        gefunden = False
        nummer = re.fullmatch(r"auftrag\s+(\d+[a-z]?)", zeile, re.I)
        if nummer:
            paare.append(("Auftrag", nummer.group(1)))
            i += 1
            continue
        for name, muster in SEITENLEISTE:
            m = re.match(rf"^({muster})\s*[:：]\s*(.+)$", zeile, re.I)
            if m:
                paare.append((name, m.group(m.lastindex).strip()))
                gefunden = True
                break
            if re.fullmatch(rf"({muster})\s*:?", zeile, re.I) and i + 1 < len(texte):
                naechste = texte[i + 1].strip()
                if naechste and not any(re.match(rf"^({mm})\b", naechste, re.I) for _, mm in SEITENLEISTE):
                    paare.append((name, naechste))
                    i += 1
                    gefunden = True
                    break
        i += 1
    return paare


def ist_karten(elemente: list[Element], hoehe: int) -> list[Element] | None:
    """2 bis 4 gefuellte Textkaesten nebeneinander mit aehnlicher Groesse."""
    kandidaten = [
        e for e in elemente if e.art == "text" and (e.fuellung or e.platzhalter is None) and e.w > 0 and len(e.absaetze) >= 1
    ]
    # Leere Flaechen hinter Text zaehlen als Fuellung
    flaechen = [e for e in elemente if e.art == "flaeche"]
    for e in kandidaten:
        if not e.fuellung:
            for f in flaechen:
                if f.x <= e.x + e.w * 0.1 and f.x + f.w >= e.x + e.w * 0.9 and f.y <= e.y + e.h * 0.2 and f.y + f.h >= e.y + e.h * 0.8:
                    e.fuellung = f.fuellung
    kandidaten = [e for e in kandidaten if e.fuellung and e.y > hoehe * 0.12]
    if len(kandidaten) < 2:
        return None
    # Gruppe mit aehnlicher Oberkante und Breite suchen
    kandidaten.sort(key=lambda e: e.x)
    beste: list[Element] = []
    for basis in kandidaten:
        gruppe = [
            e
            for e in kandidaten
            if abs(e.y - basis.y) < hoehe * 0.08 and 0.6 < (e.w / basis.w if basis.w else 0) < 1.66
        ]
        if len(gruppe) > len(beste):
            beste = gruppe
    if 2 <= len(beste) <= 4:
        # Nebeneinander, ohne grosse Ueberlappung
        beste.sort(key=lambda e: e.x)
        for a, b in zip(beste, beste[1:]):
            if b.x < a.x + a.w * 0.8:
                return None
        return beste
    return None


def zeit_aus(elemente: list[Element], breite: int, hoehe: int) -> tuple[str | None, Element | None]:
    for e in elemente:
        if e.art != "text":
            continue
        text = e.roh
        m = ZEIT_MUSTER.match(text)
        if m and e.w < breite * 0.25 and e.y < hoehe * 0.3:
            return m.group(1).replace(",", "."), e
    return None, None


def hinweis_aus(elemente: list[Element], hoehe: int) -> Element | None:
    for e in elemente:
        if e.art != "text" or not e.absaetze:
            continue
        unten = e.y > hoehe * 0.68
        hinweis_wort = re.match(r"^(hinweis|tipp|achtung|wichtig|info|beachte)\b", e.roh, re.I)
        if unten and (e.fuellung or hinweis_wort) and len(e.roh) < 300:
            return e
    return None


def folie_umwandeln(leser: Leser, folie, nr: int, erste: bool) -> FolienErgebnis:
    breite, hoehe = int(leser.breite), int(leser.hoehe)
    elemente = leser.formen(folie, nr)
    bg = hintergrund(folie, leser.farben)
    dunkel = helligkeit(bg) < 0.35

    titel_el = next((e for e in elemente if e.art == "titel"), None)
    if titel_el is None:
        # Ersatz: kurzer Text mit der groessten Schrift (auf Inhaltsfolien im oberen Drittel)
        texte = [
            e
            for e in elemente
            if e.art == "text"
            and len(e.roh) < 120
            and len(e.absaetze) <= 2
            and not ZEIT_MUSTER.match(e.roh)
            and not re.fullmatch(r"\d{1,2}", e.roh)
            and not re.match(r"^(merke|merksatz)\b", e.roh, re.I)
            and (erste or e.y < hoehe * 0.35)
        ]
        texte.sort(key=lambda e: (-e.groesse, e.y))
        if texte:
            titel_el = texte[0]
    titel = titel_el.roh.replace("\n", " ").strip() if titel_el else ""
    untertitel_el = next((e for e in elemente if e.art == "untertitel"), None)

    rest = [e for e in elemente if e is not titel_el and e.art != "flaeche"]
    alle_texte = " ".join(e.roh for e in elemente if e.absaetze).lower()

    # --- Layout erkennen
    klasse = None
    zeit, zeit_el = zeit_aus(rest, breite, hoehe)
    if zeit_el is not None:
        rest.remove(zeit_el)

    titel_klein = titel.lower()
    if erste or (dunkel and untertitel_el is not None and nr <= 2):
        klasse = "titel"
    elif re.search(r"\bl(ö|oe)sung", titel_klein) or re.match(r"^l(ö|oe)sung", alle_texte.strip()):
        klasse = "loesung"
    elif re.match(r"^(merke|merksatz|das merke ich mir)", titel_klein) or (
        dunkel and len(alle_texte) < 400 and not any(e.art in ("tabelle", "bild") for e in rest)
    ):
        klasse = "merke"

    texte_zeilen = [a.roh for e in rest if e.art == "text" for a in e.absaetze]
    paare = seitenleisten_paare(texte_zeilen)
    ist_auftrag = re.search(r"\bauftrag\b", titel_klein) or any(n != "Auftrag" for n, _ in paare) and len(paare) >= 2
    if klasse != "titel" and ist_auftrag and len([p for p in paare if p[0] != "Auftrag"]) >= 1:
        klasse = "auftrag loesung" if klasse == "loesung" else "auftrag"

    karten = None
    if klasse is None or klasse == "loesung":
        karten = ist_karten(rest, hoehe)
        if karten:
            klasse = "karten" if klasse is None else "karten loesung"

    hinweis = hinweis_aus(rest, hoehe) if klasse not in ("titel", "merke") else None
    if hinweis is not None:
        rest.remove(hinweis)

    # Text links und Bild rechts nebeneinander -> zwei Spalten
    bilder = [e for e in rest if e.art == "bild"]
    texte = [e for e in rest if e.art in ("text", "tabelle")]
    spalten = False
    if bilder and texte and klasse in (None, "loesung"):
        spalten = all(b.x > breite * 0.4 for b in bilder) and all(t.x + t.w < breite * 0.62 for t in texte)
        if spalten:
            klasse = "spalten" if klasse is None else "spalten loesung"

    # --- Markdown aufbauen
    teile: list[str] = []
    attribute = []
    if klasse:
        attribute.append(f'class="{klasse}"')
    if zeit and "auftrag" not in (klasse or ""):
        attribute.append(f'data-zeit="{zeit}"')
    if attribute:
        teile.append(f"<!-- .slide: {' '.join(attribute)} -->")

    def als_text(e: Element) -> str:
        if e.art != "text":
            return element_zu_md(e)
        return absaetze_zu_md([Absatz(a.text, a.roh, 0, "text") for a in e.absaetze])

    if klasse == "titel":
        # Die Lektionsnummer im Kreis setzt der Viewer aus kapitel.json
        rest = [e for e in rest if not (e.art == "text" and re.fullmatch(r"\d{1,2}", e.roh))]
        if titel:
            teile.append(f"# {md_escape(titel)}")
        if untertitel_el is not None:
            rest = [e for e in rest if e is not untertitel_el]
            teile.append(als_text(untertitel_el))
        teile.extend(als_text(e) for e in lesereihenfolge(rest))
    else:
        if "auftrag" in (klasse or ""):
            # "Auftrag 1: Titel" -> "Titel", die Nummer steht in der Seitenleiste
            m = re.match(r"^auftrag\s*(\d+[a-z]?)?\s*[:.\-–]\s*(.+)$", titel, re.I)
            if m:
                titel = m.group(2)
                if m.group(1) and not any(n == "Auftrag" for n, _ in paare):
                    paare.insert(0, ("Auftrag", m.group(1)))
        if titel:
            teile.append(f"## {md_escape(titel)}")
        if "auftrag" in (klasse or ""):
            leiste = [f"- {name}: {md_escape(wert)}" for name, wert in paare]
            if zeit and not any(name == "Zeit" for name, _ in paare):
                leiste.insert(0, f"- Zeit: {zeit}'")
            if leiste:
                teile.append("\n".join(leiste))
            # Zeilen der Seitenleiste nicht doppelt ausgeben
            rest = [e for e in (auftrag_ohne_leiste(e) for e in rest) if e is not None]
        if karten:
            for karte in karten:
                rest.remove(karte)
            oben = min(k.y for k in karten)
            geordnet = lesereihenfolge(rest)
            teile.extend(element_zu_md(e) for e in geordnet if e.y < oben)
            for karte in karten:
                kopf, *inhalt = karte.absaetze
                teile.append(f"### {kopf.text.strip('*') if kopf.fett else kopf.text}")
                if inhalt:
                    teile.append(absaetze_zu_md(inhalt))
            teile.extend(element_zu_md(e) for e in geordnet if e.y >= oben)
        else:
            geordnet = lesereihenfolge(rest)
            if spalten:
                geordnet = [e for e in geordnet if e.art != "bild"] + [e for e in geordnet if e.art == "bild"]
            teile.extend(element_zu_md(e) for e in geordnet)
    if klasse == "merke":
        # Das Wort "Merke" zeigt das Layout selbst an
        teile = [re.sub(r"^(#+ )?(Merke|Merksatz)\s*[:!]?\s*", r"\1", t) if not t.startswith("<!--") else t for t in teile]
        teile = [t for t in teile if t.strip() not in ("", "#", "##")]
    if hinweis is not None:
        teile.append("\n".join("> " + zeile if zeile else ">" for zeile in absaetze_zu_md(hinweis.absaetze).split("\n")))

    markdown = "\n\n".join(t for t in teile if t and t.strip())
    untertitel = untertitel_el.roh.replace("\n", " ") if untertitel_el is not None else ""
    return FolienErgebnis(markdown=markdown, titel=titel, untertitel=untertitel, klasse=klasse)


def auftrag_ohne_leiste(e: Element) -> Element | None:
    if e.art != "text":
        return e
    behalten = []
    ueberspringen = False
    for a in e.absaetze:
        if ueberspringen:
            ueberspringen = False
            continue
        zeile = a.roh.strip()
        treffer = bool(re.fullmatch(r"auftrag\s+(\d+[a-z]?)", zeile, re.I))
        for _, muster in SEITENLEISTE:
            if re.match(rf"^({muster})\s*[:：]\s*\S", zeile, re.I):
                treffer = True
                break
            if re.fullmatch(rf"({muster})\s*:?", zeile, re.I):
                treffer = True
                ueberspringen = True
                break
        if not treffer and not ZEIT_MUSTER.match(zeile):
            behalten.append(a)
    if not behalten:
        return None
    e.absaetze = behalten
    return e


def notizen(folie) -> str:
    if not folie.has_notes_slide:
        return ""
    rahmen = folie.notes_slide.notes_text_frame
    if rahmen is None:
        return ""
    zeilen = []
    for p in rahmen.paragraphs:
        text = "".join(r.text for r in p.runs).replace("\u000b", " ").rstrip()
        zeilen.append(text)
    text = "\n".join(zeilen).strip()
    # Leerzeilen zusammenfassen und "---" entschaerfen (waere sonst ein Folientrenner)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"^---$", "- - -", text, flags=re.M)
    text = re.sub(r"^Note:", "Notiz:", text, flags=re.M)
    return text


def ausgeblendet_als_text(leser: Leser, folie, nr: int) -> str:
    zeilen = []
    elemente = leser.formen(folie, nr)
    titel = next((e.roh for e in elemente if e.art == "titel"), "")
    zeilen.append(f"Ausgeblendete Folie {nr}" + (f": {titel}" if titel else ""))
    for e in lesereihenfolge(elemente):
        if e.art == "titel" or e.art == "flaeche":
            continue
        if e.art == "bild":
            zeilen.append(f"- Bild: {e.alt or e.bild}")
        elif e.art == "tabelle":
            for zeile in e.tabelle or []:
                zeilen.append("- " + " | ".join(z.replace("<br>", " ") for z in zeile))
        else:
            for a in e.absaetze:
                zeilen.append("  " * a.ebene + "- " + a.roh)
    n = notizen(folie)
    if n:
        zeilen.append("Notizen dazu: " + n.replace("\n", " "))
    return "\n".join(zeilen)


# ---------------------------------------------------------------- Ganze Datei


def umwandeln(pptx: Path, kapitel: str, lektion: str) -> tuple[str, dict, list[str]]:
    praesentation = Presentation(str(pptx))
    bildordner = INHALTE / kapitel / "bilder"
    # Alte Bilder dieser Lektion entfernen
    if bildordner.exists():
        for alt in bildordner.glob(f"{lektion}-f*.*"):
            alt.unlink()
    leser = Leser(praesentation, kapitel, lektion, bildordner)

    sichtbar = []
    ausgeblendet = []
    for nr, folie in enumerate(praesentation.slides, start=1):
        if folie._element.get("show") in ("0", "false"):
            ausgeblendet.append((nr, folie))
        else:
            sichtbar.append((nr, folie))
    if not sichtbar:
        raise SystemExit("Die Datei enthaelt keine sichtbaren Folien.")

    folien_md = []
    meta = {"titel": "", "untertitel": ""}
    for i, (nr, folie) in enumerate(sichtbar):
        ergebnis = folie_umwandeln(leser, folie, nr, erste=(i == 0))
        if i == 0:
            meta["titel"] = ergebnis.titel
            meta["untertitel"] = ergebnis.untertitel
        n = notizen(folie)
        if i == 0 and ausgeblendet:
            zusatz = "\n\n".join(ausgeblendet_als_text(leser, f, nr_a) for nr_a, f in ausgeblendet)
            n = (n + "\n\n" if n else "") + zusatz
        md = ergebnis.markdown or "## (leere Folie)"
        if n:
            md += "\n\nNote:\n" + n
        folien_md.append(md)

    kopf = (
        f"<!-- Erzeugt aus {pptx.name} mit tools/pptx_zu_md.py. Anleitung zum Bearbeiten: README.md -->\n\n"
    )
    markdown = kopf + "\n\n---\n\n".join(folien_md) + "\n"
    return markdown, meta, leser.warnungen


# ---------------------------------------------------------------- kapitel.json


def niveau_aus_dateiname(name: str) -> str:
    m = re.search(r"niveau[ _-]?([abc])(?![a-z])", name, re.I)
    return m.group(1).upper() if m else ""


def eintrag_speichern(kapitel: str, lektion: str, daten: dict) -> None:
    datei = INHALTE / "kapitel.json"
    inhalt = json.loads(datei.read_text(encoding="utf-8"))
    kap = next((k for k in inhalt["kapitel"] if k["id"] == kapitel), None)
    if kap is None:
        moegliche = ", ".join(k["id"] for k in inhalt["kapitel"])
        raise SystemExit(f"Kapitel «{kapitel}» gibt es nicht in inhalte/kapitel.json. Moeglich: {moegliche}")
    kap.setdefault("lektionen", [])
    eintrag = next((l for l in kap["lektionen"] if l.get("id") == lektion), None)
    if eintrag is None:
        eintrag = {"id": lektion}
        kap["lektionen"].append(eintrag)
    for schluessel in ("titel", "untertitel", "datum", "niveau", "datei", "original"):
        wert = daten.get(schluessel)
        erzwingen = daten.get("_erzwingen", set())
        bisher = eintrag.get(schluessel)
        if wert and (schluessel in erzwingen or not bisher or bisher == lektion):
            eintrag[schluessel] = wert
    # Reihenfolge der Felder wie im Beispiel
    reihenfolge = ["id", "titel", "untertitel", "kurztitel", "datum", "niveau", "nummer", "datei", "original"]
    geordnet = {k: eintrag[k] for k in reihenfolge if k in eintrag}
    geordnet.update({k: v for k, v in eintrag.items() if k not in geordnet})
    kap["lektionen"][kap["lektionen"].index(eintrag)] = geordnet
    datei.write_text(json.dumps(inhalt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- Farben anzeigen


def farbton(hexwert: str) -> tuple[float, float, float]:
    r, g, b = (int(hexwert[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return colorsys.rgb_to_hls(r, g, b)


def farben_ermitteln(pptx: Path) -> dict[str, str]:
    praesentation = Presentation(str(pptx))
    farben = Farben(praesentation)
    zaehler: Counter[str] = Counter()
    for folie in praesentation.slides:
        bg = hintergrund(folie, farben)
        if bg:
            zaehler[bg] += 5
        for form in folie.shapes:
            f = form_fuellung(form, farben)
            if f:
                zaehler[f] += 2
            if form.has_text_frame:
                for p in form.text_frame.paragraphs:
                    for r in p.runs:
                        try:
                            if r.font.color and r.font.color.type is not None and r.font.color.rgb is not None:
                                zaehler[str(r.font.color.rgb)] += 1
                        except Exception:
                            pass
    print(f"Designfarben ({pptx.name}):")
    for name, wert in farben.schema.items():
        print(f"  {name:8} #{wert}")
    print("Haeufigste Farben auf den Folien:")
    for wert, anzahl in zaehler.most_common(12):
        print(f"  #{wert}  ({anzahl})")

    kandidaten = list(zaehler) + list(farben.schema.values())
    ergebnis: dict[str, str] = {}

    def beste(bedingung):
        passende = [c for c in kandidaten if bedingung(*farbton(c))]
        if not passende:
            return None
        return max(passende, key=lambda c: zaehler.get(c, 0))

    ergebnis["dunkelblau"] = beste(lambda h, l, s: 0.55 <= h <= 0.72 and l < 0.35 and s > 0.25)
    ergebnis["petrol"] = beste(lambda h, l, s: 0.45 <= h <= 0.55 and 0.15 < l < 0.5 and s > 0.25)
    ergebnis["orange"] = beste(lambda h, l, s: 0.03 <= h <= 0.12 and 0.35 < l < 0.7 and s > 0.6)
    ergebnis["hellgrau"] = beste(lambda h, l, s: s < 0.12 and 0.88 < l < 0.99)
    print("Vorschlag fuer site/css/basis.css:")
    for name, wert in ergebnis.items():
        print(f"  --{name}: {'#' + wert.lower() if wert else '(nicht gefunden, bleibt)'}")
    return {k: v for k, v in ergebnis.items() if v}


def farben_schreiben(farben: dict[str, str]) -> None:
    css = BASIS_CSS.read_text(encoding="utf-8")
    for name, wert in farben.items():
        css = re.sub(rf"(--{name}:\s*)#[0-9a-fA-F]{{6}};", rf"\g<1>#{wert.lower()};", css, count=1)
    BASIS_CSS.write_text(css, encoding="utf-8")
    print("Farben in site/css/basis.css uebernommen.")


# ---------------------------------------------------------------- Hauptprogramm


def anzeige(pfad: Path) -> str:
    try:
        return str(pfad.relative_to(WURZEL))
    except ValueError:
        return str(pfad)


def main(argumente: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PowerPoint in Markdown fuer reveal.js umwandeln")
    parser.add_argument("datei", type=Path, help="PowerPoint-Datei, z. B. quellen/lektion.pptx")
    parser.add_argument("--kapitel", help="Kapitel-ID aus inhalte/kapitel.json, z. B. k1")
    parser.add_argument("--id", help="ID der Lektion, z. B. l2-bewertungen-datenstau")
    parser.add_argument("--titel")
    parser.add_argument("--untertitel")
    parser.add_argument("--datum")
    parser.add_argument("--niveau")
    parser.add_argument("--ueberschreiben", action="store_true")
    parser.add_argument("--farben", action="store_true")
    parser.add_argument("--farben-schreiben", action="store_true")
    a = parser.parse_args(argumente)

    if not a.datei.exists():
        print(f"Datei nicht gefunden: {a.datei}", file=sys.stderr)
        return 1

    if a.farben or a.farben_schreiben:
        gefunden = farben_ermitteln(a.datei)
        if a.farben_schreiben:
            farben_schreiben(gefunden)
        return 0

    if not a.kapitel or not a.id:
        parser.error("--kapitel und --id sind noetig")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", a.id):
        parser.error("--id darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten (z. B. l2-bewertungen-datenstau)")
    if a.datum and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.datum):
        parser.error("--datum bitte im Format JJJJ-MM-TT, z. B. 2026-09-22")

    ziel = INHALTE / a.kapitel / f"{a.id}.md"
    if ziel.exists() and not a.ueberschreiben:
        print(
            f"{anzeige(ziel)} gibt es schon (vielleicht mit Handkorrekturen).\n"
            "Mit --ueberschreiben wird sie ersetzt.",
            file=sys.stderr,
        )
        return 1

    markdown, meta, warnungen = umwandeln(a.datei, a.kapitel, a.id)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    ziel.write_text(markdown, encoding="utf-8")

    original = None
    try:
        original = str(a.datei.resolve().relative_to(QUELLEN.resolve()))
    except ValueError:
        print("Hinweis: Die Datei liegt nicht in quellen/, darum gibt es keinen Button «Original (.pptx)».")

    erzwingen = {"datei", "original"}
    for name in ("titel", "untertitel", "datum", "niveau"):
        if getattr(a, name):
            erzwingen.add(name)
    eintrag_speichern(
        a.kapitel,
        a.id,
        {
            "titel": a.titel or meta["titel"] or a.id,
            "untertitel": a.untertitel or meta["untertitel"],
            "datum": a.datum,
            "niveau": a.niveau or niveau_aus_dateiname(a.datei.name),
            "datei": f"{a.kapitel}/{a.id}.md",
            "original": original,
            "_erzwingen": erzwingen,
        },
    )
    anzahl = markdown.count("\n\n---\n\n") + 1
    print(f"{anzeige(ziel)}: {anzahl} Folien geschrieben, kapitel.json aktualisiert.")
    for w in warnungen:
        print("  Achtung: " + w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
