"""Tests fuer den Konverter. Aufruf: python -m unittest discover tools/tests"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HIER = Path(__file__).resolve().parent
WURZEL = HIER.parent.parent


class KonverterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ordner = Path(tempfile.mkdtemp())
        inhalte = cls.ordner / "inhalte"
        inhalte.mkdir()
        shutil.copy(WURZEL / "inhalte" / "kapitel.json", inhalte / "kapitel.json")
        (cls.ordner / "quellen").mkdir()
        os.environ["MI_INHALTE"] = str(inhalte)
        os.environ["MI_QUELLEN"] = str(cls.ordner / "quellen")
        sys.path.insert(0, str(HIER))
        sys.path.insert(0, str(WURZEL / "tools"))
        import test_pptx_erzeugen
        import pptx_zu_md

        cls.konverter = pptx_zu_md
        cls.pptx = test_pptx_erzeugen.erzeugen(cls.ordner / "quellen" / "MI_K1_L2_NiveauB_Bewertungen_mit_Loesungen.pptx")
        code = pptx_zu_md.main([str(cls.pptx), "--kapitel", "k1", "--id", "l2-bewertungen", "--datum", "2026-09-22"])
        assert code == 0
        cls.md = (inhalte / "k1" / "l2-bewertungen.md").read_text(encoding="utf-8")
        cls.folien = cls.md.split("\n\n---\n\n")
        cls.json = json.loads((inhalte / "kapitel.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.ordner)

    def test_ausgeblendete_folie_in_notizen(self):
        self.assertEqual(len(self.folien), 8)
        self.assertIn("Ausgeblendete Folie 2", self.folien[0].split("Note:")[1])
        self.assertNotIn("## Planung", self.md)

    def test_titelfolie(self):
        self.assertIn('class="titel"', self.folien[0])
        self.assertIn("# Kann man Bewertungen trauen?", self.folien[0])

    def test_auftrag(self):
        folie = self.folien[2]
        self.assertIn('class="auftrag"', folie)
        self.assertIn("## Bewertungen prüfen", folie)
        self.assertIn("- Zeit: 15'", folie)
        self.assertIn("- Sozialform: Partnerarbeit", folie)
        self.assertIn("1. Lest die drei Bewertungen.", folie)
        self.assertIn("> Tipp:", folie)

    def test_tabelle_bild_karten(self):
        self.assertIn("| Provider | verkauft den Internetzugang | Swisscom \\| Salt |", self.md)
        self.assertIn('class="spalten"', self.folien[4])
        self.assertIn("![Weg der Daten](bilder/", self.folien[4])
        self.assertIn('class="karten"', self.folien[5])
        self.assertEqual(self.folien[5].count("### "), 3)

    def test_loesung_und_merke(self):
        self.assertIn('class="loesung"', self.folien[6])
        self.assertIn('class="merke"', self.folien[7])
        self.assertNotIn("Merke:", self.folien[7])

    def test_kapitel_json(self):
        k1 = next(k for k in self.json["kapitel"] if k["id"] == "k1")
        eintrag = k1["lektionen"][0]
        self.assertEqual(eintrag["titel"], "Kann man Bewertungen trauen?")
        self.assertEqual(eintrag["niveau"], "B")
        self.assertEqual(eintrag["datum"], "2026-09-22")
        self.assertEqual(eintrag["original"], self.pptx.name)

    def test_dateiname(self):
        import neue_quellen

        self.assertEqual(neue_quellen.aus_dateiname("MI_K1_L2_NiveauB_Bewertungen_und_Datenstau_mit_Loesungen.pptx"), ("k1", "l2-bewertungen-datenstau"))
        self.assertEqual(neue_quellen.aus_dateiname("MI_Einführung_L1_Kennenlernen.pptx"), ("einfuehrung", "l1-kennenlernen"))
        self.assertEqual(neue_quellen.aus_dateiname("Präsentation.pptx")[1], None)


if __name__ == "__main__":
    unittest.main()
