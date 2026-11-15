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
  return pay + ' ' + badge(st, cls);
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
    box.innerHTML = `<h3>Trámite recibido</h3><p>${r.message}</p>` + requestCard(r, r.code) +
      `<p><button class="btn-navy" id="pay-btn">Pagar con Mercado Pago</button></p><p id="pay-msg" class="muted"></p>`;
    $('request-form').reset();
    $('pay-btn').addEventListener('click', async () => {
      try {
        const pay = await api(`/api/requests/${r.folio}/pay`, { method: 'POST' });
        if (pay.init_point) {
          window.open(pay.init_point, '_blank');
          $('pay-msg').textContent = 'Se abrió Mercado Pago en otra pestaña. Después del pago, consulta tu trámite con tu folio y código.';
        } else {
          $('pay-msg').textContent = pay.message || 'Mercado Pago no está configurado todavía.';
        }
      } catch (err) { $('pay-msg').textContent = err.message; }
    });
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (err) { alert(err.message); }
});

// ---------- Mis trámites ----------
$('lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api(`/api/requests/${encodeURIComponent($('l-folio').value.trim().toUpperCase())}?code=${encodeURIComponent($('l-code').value.trim().toUpperCase())}`);
    $('lookup-result').innerHTML = requestCard(r, null);
  } catch (err) {
    $('lookup-result').innerHTML = `<div class="card"><p>${err.message}</p></div>`;
  }
});

// ---------- Administrador ----------
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
              ${r.status !== 'entregado' ? `<button class="link" data-status="${r.folio}">${r.status === 'recibido' ? 'Marcar en proceso' : 'Marcar entregado'}</button>` : ''}
            </td></tr>`).join('') + '</tbody></table>'
        : '<p class="muted">Aún no hay trámites.</p>';
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

loadCatalog().then(refreshAdmin).catch((e) => { $('catalog').innerHTML = '<p>No se pudo cargar el catálogo.</p>'; });
