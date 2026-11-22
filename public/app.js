// Despacho jurídico 33 grados — lógica del frontend.
const $ = (id) => document.getElementById(id);
const money = (n) => '$' + Number(n).toLocaleString('es-MX') + ' MXN';
const ADMIN_KEY = 'dj33g_admin_token';
let catalog = [];

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
  return data;
}
function adminHeaders() {
  const t = localStorage.getItem(ADMIN_KEY);
  return t ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}
function badge(text, cls) { return `<span class="badge ${cls}">${text}</span>`; }
function statusBadge(r) {
  const pay = r.payment_status === 'pagado'
    ? badge('Pagado', 'pagado')
    : badge('Pendiente de pago', 'pendiente');
  const st = { recibido: 'Recibido', en_proceso: 'En proceso', entregado: 'Entregado' }[r.status] || r.status;
  const cls = { recibido: 'recibido', en_proceso: 'en_proceso', entregado: 'entregado' }[r.status] || 'recibido';
  return pay + ' ' + badge(st, cls) + ' ' + actaBadge(r);
}
// Estado de verificación del acta (el administrador lo marca antes del pago).
function actaBadge(r) {
  const s = r.acta_status || 'pendiente';
  if (s === 'en_sistema') return badge('Acta en sistema', 'pagado');
  if (s === 'no_encontrada') return badge('Acta no encontrada', 'no_encontrada');
  return badge('En revisión: confirmando si el acta está en sistema', 'pendiente');
}
// Sección de pago: solo se muestra cuando el administrador confirmó que el
// acta está en sistema; antes de eso el usuario debe esperar la revisión.
function paySection(r) {
  const s = r.acta_status || 'pendiente';
  if (r.payment_status === 'pagado') return '<p>Tu pago ya quedó confirmado.</p>';
  if (s === 'no_encontrada') {
    return `<div class="card"><h3>Tu acta no se encontró en el sistema</h3>
      <p>No pagues todavía. Primero hay que subir tu acta al sistema; contacta al administrador por WhatsApp y te ayudamos.</p></div>` + whatsappCard();
  }
  if (s !== 'en_sistema') {
    return `<div class="card"><h3>Tu solicitud está en revisión</h3>
      <p>El administrador está confirmando si tu acta está en el sistema. <strong>No pagues todavía.</strong> Consulta tu trámite con tu folio y tu código secreto para ver cuándo ya puedes pagar.</p></div>`;
  }
  return transferInfo(r.folio, r.price);
}
function requestCard(r, showCode) {
  return `<div class="card">
    <h3>${r.label} — Folio ${r.folio}</h3>
    <p><strong>Solicitante:</strong> ${r.applicant_name} · <strong>Contacto:</strong> ${r.contact}</p>
    <p><strong>Registrado:</strong> ${r.person_name} · <strong>Fecha del acto:</strong> ${r.event_date}</p>
    <p><strong>Lugar:</strong> ${r.place_municipality}, ${r.place_state}${r.curp ? ' · <strong>CURP:</strong> ' + r.curp : ''}</p>
    <p><strong>Precio:</strong> ${money(r.price)}</p>
    <p>${statusBadge(r)}</p>
    ${showCode ? `<p><strong>Código secreto:</strong> ${showCode} — guárdalo, lo necesitarás para consultar tu trámite.</p>` : ''}
  </div>`;
}

function transferInfo(folio, price) {
  return `<div class="card">
    <h3>Pago por transferencia (SPEI)</h3>
    <p><strong>Beneficiario:</strong> Raúl Yair Tapia Hernández</p>
    <p><strong>Cuenta CLABE:</strong> 722969010240856928</p>
    <p><strong>Monto:</strong> ${money(price)} MXN</p>
    <p><strong>Concepto / Referencia:</strong> ${folio}</p>
    <p class="muted">Transfiere el monto exacto y pon tu folio como concepto. Después del pago, el administrador confirma tu trámite.</p>
  </div>`;
}

