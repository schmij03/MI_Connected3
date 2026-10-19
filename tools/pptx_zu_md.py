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
    ("Arbeitsbuch", r"arbeitsbuch|buch|lehrmittel|arbeitsheft"),
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
    link: str | None = None  # z. B. eingebettetes Online-Video
    alt: str = ""
    tabelle: list[list[str]] | None = None
    name: str = ""
    groesse: float = 0.0  # groesste Schrift in Punkt (0 = unbekannt)
    # Nur fuer art == "kasten": farbige Form mit Inhalt
    kopf: "Absatz | None" = None
    nummer: str | None = None
    kinder: list = field(default_factory=list)

    @property
    def mitte(self) -> tuple[float, float]:
        return self.x + self.w / 2, self.y + self.h / 2

    def enthaelt(self, anderes: "Element") -> bool:
        mx, my = anderes.mitte
        return self.x <= mx <= self.x + self.w and self.y <= my <= self.y + self.h

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
        self.fusszeilen: set[str] = set()

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
        return self.daten_speichern(daten, endung, folien_nr, nummer)

    def daten_speichern(self, daten: bytes, endung: str, folien_nr: int, nummer: int) -> str:
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
                if form.shape_type == MSO_SHAPE_TYPE.MEDIA:
                    zaehler[0] += 1
                    video = video_lesen(form, folie)
                    if video is not None:
                        daten, endung, link = video
                        pfad = self.daten_speichern(daten, endung, folien_nr, zaehler[0]) if daten else None
                        if link and not link.startswith("http"):
                            self.warnungen.append(f"Folie {folien_nr}: Video «{form.name}» ist eine Datei in der PowerPoint und wurde nur als Bild uebernommen.")
                            link = None
                        if pfad or link:
                            el.art = "bild"
                            el.bild = pfad
                            el.link = link
                            el.alt = bild_alt(form) or "Video"
                            elemente.append(el)
                    continue
                if getattr(form, "has_chart", False) and form.has_chart:
                    self.warnungen.append(f"Folie {folien_nr}: Diagramm «{form.name}» wurde nicht uebernommen (bitte als Bild einfuegen).")
                    continue
                if form._element.tag.endswith("graphicFrame"):
                    self.warnungen.append(f"Folie {folien_nr}: Grafik «{form.name}» (z. B. SmartArt) wurde nicht uebernommen.")
                    continue
                if form.has_text_frame and form.text_frame.text.strip() in self.fusszeilen and y > self.hoehe * 0.85:
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


def video_lesen(form, folie) -> tuple[bytes | None, str, str | None] | None:
    """Vorschaubild und Adresse eines eingebetteten Videos."""
    el = form._element
    daten, endung, link = None, "png", None
    blip = el.find(".//a:blip", NS)
    if blip is not None:
        rid = blip.get(f"{{{NS['r']}}}embed")
        try:
            teil = folie.part.related_part(rid)
            daten = teil.blob
            endung = teil.partname.ext.lower()
        except Exception:
            daten = None
    for kind in el.iter():
        name = etree.QName(kind).localname
        if name in ("videoFile", "media"):
            rid = kind.get(f"{{{NS['r']}}}link") or kind.get(f"{{{NS['r']}}}embed")
            if rid and rid in folie.part.rels:
                beziehung = folie.part.rels[rid]
                link = beziehung.target_ref if beziehung.is_external else beziehung.target_ref
                break
    if link:
        m = re.search(r"youtube(?:-nocookie)?\.com/embed/([\w-]+)", link)
        if m:
            link = f"https://www.youtube.com/watch?v={m.group(1)}"
    if daten is None and link is None:
        return None
    return daten, endung, link


def bild_alt(form) -> str:
    try:
        cnv = form._element.find(".//p:cNvPr", NS)
        text = (cnv.get("descr") or "").strip() if cnv is not None else ""
    except Exception:
        text = ""
    if not text or len(text) > 200 or "automatisch generiert" in text.lower() or re.search(r"[/\\]|\.(png|jpe?g|gif|svg)$", text, re.I):
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
        if el.link and el.bild:
            return f"[![{el.alt}]({el.bild})]({el.link})"
        if el.link:
            return f"[{el.alt or 'Video'}]({el.link})"
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


