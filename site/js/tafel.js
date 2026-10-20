/*
 * Interaktive Tafel (tafel.html, mit ?p=kapitel/lektion fuer die Folien einer Praesentation).
 *
 * Aufbau: Die Tafel ist eine feste Flaeche von 1600 x 900 Punkten, die auf
 * den Bildschirm skaliert wird. Darauf liegen Elemente (Text, Notiz, Bild,
 * Link/Video, Folie, Timer, Stoppuhr, Zufall, Gruppen, Wuerfel). Darueber
 * liegt eine Zeichenebene; im Modus «Zeichnen» schreibt man auf die ganze
 * Tafel, im Modus «Bearbeiten» verschiebt und aendert man die Elemente.
 *
 * Gespeichert wird im Browser (localStorage), pro Praesentation eine Tafel.
 * «Datei > Tafel als Datei speichern» schreibt sie als JSON zum Weitergeben.
 */
(function () {
  "use strict";

  var BREITE = 1600;
  var HOEHE = 900;
  var AUFLOESUNG = 2; // Zeichenebene in doppelter Aufloesung
  var MAX_VERLAUF = 60;

  var parameter = new URLSearchParams(window.location.search);
  var pfad = (parameter.get("p") || "").replace(/\.md$/, "");
  var SPEICHER = "mi-tafel:" + (pfad || "leer");

  var FARBEN = ["#1f2933", "#065a82", "#e4572e", "#2e7d32", "#f2c94c", "#ffffff"];
  var DICKEN = [3, 6, 12];
  var NOTIZFARBEN = ["#fff3a8", "#ffd6e0", "#d4f1d6", "#d6ecfb"];

  var ICONS = {
    zeiger: '<path d="M5 3l14 7-6 2-2 6z"/>',
    stift: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
    marker: '<path d="M9 15l-3 5h6l1-3"/><path d="M9 15l7-11 4 3-7 10z"/>',
    radierer: '<path d="M8 20h12"/><path d="M4 15l9-9 6 6-8 8H8z"/><path d="M9 10l6 6"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    notiz: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
    bild: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
    link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
    stoppuhr: '<circle cx="12" cy="13" r="8"/><path d="M12 13V8M10 2h4M19 6l1.5-1.5"/>',
    zufall: '<path d="M3 7h3c5 0 7 10 12 10h3"/><path d="M3 17h3c2 0 3.5-1.6 4.6-3.6M13.4 9.6C14.5 7.6 16 7 18 7h3"/><path d="M19 4l3 3-3 3M19 14l3 3-3 3"/>',
    gruppen: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M17 14c2.8 0 4.5 2 4.5 5"/>',
    wuerfel: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    muell: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    folien: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
    zurueck: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    vor: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    datei: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    vollbild: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    kopie: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    links: '<path d="M15 5l-7 7 7 7"/>',
    rechts: '<path d="M9 5l7 7-7 7"/>',
    farbe: '<circle cx="12" cy="12" r="8"/>',
    groesser: '<path d="M4 18L9 6l5 12M6 14h6M18 9v6M15 12h6"/>',
    kleiner: '<path d="M4 18L9 6l5 12M6 14h6M15 12h6"/>'
  };

  function icon(name) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || "") +
      "</svg>"
    );
  }

  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }

  function knopf(klasse, iconName, titel, text) {
    var k = el("button", klasse);
    k.type = "button";
    k.title = titel;
    k.setAttribute("aria-label", titel);
    k.innerHTML = icon(iconName);
    if (text) k.appendChild(el("span", null, text));
    return k;
  }

  function neueId() {
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function begrenzen(wert, min, max) {
    return Math.max(min, Math.min(max, wert));
  }

  function zweistellig(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function zeitText(sekunden) {
    sekunden = Math.max(0, Math.ceil(sekunden));
    return zweistellig(Math.floor(sekunden / 60)) + ":" + zweistellig(sekunden % 60);
  }

  function namenListe(text) {
    return String(text || "")
      .split(/[\n,;]+/)
      .map(function (n) {
        return n.trim();
      })
      .filter(Boolean);
  }

  function mischen(liste) {
    var a = liste.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // ---------- Zustand ----------

  var tafelEl = document.getElementById("tafel");
  var rahmen = document.getElementById("rahmen");
  var ebene = document.getElementById("elemente");
  var leinwand = document.getElementById("zeichnung");
  var stift = leinwand.getContext("2d");

  var zustand = leererZustand();
  var lektion = null; // Eintrag aus daten/index.json
  var folienTitel = []; // Titel der Folien der Praesentation
  var modus = "bearbeiten";
  var werkzeug = "stift";
  var farbe = FARBEN[0];
  var dicke = DICKEN[1];
  var massstab = 1;
  var gewaehlt = null;
  var verlauf = [];
  var verlaufPos = -1;
  var laufend = {}; // Intervalle von Timer und Stoppuhr pro Element

  function leererZustand() {
    return { version: 1, hintergrund: "weiss", elemente: [], striche: [] };
  }

  function gueltig(daten) {
    return daten && daten.version === 1 && Array.isArray(daten.elemente) && Array.isArray(daten.striche);
  }

  // ---------- Speichern und Verlauf ----------

  var speicherTakt = null;
  var speicherWarnung = false;

  function speichern() {
    clearTimeout(speicherTakt);
    speicherTakt = setTimeout(function () {
      try {
        localStorage.setItem(SPEICHER, JSON.stringify(zustand));
        speicherWarnung = false;
      } catch (e) {
        if (!speicherWarnung) {
          melden("Der Browserspeicher ist voll. Tafel über «Datei» als Datei speichern oder grosse Bilder entfernen.", 8000);
          speicherWarnung = true;
        }
      }
    }, 250);
  }

  /** Haelt den aktuellen Stand fuer Rueckgaengig fest und speichert ihn. */
  function festhalten() {
    var stand = JSON.stringify(zustand);
    if (verlauf[verlaufPos] === stand) return;
    verlauf = verlauf.slice(0, verlaufPos + 1);
    verlauf.push(stand);
    if (verlauf.length > MAX_VERLAUF) verlauf.shift();
    verlaufPos = verlauf.length - 1;
    verlaufKnoepfe();
    speichern();
  }

  function zurueckholen(schritt) {
    var ziel = verlaufPos + schritt;
    if (ziel < 0 || ziel >= verlauf.length) return;
    verlaufPos = ziel;
    zustand = JSON.parse(verlauf[verlaufPos]);
    allesZeichnen();
    verlaufKnoepfe();
    speichern();
  }

  function verlaufKnoepfe() {
    document.getElementById("rueckgaengig").disabled = verlaufPos <= 0;
    document.getElementById("wiederholen").disabled = verlaufPos >= verlauf.length - 1;
  }

  var meldungTakt = null;
  function melden(text, dauer) {
    var m = document.getElementById("meldung");
    m.textContent = text;
    m.hidden = false;
    clearTimeout(meldungTakt);
    meldungTakt = setTimeout(function () {
      m.hidden = true;
    }, dauer || 3000);
  }

  // ---------- Massstab ----------

  function einpassen() {
    var b = rahmen.clientWidth - 24;
    var h = rahmen.clientHeight - 24;
    massstab = Math.max(0.1, Math.min(b / BREITE, h / HOEHE));
    tafelEl.style.transform = "scale(" + massstab + ")";
    tafelEl.style.left = Math.max(12, (rahmen.clientWidth - BREITE * massstab) / 2) + "px";
    tafelEl.style.top = Math.max(12, (rahmen.clientHeight - HOEHE * massstab) / 2) + "px";
  }

  /** Bildschirmpunkt in Tafelkoordinaten */
  function tafelPunkt(ereignis) {
    var r = tafelEl.getBoundingClientRect();
    return { x: (ereignis.clientX - r.left) / massstab, y: (ereignis.clientY - r.top) / massstab };
  }

  // ---------- Elemente ----------

  var GROESSE = {
    text: [460, 170],
    notiz: [320, 280],
    bild: [480, 380],
    link: [560, 360],
    folie: [960, 584],
    timer: [400, 300],
    stoppuhr: [400, 260],
    zufall: [440, 380],
    gruppen: [620, 440],
    wuerfel: [360, 280]
  };

  var NAMEN = {
    text: "Text",
    notiz: "Notiz",
    bild: "Bild",
    link: "Link",
    folie: "Folie",
    timer: "Timer",
    stoppuhr: "Stoppuhr",
    zufall: "Zufall",
    gruppen: "Gruppen",
    wuerfel: "Würfel"
  };

  /** Sucht die Stelle, an der ein neues Element am wenigsten verdeckt. */
  function freierPlatz(b, h) {
    var bester = null;
    for (var y = 20; y <= HOEHE - h - 20; y += 40) {
      for (var x = 20; x <= BREITE - b - 20; x += 40) {
        var verdeckt = 0;
        zustand.elemente.forEach(function (e) {
          var ub = Math.min(x + b, e.x + e.b) - Math.max(x, e.x);
          var uh = Math.min(y + h, e.y + e.h) - Math.max(y, e.y);
          if (ub > 0 && uh > 0) verdeckt += ub * uh;
        });
        if (!bester || verdeckt < bester.verdeckt) bester = { x: x, y: y, verdeckt: verdeckt };
        if (verdeckt === 0) return bester;
      }
    }
    return bester || { x: (BREITE - b) / 2, y: (HOEHE - h) / 2 };
  }

  function hinzufuegen(typ, daten, ort) {
    var g = GROESSE[typ];
    var b = (ort && ort.b) || g[0];
    var h = (ort && ort.h) || g[1];
    var x, y;
    if (ort && ort.x != null) {
      x = ort.x;
      y = ort.y;
    } else {
      var platz = freierPlatz(b, h);
      x = platz.x;
      y = platz.y;
    }
    var e = {
      id: neueId(),
      typ: typ,
      x: Math.round(begrenzen(x, 0, BREITE - 60)),
      y: Math.round(begrenzen(y, 0, HOEHE - 40)),
      b: b,
      h: h,
      z: hoechsteEbene() + 1,
      daten: daten || {}
    };
    zustand.elemente.push(e);
    var knoten = elementBauen(e);
    ebene.appendChild(knoten);
    waehlen(e.id);
    festhalten();
    return knoten;
  }

  function hoechsteEbene() {
    return zustand.elemente.reduce(function (m, e) {
      return Math.max(m, e.z || 0);
    }, 0);
  }

  function finden(id) {
    for (var i = 0; i < zustand.elemente.length; i++) if (zustand.elemente[i].id === id) return zustand.elemente[i];
    return null;
  }

  function knotenVon(id) {
    return ebene.querySelector('[data-id="' + id + '"]');
  }

  function lage(knoten, e) {
    knoten.style.left = e.x + "px";
    knoten.style.top = e.y + "px";
    knoten.style.width = e.b + "px";
    knoten.style.height = e.h + "px";
    knoten.style.zIndex = e.z;
  }

  function waehlen(id) {
    gewaehlt = id;
    ebene.querySelectorAll(".element").forEach(function (k) {
      k.classList.toggle("gewaehlt", k.dataset.id === id);
    });
  }

  function entfernen(id) {
    stoppen(id);
    zustand.elemente = zustand.elemente.filter(function (e) {
      return e.id !== id;
    });
    var k = knotenVon(id);
    if (k) k.remove();
    if (gewaehlt === id) gewaehlt = null;
    festhalten();
  }

  function nachVorne(e, knoten) {
    if (e.z === hoechsteEbene()) return;
    e.z = hoechsteEbene() + 1;
    knoten.style.zIndex = e.z;
  }

  function stoppen(id) {
    if (laufend[id]) {
      clearInterval(laufend[id]);
      delete laufend[id];
    }
  }

  /** Baut den Rahmen eines Elements: Griffleiste, Inhalt, Ziehpunkt. */
  function elementBauen(e) {
    var knoten = el("div", "element element-" + e.typ);
    knoten.dataset.id = e.id;
    lage(knoten, e);

    var griff = el("div", "griff");
    griff.appendChild(el("span", "griff-name", NAMEN[e.typ] || e.typ));
    var werkzeuge = el("span", "griff-werkzeuge");
    griff.appendChild(werkzeuge);
    var kopie = knopf("g-knopf", "kopie", "Duplizieren");
    kopie.addEventListener("click", function () {
      var daten = JSON.parse(JSON.stringify(e.daten));
      hinzufuegen(e.typ, daten, { x: e.x + 30, y: e.y + 30, b: e.b, h: e.h });
    });
    var weg = knopf("g-knopf", "muell", "Löschen (Entf)");
    weg.addEventListener("click", function () {
      entfernen(e.id);
    });
    werkzeuge.appendChild(kopie);
    werkzeuge.appendChild(weg);
    knoten.appendChild(griff);

    var koerper = el("div", "koerper");
    knoten.appendChild(koerper);
    var ziehpunkt = el("div", "ziehpunkt");
    ziehpunkt.title = "Grösse ändern";
    knoten.appendChild(ziehpunkt);

    knoten.addEventListener("pointerdown", function () {
      waehlen(e.id);
    });
    verschiebbar(griff, knoten, e);
    groesseAenderbar(ziehpunkt, knoten, e);

    var bauer = INHALT[e.typ];
    if (bauer) bauer(e, koerper, werkzeuge, knoten);
    // Bilder und Folien lassen sich auch am Inhalt verschieben
    if (e.typ === "bild" || e.typ === "folie") verschiebbar(koerper, knoten, e);
    return knoten;
  }

  function verschiebbar(anfasser, knoten, e) {
    anfasser.addEventListener("pointerdown", function (start) {
      if (start.button !== 0 || start.target.closest("button, input, select, textarea, a, [contenteditable]")) return;
      start.preventDefault();
      nachVorne(e, knoten);
      var p0 = tafelPunkt(start);
      var x0 = e.x;
      var y0 = e.y;
      anfasser.setPointerCapture(start.pointerId);
      function bewegen(ev) {
        var p = tafelPunkt(ev);
        e.x = Math.round(begrenzen(x0 + p.x - p0.x, -e.b + 60, BREITE - 60));
        e.y = Math.round(begrenzen(y0 + p.y - p0.y, 0, HOEHE - 40));
        lage(knoten, e);
      }
      function ende() {
        anfasser.removeEventListener("pointermove", bewegen);
        anfasser.removeEventListener("pointerup", ende);
        anfasser.removeEventListener("pointercancel", ende);
        knoten.classList.remove("zieht");
        festhalten();
      }
      knoten.classList.add("zieht");
      anfasser.addEventListener("pointermove", bewegen);
      anfasser.addEventListener("pointerup", ende);
      anfasser.addEventListener("pointercancel", ende);
    });
  }

  function groesseAenderbar(punkt, knoten, e) {
    punkt.addEventListener("pointerdown", function (start) {
      if (start.button !== 0) return;
      start.preventDefault();
      start.stopPropagation();
      var p0 = tafelPunkt(start);
      var b0 = e.b;
      var h0 = e.h;
      // Folien behalten das Seitenverhaeltnis 16:9
      var folie = e.typ === "folie";
      punkt.setPointerCapture(start.pointerId);
      function bewegen(ev) {
        var p = tafelPunkt(ev);
        e.b = Math.round(begrenzen(b0 + p.x - p0.x, 140, BREITE));
        e.h = folie ? Math.round((e.b * 9) / 16) + 44 : Math.round(begrenzen(h0 + p.y - p0.y, 100, HOEHE));
        lage(knoten, e);
      }
      function ende() {
        punkt.removeEventListener("pointermove", bewegen);
        punkt.removeEventListener("pointerup", ende);
        knoten.classList.remove("zieht");
        festhalten();
      }
      knoten.classList.add("zieht");
      punkt.addEventListener("pointermove", bewegen);
      punkt.addEventListener("pointerup", ende);
    });
  }

  /** Bearbeitbarer Text (nur reiner Text, kein HTML) */
  function textFeld(e, koerper, platzhalter) {
    var feld = el("div", "textfeld");
    feld.contentEditable = "true";
    feld.spellcheck = false;
    feld.dataset.platzhalter = platzhalter;
    feld.textContent = e.daten.text || "";
    feld.style.fontSize = (e.daten.groesse || 32) + "px";
    feld.addEventListener("paste", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var text = (ev.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    feld.addEventListener("input", function () {
      e.daten.text = feld.innerText.replace(/\n$/, "");
      speichern();
    });
    feld.addEventListener("blur", festhalten);
    koerper.appendChild(feld);
    return feld;
  }

  function schriftKnoepfe(e, werkzeuge, feld) {
    function aendern(schritt) {
      e.daten.groesse = begrenzen((e.daten.groesse || 32) + schritt, 14, 160);
      feld.style.fontSize = e.daten.groesse + "px";
      festhalten();
    }
    var kleiner = knopf("g-knopf", "kleiner", "Schrift kleiner");
    kleiner.addEventListener("click", function () {
      aendern(-4);
    });
    var groesser = knopf("g-knopf", "groesser", "Schrift grösser");
    groesser.addEventListener("click", function () {
      aendern(4);
    });
    werkzeuge.insertBefore(groesser, werkzeuge.firstChild);
    werkzeuge.insertBefore(kleiner, werkzeuge.firstChild);
  }

  function youtubeId(url) {
    var m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  function sicherUrl(url) {
    try {
      var u = new URL(url, window.location.href);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function signal() {
    try {
      var Ton = window.AudioContext || window.webkitAudioContext;
      var ton = new Ton();
      [0, 0.35, 0.7].forEach(function (t) {
        var osz = ton.createOscillator();
        var laut = ton.createGain();
        osz.frequency.value = 880;
        laut.gain.setValueAtTime(0.25, ton.currentTime + t);
        laut.gain.exponentialRampToValueAtTime(0.001, ton.currentTime + t + 0.3);
        osz.connect(laut).connect(ton.destination);
        osz.start(ton.currentTime + t);
        osz.stop(ton.currentTime + t + 0.3);
      });
    } catch (e) {
      /* ohne Ton */
    }
  }

  var AUGEN = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
  };

  function wuerfelBild(zahl) {
    var w = el("div", "wuerfel");
    w.setAttribute("role", "img");
    w.setAttribute("aria-label", "Würfel zeigt " + zahl);
    for (var i = 1; i <= 9; i++) {
      var feld = el("span");
      if (AUGEN[zahl].indexOf(i) !== -1) feld.className = "auge";
      w.appendChild(feld);
    }
    return w;
  }

  var INHALT = {
    text: function (e, koerper, werkzeuge) {
      var feld = textFeld(e, koerper, "Text eingeben …");
      schriftKnoepfe(e, werkzeuge, feld);
    },

    notiz: function (e, koerper, werkzeuge, knoten) {
      if (!e.daten.farbe) e.daten.farbe = NOTIZFARBEN[0];
      knoten.style.setProperty("--notiz", e.daten.farbe);
      var feld = textFeld(e, koerper, "Notiz …");
      if (!e.daten.groesse) feld.style.fontSize = "28px";
      schriftKnoepfe(e, werkzeuge, feld);
      var f = knopf("g-knopf", "farbe", "Farbe wechseln");
      f.addEventListener("click", function () {
        var i = NOTIZFARBEN.indexOf(e.daten.farbe);
        e.daten.farbe = NOTIZFARBEN[(i + 1) % NOTIZFARBEN.length];
        knoten.style.setProperty("--notiz", e.daten.farbe);
        festhalten();
      });
      werkzeuge.insertBefore(f, werkzeuge.firstChild);
    },

    bild: function (e, koerper) {
      var bild = el("img");
      bild.src = e.daten.src || "";
      bild.alt = e.daten.name || "Bild";
      bild.draggable = false;
      koerper.appendChild(bild);
    },

    link: function (e, koerper) {
      var url = sicherUrl(e.daten.url);
      var id = url && youtubeId(url);
      if (id) {
        var rahmenVideo = el("iframe");
        rahmenVideo.src = "https://www.youtube-nocookie.com/embed/" + id;
        rahmenVideo.title = "YouTube-Video";
        rahmenVideo.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        rahmenVideo.allowFullscreen = true;
        rahmenVideo.referrerPolicy = "strict-origin-when-cross-origin";
        koerper.appendChild(rahmenVideo);
        return;
      }
      var karte = el("div", "link-karte");
      var a = el("a", null, e.daten.titel || url || "Link");
      if (url) {
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      karte.appendChild(a);
      if (url) karte.appendChild(el("small", null, new URL(url).host));
      koerper.appendChild(karte);
    },

    folie: function (e, koerper, werkzeuge) {
      var rahmenFolie = el("iframe");
      rahmenFolie.title = "Folie " + e.daten.nummer;
      rahmenFolie.tabIndex = -1;
      function zeigen() {
        var ziel = "praesentation.html?p=" + encodeURIComponent(e.daten.pfad).replace(/%2F/g, "/") + "&tafel=1#/" + (e.daten.nummer - 1);
        var fenster = rahmenFolie.contentWindow;
        if (fenster && fenster.Reveal && fenster.Reveal.isReady()) fenster.Reveal.slide(e.daten.nummer - 1);
        else rahmenFolie.src = ziel;
        name.textContent = "Folie " + e.daten.nummer + (e.daten.pfad === pfad && folienTitel[e.daten.nummer - 1] ? ": " + folienTitel[e.daten.nummer - 1] : "");
      }
      var name = werkzeuge.parentNode.querySelector(".griff-name");
      var zurueck = knopf("g-knopf", "links", "Vorherige Folie");
      var weiter = knopf("g-knopf", "rechts", "Nächste Folie");
      zurueck.addEventListener("click", function () {
        if (e.daten.nummer <= 1) return;
        e.daten.nummer--;
        zeigen();
        festhalten();
      });
      weiter.addEventListener("click", function () {
        var anzahl = e.daten.pfad === pfad ? folienTitel.length : 0;
        if (anzahl && e.daten.nummer >= anzahl) return;
        e.daten.nummer++;
        zeigen();
        festhalten();
      });
      werkzeuge.insertBefore(weiter, werkzeuge.firstChild);
      werkzeuge.insertBefore(zurueck, werkzeuge.firstChild);
      koerper.appendChild(rahmenFolie);
      koerper.appendChild(el("div", "folie-deckel"));
      zeigen();
    },

    timer: function (e, koerper) {
      if (!e.daten.sekunden) e.daten.sekunden = 300;
      var rest = e.daten.sekunden;
      var ende = 0;
      var anzeige = el("div", "gross-zahl", zeitText(rest));
      var balken = el("div", "zeit-balken");
      var fuellung = el("span");
      balken.appendChild(fuellung);
      var knoepfe = el("div", "widget-knoepfe");
      var minus = el("button", "w-knopf", "−1 min");
      var start = el("button", "w-knopf w-haupt", "Start");
      var plus = el("button", "w-knopf", "+1 min");
      var neu = el("button", "w-knopf", "Zurück");
      [minus, start, plus, neu].forEach(function (k) {
        k.type = "button";
        knoepfe.appendChild(k);
      });
      koerper.appendChild(anzeige);
      koerper.appendChild(balken);
      koerper.appendChild(knoepfe);

      function zeichnen() {
        anzeige.textContent = zeitText(rest);
        fuellung.style.width = (rest / e.daten.sekunden) * 100 + "%";
        koerper.classList.toggle("abgelaufen", rest <= 0);
      }
      function anhalten() {
        stoppen(e.id);
        start.textContent = "Start";
      }
      start.addEventListener("click", function () {
        if (laufend[e.id]) {
          anhalten();
          return;
        }
        if (rest <= 0) rest = e.daten.sekunden;
        ende = Date.now() + rest * 1000;
        start.textContent = "Pause";
        laufend[e.id] = setInterval(function () {
          rest = (ende - Date.now()) / 1000;
          if (rest <= 0) {
            rest = 0;
            anhalten();
            signal();
          }
          zeichnen();
        }, 200);
        zeichnen();
      });
      function verstellen(schritt) {
        anhalten();
        e.daten.sekunden = begrenzen(e.daten.sekunden + schritt, 60, 99 * 60);
        rest = e.daten.sekunden;
        zeichnen();
        festhalten();
      }
      minus.addEventListener("click", function () {
        verstellen(-60);
      });
      plus.addEventListener("click", function () {
        verstellen(60);
      });
      neu.addEventListener("click", function () {
        anhalten();
        rest = e.daten.sekunden;
        zeichnen();
      });
      zeichnen();
    },

    stoppuhr: function (e, koerper) {
      var vorher = 0;
      var seit = 0;
      var anzeige = el("div", "gross-zahl", "00:00.0");
      var knoepfe = el("div", "widget-knoepfe");
      var start = el("button", "w-knopf w-haupt", "Start");
      var neu = el("button", "w-knopf", "Zurück");
      start.type = neu.type = "button";
      knoepfe.appendChild(start);
      knoepfe.appendChild(neu);
      koerper.appendChild(anzeige);
      koerper.appendChild(knoepfe);
      function zeichnen() {
        var ms = vorher + (laufend[e.id] ? Date.now() - seit : 0);
        var s = Math.floor(ms / 1000);
        anzeige.textContent = zweistellig(Math.floor(s / 60)) + ":" + zweistellig(s % 60) + "." + Math.floor((ms % 1000) / 100);
      }
      start.addEventListener("click", function () {
        if (laufend[e.id]) {
          vorher += Date.now() - seit;
          stoppen(e.id);
          start.textContent = "Start";
        } else {
          seit = Date.now();
          laufend[e.id] = setInterval(zeichnen, 100);
          start.textContent = "Pause";
        }
        zeichnen();
      });
      neu.addEventListener("click", function () {
        stoppen(e.id);
        vorher = 0;
        start.textContent = "Start";
        zeichnen();
      });
    },

    zufall: function (e, koerper) {
      if (e.daten.namen == null) e.daten.namen = "";
      if (!e.daten.gezogen) e.daten.gezogen = [];
      if (e.daten.ohne == null) e.daten.ohne = true;
      koerper.innerHTML = "";

      if (!namenListe(e.daten.namen).length || e.daten.bearbeiten) {
        var feld = el("textarea", "namen-feld");
        feld.placeholder = "Namen, einer pro Zeile";
        feld.value = e.daten.namen;
        var zeile = el("label", "widget-option");
        var ohne = el("input");
        ohne.type = "checkbox";
        ohne.checked = e.daten.ohne;
        zeile.appendChild(ohne);
        zeile.appendChild(document.createTextNode(" Gezogene nicht wiederholen"));
        var fertig = el("button", "w-knopf w-haupt", "Fertig");
        fertig.type = "button";
        fertig.addEventListener("click", function () {
          e.daten.namen = feld.value;
          e.daten.ohne = ohne.checked;
          e.daten.gezogen = [];
          e.daten.bearbeiten = false;
          festhalten();
          INHALT.zufall(e, koerper);
        });
        koerper.appendChild(feld);
        koerper.appendChild(zeile);
        var knoepfe = el("div", "widget-knoepfe");
        knoepfe.appendChild(fertig);
        koerper.appendChild(knoepfe);
        return;
      }

      var namen = namenListe(e.daten.namen);
      var anzeige = el("div", "zufall-name", e.daten.letzter || "?");
      var info = el("div", "widget-info");
      var knoepfe2 = el("div", "widget-knoepfe");
      var ziehen = el("button", "w-knopf w-haupt", "Ziehen");
      var neu = el("button", "w-knopf", "Neu mischen");
      var liste = el("button", "w-knopf", "Namen");
      [ziehen, neu, liste].forEach(function (k) {
        k.type = "button";
        knoepfe2.appendChild(k);
      });
      function infoZeigen() {
        info.textContent = e.daten.ohne ? namen.length - e.daten.gezogen.length + " von " + namen.length + " übrig" : namen.length + " Namen";
      }
      ziehen.addEventListener("click", function () {
        var offen = e.daten.ohne
          ? namen.filter(function (n) {
              return e.daten.gezogen.indexOf(n) === -1;
            })
          : namen;
        if (!offen.length) {
          anzeige.textContent = "Alle gezogen";
          return;
        }
        var wahl = offen[Math.floor(Math.random() * offen.length)];
        var runden = 0;
        ziehen.disabled = true;
        var takt = setInterval(function () {
          anzeige.textContent = namen[Math.floor(Math.random() * namen.length)];
          if (++runden >= 12) {
            clearInterval(takt);
            anzeige.textContent = wahl;
            ziehen.disabled = false;
            e.daten.letzter = wahl;
            if (e.daten.ohne) e.daten.gezogen.push(wahl);
            infoZeigen();
            festhalten();
          }
        }, 60);
      });
      neu.addEventListener("click", function () {
        e.daten.gezogen = [];
        e.daten.letzter = "";
        anzeige.textContent = "?";
        infoZeigen();
        festhalten();
      });
      liste.addEventListener("click", function () {
        e.daten.bearbeiten = true;
        INHALT.zufall(e, koerper);
      });
      koerper.appendChild(anzeige);
      koerper.appendChild(info);
      koerper.appendChild(knoepfe2);
      infoZeigen();
    },

    gruppen: function (e, koerper) {
      if (e.daten.namen == null) e.daten.namen = "";
      if (!e.daten.groesse) e.daten.groesse = 3;
      koerper.innerHTML = "";

      if (!e.daten.gruppen || e.daten.bearbeiten) {
        var feld = el("textarea", "namen-feld");
        feld.placeholder = "Namen, einer pro Zeile";
        feld.value = e.daten.namen;
        var zeile = el("label", "widget-option", "Personen pro Gruppe ");
        var zahl = el("input");
        zahl.type = "number";
        zahl.min = "2";
        zahl.max = "10";
        zahl.value = e.daten.groesse;
        zeile.appendChild(zahl);
        var bilden = el("button", "w-knopf w-haupt", "Gruppen bilden");
        bilden.type = "button";
        bilden.addEventListener("click", function () {
          e.daten.namen = feld.value;
          e.daten.groesse = begrenzen(parseInt(zahl.value, 10) || 3, 2, 10);
          var namen = mischen(namenListe(e.daten.namen));
          if (namen.length < 2) {
            melden("Mindestens zwei Namen eingeben.");
            return;
          }
          var anzahl = Math.max(1, Math.round(namen.length / e.daten.groesse));
          var gruppen = [];
          for (var i = 0; i < anzahl; i++) gruppen.push([]);
          namen.forEach(function (n, i) {
            gruppen[i % anzahl].push(n);
          });
          e.daten.gruppen = gruppen;
          e.daten.bearbeiten = false;
          festhalten();
          INHALT.gruppen(e, koerper);
        });
        koerper.appendChild(feld);
        koerper.appendChild(zeile);
        var knoepfe = el("div", "widget-knoepfe");
        knoepfe.appendChild(bilden);
        koerper.appendChild(knoepfe);
        return;
      }

      var raster = el("div", "gruppen-raster");
      e.daten.gruppen.forEach(function (gruppe, i) {
        var karte = el("div", "gruppe");
        karte.appendChild(el("strong", null, "Gruppe " + (i + 1)));
        var ul = el("ul");
        gruppe.forEach(function (n) {
          ul.appendChild(el("li", null, n));
        });
        karte.appendChild(ul);
        raster.appendChild(karte);
      });
      var knoepfe2 = el("div", "widget-knoepfe");
      var neu = el("button", "w-knopf w-haupt", "Neu mischen");
      var aendern = el("button", "w-knopf", "Namen");
      neu.type = aendern.type = "button";
      neu.addEventListener("click", function () {
        e.daten.bearbeiten = true;
        INHALT.gruppen(e, koerper);
        koerper.querySelector(".w-haupt").click();
      });
      aendern.addEventListener("click", function () {
        e.daten.bearbeiten = true;
        INHALT.gruppen(e, koerper);
      });
      knoepfe2.appendChild(neu);
      knoepfe2.appendChild(aendern);
      koerper.appendChild(raster);
      koerper.appendChild(knoepfe2);
    },

    wuerfel: function (e, koerper) {
      if (!e.daten.anzahl) e.daten.anzahl = 1;
      if (!e.daten.werte) e.daten.werte = [6];
      var flaeche = el("div", "wuerfel-flaeche");
      var summe = el("div", "widget-info");
      var knoepfe = el("div", "widget-knoepfe");
      var werfen = el("button", "w-knopf w-haupt", "Würfeln");
      var anzahl = el("select", "w-wahl");
      anzahl.setAttribute("aria-label", "Anzahl Würfel");
      [1, 2, 3].forEach(function (n) {
        var o = el("option", null, n + (n === 1 ? " Würfel" : " Würfel"));
        o.value = n;
        anzahl.appendChild(o);
      });
      anzahl.value = e.daten.anzahl;
      werfen.type = "button";
      knoepfe.appendChild(werfen);
      knoepfe.appendChild(anzahl);
      koerper.appendChild(flaeche);
      koerper.appendChild(summe);
      koerper.appendChild(knoepfe);
      function zeichnen(werte) {
        flaeche.innerHTML = "";
        werte.forEach(function (w) {
          flaeche.appendChild(wuerfelBild(w));
        });
        summe.textContent = werte.length > 1 ? "Summe: " + werte.reduce(function (a, b) { return a + b; }, 0) : "";
      }
      function zufall() {
        var werte = [];
        for (var i = 0; i < e.daten.anzahl; i++) werte.push(1 + Math.floor(Math.random() * 6));
        return werte;
      }
      werfen.addEventListener("click", function () {
        var runden = 0;
        werfen.disabled = true;
        flaeche.classList.add("rollt");
        var takt = setInterval(function () {
          zeichnen(zufall());
          if (++runden >= 8) {
            clearInterval(takt);
            flaeche.classList.remove("rollt");
            werfen.disabled = false;
            e.daten.werte = zufall();
            zeichnen(e.daten.werte);
            festhalten();
          }
        }, 70);
      });
      anzahl.addEventListener("change", function () {
        e.daten.anzahl = parseInt(anzahl.value, 10);
        e.daten.werte = zufall();
        zeichnen(e.daten.werte);
        festhalten();
      });
      zeichnen(e.daten.werte);
    }
  };

  // ---------- Zeichnen ----------

  function strichZeichnen(s) {
    var p = s.punkte;
    if (!p || p.length < 2) return;
    stift.save();
    stift.lineCap = "round";
    stift.lineJoin = "round";
    stift.strokeStyle = s.farbe;
    stift.fillStyle = s.farbe;
    stift.lineWidth = s.dicke;
    if (s.werkzeug === "radierer") stift.globalCompositeOperation = "destination-out";
    if (s.werkzeug === "marker") stift.globalAlpha = 0.35;
    stift.beginPath();
    if (p.length === 2) {
      stift.arc(p[0], p[1], s.dicke / 2, 0, Math.PI * 2);
      stift.fill();
    } else {
      stift.moveTo(p[0], p[1]);
      // Geglaettet ueber die Mittelpunkte
      for (var i = 2; i < p.length - 2; i += 2) {
        stift.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
      }
      stift.lineTo(p[p.length - 2], p[p.length - 1]);
      stift.stroke();
    }
    stift.restore();
  }

  function zeichnungNeu(aktuell) {
    stift.setTransform(AUFLOESUNG, 0, 0, AUFLOESUNG, 0, 0);
    stift.clearRect(0, 0, BREITE, HOEHE);
    zustand.striche.forEach(strichZeichnen);
    if (aktuell) strichZeichnen(aktuell);
  }

  function zeichnenEinrichten() {
    var aktuell = null;
    leinwand.addEventListener("pointerdown", function (ev) {
      if (modus !== "zeichnen" || ev.button > 0) return;
      ev.preventDefault();
      leinwand.setPointerCapture(ev.pointerId);
      var p = tafelPunkt(ev);
      var faktor = werkzeug === "radierer" ? 5 : werkzeug === "marker" ? 4 : 1;
      aktuell = {
        werkzeug: werkzeug,
        farbe: farbe,
        dicke: dicke * faktor,
        punkte: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]
      };
      zeichnungNeu(aktuell);
    });
    leinwand.addEventListener("pointermove", function (ev) {
      if (!aktuell) return;
      var liste = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      if (!liste.length) liste = [ev];
      liste.forEach(function (einzeln) {
        var p = tafelPunkt(einzeln);
        var n = aktuell.punkte.length;
        var dx = p.x - aktuell.punkte[n - 2];
        var dy = p.y - aktuell.punkte[n - 1];
        if (dx * dx + dy * dy < 1.5) return;
        aktuell.punkte.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10);
      });
      zeichnungNeu(aktuell);
    });
    function ende() {
      if (!aktuell) return;
      zustand.striche.push(aktuell);
      aktuell = null;
      zeichnungNeu();
      festhalten();
    }
    leinwand.addEventListener("pointerup", ende);
    leinwand.addEventListener("pointercancel", ende);
  }

  // ---------- Darstellung ----------

  function allesZeichnen() {
    Object.keys(laufend).forEach(stoppen);
    ebene.innerHTML = "";
    zustand.elemente.forEach(function (e) {
      ebene.appendChild(elementBauen(e));
    });
    if (gewaehlt && !finden(gewaehlt)) gewaehlt = null;
    waehlen(gewaehlt);
    hintergrundSetzen(zustand.hintergrund);
    zeichnungNeu();
  }

  function hintergrundSetzen(name) {
    tafelEl.className = tafelEl.className.replace(/\bhg-\S+/g, "").trim() + " hg-" + name;
    tafelEl.classList.toggle("zeichnen", modus === "zeichnen");
    document.getElementById("hintergrund").value = name;
  }

  function modusSetzen(neu) {
    modus = neu;
    document.body.dataset.modus = neu;
    tafelEl.classList.toggle("zeichnen", neu === "zeichnen");
    document.querySelectorAll("[data-modus]").forEach(function (k) {
      k.classList.toggle("aktiv", k.dataset.modus === neu);
      k.setAttribute("aria-pressed", k.dataset.modus === neu);
    });
    if (neu === "zeichnen") {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      waehlen(null);
    }
    window.requestAnimationFrame(einpassen);
  }

  // ---------- Einfuegen ----------

  function bildEinfuegen(datei, ort) {
    if (!datei || !/^image\//.test(datei.type)) return;
    var leser = new FileReader();
    leser.onload = function () {
      var bild = new Image();
      bild.onload = function () {
        var src = leser.result;
        var max = 1600;
        // Grosse Bilder verkleinern, damit sie in den Browserspeicher passen
        if (datei.size > 400 * 1024 || bild.width > max || bild.height > max) {
          var f = Math.min(1, max / Math.max(bild.width, bild.height));
          var c = document.createElement("canvas");
          c.width = Math.round(bild.width * f);
          c.height = Math.round(bild.height * f);
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(bild, 0, 0, c.width, c.height);
          src = c.toDataURL("image/jpeg", 0.85);
        }
        var b = Math.min(640, bild.width);
        var h = Math.round((b * bild.height) / bild.width);
        if (h > 600) {
          b = Math.round((b * 600) / h);
          h = 600;
        }
        var lageNeu = { b: b, h: h + 44 };
        if (ort) {
          lageNeu.x = ort.x - b / 2;
          lageNeu.y = ort.y - h / 2;
        }
        hinzufuegen("bild", { src: src, name: datei.name }, lageNeu);
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  }

  function linkEinfuegen(url) {
    if (url == null) url = window.prompt("Adresse des Links oder YouTube-Videos:", "https://");
    if (!url) return;
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    if (!sicherUrl(url)) {
      melden("Das ist keine gültige Adresse.");
      return;
    }
    hinzufuegen("link", { url: url }, youtubeId(url) ? { b: 640, h: 404 } : { b: 520, h: 170 });
  }

  function folieEinfuegen(nummer) {
    hinzufuegen("folie", { pfad: pfad, nummer: nummer });
  }

  function neuesElement(typ) {
    if (typ === "bild") {
      document.getElementById("bild-datei").click();
      return;
    }
    if (typ === "link") {
      linkEinfuegen();
      return;
    }
    var knoten = hinzufuegen(typ, {});
    var feld = knoten.querySelector(".textfeld, textarea");
    if (feld) feld.focus();
  }

  function bearbeitetGerade() {
    var a = document.activeElement;
    return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  // ---------- Folien der Praesentation ----------

  function folienTitelAus(markdown) {
    return markdown.split(/^\r?\n---\r?\n$/m).map(function (teil, i) {
      var zeilen = teil
        .replace(/<!--[\s\S]*?-->/g, "")
        .split(/\r?\nNote:/)[0]
        .split(/\r?\n/)
        .map(function (z) {
          return z.trim();
        })
        .filter(Boolean);
      var titel =
        zeilen.find(function (z) {
          return /^#{1,3}\s/.test(z);
        }) || zeilen[0];
      titel = (titel || "")
        .replace(/^#+\s*/, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`>]/g, "")
        .replace(/^[-+]\s+/, "")
        .trim();
      return titel || "Folie " + (i + 1);
    });
  }

  function folienListeBauen() {
    var liste = document.getElementById("folien");
    liste.innerHTML = "";
    folienTitel.forEach(function (titel, i) {
      var li = el("li");
      var k = el("button", "folie-eintrag");
      k.type = "button";
      k.appendChild(el("span", "folie-nr", String(i + 1)));
      k.appendChild(el("span", null, titel));
      k.addEventListener("click", function () {
        folieEinfuegen(i + 1);
      });
      li.appendChild(k);
      liste.appendChild(li);
    });
  }

  async function praesentationLaden() {
    if (!pfad) return;
    var antwort = await fetch("daten/index.json", { cache: "no-cache" });
    if (!antwort.ok) throw new Error("Verzeichnis nicht gefunden");
    var index = await antwort.json();
    index.kapitel.forEach(function (k) {
      k.lektionen.forEach(function (l) {
        if (l.pfad === pfad) lektion = l;
      });
    });
    if (!lektion) {
      melden("Die Präsentation «" + pfad + "» gibt es nicht (mehr). Die Tafel funktioniert trotzdem.", 6000);
      return;
    }
    document.title = "Tafel: " + lektion.titel + " · Medien und Informatik";
    document.getElementById("titel").textContent = (lektion.nummer ? "Lektion " + lektion.nummer + ": " : "") + lektion.titel;
    var zur = document.getElementById("zur-praesentation");
    zur.href = "praesentation.html?p=" + encodeURIComponent(pfad).replace(/%2F/g, "/");
    zur.hidden = false;

    var md = await fetch(lektion.md, { cache: "no-cache" });
    if (!md.ok) return;
    folienTitel = folienTitelAus(await md.text());
    folienListeBauen();
    var knopfFolien = document.getElementById("folien-knopf");
    knopfFolien.hidden = false;
    document.getElementById("folienliste").hidden = false;
    knopfFolien.classList.add("aktiv");
    // Folientitel in bestehende Folienelemente uebernehmen
    allesZeichnen();
    einpassen();

    // Aus der Praesentation mit W geoeffnet: diese Folie auf die Tafel legen
    var nummer = parseInt(parameter.get("folie"), 10);
    if (nummer >= 1 && nummer <= folienTitel.length) {
      var schon = zustand.elemente.some(function (e) {
        return e.typ === "folie" && e.daten.pfad === pfad && e.daten.nummer === nummer;
      });
      if (!schon) folieEinfuegen(nummer);
      parameter.delete("folie");
      history.replaceState(null, "", "?" + parameter.toString().replace(/%2F/g, "/"));
    }
  }

  // ---------- Datei ----------

  function dateiName() {
    var heute = new Date();
    var datum = heute.getFullYear() + "-" + zweistellig(heute.getMonth() + 1) + "-" + zweistellig(heute.getDate());
    var kurz = lektion && lektion.downloads && lektion.downloads.pdf ? lektion.downloads.pdf.name.replace(/\.pdf$/, "") : "MI_Tafel";
    return kurz + "_Tafel_" + datum + ".json";
  }

  function alsDateiSpeichern() {
    var blob = new Blob([JSON.stringify(zustand)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = dateiName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }

  function ausDateiLaden(datei) {
    var leser = new FileReader();
    leser.onload = function () {
      try {
        var daten = JSON.parse(leser.result);
        if (!gueltig(daten)) throw new Error("ungültig");
        zustand = daten;
        allesZeichnen();
        festhalten();
        melden("Tafel geöffnet.");
      } catch (e) {
        melden("Diese Datei ist keine gespeicherte Tafel.");
      }
    };
    leser.readAsText(datei);
  }

  // ---------- Bedienung ----------

  function leisteEinrichten() {
    document.querySelectorAll("[data-icon]").forEach(function (k) {
      k.insertAdjacentHTML("afterbegin", icon(k.dataset.icon));
    });

    document.querySelectorAll("[data-modus]").forEach(function (k) {
      k.addEventListener("click", function () {
        modusSetzen(k.dataset.modus);
      });
    });
    document.querySelectorAll("[data-neu]").forEach(function (k) {
      k.addEventListener("click", function () {
        neuesElement(k.dataset.neu);
      });
    });
    document.querySelectorAll("[data-werkzeug]").forEach(function (k) {
      k.addEventListener("click", function () {
        werkzeug = k.dataset.werkzeug;
        document.querySelectorAll("[data-werkzeug]").forEach(function (w) {
          w.classList.toggle("aktiv", w === k);
        });
      });
    });

    var farbenEl = document.getElementById("farben");
    FARBEN.forEach(function (f, i) {
      var k = el("button", "farbknopf" + (i === 0 ? " aktiv" : ""));
      k.type = "button";
      k.style.setProperty("--farbe", f);
      k.title = "Farbe " + f;
      k.setAttribute("aria-label", "Farbe " + (i + 1));
      k.addEventListener("click", function () {
        farbe = f;
        if (werkzeug === "radierer") document.querySelector('[data-werkzeug="stift"]').click();
        farbenEl.querySelectorAll(".farbknopf").forEach(function (x) {
          x.classList.toggle("aktiv", x === k);
        });
      });
      farbenEl.appendChild(k);
    });
    var dickenEl = document.getElementById("dicken");
    DICKEN.forEach(function (d, i) {
      var k = el("button", "dickknopf" + (d === dicke ? " aktiv" : ""));
      k.type = "button";
      k.style.setProperty("--dicke", 4 + i * 4 + "px");
      k.title = ["Dünn", "Mittel", "Dick"][i];
      k.setAttribute("aria-label", k.title);
      k.addEventListener("click", function () {
        dicke = d;
        dickenEl.querySelectorAll(".dickknopf").forEach(function (x) {
          x.classList.toggle("aktiv", x === k);
        });
      });
      dickenEl.appendChild(k);
    });

    document.getElementById("zeichnung-loeschen").addEventListener("click", function () {
      if (!zustand.striche.length) return;
      zustand.striche = [];
      zeichnungNeu();
      festhalten();
      melden("Zeichnungen gelöscht. Rückgängig mit Ctrl+Z.");
    });
    document.getElementById("hintergrund").addEventListener("change", function (ev) {
      zustand.hintergrund = ev.target.value;
      hintergrundSetzen(zustand.hintergrund);
      festhalten();
    });
    document.getElementById("rueckgaengig").addEventListener("click", function () {
      zurueckholen(-1);
    });
    document.getElementById("wiederholen").addEventListener("click", function () {
      zurueckholen(1);
    });
    document.getElementById("folien-knopf").addEventListener("click", function () {
      var liste = document.getElementById("folienliste");
      liste.hidden = !liste.hidden;
      this.classList.toggle("aktiv", !liste.hidden);
      einpassen();
    });
    document.getElementById("vollbild").addEventListener("click", vollbild);

    var menue = document.getElementById("datei-menue");
    var dateiKnopf = document.getElementById("datei-knopf");
    function menueZu() {
      menue.hidden = true;
      dateiKnopf.setAttribute("aria-expanded", "false");
    }
    dateiKnopf.addEventListener("click", function (ev) {
      ev.stopPropagation();
      menue.hidden = !menue.hidden;
      dateiKnopf.setAttribute("aria-expanded", String(!menue.hidden));
    });
    document.addEventListener("click", menueZu);
    document.getElementById("speichern").addEventListener("click", alsDateiSpeichern);
    document.getElementById("oeffnen").addEventListener("click", function () {
      document.getElementById("tafel-datei").click();
    });
    document.getElementById("leeren").addEventListener("click", function () {
      if (!window.confirm("Die ganze Tafel leeren? Rückgängig ist danach mit Ctrl+Z möglich.")) return;
      var hg = zustand.hintergrund;
      zustand = leererZustand();
      zustand.hintergrund = hg;
      allesZeichnen();
      festhalten();
    });
    document.getElementById("tafel-datei").addEventListener("change", function () {
      if (this.files[0]) ausDateiLaden(this.files[0]);
      this.value = "";
    });
    document.getElementById("bild-datei").addEventListener("change", function () {
      if (this.files[0]) bildEinfuegen(this.files[0]);
      this.value = "";
    });
  }

  function vollbild() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  }

  function tastenEinrichten() {
    document.addEventListener("keydown", function (ev) {
      var strg = ev.ctrlKey || ev.metaKey;
      if (strg && !bearbeitetGerade() && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        zurueckholen(ev.shiftKey ? 1 : -1);
        return;
      }
      if (strg && !bearbeitetGerade() && ev.key.toLowerCase() === "y") {
        ev.preventDefault();
        zurueckholen(1);
        return;
      }
      if (bearbeitetGerade()) {
        if (ev.key === "Escape") document.activeElement.blur();
        return;
      }
      if (strg || ev.altKey) return;
      if ((ev.key === "Delete" || ev.key === "Backspace") && gewaehlt) {
        ev.preventDefault();
        entfernen(gewaehlt);
      } else if (ev.key === "z" || ev.key === "Z") {
        modusSetzen(modus === "zeichnen" ? "bearbeiten" : "zeichnen");
      } else if (ev.key === "f" || ev.key === "F") {
        vollbild();
      } else if (ev.key === "Escape") {
        waehlen(null);
        modusSetzen("bearbeiten");
      }
    });

    // Einfuegen aus der Zwischenablage: Bild, Link oder Text
    document.addEventListener("paste", function (ev) {
      if (bearbeitetGerade()) return;
      var daten = ev.clipboardData;
      if (!daten) return;
      for (var i = 0; i < daten.items.length; i++) {
        if (/^image\//.test(daten.items[i].type)) {
          ev.preventDefault();
          bildEinfuegen(daten.items[i].getAsFile());
          return;
        }
      }
      var text = (daten.getData("text/plain") || "").trim();
      if (!text) return;
      ev.preventDefault();
      if (modus === "zeichnen") modusSetzen("bearbeiten");
      if (/^https?:\/\/\S+$/i.test(text)) linkEinfuegen(text);
      else hinzufuegen("text", { text: text });
    });

    // Bilder auf die Tafel ziehen
    rahmen.addEventListener("dragover", function (ev) {
      ev.preventDefault();
    });
    rahmen.addEventListener("drop", function (ev) {
      ev.preventDefault();
      var dateien = ev.dataTransfer && ev.dataTransfer.files;
      if (!dateien || !dateien.length) return;
      var ort = tafelPunkt(ev);
      Array.prototype.forEach.call(dateien, function (d) {
        if (/json$/.test(d.type) || /\.json$/i.test(d.name)) ausDateiLaden(d);
        else bildEinfuegen(d, ort);
      });
    });

    // Klick auf die leere Tafel hebt die Auswahl auf
    tafelEl.addEventListener("pointerdown", function (ev) {
      if (ev.target === tafelEl || ev.target === ebene) {
        waehlen(null);
        if (bearbeitetGerade()) document.activeElement.blur();
      }
    });
  }

  // ---------- Start ----------

  function starten() {
    tafelEl.style.width = BREITE + "px";
    tafelEl.style.height = HOEHE + "px";
    try {
      var gespeichert = JSON.parse(localStorage.getItem(SPEICHER) || "null");
      if (gueltig(gespeichert)) zustand = gespeichert;
    } catch (e) {
      /* neue Tafel */
    }
    leisteEinrichten();
    zeichnenEinrichten();
    tastenEinrichten();
    modusSetzen("bearbeiten");
    allesZeichnen();
    festhalten();
    einpassen();
    window.addEventListener("resize", einpassen);
    document.addEventListener("fullscreenchange", einpassen);

    praesentationLaden().catch(function (fehler) {
      melden("Die Folien konnten nicht geladen werden: " + fehler.message, 6000);
    });
  }

  // Fuer den Browsertest
  window.MiTafel = {
    zustand: function () {
      return zustand;
    },
    folienTitel: function () {
      return folienTitel;
    },
    folienTitelAus: folienTitelAus
  };

  starten();
})();