// ---------- Catálogo ----------
async function loadCatalog() {
  const data = await api('/api/catalog');
  catalog = data.actas;
  $('catalog').innerHTML = catalog.map((a) => `
    <div class="card">
      <h3>${a.label}</h3>
      <p class="muted">${a.description}</p>
      <p class="price">${money(a.price)} <small>MXN</small></p>
      <button class="btn-gold" data-type="${a.type}" data-label="${a.label}" data-price="${a.price}">Solicitar</button>
      ${data.mpConfigured ? '' : '<p class="muted"><small>Pago por confirmar con el administrador.</small></p>'}
    </div>`).join('');
  document.querySelectorAll('#catalog button').forEach((btn) => {
    btn.addEventListener('click', () => openForm(btn.dataset.type, btn.dataset.label, btn.dataset.price));
  });
}
function openForm(type, label, price) {
  $('solicitud').classList.remove('hidden');
  $('request-result').classList.add('hidden');
  $('f-type').value = type;
  $('form-title').textContent = 'Solicitar ' + label;
  $('form-price').textContent = 'Precio: ' + money(price) + ' MXN';
  $('solicitud').scrollIntoView({ behavior: 'smooth' });
}

// ---------- Crear solicitud ----------
$('request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    type: $('f-type').value,
    applicant_name: $('f-applicant').value.trim(),
    contact: $('f-contact').value.trim(),
    person_name: $('f-person').value.trim(),
    event_date: $('f-date').value,
    place_municipality: $('f-municipality').value.trim(),
    place_state: $('f-state').value.trim(),
    curp: $('f-curp').value.trim(),
  };
  try {
    const r = await api('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const box = $('request-result');
    box.classList.remove('hidden');
    box.innerHTML = `<h3>Trámite recibido</h3><p>${r.message}</p>` + requestCard(r, r.code) + paySection(r);
    $('request-form').reset();
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (err) { alert(err.message); }
});

function whatsappCard() {
  return `<div class="card">
    <h3>¿Tu acta no está en el sistema?</h3>
    <p>Se puede subir al sistema. Contacta al administrador por WhatsApp: <strong>777 470 0718</strong></p>
    <p><a class="btn-gold" href="https://wa.me/527774700718?text=Hola%2C%20quiero%20subir%20un%20acta%20al%20sistema%20de%20Despacho%20jur%C3%ADdico%2033%20grados." target="_blank" rel="noopener">Contactar por WhatsApp</a></p>
  </div>`;
}

// ---------- Mis trámites ----------
$('lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api(`/api/requests/${encodeURIComponent($('l-folio').value.trim().toUpperCase())}?code=${encodeURIComponent($('l-code').value.trim().toUpperCase())}`);
    $('lookup-result').innerHTML = requestCard(r, null) + paySection(r);
  } catch (err) {
    $('lookup-result').innerHTML = `<div class="card"><p>${err.message}</p></div>` + whatsappCard();
  }
});

