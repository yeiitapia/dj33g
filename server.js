// Despacho jurídico 33 grados (D.J. 33G)
// Expedición de actas de nacimiento, matrimonio y defunción.
// Un solo servicio: sirve el frontend (public/) y la API. Base de datos SQLite
// en archivo (sin servicios externos obligatorios).
// Requiere Node >= 22.5 (usa el módulo built-in node:sqlite).
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');


const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'dj33g.db');
const MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY || '';
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
// PIN de administrador fijo en Render (gratis): sobrevive a las actualizaciones
// aunque el disco gratis se borre. ADMIN_PIN_HASH (formato salt:hash) tiene
// prioridad; si solo está ADMIN_PIN (en texto plano), se convierte a hash en
// memoria al arrancar. Sin ninguno de los dos, el PIN se guarda en la base
// de datos como antes y se puede perder al actualizar.
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const ADMIN_PIN_HASH_ENV = process.env.ADMIN_PIN_HASH || '';
let adminPinHashMemory = null;
if (ADMIN_PIN && !ADMIN_PIN_HASH_ENV) adminPinHashMemory = hashPin(ADMIN_PIN);
function getAdminPinHash() {
  return getSetting('admin_pin_hash') || ADMIN_PIN_HASH_ENV || adminPinHashMemory;
}
// Alertas de WhatsApp al administrador cuando se solicita un acta (CallMeBot).
// Se activa solo si CALLMEBOT_APIKEY está configurado en el entorno; sin la
// clave no se envía nada y la solicitud se crea igual. Sin subir todavía.
const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || '5217774700718').replace(/\D/g, '');
const CALLMEBOT_APIKEY = process.env.CALLMEBOT_APIKEY || '';


async function notifyAdminWhatsApp(text) {
  if (!CALLMEBOT_APIKEY) return false;
  try {
    const url = 'https://api.callmebot.com/whatsapp.php?phone=' + ADMIN_WHATSAPP +
      '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(CALLMEBOT_APIKEY);
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) console.error('CallMeBot respondió', resp.status);
    return resp.ok;
  } catch (e) {
    console.error('No se pudo enviar la alerta de WhatsApp:', e.message);
    return false;
  }
}
// Anti-spam de alertas de consulta: máximo una por folio cada 15 minutos
// (en memoria; al reiniciar el servidor se olvida).
const lastLookupNotified = new Map();
function shouldNotifyLookup(folio) {
  const last = lastLookupNotified.get(folio) || 0;
  if (Date.now() - last < 15 * 60 * 1000) return false;
  lastLookupNotified.set(folio, Date.now());
  return true;
}


fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);


// ---------- Base de datos ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