def ist_marke(e: Element, breite: int) -> bool:
    """Kleiner Kreis oder kleines Quadrat (Nummer, Zeitangabe, Symbol)."""
    return e.w > 0 and e.w < breite * 0.14 and abs(e.w - e.h) < e.w * 0.2


def kaesten_bilden(elemente: list[Element], breite: int, hoehe: int) -> tuple[list[Element], list[Element]]:
    """
    Fasst Textfelder und Bilder, die auf einer farbigen Form liegen, zu einem Kasten zusammen.
    Gibt (Elemente, Marken) zurueck. Marken sind kleine Kreise mit Text (Nummer, Zeit),
    die nicht in einem Kasten liegen.
    """
    benutzt: set[int] = set()
    # Kleine Bilder sind Symbole (Icons): weglassen, ebenso ihr Kreis
    for e in elemente:
        if e.art == "bild" and e.w < breite * 0.06 and e.h < hoehe * 0.1:
            benutzt.add(id(e))
            for f in elemente:
                if f.art == "flaeche" and ist_marke(f, breite) and f.enthaelt(e):
                    benutzt.add(id(f))

    # Marken: kleiner Kreis mit kurzem Text darauf (oder Text, der selbst ein gefuellter Kreis ist)
    marken: list[Element] = []
    for f in elemente:
        if id(f) in benutzt or not ist_marke(f, breite):
            continue
        if f.art == "text" and f.fuellung and len(f.roh) <= 6:
            marken.append(f)
            benutzt.add(id(f))
            continue
        if f.art != "flaeche":
            continue
        text = next(
            (t for t in elemente if t.art == "text" and id(t) not in benutzt and len(t.roh) <= 6 and f.enthaelt(t)),
            None,
        )
        if text is not None:
            text.x, text.y, text.w, text.h, text.fuellung = f.x, f.y, f.w, f.h, f.fuellung
            marken.append(text)
            benutzt.update({id(f), id(text)})

    # Kaesten: groessere farbige Formen (oder gefuellte Textfelder)
    flaeche_gesamt = breite * hoehe
    kaesten = [
        e
        for e in elemente
        if id(e) not in benutzt
        and e.art in ("flaeche", "text")
        and e.fuellung
        and e.w >= breite * 0.12
        and e.h >= hoehe * 0.06
        and e.w * e.h < flaeche_gesamt * 0.9
    ]
    kaesten.sort(key=lambda k: k.w * k.h)
    inhalt: dict[int, list[Element]] = {id(k): [] for k in kaesten}
    for e in elemente + marken:
        if id(e) in benutzt and e not in marken:
            continue
        if e in kaesten and e.art == "flaeche":
            continue
        ziel = next((k for k in kaesten if k is not e and k.enthaelt(e) and k.w * k.h > e.w * e.h), None)
        if ziel is not None:
            inhalt[id(ziel)].append(e)

    ergebnis_kaesten: list[Element] = []
    in_kasten: set[int] = set()
    for k in kaesten:
        teile = inhalt[id(k)]
        if k.art == "text":
            teile = [k] + teile
        texte = [t for t in lesereihenfolge(teile) if t.art == "text" and t not in marken]
        nummern = [m for m in teile if m in marken and re.fullmatch(r"\d{1,2}", m.roh)]
        bilder = [b for b in teile if b.art == "bild"]
        if not texte and not bilder:
            continue
        kasten = Element(art="kasten", x=k.x, y=k.y, w=k.w, h=k.h, fuellung=k.fuellung, name=k.name)
        kasten.nummer = nummern[0].roh if nummern else None
        # Eine Ziffer als eigener Text (ohne Kreis) zaehlt auch als Nummer
        if kasten.nummer is None and texte and re.fullmatch(r"\d{1,2}", texte[0].roh):
            kasten.nummer = texte[0].roh
            texte = texte[1:]
        absaetze = [a for t in texte for a in t.absaetze]
        groessen = [t.groesse for t in texte]
        if absaetze and (len(absaetze) > 1) and (
            absaetze[0].fett or (len(texte) > 1 and groessen[0] > max(groessen[1:]))
        ) and len(absaetze[0].roh) < 70:
            kasten.kopf = absaetze[0]
            absaetze = absaetze[1:]
        kasten.absaetze = absaetze
        kasten.kinder = bilder
        kasten.groesse = max(groessen) if groessen else 0.0
        ergebnis_kaesten.append(kasten)
        in_kasten.update(id(t) for t in teile)
        in_kasten.add(id(k))
        # Verschachtelte Kaesten nicht doppelt ausgeben
        for anderer in ergebnis_kaesten[:-1]:
            if k.enthaelt(anderer) and id(anderer) not in in_kasten:
                in_kasten.add(id(anderer))

    uebrig = [
        e
        for e in elemente
        if id(e) not in benutzt and id(e) not in in_kasten and e.art != "flaeche" and e not in marken
    ]
    freie_marken = [m for m in marken if id(m) not in in_kasten]
    # Kaesten, die ganz in einem anderen Kasten liegen, entfernen
    flach = []
    for k in ergebnis_kaesten:
        if any(o is not k and o.enthaelt(k) and o.w * o.h > k.w * k.h * 1.2 for o in ergebnis_kaesten):
            continue
        flach.append(k)
    return uebrig + flach, freie_marken