// ---------- Administrador ----------
// ---------- WhatsApp del solicitante (panel del administrador) ----------
// Normaliza el contacto que dejó el solicitante a número mexicano para wa.me:
// 10 dígitos -> 52 + número; 12 dígitos con 52 -> tal cual; 521 + 10 -> 52 + 10.
// Si el contacto no es un teléfono válido, devuelve '' (sin botón de WhatsApp).
function waNumber(contact) {
  const d = String(contact || '').replace(/\D/g, '');
  if (d.length === 10) return '52' + d;
  if (d.length === 12 && d.startsWith('52')) return d;
  if (d.length === 13 && d.startsWith('521')) return '52' + d.slice(3);
  return '';
}
function waLink(r) {
  const n = waNumber(r.contact);
  if (!n) return '';
  const text = `Hola ${r.applicant_name}, soy del Despacho jurídico 33 grados. Te contacto por tu ${r.label} (folio ${r.folio}).`;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

async function refreshAdmin() {
  const st = await api('/api/admin/status');
  const token = localStorage.getItem(ADMIN_KEY);
  $('admin-setup').classList.add('hidden');
  $('admin-login').classList.add('hidden');
  $('admin-panel').classList.add('hidden');
  if (!st.hasPin) {
    $('admin-setup').classList.remove('hidden');
  } else if (!token) {
    $('admin-login').classList.remove('hidden');
  } else {
    try {
      const data = await api('/api/admin/requests', { headers: adminHeaders() });
      $('admin-panel').classList.remove('hidden');
      $('prices-form').innerHTML = catalog.map((a) => `
        <label>${a.label}
          <input type="number" min="0" step="1" data-price-type="${a.type}" value="${a.price}">
        </label>`).join('') + '<button type="submit" class="btn-gold">Guardar precios</button>';
      $('admin-requests').innerHTML = data.requests.length
        ? `<table><thead><tr><th>Folio</th><th>Acta</th><th>Solicitante</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>` +
          data.requests.map((r) => `<tr>
            <td>${r.folio}</td><td>${r.label}<br><small>${r.person_name} · ${r.event_date}</small></td>
            <td>${r.applicant_name}<br><small>${r.contact}</small></td>
            <td>${statusBadge(r)}</td>
            <td>
              ${r.payment_status !== 'pagado' ? `<button class="link" data-confirm="${r.folio}">Confirmar pago</button><br>` : ''}
              ${r.status !== 'entregado' ? `<button class="link" data-status="${r.folio}">${r.status === 'recibido' ? 'Marcar en proceso' : 'Marcar entregado'}</button><br>` : ''}
              <button class="link" data-acta="${r.folio}" data-acta-status="en_sistema">Acta en sistema</button><br>
              <button class="link" data-acta="${r.folio}" data-acta-status="no_encontrada">No encontrada</button><br>
              ${waLink(r) ? `<a class="link" href="${waLink(r)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}
            </td></tr>`).join('') + '</tbody></table>'
        : '<p class="muted">Aún no hay trámites.</p>';
      document.querySelectorAll('[data-acta]').forEach((b) => b.addEventListener('click', async () => {
        await api(`/api/admin/requests/${b.dataset.acta}/acta-status`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ acta_status: b.dataset.actaStatus }) });
        refreshAdmin();
      }));
      document.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', async () => {
        await api(`/api/admin/requests/${b.dataset.confirm}/confirm-payment`, { method: 'POST', headers: adminHeaders() });
        refreshAdmin();
      }));
      document.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
        const cur = data.requests.find((r) => r.folio === b.dataset.status);
        const next = cur.status === 'recibido' ? 'en_proceso' : 'entregado';
        await api(`/api/admin/requests/${b.dataset.status}/status`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ status: next }) });
        refreshAdmin();
      }));
    } catch (err) {
      localStorage.removeItem(ADMIN_KEY);
      $('admin-login').classList.remove('hidden');
      $('admin-msg').textContent = 'La sesión venció. Entra de nuevo con tu PIN.';
    }
  }
}
$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('s-pin').value }) });
    $('admin-msg').textContent = 'PIN creado. Ahora entra con tu PIN para administrar.';
    refreshAdmin();
  } catch (err) { alert(err.message); }
});
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('a-pin').value }) });
    localStorage.setItem(ADMIN_KEY, r.token);
    $('admin-msg').textContent = '';
    refreshAdmin();
  } catch (err) { alert(err.message); }
});
$('logout-btn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', headers: adminHeaders() }); } catch (e) {}
  localStorage.removeItem(ADMIN_KEY);
  refreshAdmin();
});
$('prices-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {};
  document.querySelectorAll('[data-price-type]').forEach((i) => { body[i.dataset.priceType] = Number(i.value); });
  try {
    const r = await api('/api/admin/prices', { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(body) });
    catalog = r.actas;
    $('admin-msg').textContent = 'Precios actualizados.';
    loadCatalog();
  } catch (err) { alert(err.message); }
});

// ---------- Borrar historial (administrador) ----------
$('delete-one-btn').addEventListener('click', async () => {
  const folio = $('d-folio').value.trim().toUpperCase();
  if (!folio) { alert('Escribe el folio del trámite que quieres borrar.'); return; }
  if (!confirm(`¿Borrar el trámite con folio ${folio}? Esta acción es permanente y no se puede deshacer.`)) return;
  try {
    await api(`/api/admin/requests/${encodeURIComponent(folio)}`, { method: 'DELETE', headers: adminHeaders() });
    $('admin-msg').textContent = `Trámite ${folio} borrado.`;
    $('d-folio').value = '';
    refreshAdmin();
  } catch (err) { alert(err.message); }
});
$('delete-all-btn').addEventListener('click', async () => {
  if (!confirm('¿Borrar TODO el historial de trámites? Esta acción es permanente y no se puede deshacer.')) return;
  try {
    const r = await api('/api/admin/requests', { method: 'DELETE', headers: adminHeaders() });
    $('admin-msg').textContent = `Historial borrado: ${r.deleted} trámite(s) eliminado(s).`;
    refreshAdmin();
  } catch (err) { alert(err.message); }
});

loadCatalog().then(refreshAdmin).catch((e) => { $('catalog').innerHTML = '<p>No se pudo cargar el catálogo.</p>'; });
