#!/usr/bin/env python3
"""
Wandelt neue PowerPoint-Dateien in quellen/ automatisch um.

"Neu" heisst: Keine Lektion in inhalte/kapitel.json verweist mit "original"
auf die Datei. Kapitel und Lektion werden aus dem Dateinamen gelesen:

  MI_K1_L3_Datenpakete.pptx          -> Kapitel k1, Lektion l3-datenpakete
  MI_K2_L5_NiveauA_Geraete.pptx      -> Kapitel k2, Lektion l5-geraete, Niveau A
  MI_Einfuehrung_L1_Kennenlernen.pptx -> Kapitel einfuehrung, Lektion l1-kennenlernen
  MI_Word_L2_Tabellen.pptx           -> Kapitel word, Lektion l2-tabellen

Bestehende Markdown-Dateien werden nie ueberschrieben.
Laeuft im GitHub-Workflow vor dem Build, kann aber auch lokal gestartet werden:
  python tools/neue_quellen.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pptx_zu_md as konverter  # noqa: E402

UMLAUTE = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "ae", "Ö": "oe", "Ü": "ue", "ß": "ss"})
FUELLWOERTER = {"mi", "mit", "loesungen", "loesung", "und", "der", "die", "das", "praesentation", "folien", "final", "neu"}


def aus_dateiname(name: str) -> tuple[str | None, str | None]:
    """Liefert (kapitel, lektion) oder None, wenn nicht eindeutig."""
    stamm = Path(name).stem.translate(UMLAUTE)
    teile = [t for t in re.split(r"[\s_\-]+", stamm) if t]
    kapitel = None
    nummer = None
    rest = []
    for i, t in enumerate(teile):
        klein = t.lower()
        if kapitel is None and re.fullmatch(r"k(ap(itel)?)?\d", klein):
            kapitel = "k" + klein[-1]
        elif kapitel is None and klein in ("kapitel", "kap") and i + 1 < len(teile) and teile[i + 1][:1].isdigit():
            kapitel = "k" + teile[i + 1][0]
        elif kapitel is None and klein.startswith("einf"):
            kapitel = "einfuehrung"
        elif kapitel is None and klein == "word":
            kapitel = "word"
        elif nummer is None and re.fullmatch(r"l(ektion)?\d+", klein):
            nummer = re.sub(r"\D", "", klein)
        elif nummer is None and klein == "lektion" and i + 1 < len(teile) and teile[i + 1].isdigit():
            nummer = teile[i + 1]
        elif re.fullmatch(r"niveau[abc]?", klein) or re.fullmatch(r"\d+[a-z]?", klein):
            continue
        elif klein not in FUELLWOERTER:
            rest.append(klein)
    if not kapitel or not nummer:
        return kapitel, None
    kurz = "-".join(re.sub(r"[^a-z0-9]", "", w) for w in rest[:4] if re.sub(r"[^a-z0-9]", "", w))
    return kapitel, f"l{int(nummer)}" + (f"-{kurz}" if kurz else "")


def main() -> int:
    daten = json.loads((konverter.INHALTE / "kapitel.json").read_text(encoding="utf-8"))
    bekannt = {o for k in daten["kapitel"] for l in k.get("lektionen", []) for o in ([l["original"]] if isinstance(l.get("original"), str) else l.get("original") or [])}
    kapitel_ids = {k["id"] for k in daten["kapitel"]}
    meldungen = []
    neu = 0
    for datei in sorted(konverter.QUELLEN.glob("*.pptx")):
        if datei.name.startswith("~$") or datei.name in bekannt:
            continue
        kapitel, lektion = aus_dateiname(datei.name)
        if not kapitel or not lektion or kapitel not in kapitel_ids:
            meldungen.append(
                f"«{datei.name}» wurde nicht umgewandelt: Kapitel oder Lektion nicht erkennbar. "
                "Bitte umbenennen, z. B. MI_K1_L3_Kurztitel.pptx, oder von Hand umwandeln (siehe README)."
            )
            continue
        if (konverter.INHALTE / kapitel / f"{lektion}.md").exists():
            meldungen.append(f"«{datei.name}»: inhalte/{kapitel}/{lektion}.md gibt es schon, nicht ueberschrieben.")
            continue
        print(f"Neue Datei {datei.name} -> {kapitel}/{lektion}")
        code = konverter.main([str(datei), "--kapitel", kapitel, "--id", lektion])
        if code == 0:
            neu += 1
        else:
            meldungen.append(f"«{datei.name}»: Umwandlung fehlgeschlagen.")

    for m in meldungen:
        print("Hinweis: " + m)
    zusammenfassung = os.environ.get("GITHUB_STEP_SUMMARY")
    if zusammenfassung:
        with open(zusammenfassung, "a", encoding="utf-8") as f:
            f.write(f"### Neue PowerPoint-Dateien\n\n{neu} Datei(en) umgewandelt.\n\n")
            for m in meldungen:
                f.write(f"- {m}\n")
    print(f"{neu} neue Datei(en) umgewandelt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
