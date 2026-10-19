// Verschluesselung fuer den Build. Gegenstueck: site/js/krypto.js
import crypto from "node:crypto";

export const RUNDEN = 600000;

/** Leitet aus Passwort und Salz den AES-Schluessel ab (wie im Browser). */
export function schluesselAbleiten(passwort, salzB64, runden = RUNDEN) {
  return crypto.pbkdf2Sync(Buffer.from(passwort, "utf8"), Buffer.from(salzB64, "base64"), runden, 32, "sha256");
}

/** AES-256-GCM: 12 Byte IV + Geheimtext + 16 Byte Pruefsumme */
export function verschluesseln(schluessel, daten) {
  const iv = crypto.randomBytes(12);
  const chiffre = crypto.createCipheriv("aes-256-gcm", schluessel, iv);
  const geheim = Buffer.concat([chiffre.update(daten), chiffre.final()]);
  return Buffer.concat([iv, geheim, chiffre.getAuthTag()]);
}

export function entschluesseln(schluessel, daten) {
  const iv = daten.subarray(0, 12);
  const tag = daten.subarray(daten.length - 16);
  const geheim = daten.subarray(12, daten.length - 16);
  const dechiffre = crypto.createDecipheriv("aes-256-gcm", schluessel, iv);
  dechiffre.setAuthTag(tag);
  return Buffer.concat([dechiffre.update(geheim), dechiffre.final()]);
}

/**
 * Nichtssagender Dateiname: haengt vom Schluessel, vom Pfad und vom Inhalt ab.
 * So verraten die Namen nichts, und neue Inhalte erhalten neue Namen (kein alter Cache).
 */
export function geheimerName(schluessel, pfad, daten) {
  const inhalt = crypto.createHash("sha256").update(daten).digest("hex");
  return crypto.createHmac("sha256", schluessel).update(pfad + "\n" + inhalt).digest("hex").slice(0, 32) + ".bin";
}

export function neuesSalz() {
  return crypto.randomBytes(16).toString("base64");
}