def kasten_zu_md(k: Element, als_karte: bool = False) -> str:
    teile = []
    if k.kopf is not None:
        kopf = k.kopf.text.replace("**", "")
        if als_karte:
            teile.append(f"### {kopf}" + (' <!-- .element: class="hervor" -->' if helligkeit(k.fuellung) < 0.4 else ""))
        else:
            teile.append(f"**{kopf}**")
    if k.absaetze:
        teile.append(absaetze_zu_md(k.absaetze))
    for b in k.kinder:
        teile.append(element_zu_md(b))
    return "\n\n".join(t for t in teile if t)


def gruppe_nebeneinander(kaesten: list[Element], hoehe: int) -> list[Element]:
    beste: list[Element] = []
    for basis in kaesten:
        gruppe = [k for k in kaesten if abs(k.y - basis.y) < hoehe * 0.06 and 0.6 < k.w / max(basis.w, 1) < 1.66]
        if len(gruppe) > len(beste):
            beste = gruppe
    if len(beste) < 2:
        return []
    beste.sort(key=lambda k: k.x)
    for a, b in zip(beste, beste[1:]):
        if b.x < a.x + a.w * 0.8:
            return []
    # Weitere Reihen mit gleich breiten Kaesten gehoeren dazu (z. B. 3 + 2 Karten)
    breite = sum(k.w for k in beste) / len(beste)
    weitere = [k for k in kaesten if k not in beste and 0.8 < k.w / breite < 1.25 and k.y > beste[0].y]
    return sorted(beste + weitere, key=lambda k: (round(k.y / max(k.h, 1) * 2), k.x))


def gruppe_untereinander(kaesten: list[Element], breite: int) -> list[Element]:
    breite_kaesten = [k for k in kaesten if k.w > breite * 0.45]
    if len(breite_kaesten) < 2:
        return []
    basis = breite_kaesten[0]
    gruppe = [k for k in breite_kaesten if abs(k.x - basis.x) < breite * 0.05]
    return sorted(gruppe, key=lambda k: k.y) if len(gruppe) >= 2 else []


def zeit_aus(elemente: list[Element], breite: int, hoehe: int) -> tuple[str | None, Element | None]:
    for e in elemente:
        if e.art != "text":
            continue
        m = ZEIT_MUSTER.match(e.roh)
        if m and e.w < breite * 0.25 and e.y < hoehe * 0.3 and e.x > breite * 0.6:
            return m.group(1).replace(",", "."), e
    return None, None


