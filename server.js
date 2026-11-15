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

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

// ---------- Base de datos ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT UNIQUE NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    applicant_name TEXT NOT NULL,
    contact TEXT NOT NULL,
    person_name TEXT NOT NULL,
    event_date TEXT NOT NULL,
    place_municipality TEXT NOT NULL,
    place_state TEXT NOT NULL,
    curp TEXT,
    status TEXT NOT NULL DEFAULT 'recibido',
    payment_status TEXT NOT NULL DEFAULT 'pendiente',
    mp_preference_id TEXT,
    mp_init_point TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL
  );
`);

const getSetting = (key, fallback) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

// Precios fijos: $110 MXN por acta (editables por el administrador).
if (getSetting('price_nacimiento') === undefined) setSetting('price_nacimiento', 110);
if (getSetting('price_matrimonio') === undefined) setSetting('price_matrimonio', 110);
if (getSetting('price_defuncion') === undefined) setSetting('price_defuncion', 110);
// Migración única: precios que ya existían guardados (250/350/250) pasan a $110.
if (getSetting('prices_migrated_110') === undefined) {
  setSetting('price_nacimiento', 110);
  setSetting('price_matrimonio', 110);
  setSetting('price_defuncion', 110);
  setSetting('prices_migrated_110', 1);
}

const ACTAS = {
  nacimiento: { label: 'Acta de Nacimiento', description: 'Copia certificada del acta de nacimiento.' },
  matrimonio: { label: 'Acta de Matrimonio', description: 'Copia certificada del acta de matrimonio.' },
  defuncion: { label: 'Acta de Defunción', description: 'Copia certificada del acta de defunción.' },
};
const getCatalog = () =>
  Object.entries(ACTAS).map(([type, info]) => ({
    type,
    label: info.label,
    description: info.description,
    price: Number(getSetting('price_' + type, 0)),
  }));
const getPrice = (type) => Number(getSetting('price_' + type, 0));

// ---------- Utilidades ----------
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}
function makeFolio() {
  // Contador persistente: el folio nunca se reutiliza aunque se borre el historial.
  const year = new Date().getFullYear();
  const key = 'folio_seq_' + year;
  const n = Number(getSetting(key, 0)) + 1;
  setSetting(key, n);
  return `DJ33G-${year}-${String(n).padStart(4, '0')}`;
}
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return crypto.timingSafeEqual(
    Buffer.from(crypto.scryptSync(pin, salt, 64).toString('hex')),
    Buffer.from(hash)
  );
}
function publicRequest(r) {
  return {
    folio: r.folio,
    type: r.type,
    label: ACTAS[r.type] ? ACTAS[r.type].label : r.type,
    applicant_name: r.applicant_name,
    contact: r.contact,
    person_name: r.person_name,
    event_date: r.event_date,
    place_municipality: r.place_municipality,
    place_state: r.place_state,
    curp: r.curp || '',
    status: r.status,
    payment_status: r.payment_status,
    price: getPrice(r.type),
    created_at: r.created_at,
  };
}
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const row = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(token);
  if (!row || new Date(row.expires_at) <= new Date()) {
    if (row) db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Sesión no válida o vencida' });
  }
  next();
}

// ---------- App ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Catálogo público de actas con precios.
app.get('/api/catalog', (req, res) => {
  res.json({ actas: getCatalog(), mpConfigured: Boolean(MP_ACCESS_TOKEN) });
});

// Crear una solicitud de acta.
app.post('/api/requests', (req, res) => {
  const b = req.body || {};
  const type = String(b.type || '').toLowerCase();
  if (!ACTAS[type]) return res.status(400).json({ error: 'Tipo de acta no válido' });
  const required = ['applicant_name', 'contact', 'person_name', 'event_date', 'place_municipality', 'place_state'];
  for (const f of required) {
    if (!b[f] || !String(b[f]).trim()) return res.status(400).json({ error: `Falta el campo: ${f}` });
  }
  const folio = makeFolio();
  const code = makeCode();
  const price = getPrice(type);
  const info = db.prepare(`
    INSERT INTO requests (folio, code, type, applicant_name, contact, person_name, event_date, place_municipality, place_state, curp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    folio, code, type,
    String(b.applicant_name).trim(), String(b.contact).trim(),
    String(b.person_name).trim(), String(b.event_date).trim(),
    String(b.place_municipality).trim(), String(b.place_state).trim(),
    b.curp ? String(b.curp).trim().toUpperCase() : null
  );
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({
    ...publicRequest(row),
    code,
    message:
      'Trámite recibido. Confirmamos que tu solicitud de ' + ACTAS[type].label +
      ' quedó registrada con el folio ' + folio + '. Revisa que los datos del ' +
      'registro (nombre, fecha y lugar) estén correctos; si algo no coincide, ' +
      'avísanos con tu folio para corregirlo antes de expedir el acta. ' +
      'Guarda tu código secreto: lo necesitarás para consultar tu trámite. ' +
      (MP_ACCESS_TOKEN
        ? 'Puedes pagar en línea con Mercado Pago o esperar la confirmación.'
        : 'El pago queda pendiente: puedes pagar en línea cuando se active Mercado Pago o el administrador lo confirmará manualmente.'),
  });
});

