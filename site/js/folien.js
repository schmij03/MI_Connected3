/*
 * MiFolien: reveal.js-Plugin fuer die Folienlayouts, den Countdown,
 * die Download-Leiste und den Hinweis zur Referentenansicht.
 *
 * Wird im Viewer und im Offline-HTML-Export gleich verwendet.
 * Muss in der Plugin-Liste NACH RevealMarkdown stehen, weil es die
 * Folien umbaut, die das Markdown-Plugin erzeugt hat.
 *
 * Optionen:
 *   nummer      Lektionsnummer fuer den Kreis auf der Titelfolie
 *   downloads   [{ text, aktion }] fuer die Download-Leiste (leer = keine Leiste)
 *   referent    true = Hinweis zum Oeffnen der Referentenansicht zeigen
 *   startseite  Link zurueck zur Startseite (optional)
 */
(function () {
  "use strict";

  var ICONS = {
    uhr:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
    personen:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.8"/><path d="M17 14c2.8 0 4.5 2 4.5 5"/></svg>',
    material:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>',
    buch:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20"/></svg>',
    auftrag:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6v3H9z"/><path d="M15 5h3v16H6V5h3"/><path d="m9 13 2 2 4-4"/></svg>',
    haken:
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 7"/></svg>',
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/></svg>',
    zurueck:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'
  };

  // Begriffe in der Seitenleiste von Auftragsfolien
  var SEITENLEISTE = [
    { muster: /^auftrag$/i, icon: "auftrag", text: "Auftrag" },
    { muster: /^zeit(dauer)?$/i, icon: "uhr", text: "Zeit" },
    { muster: /^sozialform$/i, icon: "personen", text: "Sozialform" },
    { muster: /^material(ien)?$/i, icon: "material", text: "Material" },
    { muster: /^(arbeitsbuch|ab|buch|lehrmittel)$/i, icon: "buch", text: "Arbeitsbuch" }
  ];

  function farbe(name, ersatz) {
    var wert = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (wert && wert.trim()) || ersatz;
  }

  function el(tag, klasse, html) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /** "7", "7'", "7 Min", "2.5" oder "2,5" -> Minuten als Zahl */
  function minutenAus(text) {
    if (!text) return null;
    var m = String(text).match(/(\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    var wert = parseFloat(m[1].replace(",", "."));
    return wert > 0 ? wert : null;
  }

  function zeitText(minuten) {
    var ganz = Math.round(minuten * 10) / 10;
    return String(ganz).replace(".", ",") + "’";
  }

  /** Inhalt einer Folie ohne die Notizen */
  function inhaltsKinder(folie) {
    return Array.prototype.filter.call(folie.children, function (k) {
      return !k.matches("aside.notes");
    });
  }

  function istNurBild(p) {
    if (p.tagName !== "P") return false;
    var bilder = p.querySelectorAll("img");
    if (!bilder.length) return false;
    var text = p.textContent.replace(/\s+/g, "");
    return text === "";
  }

  // ---------- Allgemeine Aufbereitung ----------

  function allgemein(folie) {
    // Leere Absaetze entfernen
    folie.querySelectorAll("p").forEach(function (p) {
      if (!p.textContent.trim() && !p.querySelector("img, svg, video, iframe")) p.remove();
    });
    // Absaetze nur mit Bildern hervorheben
    folie.querySelectorAll("p").forEach(function (p) {
      if (istNurBild(p)) {
        p.classList.add(p.querySelectorAll("img").length > 1 ? "bilder-reihe" : "nur-bild");
      }
    });
    // Bilder: Alternativtext als Titel, damit er beim Ueberfahren sichtbar ist
    folie.querySelectorAll("img").forEach(function (img) {
      if (img.alt && !img.title) img.title = img.alt;
      img.setAttribute("draggable", "false");
    });
  }

  function zeitBadge(folie) {
    var minuten = minutenAus(folie.getAttribute("data-zeit"));
    if (!minuten) return;
    folie.setAttribute("data-zeit", String(minuten));
    if (folie.querySelector(":scope > .zeit-badge")) return;
    var badge = el("div", "zeit-badge", ICONS.uhr + "<span>" + zeitText(minuten) + "</span>");
    badge.title = "Countdown starten (Taste T)";
    badge.setAttribute("role", "button");
    folie.insertBefore(badge, folie.firstChild);
  }

  // ---------- Layouts ----------

  function layoutTitel(folie, optionen) {
    folie.setAttribute("data-background-color", farbe("--dunkelblau", "#1f3864"));
    var nummer = folie.getAttribute("data-nummer") || optionen.nummer;
    var text = el("div", "titel-text");
    inhaltsKinder(folie).forEach(function (k) {
      if (!k.classList.contains("zeit-badge")) text.appendChild(k);
    });
    if (nummer && String(nummer) !== "0" && String(nummer).toLowerCase() !== "keine") {
      var kreis = el(
        "div",
        "nummer-kreis",
        '<span class="nummer-wort">Lektion</span><span class="nummer-zahl"></span>'
      );
      kreis.querySelector(".nummer-zahl").textContent = nummer;
      folie.insertBefore(kreis, folie.querySelector("aside.notes"));
    } else {
      folie.classList.add("ohne-nummer");
    }
    folie.insertBefore(text, folie.querySelector("aside.notes"));
  }

  function layoutMerke(folie) {
    if (!folie.querySelector(".merke-marke")) {
      folie.insertBefore(el("div", "merke-marke", "Merke"), folie.firstChild);
    }
    if (!folie.hasAttribute("data-background-color")) {
      folie.setAttribute("data-background-color", farbe("--dunkelblau-tief", "#172a4b"));
    }
  }

  function layoutLoesung(folie) {
    if (folie.querySelector(".loesung-band")) return;
    var band = el("div", "loesung-band", ICONS.haken + "<span>Lösung</span>");
    folie.insertBefore(band, folie.firstChild);
  }

  function layoutKarten(folie) {
    var kinder = inhaltsKinder(folie);
    var karten = [];
    var aktuell = null;
    var ersteKarte = null;
    kinder.forEach(function (k) {
      if (k.tagName === "H3") {
        aktuell = el("div", "karte");
        karten.push(aktuell);
        if (!ersteKarte) ersteKarte = k;
      }
      if (aktuell && k.tagName !== "BLOCKQUOTE" && !k.classList.contains("zeit-badge") && !k.classList.contains("loesung-band")) {
        aktuell.appendChild(k);
      }
    });
    if (!karten.length) return;
    var reihe = el("div", "karten-reihe");
    reihe.style.setProperty("--anzahl", String(Math.min(Math.max(karten.length, 1), 4)));
    karten.forEach(function (karte) {
      reihe.appendChild(karte);
    });
    // Die Reihe steht dort, wo die erste Karte begann
    var danach = null;
    var kinderJetzt = inhaltsKinder(folie);
    for (var i = 0; i < kinderJetzt.length; i++) {
      if (kinderJetzt[i].tagName === "BLOCKQUOTE") {
        danach = kinderJetzt[i];
        break;
      }
    }
    folie.insertBefore(reihe, danach || folie.querySelector("aside.notes"));
  }

  function layoutSpalten(folie) {
    var kinder = inhaltsKinder(folie).filter(function (k) {
      return !/^H[12]$/.test(k.tagName) && k.tagName !== "BLOCKQUOTE" && !k.classList.contains("zeit-badge") && !k.classList.contains("loesung-band");
    });
    if (!kinder.length) return;
    var links = el("div", "spalte");
    var rechts = el("div", "spalte");
    var trenner = kinder.filter(function (k) {
      return k.tagName === "HR";
    })[0];
    var ziel = links;
    kinder.forEach(function (k) {
      if (k === trenner) {
        ziel = rechts;
        k.remove();
        return;
      }
      if (!trenner && (k.classList.contains("nur-bild") || k.classList.contains("bilder-reihe"))) {
        rechts.appendChild(k);
      } else {
        ziel.appendChild(k);
      }
    });
    var raster = el("div", "zwei-spalten");
    raster.appendChild(links);
    raster.appendChild(rechts);
    var vor = inhaltsKinder(folie).filter(function (k) {
      return k.tagName === "BLOCKQUOTE";
    })[0];
    folie.insertBefore(raster, vor || folie.querySelector("aside.notes"));
  }

  /** Erkennt Zeilen wie "Zeit: 7'" in einer Liste */
  function seitenleistenEintrag(li) {
    var text = li.textContent.trim();
    var m = text.match(/^([^:]{2,20}):\s*(.*)$/);
    if (!m) return null;
    var begriff = m[1].trim();
    for (var i = 0; i < SEITENLEISTE.length; i++) {
      if (SEITENLEISTE[i].muster.test(begriff)) {
        // Den Wert mit Formatierung uebernehmen
        var html = li.innerHTML.replace(/^[\s\S]*?:\s*/, "");
        if (/^<\/(strong|b|em)>/i.test(html)) html = html.replace(/^<\/(strong|b|em)>\s*/i, "");
        return { art: SEITENLEISTE[i], wert: m[2], html: html };
      }
    }
    return null;
  }

  function layoutAuftrag(folie) {
    var kinder = inhaltsKinder(folie);
    var liste = null;
    var eintraege = [];
    for (var i = 0; i < kinder.length; i++) {
      var k = kinder[i];
      if (k.tagName !== "UL") continue;
      var lis = Array.prototype.filter.call(k.children, function (c) {
        return c.tagName === "LI";
      });
      var gefunden = lis.map(seitenleistenEintrag);
      if (lis.length && gefunden.every(Boolean)) {
        liste = k;
        eintraege = gefunden;
        break;
      }
    }

    var seite = el("div", "auftrag-seite");
    var marke = el("div", "auftrag-marke", "Auftrag");
    seite.appendChild(marke);
    var dl = el("dl");
    eintraege.forEach(function (e) {
      if (e.art.text === "Auftrag") {
        marke.textContent = "Auftrag " + e.wert;
        return;
      }
      var dt = el("dt", null, ICONS[e.art.icon] + "<span></span>");
      dt.querySelector("span").textContent = e.art.text;
      var dd = el("dd", null, e.html);
      dl.appendChild(dt);
      dl.appendChild(dd);
      if (e.art.text === "Zeit" && !folie.hasAttribute("data-zeit")) {
        var minuten = minutenAus(e.wert);
        if (minuten) folie.setAttribute("data-zeit", String(minuten));
      }
    });
    seite.appendChild(dl);
    if (liste) liste.remove();

    var haupt = el("div", "auftrag-haupt");
    inhaltsKinder(folie).forEach(function (k) {
      if (k.tagName === "BLOCKQUOTE" || k.classList.contains("loesung-band")) return;
      haupt.appendChild(k);
    });
    var notizen = folie.querySelector("aside.notes");
    folie.insertBefore(seite, notizen);
    folie.insertBefore(haupt, notizen);
  }

  /** Baut eine Folie gemaess ihren Klassen um. Wird einmal pro Folie ausgefuehrt. */
  function aufbereiten(folie, optionen) {
    if (folie.getAttribute("data-mi-fertig")) return;
    folie.setAttribute("data-mi-fertig", "1");
    var kl = folie.classList;
    allgemein(folie);
    if (kl.contains("titel")) layoutTitel(folie, optionen);
    if (kl.contains("merke")) layoutMerke(folie);
    if (kl.contains("karten")) layoutKarten(folie);
    if (kl.contains("spalten")) layoutSpalten(folie);
    if (kl.contains("auftrag")) layoutAuftrag(folie);
    if (kl.contains("loesung")) layoutLoesung(folie);
    zeitBadge(folie);
  }

  // ---------- Countdown ----------

  function Countdown(deck) {
    this.deck = deck;
    this.box = el(
      "div",
      "mi-countdown",
      '<div class="zeit">0:00</div><div class="balken"><span></span></div>' +
        '<div class="hilfe"><kbd>T</kbd> Pause &middot; <kbd>Shift</kbd>+<kbd>T</kbd> schliessen</div>'
    );
    this.box.hidden = true;
    this.box.title = "Klicken: anhalten oder weiterlaufen lassen";
    document.body.appendChild(this.box);
    this.anzeige = this.box.querySelector(".zeit");
    this.balken = this.box.querySelector(".balken span");
    this.gesamt = 0;
    this.rest = 0;
    this.ende = 0;
    this.takt = null;
    var self = this;
    this.box.addEventListener("click", function () {
      self.umschalten();
    });
  }

  Countdown.prototype.zeichnen = function () {
    var sek = Math.max(0, Math.ceil(this.rest / 1000));
    var min = Math.floor(sek / 60);
    var s = sek % 60;
    this.anzeige.textContent = min + ":" + (s < 10 ? "0" : "") + s;
    this.balken.style.width = (this.gesamt ? (this.rest / this.gesamt) * 100 : 0) + "%";
  };

  Countdown.prototype.starten = function (minuten) {
    this.stoppen();
    this.gesamt = minuten * 60 * 1000;
    this.rest = this.gesamt;
    this.box.hidden = false;
    this.box.classList.remove("abgelaufen");
    this.weiter();
  };

  Countdown.prototype.weiter = function () {
    var self = this;
    this.box.classList.remove("pausiert");
    this.ende = Date.now() + this.rest;
    this.zeichnen();
    this.takt = setInterval(function () {
      self.rest = self.ende - Date.now();
      if (self.rest <= 0) {
        self.rest = 0;
        self.stoppen();
        self.box.classList.add("abgelaufen");
      }
      self.zeichnen();
    }, 250);
  };

  Countdown.prototype.stoppen = function () {
    if (this.takt) clearInterval(this.takt);
    this.takt = null;
  };

  Countdown.prototype.umschalten = function () {
    if (this.box.hidden || this.rest <= 0) return;
    if (this.takt) {
      this.stoppen();
      this.rest = this.ende - Date.now();
      this.box.classList.add("pausiert");
      this.zeichnen();
    } else {
      this.weiter();
    }
  };

  Countdown.prototype.schliessen = function () {
    this.stoppen();
    this.box.hidden = true;
  };

  /** Taste T: auf einer Folie mit Zeitangabe starten, sonst pausieren */
  Countdown.prototype.taste = function (ereignis) {
    if (ereignis && ereignis.shiftKey) {
      this.schliessen();
      return;
    }
    var folie = this.deck.getCurrentSlide();
    var minuten = folie && minutenAus(folie.getAttribute("data-zeit"));
    var laeuftFuerDieseFolie = !this.box.hidden && this.folie === folie && this.rest > 0;
    if (laeuftFuerDieseFolie || (!minuten && !this.box.hidden)) {
      this.umschalten();
    } else if (minuten) {
      this.folie = folie;
      this.starten(minuten);
    }
  };

  // ---------- Download-Leiste ----------

  function downloadLeiste(deck, optionen) {
    var eintraege = optionen.downloads || [];
    if (!eintraege.length && !optionen.startseite) return null;
    var leiste = el("div", "mi-leiste");
    var schalter = el("button", "mi-leiste-schalter", ICONS.download);
    schalter.type = "button";
    schalter.title = "Downloads ein- oder ausblenden (Taste D)";
    schalter.setAttribute("aria-label", schalter.title);
    schalter.setAttribute("aria-expanded", "false");
    var inhalt = el("div", "mi-leiste-inhalt");
    if (optionen.startseite) {
      var zurueck = el("a", null, ICONS.zurueck + "<span>Startseite</span>");
      zurueck.href = optionen.startseite;
      inhalt.appendChild(zurueck);
    }
    eintraege.forEach(function (e) {
      var knopf = el("button", null, ICONS.download + "<span></span>");
      knopf.type = "button";
      knopf.querySelector("span").textContent = e.text;
      knopf.addEventListener("click", function () {
        if (knopf.classList.contains("laedt")) return;
        knopf.classList.add("laedt");
        Promise.resolve()
          .then(e.aktion)
          .catch(function (fehler) {
            alert("Der Download hat nicht geklappt: " + (fehler && fehler.message ? fehler.message : fehler));
          })
          .then(function () {
            knopf.classList.remove("laedt");
          });
      });
      inhalt.appendChild(knopf);
    });
    leiste.appendChild(schalter);
    leiste.appendChild(inhalt);
    function umschalten() {
      var offen = leiste.classList.toggle("offen");
      schalter.setAttribute("aria-expanded", String(offen));
    }
    schalter.addEventListener("click", umschalten);
    // Klicks in der Leiste sollen nicht zur naechsten Folie fuehren
    leiste.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    document.body.appendChild(leiste);
    return { umschalten: umschalten };
  }

  // ---------- Referentenansicht ----------

  function referentenHinweis(deck) {
    var dialog = el(
      "div",
      "mi-dialog",
      '<div class="mi-dialog-karte" role="dialog" aria-modal="true" aria-labelledby="mi-ref-titel">' +
        '<h2 id="mi-ref-titel">Referentenansicht</h2>' +
        "<p>Die Referentenansicht öffnet sich in einem eigenen Fenster mit Notizen, nächster Folie und Uhr. " +
        "Ziehe dieses Fenster hier auf den Beamer und drücke dort <kbd>F</kbd> für Vollbild.</p>" +
        "<p>Später jederzeit mit der Taste <kbd>S</kbd>.</p>" +
        '<div class="knoepfe"><button type="button" class="haupt">Referentenansicht öffnen</button>' +
        '<button type="button" class="nein">Nur präsentieren</button></div></div>'
    );
    document.body.appendChild(dialog);
    function schliessen() {
      dialog.remove();
    }
    dialog.querySelector(".haupt").addEventListener("click", function () {
      var notes = deck.getPlugin("notes");
      if (notes) notes.open();
      schliessen();
    });
    dialog.querySelector(".nein").addEventListener("click", schliessen);
    dialog.querySelector(".haupt").focus();
  }

  // ---------- Plugin ----------

  window.MiFolien = function (optionen) {
    optionen = optionen || {};
    return {
      id: "mi-folien",
      init: function (deck) {
        var empfaenger = /receiver/i.test(window.location.search);
        if (empfaenger) document.documentElement.classList.add("mi-empfaenger");

        deck
          .getRevealElement()
          .querySelectorAll(".slides section:not(.stack)")
          .forEach(function (folie) {
            aufbereiten(folie, optionen);
          });

        if (empfaenger || /print-pdf/i.test(window.location.search)) return;

        var countdown = new Countdown(deck);
        deck.addKeyBinding({ keyCode: 84, key: "T", description: "Countdown starten / anhalten (Shift+T schliesst)" }, function (e) {
          countdown.taste(e);
        });
        deck.getRevealElement().addEventListener("click", function (e) {
          var badge = e.target.closest && e.target.closest(".zeit-badge");
          if (badge) {
            e.stopPropagation();
            countdown.taste();
          }
        });

        var leiste = downloadLeiste(deck, optionen);
        if (leiste) {
          deck.addKeyBinding({ keyCode: 68, key: "D", description: "Download-Leiste ein-/ausblenden" }, leiste.umschalten);
        }

        if (optionen.referent) {
          deck.on("ready", function () {
            referentenHinweis(deck);
          });
        }
      },
      // Fuer Tests und den PPTX-Export
      minutenAus: minutenAus
    };
  };

  /**
   * Baut die Praesentation aus Markdown und startet reveal.js.
   * Gemeinsamer Einstieg fuer Viewer und Offline-Export.
   *   markdown   Text der Praesentation
   *   weitere Optionen siehe MiFolien oben
   */
  window.MiFolien.starten = function (optionen) {
    var suche = window.location.search;
    var druck = /print-pdf/i.test(suche);
    var notizenDrucken = /notizen/i.test(suche);
    if (optionen.titel) document.title = optionen.titel;

    var folien = document.querySelector(".reveal .slides");
    folien.innerHTML = "";
    var abschnitt = document.createElement("section");
    abschnitt.setAttribute("data-markdown", "");
    abschnitt.setAttribute("data-separator", "^\\r?\\n---\\r?\\n$");
    abschnitt.setAttribute("data-separator-notes", "^Note:");
    var vorlage = document.createElement("textarea");
    vorlage.setAttribute("data-template", "");
    vorlage.textContent = optionen.markdown;
    abschnitt.appendChild(vorlage);
    folien.appendChild(abschnitt);

    return Reveal.initialize({
      hash: true,
      width: 1280,
      height: 720,
      margin: druck ? 0 : 0.03,
      minScale: 0.2,
      maxScale: 2.5,
      center: false,
      controls: true,
      controlsTutorial: false,
      progress: true,
      slideNumber: "c/t",
      showSlideNumber: "all",
      transition: "fade",
      transitionSpeed: "fast",
      backgroundTransition: "fade",
      pdfMaxPagesPerSlide: 1,
      pdfSeparateFragments: false,
      showNotes: druck && notizenDrucken ? "separate-page" : false,
      markdown: { gfm: true },
      plugins: [RevealMarkdown, RevealNotes, RevealZoom, window.MiFolien(optionen)]
    });
  };
})();
