/* Startseite: Kapitel und Lektionen aus daten/index.json anzeigen. */
(function () {
  "use strict";

  var inhalt = document.getElementById("inhalt");
  var filter = document.getElementById("filter");
  var suche = document.getElementById("suche");
  var daten = null;

  var DOWNLOADS = [
    { schluessel: "pdf", text: "PDF" },
    { schluessel: "pdfNotizen", text: "PDF mit Notizen" },
    { schluessel: "pptx", text: "PPTX" },
    { schluessel: "html", text: "HTML (offline)" },
    { schluessel: "original", text: "Original (.pptx)" }
  ];

  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }

  function normal(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ");
  }

  function datumText(iso) {
    if (!iso) return "";
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + "." + m[2] + "." + m[1] : iso;
  }

  function downloadKnopf(eintrag, text) {
    var link = el("a", "knopf knopf-klein", text);
    link.href = eintrag.datei;
    link.setAttribute("download", eintrag.name);
    link.title = eintrag.name;
    return link;
  }

  function lektionKarte(lektion) {
    var karte = el("article", "lektion");
    karte.dataset.suche = normal(
      [lektion.titel, lektion.untertitel, lektion.niveau ? "niveau " + lektion.niveau : "", lektion.suchtext].join(" ")
    );

    var kopf = el("div", "lektion-kopf");
    var nummer = el("div", "lektion-nummer");
    if (lektion.nummer) {
      nummer.appendChild(el("small", null, "Lektion"));
      nummer.appendChild(document.createTextNode(lektion.nummer));
    } else {
      nummer.textContent = (lektion.titel || "?").charAt(0).toUpperCase();
    }
    kopf.appendChild(nummer);
    var titelBlock = el("div");
    titelBlock.appendChild(el("h3", null, lektion.titel));
    if (lektion.untertitel) titelBlock.appendChild(el("p", "untertitel", lektion.untertitel));
    kopf.appendChild(titelBlock);
    karte.appendChild(kopf);

    var angaben = el("ul", "lektion-daten");
    if (lektion.datum) angaben.appendChild(el("li", null, datumText(lektion.datum)));
    if (lektion.niveau) angaben.appendChild(el("li", "niveau", "Niveau " + lektion.niveau));
    angaben.appendChild(el("li", null, lektion.folien + (lektion.folien === 1 ? " Folie" : " Folien")));
    karte.appendChild(angaben);

    var aktionen = el("div", "lektion-aktionen");
    var zeile1 = el("div", "aktionen-zeile");
    var praesentieren = el("a", "knopf knopf-haupt", "Präsentieren");
    praesentieren.href = "praesentation.html?p=" + encodeURIComponent(lektion.pfad).replace(/%2F/g, "/");
    var referent = el("a", "knopf knopf-referent", "Referentenansicht");
    referent.href = praesentieren.href + "&referent=1";
    var tafel = el("a", "knopf knopf-tafel", "Interaktive Tafel");
    tafel.href = "tafel.html?p=" + encodeURIComponent(lektion.pfad).replace(/%2F/g, "/");
    tafel.title = "Interaktive Tafel mit den Folien dieser Präsentation";
    zeile1.appendChild(praesentieren);
    zeile1.appendChild(referent);
    zeile1.appendChild(tafel);
    aktionen.appendChild(zeile1);

    var zeile2 = el("div", "aktionen-zeile");
    DOWNLOADS.forEach(function (d) {
      var eintrag = lektion.downloads && lektion.downloads[d.schluessel];
      if (!eintrag) return;
      var text = d.text;
      // Mehrere Originale (Praesentation aus mehreren PowerPoint-Dateien)
      if (d.schluessel === "original" && lektion.downloads.original2) text = "Original Teil 1 (.pptx)";
      zeile2.appendChild(downloadKnopf(eintrag, text));
      if (d.schluessel === "original") {
        for (var i = 2; lektion.downloads["original" + i]; i++) {
          zeile2.appendChild(downloadKnopf(lektion.downloads["original" + i], "Original Teil " + i + " (.pptx)"));
        }
      }
    });
    aktionen.appendChild(zeile2);
    karte.appendChild(aktionen);
    return karte;
  }

  function zeichnen() {
    inhalt.innerHTML = "";
    daten.kapitel.forEach(function (kapitel) {
      var abschnitt = el("section", "kapitel");
      abschnitt.id = "kapitel-" + kapitel.id;
      abschnitt.dataset.kapitel = kapitel.id;

      var kopf = el("div", "kapitel-kopf");
      kopf.appendChild(el("h2", null, kapitel.titel));
      if (kapitel.zip) kopf.appendChild(downloadKnopf(kapitel.zip, "Kapitel offline (ZIP)"));
      abschnitt.appendChild(kopf);

      if (!kapitel.lektionen.length) {
        abschnitt.appendChild(el("p", "kapitel-leer", "Noch keine Präsentation"));
      } else {
        var raster = el("div", "karten-raster");
        kapitel.lektionen.forEach(function (lektion) {
          raster.appendChild(lektionKarte(lektion));
        });
        abschnitt.appendChild(raster);
      }
      inhalt.appendChild(abschnitt);
    });
    var keinTreffer = el("p", "leer-treffer", "Keine Präsentation gefunden.");
    keinTreffer.id = "kein-treffer";
    keinTreffer.hidden = true;
    inhalt.appendChild(keinTreffer);
  }

  function anwenden() {
    var kapitelWahl = filter.value;
    var begriffe = normal(suche.value).trim().split(" ").filter(Boolean);
    var sichtbar = 0;
    inhalt.querySelectorAll(".kapitel").forEach(function (abschnitt) {
      var passtKapitel = !kapitelWahl || abschnitt.dataset.kapitel === kapitelWahl;
      var karten = abschnitt.querySelectorAll(".lektion");
      var treffer = 0;
      karten.forEach(function (karte) {
        var passt =
          passtKapitel &&
          begriffe.every(function (b) {
            return karte.dataset.suche.indexOf(b) !== -1;
          });
        karte.hidden = !passt;
        if (passt) treffer++;
      });
      // Ohne Suche bleiben leere Kapitel sichtbar (Hinweis "Noch keine Praesentation")
      abschnitt.hidden = !passtKapitel || (begriffe.length > 0 && treffer === 0);
      if (!abschnitt.hidden) sichtbar++;
    });
    document.getElementById("kein-treffer").hidden = sichtbar > 0;
    try {
      sessionStorage.setItem("mi-filter", JSON.stringify({ kapitel: kapitelWahl, suche: suche.value }));
    } catch (e) {
      /* egal */
    }
  }

  fetch("daten/index.json", { cache: "no-cache" })
    .then(function (antwort) {
      if (!antwort.ok) throw new Error("Verzeichnis nicht gefunden (" + antwort.status + ")");
      return antwort.json();
    })
    .then(function (index) {
      daten = index;
      daten.kapitel.forEach(function (k) {
        var option = el("option", null, k.titel);
        option.value = k.id;
        filter.appendChild(option);
      });
      zeichnen();
      try {
        var gemerkt = JSON.parse(sessionStorage.getItem("mi-filter") || "{}");
        if (gemerkt.kapitel) filter.value = gemerkt.kapitel;
        if (gemerkt.suche) suche.value = gemerkt.suche;
      } catch (e) {
        /* egal */
      }
      anwenden();
      if (index.erstellt) {
        document.getElementById("fuss").textContent =
          "Stand: " + new Date(index.erstellt).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
      }
    })
    .catch(function (fehler) {
      inhalt.innerHTML = "";
      inhalt.appendChild(el("p", "ladeanzeige", "Fehler beim Laden: " + fehler.message));
    });

  filter.addEventListener("change", anwenden);
  suche.addEventListener("input", anwenden);
})();