// Consultar un trámite con folio + código secreto ("Mis trámites").
app.get('/api/requests/:folio', (req, res) => {
  const code = String(req.query.code || '');
  const row = db.prepare('SELECT * FROM requests WHERE folio = ?').get(req.params.folio.toUpperCase());
  if (!row || row.code !== code) {
    return res.status(404).json({ error: 'No se encontró el trámite con ese folio y código' });
  }
  res.json(publicRequest(row));
});

// Pagar un trámite con Mercado Pago (crea la preferencia de pago).
app.post('/api/requests/:folio/pay', async (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE folio = ?').get(req.params.folio.toUpperCase());
  if (!row) return res.status(404).json({ error: 'Trámite no encontrado' });
  if (row.payment_status === 'pagado') return res.json({ alreadyPaid: true, ...publicRequest(row) });
  if (!MP_ACCESS_TOKEN) {
    return res.json({
      mpConfigured: false,
      message: 'Mercado Pago no está configurado todavía. Tu trámite queda pendiente de pago y el administrador lo confirmará manualmente.',
      ...publicRequest(row),
    });
  }
  try {
    const price = getPrice(row.type);
    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ title: `${ACTAS[row.type].label} - Folio ${row.folio}`, quantity: 1, unit_price: price, currency_id: 'MXN' }],
        external_reference: row.folio,
        payer: { name: row.applicant_name },
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: 'Mercado Pago no aceptó la solicitud de pago', detail: data && data.message ? data.message : '' });
    db.prepare('UPDATE requests SET mp_preference_id = ?, mp_init_point = ? WHERE id = ?')
      .run(data.id, data.init_point, row.id);
    res.json({ mpConfigured: true, init_point: data.init_point, preference_id: data.id });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo contactar a Mercado Pago. Inténtalo más tarde.' });
  }
});

// ---------- Administrador ----------
// ¿Ya existe un PIN de administrador?
app.get('/api/admin/status', (req, res) => {
  res.json({ hasPin: Boolean(getSetting('admin_pin_hash')), mpConfigured: Boolean(MP_ACCESS_TOKEN) });
});

// Crear el PIN la primera vez (solo si aún no existe).
app.post('/api/admin/setup', (req, res) => {
  if (getSetting('admin_pin_hash')) return res.status(409).json({ error: 'El PIN de administrador ya existe' });
  const pin = String(req.body && req.body.pin || '');
  if (pin.length < 4 || pin.length > 20) return res.status(400).json({ error: 'El PIN debe tener entre 4 y 20 caracteres' });
  setSetting('admin_pin_hash', hashPin(pin));
  res.json({ ok: true });
});

// Entrar como administrador (sesión de 30 días en este dispositivo).
app.post('/api/admin/login', (req, res) => {
  const stored = getSetting('admin_pin_hash');
  if (!stored) return res.status(409).json({ error: 'Aún no hay PIN de administrador. Créalo primero.' });
  const pin = String(req.body && req.body.pin || '');
  if (!verifyPin(pin, stored)) return res.status(401).json({ error: 'PIN incorrecto' });
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').run(token, expires);
  res.json({ token, expires_at: expires });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

// Ver todos los trámites.
app.get('/api/admin/requests', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM requests ORDER BY id DESC').all();
  res.json({ requests: rows.map(publicRequest) });
});

// Confirmar manualmente un pago.
app.post('/api/admin/requests/:folio/confirm-payment', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE folio = ?').get(req.params.folio.toUpperCase());
  if (!row) return res.status(404).json({ error: 'Trámite no encontrado' });
  db.prepare("UPDATE requests SET payment_status = 'pagado' WHERE id = ?").run(row.id);
  res.json(publicRequest(db.prepare('SELECT * FROM requests WHERE id = ?').get(row.id)));
});

// Cambiar el estado de un trámite (recibido, en_proceso, entregado).
app.post('/api/admin/requests/:folio/status', requireAdmin, (req, res) => {
  const status = String(req.body && req.body.status || '');
  if (!['recibido', 'en_proceso', 'entregado'].includes(status)) {
    return res.status(400).json({ error: 'Estado no válido' });
  }
  const row = db.prepare('SELECT * FROM requests WHERE folio = ?').get(req.params.folio.toUpperCase());
  if (!row) return res.status(404).json({ error: 'Trámite no encontrado' });
  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run(status, row.id);
  res.json(publicRequest(db.prepare('SELECT * FROM requests WHERE id = ?').get(row.id)));
});

// Borrar un trámite individual por folio.
app.delete('/api/admin/requests/:folio', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE folio = ?').get(req.params.folio.toUpperCase());
  if (!row) return res.status(404).json({ error: 'Trámite no encontrado' });
  db.prepare('DELETE FROM requests WHERE id = ?').run(row.id);
  res.json({ ok: true, deleted: row.folio });
});

// Borrar todo el historial de trámites (definitivo, no se puede deshacer).
app.delete('/api/admin/requests', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM requests').run();
  res.json({ ok: true, deleted: info.changes });
});

// Editar precios del catálogo.
app.put('/api/admin/prices', requireAdmin, (req, res) => {
  const b = req.body || {};
  for (const type of Object.keys(ACTAS)) {
    if (b[type] !== undefined) {
      const v = Number(b[type]);
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `Precio no válido para ${type}` });
      setSetting('price_' + type, v);
    }
  }
  res.json({ actas: getCatalog() });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Despacho jurídico 33 grados escuchando en el puerto ${PORT}`);
});
