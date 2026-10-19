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

  /** Ersetzt Bildpfade wie bilder/foto.png durch entschluesselte Blob-Adressen. */
  async function bilderEinsetzen(markdown, bilder) {
    var namen = Object.keys(bilder || {}).sort(function (a, b) {
      return b.length - a.length;
    });
    for (var i = 0; i < namen.length; i++) {
      var name = namen[i];
      if (markdown.indexOf(name) === -1) continue;
      var eintrag = bilder[name];
      var bytes = await MiKrypto.datei(eintrag.datei);
      var url = URL.createObjectURL(new Blob([bytes], { type: eintrag.typ }));
      markdown = markdown.split(name).join(url);
    }
    return markdown;
  }

  async function laden() {
    if (!pfad) {
      fehler("Im Link fehlt die Angabe, welche Präsentation gezeigt werden soll.");
      return;
    }
    var index;
    try {
      index = await MiKrypto.index();
    } catch (e) {
      if (/Nicht angemeldet/.test(e.message)) {
        location.replace("index.html?weiter=" + encodeURIComponent("praesentation.html" + location.search + location.hash));
        return;
      }
      throw e;
    }
    var lektion = suchen(index);
    if (!lektion) {
      fehler("Die Präsentation «" + pfad + "» gibt es nicht (mehr).");
      return;
    }
    var markdown = new TextDecoder().decode(await MiKrypto.datei(lektion.md));
    markdown = await bilderEinsetzen(markdown, lektion.bilder);

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
            return MiKrypto.herunterladen(eintrag);
          }
        });
      }
    });

    MiFolien.starten({
      markdown: markdown,
      titel: lektion.titel + " · Medien und Informatik",
      nummer: lektion.nummer,
      downloads: downloads,
      startseite: "start.html",
      referent: parameter.get("referent") === "1" && !/receiver/i.test(location.search)
    });
  }

  laden().catch(function (e) {
    fehler("Beim Laden ist ein Fehler aufgetreten: " + e.message);
  });
})();