def folie_umwandeln(leser: Leser, folie, nr: int, erste: bool) -> FolienErgebnis:
    breite, hoehe = int(leser.breite), int(leser.hoehe)
    roh = leser.formen(folie, nr)
    bg = hintergrund(folie, leser.farben)
    dunkel = helligkeit(bg) < 0.35
    elemente, marken = kaesten_bilden(roh, breite, hoehe)

    # --- Zeitbadge oben rechts
    zeit, zeit_el = zeit_aus(marken + elemente, breite, hoehe)
    if zeit_el is not None:
        if zeit_el in marken:
            marken.remove(zeit_el)
        if zeit_el in elemente:
            elemente.remove(zeit_el)

    texte = [e for e in elemente if e.art in ("text", "titel", "untertitel")]
    alle_texte = " ".join(e.roh for e in roh if e.absaetze).lower()

    # --- Kennzeichnungen wie "Lektion 2" und "Merke" (kleine Beschriftungen)
    lektion_el = next((e for e in texte if re.fullmatch(r"lektion\s+\d+", e.roh, re.I)), None)
    merke_el = next((e for e in texte if re.fullmatch(r"(merke|merksatz)\s*:?", e.roh, re.I)), None)
    for e in (lektion_el, merke_el):
        if e is not None:
            elemente.remove(e)
            texte.remove(e)

    # --- Titel
    titel_el = next((e for e in texte if e.art == "titel"), None)
    if titel_el is None:
        kandidaten = [
            e
            for e in texte
            if len(e.roh) < 120
            and len(e.absaetze) <= 2
            and not re.fullmatch(r"\d{1,2}", e.roh)
            and (erste or merke_el is not None or e.y < hoehe * 0.35 or dunkel)
        ]
        kandidaten.sort(key=lambda e: (-e.groesse, e.y))
        if kandidaten:
            titel_el = kandidaten[0]
    titel = titel_el.roh.replace("\n", " ").strip() if titel_el else ""
    if titel_el is not None:
        elemente.remove(titel_el)
    untertitel_el = next((e for e in elemente if e.art == "untertitel"), None)

    # --- Layout bestimmen
    klasse: list[str] = []
    titel_klein = titel.lower()
    kaesten = [e for e in elemente if e.art == "kasten"]
    nummer = None
    if erste:
        klasse.append("titel")
        frei = [m for m in marken if re.fullmatch(r"\d{1,2}", m.roh)]
        if frei:
            nummer = frei[0].roh
        elif lektion_el is not None:
            nummer = re.sub(r"\D", "", lektion_el.roh)
    elif merke_el is not None or re.match(r"^(merke|merksatz)\b", titel_klein):
        klasse.append("merke")
        titel = re.sub(r"^(merke|merksatz)\s*[:!]?\s*", "", titel, flags=re.I)
    elif dunkel:
        klasse.append("frage")
    if re.search(r"l(ö|oe)sung", titel_klein):
        klasse.append("loesung")

    # Auftrag: hoher Kasten links mit dem Wort "Auftrag"
    seitenleiste = next(
        (
            k
            for k in kaesten
            if k.x < breite * 0.2 and k.h > hoehe * 0.4 and k.w < breite * 0.4
            and re.match(r"^auftrag", (k.kopf.roh if k.kopf else (k.absaetze[0].roh if k.absaetze else "")), re.I)
        ),
        None,
    )
    paare: list[tuple[str, str]] = []
    if seitenleiste is not None and "titel" not in klasse:
        zeilen = ([seitenleiste.kopf.roh] if seitenleiste.kopf else []) + [a.roh for a in seitenleiste.absaetze]
        if seitenleiste.nummer:
            paare.append(("Auftrag", seitenleiste.nummer))
        if zeilen and re.fullmatch(r"auftrag", zeilen[0].strip(), re.I) and len(zeilen) > 1 and re.fullmatch(r"\d+[a-z]?", zeilen[1].strip()):
            paare.append(("Auftrag", zeilen[1].strip()))
            zeilen = zeilen[2:]
        paare += [p for p in seitenleisten_paare(zeilen) if p[0] != "Auftrag" or not paare]
        klasse.insert(0, "auftrag")
        elemente.remove(seitenleiste)
        kaesten.remove(seitenleiste)
    elif "titel" not in klasse:
        # Auftrag als Textzeilen ("Zeit: 10 Minuten") ohne Kasten
        zeilen = [a.roh for e in elemente if e.art == "text" for a in e.absaetze]
        moegliche = seitenleisten_paare(zeilen)
        if re.search(r"\bauftrag\b", titel_klein) and len([p for p in moegliche if p[0] != "Auftrag"]) >= 1:
            paare = moegliche
            klasse.insert(0, "auftrag")
            elemente = [x for x in (auftrag_ohne_leiste(e) for e in elemente) if x is not None]

    # Hinweis: heller Kasten unten
    hinweis = None
    if not {"titel", "merke"} & set(klasse):
        for k in sorted(kaesten, key=lambda k: -k.y):
            if k.y > hoehe * 0.68 and helligkeit(k.fuellung) > 0.6 and len(k.roh) < 300 and k.w > breite * 0.4:
                hinweis = k
                break
        if hinweis is None:
            for e in elemente:
                if e.art == "text" and e.y > hoehe * 0.72 and re.match(r"^(hinweis|tipp|achtung|wichtig|merke|beachte)\b", e.roh, re.I):
                    hinweis = e
                    break
    if hinweis is not None:
        elemente.remove(hinweis)
        if hinweis in kaesten:
            kaesten.remove(hinweis)

    # Ziele, Karten
    karten: list[Element] = []
    ziele: list[Element] = []
    untereinander = gruppe_untereinander(kaesten, breite)
    if untereinander and all(k.nummer for k in untereinander):
        ziele = untereinander
        klasse.append("ziele")
    elif untereinander and all(k.kopf for k in untereinander) and not gruppe_nebeneinander(kaesten, hoehe):
        karten = untereinander
        klasse += ["karten", "untereinander"]
    else:
        karten = gruppe_nebeneinander(kaesten, hoehe)
        if len(karten) >= 2:
            klasse.append("karten")
            if all(k.nummer for k in karten):
                klasse.append("nummeriert")
        else:
            karten = []
    for k in karten + ziele:
        elemente.remove(k)

    # Text links und Bild rechts nebeneinander -> zwei Spalten
    bilder = [e for e in elemente if e.art == "bild"]
    inhalt = [e for e in elemente if e.art in ("text", "tabelle", "kasten")]
    spalten = False
    if bilder and inhalt and not ({"titel", "auftrag", "karten", "ziele"} & set(klasse)):
        spalten = all(b.x > breite * 0.4 for b in bilder) and all(t.x + t.w < breite * 0.62 for t in inhalt)
        if spalten:
            klasse.append("spalten")

    # --- Markdown aufbauen
    teile: list[str] = []
    attribute = []
    if klasse:
        attribute.append(f'class="{" ".join(dict.fromkeys(klasse))}"')
    if zeit and "auftrag" not in klasse:
        attribute.append(f'data-zeit="{zeit}"')
    if nummer and "titel" in klasse:
        attribute.append(f'data-nummer="{nummer}"')
    if attribute:
        teile.append(f"<!-- .slide: {' '.join(attribute)} -->")

    def als_text(e: Element) -> str:
        if e.art == "kasten":
            return kasten_zu_md(e)
        if e.art != "text":
            return element_zu_md(e)
        return absaetze_zu_md([Absatz(a.text, a.roh, 0, "text") for a in e.absaetze])

    if "titel" in klasse:
        if titel:
            teile.append(f"# {md_escape(titel)}")
        fuss = [e for e in elemente if e.art == "text" and e.y > hoehe * 0.8]
        oben = [e for e in lesereihenfolge(elemente) if e not in fuss]
        teile.extend(als_text(e) for e in oben)
        if fuss:
            teile.append("***")
            teile.extend(als_text(e) for e in fuss)
    else:
        if "auftrag" in klasse:
            m = re.match(r"^auftrag\s*(\d+[a-z]?)?\s*[:.\-–]\s*(.+)$", titel, re.I)
            if m:
                titel = m.group(2)
                if m.group(1) and not any(n == "Auftrag" for n, _ in paare):
                    paare.insert(0, ("Auftrag", m.group(1)))
        if titel:
            teile.append(f"## {md_escape(titel)}")
        if "auftrag" in klasse:
            leiste = [f"- {name}: {md_escape(wert)}" for name, wert in paare]
            if zeit and not any(name == "Zeit" for name, _ in paare):
                leiste.insert(0, f"- Zeit: {zeit}'")
            if leiste:
                teile.append("\n".join(leiste))
        geordnet = lesereihenfolge(elemente)
        if spalten:
            geordnet = [e for e in geordnet if e.art != "bild"] + ["***"] + [e for e in geordnet if e.art == "bild"]
        oben = min((k.y for k in karten), default=hoehe)
        for e in geordnet:
            if e == "***":
                teile.append("***")
            elif e.y < oben or not karten:
                teile.append(kasten_zu_md(e) if e.art == "kasten" else element_zu_md(e))
        if ziele:
            teile.append("\n".join(f"{i}. {absaetze_zu_md(k.absaetze).replace(chr(10), ' ')}" for i, k in enumerate(ziele, 1)))
        for k in karten:
            if k.kopf is None and k.absaetze:
                k.kopf, k.absaetze = k.absaetze[0], k.absaetze[1:]
            teile.append(kasten_zu_md(k, als_karte=True))
        if karten:
            teile.extend(
                kasten_zu_md(e) if e.art == "kasten" else element_zu_md(e) for e in geordnet if e != "***" and e.y >= oben
            )
    if hinweis is not None:
        text = als_text(hinweis) if hinweis.art != "kasten" else absaetze_zu_md(
            ([hinweis.kopf] if hinweis.kopf else []) + hinweis.absaetze
        )
        text = text.replace("**", "")
        teile.append("\n".join("> " + z if z else ">" for z in text.split("\n")))

    markdown = "\n\n".join(t for t in teile if t and t.strip())
    untertitel = untertitel_el.roh.replace("\n", " ") if untertitel_el is not None else ""
    if not untertitel and "titel" in klasse:
        rest_texte = [e for e in lesereihenfolge(elemente) if e.art == "text" and e.y < hoehe * 0.8]
        if rest_texte:
            untertitel = rest_texte[0].roh.replace("\n", " ")
    return FolienErgebnis(markdown=markdown, titel=titel, untertitel=untertitel, klasse=" ".join(klasse) or None)


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

    # Texte, die unten auf vielen Folien gleich stehen (Fusszeilen), weglassen
    zaehler: Counter[str] = Counter()
    for _, folie in sichtbar:
        unten = set()
        for form in folie.shapes:
            if form.has_text_frame and form.text_frame.text.strip() and (form.top or 0) > leser.hoehe * 0.85:
                unten.add(form.text_frame.text.strip())
        zaehler.update(unten)
    leser.fusszeilen = {t for t, n in zaehler.items() if n >= 3}

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

    # Bilder, die nicht im Markdown vorkommen (z. B. Symbole), wieder loeschen
    alles = "\n".join(folien_md)
    for pfad in set(leser.bilder_gespeichert.values()):
        if pfad not in alles:
            (bildordner / Path(pfad).name).unlink(missing_ok=True)

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

    kandidaten = [c for c in kandidaten if c not in ("FFFFFF", "000000")]
    ergebnis["dunkelblau"] = beste(lambda h, l, s: 0.58 <= h <= 0.72 and l < 0.35 and s > 0.25)
    ergebnis["petrol"] = beste(lambda h, l, s: 0.44 <= h < 0.58 and 0.15 < l < 0.5 and s > 0.25)
    ergebnis["orange"] = beste(lambda h, l, s: (h <= 0.12 or h >= 0.97) and 0.35 < l < 0.7 and s > 0.6)
    ergebnis["hellgrau"] = beste(lambda h, l, s: 0.88 < l < 0.985)
    ergebnis["text"] = beste(lambda h, l, s: l < 0.22 and s < 0.35)
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
