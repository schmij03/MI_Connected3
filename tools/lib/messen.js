/*
 * Laeuft im Browser (Playwright) auf der Druckansicht (?print-pdf) des
 * Offline-Exports. Misst jede Folie aus und beschreibt sie als Liste von
 * Formen (Rechtecke, Texte, Tabellen, Bilder) in Bildpunkten (1280 x 720).
 * Daraus baut pptx.mjs die PowerPoint-Datei.
 */
window.miFolienMessen = async function () {
  "use strict";

  function farbeHex(wert) {
    if (!wert) return null;
    var m = wert.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
    if (!m) return null;
    var alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (alpha < 0.05) return null;
    return [m[1], m[2], m[3]]
      .map(function (z) {
        return ("0" + Math.round(parseFloat(z)).toString(16)).slice(-2);
      })
      .join("")
      .toUpperCase();
  }

  function px(wert) {
    var z = parseFloat(wert);
    return isNaN(z) ? 0 : z;
  }

  function sichtbar(el, cs) {
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  var INLINE = /^(inline|inline-block|contents)$/;

  function hatBlockKinder(el) {
    for (var i = 0; i < el.children.length; i++) {
      var k = el.children[i];
      if (k.matches("br")) continue;
      var d = getComputedStyle(k).display;
      if (d === "none") continue;
      if (!INLINE.test(d) || k.matches("img, svg, table, ul, ol")) return true;
    }
    return false;
  }

  function hatText(el) {
    return el.textContent.replace(/\s+/g, "") !== "";
  }

  /** Text-Laeufe (Runs) eines Elements mit Formatierung */
  function laeufe(el, ohne) {
    var liste = [];
    function gehen(knoten) {
      if (knoten.nodeType === 3) {
        var text = knoten.nodeValue.replace(/\s+/g, " ");
        if (!text) return;
        var eltern = knoten.parentElement;
        var cs = getComputedStyle(eltern);
        if (cs.textTransform === "uppercase") text = text.toUpperCase();
        else if (cs.textTransform === "lowercase") text = text.toLowerCase();
        var link = eltern.closest("a");
        liste.push({
          text: text,
          fett: parseInt(cs.fontWeight, 10) >= 600,
          kursiv: cs.fontStyle === "italic",
          farbe: farbeHex(cs.color) || "262626",
          groesse: px(cs.fontSize),
          link: link && /^https?:/.test(link.href) ? link.href : null
        });
        return;
      }
      if (knoten.nodeType !== 1) return;
      if (ohne && knoten.matches(ohne)) return;
      if (knoten.matches("br")) {
        liste.push({ umbruch: true });
        return;
      }
      if (knoten.matches("aside.notes, script, style, svg, img")) return;
      if (getComputedStyle(knoten).display === "none") return;
      for (var i = 0; i < knoten.childNodes.length; i++) gehen(knoten.childNodes[i]);
    }
    for (var i = 0; i < el.childNodes.length; i++) gehen(el.childNodes[i]);
    // Leerzeichen am Anfang und Ende entfernen
    while (liste.length && liste[0].text !== undefined && !liste[0].text.trim()) liste.shift();
    while (liste.length && liste[liste.length - 1].text !== undefined && !liste[liste.length - 1].text.trim()) liste.pop();
    if (liste.length && liste[0].text) liste[0].text = liste[0].text.replace(/^\s+/, "");
    if (liste.length && liste[liste.length - 1].text) {
      liste[liste.length - 1].text = liste[liste.length - 1].text.replace(/\s+$/, "");
    }
    return liste;
  }

  function inhaltsRechteck(el, ursprung) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var links = px(cs.paddingLeft) + px(cs.borderLeftWidth);
    var oben = px(cs.paddingTop) + px(cs.borderTopWidth);
    var rechts = px(cs.paddingRight) + px(cs.borderRightWidth);
    var unten = px(cs.paddingBottom) + px(cs.borderBottomWidth);
    return {
      x: r.left - ursprung.left + links,
      y: r.top - ursprung.top + oben,
      w: Math.max(1, r.width - links - rechts),
      h: Math.max(1, r.height - oben - unten)
    };
  }

  function rechteck(el, ursprung) {
    var r = el.getBoundingClientRect();
    return { x: r.left - ursprung.left, y: r.top - ursprung.top, w: r.width, h: r.height };
  }

  function absatzVon(el, extra) {
    var cs = getComputedStyle(el);
    var groesse = px(cs.fontSize);
    var zeile = cs.lineHeight === "normal" ? groesse * 1.2 : px(cs.lineHeight);
    var ausrichtung = cs.textAlign;
    if (ausrichtung === "start" || ausrichtung === "justify" || ausrichtung === "-webkit-left") ausrichtung = "left";
    if (ausrichtung === "end") ausrichtung = "right";
    var absatz = {
      laeufe: laeufe(el, extra && extra.ohne),
      groesse: groesse,
      farbe: farbeHex(cs.color) || "262626",
      fett: parseInt(cs.fontWeight, 10) >= 600,
      ausrichtung: ausrichtung,
      zeilenhoehe: zeile / groesse,
      abstandNach: px(cs.marginBottom)
    };
    if (extra) {
      for (var k in extra) if (k !== "ohne") absatz[k] = extra[k];
    }
    return absatz;
  }

  async function rastern(quelle, breite, hoehe, typ) {
    return new Promise(function (fertig) {
      var bild = new Image();
      bild.onload = function () {
        var faktor = 2;
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(breite * faktor));
        c.height = Math.max(1, Math.round(hoehe * faktor));
        var ctx = c.getContext("2d");
        if (typ === "image/jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(bild, 0, 0, c.width, c.height);
        try {
          fertig(c.toDataURL(typ === "image/jpeg" ? "image/jpeg" : "image/png", 0.9));
        } catch (e) {
          fertig(null);
        }
      };
      bild.onerror = function () {
        fertig(null);
      };
      bild.src = quelle;
    });
  }

  async function svgRastern(svg, r) {
    var kopie = svg.cloneNode(true);
    var cs = getComputedStyle(svg);
    kopie.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    kopie.setAttribute("width", r.w);
    kopie.setAttribute("height", r.h);
    kopie.setAttribute("style", "color:" + cs.color);
    var text = new XMLSerializer().serializeToString(kopie);
    return rastern("data:image/svg+xml;charset=utf-8," + encodeURIComponent(text), r.w, r.h, "image/png");
  }

  async function folieMessen(folie, seite) {
    var ursprung = seite.getBoundingClientRect();
    var formen = [];

    function rahmenUndFlaeche(el, cs) {
      if (el.matches("td, th, table, tr, thead, tbody")) return;
      var r = rechteck(el, ursprung);
      var flaeche = farbeHex(cs.backgroundColor);
      var radius = px(cs.borderTopLeftRadius);
      if (flaeche) {
        var art = "rechteck";
        if (radius >= Math.min(r.w, r.h) / 2 - 1 && Math.abs(r.w - r.h) < 2) art = "ellipse";
        formen.push({ art: art, x: r.x, y: r.y, w: r.w, h: r.h, farbe: flaeche, radius: radius });
      }
      // Einzelne Randlinien (z. B. orange Linie links am Hinweiskasten)
      [
        ["Left", r.x, r.y, px(cs.borderLeftWidth), r.h],
        ["Top", r.x, r.y, r.w, px(cs.borderTopWidth)],
        ["Right", r.x + r.w - px(cs.borderRightWidth), r.y, px(cs.borderRightWidth), r.h],
        ["Bottom", r.x, r.y + r.h - px(cs.borderBottomWidth), r.w, px(cs.borderBottomWidth)]
      ].forEach(function (seite) {
        var breite = px(cs["border" + seite[0] + "Width"]);
        var farbe = farbeHex(cs["border" + seite[0] + "Color"]);
        if (breite >= 1 && farbe && cs["border" + seite[0] + "Style"] !== "none") {
          formen.push({ art: "rechteck", x: seite[1], y: seite[2], w: seite[3], h: seite[4], farbe: farbe, radius: 0 });
        }
      });
    }

    function pseudoNachher(el) {
      var ps = getComputedStyle(el, "::after");
      if (!ps || ps.content === "none" || ps.display === "none") return;
      var farbe = farbeHex(ps.backgroundColor);
      var h = px(ps.height);
      var w = px(ps.width);
      if (!farbe || !h || !w) return;
      var r = rechteck(el, ursprung);
      var links = px(ps.marginLeft);
      formen.push({ art: "rechteck", x: r.x + links, y: r.y + r.h - h, w: w, h: h, farbe: farbe, radius: px(ps.borderTopLeftRadius) });
    }

    function hinweisSymbol(el) {
      var ps = getComputedStyle(el, "::before");
      if (!ps || ps.content === "none") return;
      var r = rechteck(el, ursprung);
      var groesse = px(ps.width) || 32;
      var y = r.y + r.h / 2 - groesse / 2;
      formen.push({ art: "ellipse", x: r.x + px(ps.left), y: y, w: groesse, h: groesse, farbe: farbeHex(ps.backgroundColor) || "ED7D31" });
      formen.push({
        art: "text",
        x: r.x + px(ps.left),
        y: y,
        w: groesse,
        h: groesse,
        mitte: true,
        schrift: "Georgia",
        absaetze: [
          {
            laeufe: [{ text: "i", fett: true, kursiv: true, farbe: farbeHex(ps.color) || "FFFFFF", groesse: px(ps.fontSize) }],
            groesse: px(ps.fontSize),
            ausrichtung: "center",
            zeilenhoehe: 1,
            abstandNach: 0
          }
        ]
      });
    }

    async function bild(el) {
      var r = rechteck(el, ursprung);
      var daten = null;
      if (el.tagName.toLowerCase() === "svg") daten = await svgRastern(el, r);
      else {
        var typ = /^data:image\/jpe?g/.test(el.src) ? "image/jpeg" : "image/png";
        daten = await rastern(el.currentSrc || el.src, r.w, r.h, typ);
      }
      if (daten) formen.push({ art: "bild", x: r.x, y: r.y, w: r.w, h: r.h, daten: daten, alt: el.getAttribute("alt") || "" });
    }

    function liste(el, ebene, absaetze) {
      var geordnet = el.tagName === "OL";
      var start = parseInt(el.getAttribute("start") || "1", 10);
      var csListe = getComputedStyle(el);
      Array.prototype.forEach.call(el.children, function (li) {
        if (li.tagName !== "LI") return;
        if (getComputedStyle(li).display === "none") return;
        absaetze.push(
          absatzVon(li, {
            ohne: "ul, ol",
            aufzaehlung: geordnet ? "zahl" : "punkt",
            start: start,
            ebene: ebene,
            einzug: px(csListe.paddingLeft)
          })
        );
        Array.prototype.forEach.call(li.children, function (k) {
          if (k.tagName === "UL" || k.tagName === "OL") liste(k, ebene + 1, absaetze);
        });
      });
    }

    function tabelle(el) {
      var r = rechteck(el, ursprung);
      var zeilen = [];
      var spalten = [];
      var rand = null;
      Array.prototype.forEach.call(el.querySelectorAll("tr"), function (tr, i) {
        var zellen = [];
        Array.prototype.forEach.call(tr.children, function (zelle) {
          var cs = getComputedStyle(zelle);
          if (i === 0) spalten.push(zelle.getBoundingClientRect().width);
          if (!rand) rand = { farbe: farbeHex(cs.borderTopColor) || "D9D9D9", breite: px(cs.borderTopWidth) };
          zellen.push({
            absatz: absatzVon(zelle),
            fuellung: farbeHex(cs.backgroundColor) || farbeHex(getComputedStyle(tr).backgroundColor),
            innen: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)]
          });
        });
        zeilen.push({ h: tr.getBoundingClientRect().height, zellen: zellen });
      });
      formen.push({ art: "tabelle", x: r.x, y: r.y, w: r.w, h: r.h, spalten: spalten, zeilen: zeilen, rand: rand });
    }

    async function gehen(el) {
      if (el.matches("aside.notes, script, style, br")) return;
      var cs = getComputedStyle(el);
      if (!sichtbar(el, cs)) return;
      var tag = el.tagName.toUpperCase();

      if (tag === "IMG" || tag === "SVG") {
        await bild(el);
        return;
      }
      if (tag === "TABLE") {
        tabelle(el);
        return;
      }

      if (el !== folie) rahmenUndFlaeche(el, cs);
      else if (px(cs.borderLeftWidth) >= 1 && farbeHex(cs.borderLeftColor)) {
        // Rand der Folie selbst (z. B. gruene Linie bei Loesungen)
        var rf = rechteck(el, ursprung);
        formen.push({ art: "rechteck", x: rf.x, y: rf.y, w: px(cs.borderLeftWidth), h: rf.h, farbe: farbeHex(cs.borderLeftColor), radius: 0 });
      }
      if (tag === "BLOCKQUOTE") hinweisSymbol(el);

      if (tag === "UL" || tag === "OL") {
        var absaetze = [];
        liste(el, 0, absaetze);
        if (absaetze.length) {
          var rl = rechteck(el, ursprung);
          formen.push({ art: "text", x: rl.x, y: rl.y, w: rl.w, h: rl.h, absaetze: absaetze });
        }
        // Bilder in Listen trotzdem uebernehmen
        var bilderInListe = el.querySelectorAll("img");
        for (var b = 0; b < bilderInListe.length; b++) await bild(bilderInListe[b]);
        return;
      }

      if (hatText(el) && !hatBlockKinder(el)) {
        var ri = inhaltsRechteck(el, ursprung);
        var absatz = absatzVon(el);
        absatz.abstandNach = 0;
        var zeilen = Math.round(ri.h / (absatz.zeilenhoehe * absatz.groesse));
        formen.push({ art: "text", x: ri.x, y: ri.y, w: ri.w, h: ri.h, einzeilig: zeilen <= 1, absaetze: [absatz] });
        pseudoNachher(el);
        var innereBilder = el.querySelectorAll("img, svg");
        for (var j = 0; j < innereBilder.length; j++) await bild(innereBilder[j]);
        return;
      }

      for (var i = 0; i < el.children.length; i++) await gehen(el.children[i]);
      pseudoNachher(el);
    }

    await gehen(folie);
    return formen;
  }

  function notizenText(folie) {
    var teile = [];
    folie.querySelectorAll("aside.notes").forEach(function (notiz) {
      var bloecke = notiz.querySelectorAll("p, li, h1, h2, h3, h4, pre");
      if (!bloecke.length) {
        teile.push(notiz.textContent.trim());
        return;
      }
      bloecke.forEach(function (b) {
        if (b.closest("li") && b.tagName !== "LI") return;
        var text = b.textContent.replace(/[ \t]+/g, " ").trim();
        if (!text) return;
        if (b.tagName === "LI") {
          var tiefe = 0;
          var p = b.parentElement;
          while (p && p !== notiz) {
            if (p.tagName === "UL" || p.tagName === "OL") tiefe++;
            p = p.parentElement;
          }
          text = new Array(tiefe).join("  ") + "- " + text;
        }
        teile.push(text);
      });
    });
    return teile.join("\n").trim();
  }

  var ergebnis = [];
  var folien = document.querySelectorAll(".pdf-page > section");
  for (var i = 0; i < folien.length; i++) {
    var folie = folien[i];
    var seite = folie.parentElement;
    var hintergrund = null;
    var bg = folie.getAttribute("data-background-color");
    if (bg) {
      var probe = document.createElement("div");
      probe.style.color = bg;
      document.body.appendChild(probe);
      hintergrund = farbeHex(getComputedStyle(probe).color);
      probe.remove();
    }
    ergebnis.push({
      hintergrund: hintergrund,
      breite: seite.getBoundingClientRect().width,
      hoehe: seite.getBoundingClientRect().height,
      notizen: notizenText(folie),
      formen: await folieMessen(folie, seite)
    });
  }
  return ergebnis;
};
