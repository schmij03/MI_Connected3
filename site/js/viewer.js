/* Viewer: laedt eine Praesentation (praesentation.html?p=kapitel/lektion) und startet sie. */
(function () {
  "use strict";

  var parameter = new URLSearchParams(window.location.search);
  var pfad = (parameter.get("p") || "").replace(/\.md$/, "");

  function fehler(text) {
    document.getElementById("fehler-text").textContent = text;
    document.getElementById("fehler").hidden = false;
  }

  function suchen(index) {
    for (var i = 0; i < index.kapitel.length; i++) {
      var lektionen = index.kapitel[i].lektionen;
      for (var j = 0; j < lektionen.length; j++) {
        if (lektionen[j].pfad === pfad) return lektionen[j];
      }
    }
    return null;
  }

  /** Ersetzt Bildpfade wie bilder/foto.png durch ihre Adresse auf der Website. */
  function bilderEinsetzen(markdown, bilder) {
    var namen = Object.keys(bilder || {}).sort(function (a, b) {
      return b.length - a.length;
    });
    namen.forEach(function (name) {
      markdown = markdown.split(name).join(bilder[name].datei);
    });
    return markdown;
  }

  function holen(adresse) {
    return fetch(adresse, { cache: "no-cache" }).then(function (antwort) {
      if (!antwort.ok) throw new Error("Datei nicht gefunden (" + antwort.status + ")");
      return antwort;
    });
  }

  function herunterladen(eintrag) {
    var a = document.createElement("a");
    a.href = eintrag.datei;
    a.download = eintrag.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function laden() {
    if (!pfad) {
      fehler("Im Link fehlt die Angabe, welche Präsentation gezeigt werden soll.");
      return;
    }
    var index = await (await holen("daten/index.json")).json();
    var lektion = suchen(index);
    if (!lektion) {
      fehler("Die Präsentation «" + pfad + "» gibt es nicht (mehr).");
      return;
    }
    var markdown = await (await holen(lektion.md)).text();
    markdown = bilderEinsetzen(markdown, lektion.bilder);

    var downloads = [];
    [
      ["pdf", "PDF"],
      ["pptx", "PPTX"],
      ["html", "HTML"]
    ].forEach(function (d) {
      var eintrag = lektion.downloads && lektion.downloads[d[0]];
      if (eintrag) {
        downloads.push({
          text: d[1],
          aktion: function () {
            herunterladen(eintrag);
          }
        });
      }
    });

    MiFolien.starten({
      markdown: markdown,
      titel: lektion.titel + " · Medien und Informatik",
      nummer: lektion.nummer,
      downloads: downloads,
      startseite: "index.html",
      referent: parameter.get("referent") === "1" && !/receiver/i.test(location.search)
    });
  }

  laden().catch(function (e) {
    fehler("Beim Laden ist ein Fehler aufgetreten: " + e.message);
  });
})();
