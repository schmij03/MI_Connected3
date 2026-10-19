/*
 * Entschluesselung im Browser (Web Crypto API).
 *
 * Beim Build werden alle Inhalte mit AES-256-GCM verschluesselt. Der
 * Schluessel entsteht aus dem Passwort mit PBKDF2-SHA-256. Oeffentlich sind
 * nur Salz und Anzahl Runden (daten/zugang.json). Jede Datei ist so
 * aufgebaut: 12 Byte IV, danach Geheimtext mit Pruefsumme.
 *
 * Nach der Anmeldung liegt der abgeleitete Schluessel (nicht das Passwort)
 * im sessionStorage, bei "angemeldet bleiben" im localStorage.
 */
(function () {
  "use strict";

  var SPEICHER_NAME = "mi-schluessel";
  var DATEN = "daten/";
  var schluesselCache = null;
  var indexCache = null;

  function b64ZuBytes(text) {
    var bin = atob(text);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesZuB64(bytes) {
    var bin = "";
    var teil = 0x8000;
    for (var i = 0; i < bytes.length; i += teil) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + teil));
    }
    return btoa(bin);
  }

  function speicherLesen() {
    try {
      return sessionStorage.getItem(SPEICHER_NAME) || localStorage.getItem(SPEICHER_NAME);
    } catch (e) {
      return null;
    }
  }

  function speicherSchreiben(wert, dauerhaft) {
    try {
      sessionStorage.setItem(SPEICHER_NAME, wert);
      if (dauerhaft) localStorage.setItem(SPEICHER_NAME, wert);
      else localStorage.removeItem(SPEICHER_NAME);
    } catch (e) {
      /* Privates Fenster: dann gilt die Anmeldung nur fuer diese Seite */
    }
  }

  function abmelden() {
    schluesselCache = null;
    indexCache = null;
    try {
      sessionStorage.removeItem(SPEICHER_NAME);
      localStorage.removeItem(SPEICHER_NAME);
    } catch (e) {
      /* nichts zu tun */
    }
  }

  async function holen(pfad, ohneCache) {
    var antwort = await fetch(pfad, { cache: ohneCache ? "no-store" : "default" });
    if (!antwort.ok) throw new Error("Datei nicht gefunden (" + antwort.status + ")");
    return new Uint8Array(await antwort.arrayBuffer());
  }

  async function zugang() {
    var antwort = await fetch(DATEN + "zugang.json", { cache: "no-store" });
    if (!antwort.ok) throw new Error("Die Seite ist noch nicht fertig eingerichtet.");
    return antwort.json();
  }

  async function schluesselAusRoh(roh) {
    return crypto.subtle.importKey("raw", roh, { name: "AES-GCM" }, false, ["decrypt"]);
  }

  async function entschluesselnMit(schluessel, daten) {
    var iv = daten.subarray(0, 12);
    var geheim = daten.subarray(12);
    var klar = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, schluessel, geheim);
    return new Uint8Array(klar);
  }

  /** Prueft das Passwort, indem der Index entschluesselt wird. */
  async function anmelden(passwort, dauerhaft) {
    if (!window.crypto || !crypto.subtle) {
      throw new Error("Dieser Browser unterstützt die Entschlüsselung nicht. Bitte die Seite über https öffnen.");
    }
    var z = await zugang();
    var basis = await crypto.subtle.importKey("raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64ZuBytes(z.salz), iterations: z.runden },
      basis,
      256
    );
    var roh = new Uint8Array(bits);
    var schluessel = await schluesselAusRoh(roh);
    var daten = await holen(DATEN + z.index, true);
    try {
      await entschluesselnMit(schluessel, daten);
    } catch (e) {
      var fehler = new Error("Das Passwort stimmt nicht.");
      fehler.falschesPasswort = true;
      throw fehler;
    }
    speicherSchreiben(bytesZuB64(roh), dauerhaft);
    schluesselCache = schluessel;
    return true;
  }

  async function schluessel() {
    if (schluesselCache) return schluesselCache;
    var gespeichert = speicherLesen();
    if (!gespeichert) return null;
    schluesselCache = await schluesselAusRoh(b64ZuBytes(gespeichert));
    return schluesselCache;
  }

  /** Laedt eine verschluesselte Datei und gibt die Bytes zurueck. */
  async function datei(name) {
    var s = await schluessel();
    if (!s) throw new Error("Nicht angemeldet.");
    return entschluesselnMit(s, await holen(DATEN + name));
  }

  /** Laedt den Index mit allen Kapiteln, Lektionen und Dateinamen. */
  async function index() {
    if (indexCache) return indexCache;
    var z = await zugang();
    var s = await schluessel();
    if (!s) throw new Error("Nicht angemeldet.");
    var bytes;
    try {
      bytes = await entschluesselnMit(s, await holen(DATEN + z.index, true));
    } catch (e) {
      // Passwort wurde geaendert: neu anmelden
      abmelden();
      throw new Error("Nicht angemeldet.");
    }
    indexCache = JSON.parse(new TextDecoder().decode(bytes));
    return indexCache;
  }

  /** Bietet eine Datei aus dem Index zum Speichern an. */
  async function herunterladen(eintrag) {
    var bytes = await datei(eintrag.datei);
    var blob = new Blob([bytes], { type: eintrag.typ || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = eintrag.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  /** Zur Anmeldung umleiten, falls kein Schluessel vorhanden ist. */
  function anmeldungVerlangen() {
    if (speicherLesen()) return true;
    var ziel = location.pathname.split("/").pop() + location.search + location.hash;
    location.replace("index.html?weiter=" + encodeURIComponent(ziel));
    return false;
  }

  window.MiKrypto = {
    anmelden: anmelden,
    abmelden: abmelden,
    angemeldet: function () {
      return !!speicherLesen();
    },
    anmeldungVerlangen: anmeldungVerlangen,
    datei: datei,
    index: index,
    herunterladen: herunterladen
  };
})();
