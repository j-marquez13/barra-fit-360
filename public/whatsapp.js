// ============================================
// WhatsApp — Recordatorios Automáticos (Fit 360)
// Se ejecuta después de app3.js y usa STATE, showToast y lucide.
// ============================================

function waEscapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function waSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waIsLoggedIn() {
  try {
    const auth = JSON.parse(sessionStorage.getItem('bf360_auth') || 'null');
    return !!(auth && auth.token);
  } catch (e) { return false; }
}

async function refreshWhatsAppEstado() {
  if (!waIsLoggedIn()) return;
  try {
    const res = await fetch('/api/whatsapp/estado');
    if (!res.ok) return;
    const data = await res.json();
    updateWhatsAppUI(data);
  } catch (e) { /* sin conexión */ }
}

function updateWhatsAppUI(data) {
  const btnConectar = document.getElementById('btn-wa-conectar');
  const btnEnviar = document.getElementById('btn-wa-enviar');
  const banner = document.getElementById('wa-banner');
  if (!btnConectar || !btnEnviar) return;

  if (data.conectado) {
    btnConectar.innerHTML = '<i data-lucide="check-circle-2"></i> WhatsApp conectado';
    btnConectar.disabled = true;
    btnConectar.style.opacity = '0.7';
    btnEnviar.disabled = false;
    banner.innerHTML = '🟢 Conectado' + (data.nombre ? ' como <strong>' + waEscapeHtml(data.nombre) + '</strong>' : '') + '. Enviados hoy: <strong>' + data.enviadosHoy + '/' + data.limiteDiario + '</strong>.';
    banner.className = 'wa-banner wa-ok';
  } else if (data.conectando) {
    btnConectar.innerHTML = '<i data-lucide="loader-2"></i> Conectando...';
    btnConectar.disabled = true;
    btnConectar.style.opacity = '0.7';
    btnEnviar.disabled = true;
    banner.innerHTML = '⌛ Generando código QR...';
    banner.className = 'wa-banner wa-warn';
  } else {
    btnConectar.innerHTML = '<i data-lucide="link"></i> Iniciar sesión con WhatsApp';
    btnConectar.disabled = false;
    btnConectar.style.opacity = '1';
    btnEnviar.disabled = true;
    banner.innerHTML = '⚠️ WhatsApp desconectado. Conéctalo para poder enviar recordatorios.';
    banner.className = 'wa-banner wa-warn';
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openWhatsAppModal(html) {
  const modal = document.getElementById('wa-modal');
  if (!modal) return;
  document.getElementById('wa-modal-body').innerHTML = html || '';
  document.getElementById('wa-modal-footer-confirm').style.display = 'none';
  modal.classList.add('open');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeWhatsAppModal() {
  const modal = document.getElementById('wa-modal');
  if (modal) modal.classList.remove('open');
}

async function conectarWhatsApp() {
  try {
    const res = await fetch('/api/whatsapp/conectar', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error al conectar', 'danger'); return; }
    updateWhatsAppUI(data);
    openWhatsAppModal(`
      <div style="text-align:center;">
        <p style="color:var(--color-muted); margin-bottom:14px; font-size:0.85rem;">
          Escanea este código con tu <strong>WhatsApp Business</strong>:<br>
          <span style="font-size:0.78rem;">Ajustes → Dispositivos vinculados → Vincular un dispositivo</span>
        </p>
        <div id="wa-qr-area" style="display:flex; justify-content:center;">
          <div style="padding:14px; background:rgba(0,0,0,0.2); border-radius:12px; border:1px solid var(--border-glass); color:var(--color-muted); font-size:0.85rem;">Generando código QR...</div>
        </div>
      </div>`);
    pollWhatsAppQR();
  } catch (e) {
    showToast('Error al conectar WhatsApp', 'danger');
  }
}

async function pollWhatsAppQR() {
  let intentos = 0;
  const maxIntentos = 180; // ~3 minutos
  while (intentos < maxIntentos) {
    await waSleep(2000);
    intentos++;
    let data;
    try {
      const res = await fetch('/api/whatsapp/estado');
      data = await res.json();
    } catch (e) { continue; }

    const qrArea = document.getElementById('wa-qr-area');
    if (data.conectado) {
      if (qrArea) qrArea.innerHTML = '<div style="color:var(--success); font-size:1rem; padding:20px;">✅ WhatsApp conectado correctamente</div>';
      showToast('✅ WhatsApp conectado correctamente', 'success');
      updateWhatsAppUI(data);
      setTimeout(closeWhatsAppModal, 1500);
      return;
    }
    if (data.qr && qrArea) {
      qrArea.innerHTML = '<img src="' + data.qr + '" alt="QR WhatsApp" style="width:260px; height:260px; border-radius:12px; background:#fff; padding:8px; box-shadow:0 8px 24px rgba(0,0,0,0.4);">';
    }
  }
  const qrArea = document.getElementById('wa-qr-area');
  if (qrArea) qrArea.innerHTML = '<div style="color:var(--warning); padding:20px;">No se detectó el escaneo. Cierra e inténtalo de nuevo.</div>';
}

async function enviarRecordatorios() {
  const tasaUsd = STATE.tasas.USD, tasaVes = STATE.tasas.VES;
  if (!tasaUsd || !tasaVes || parseFloat(tasaUsd) <= 0 || parseFloat(tasaVes) <= 0) {
    showToast('Establece las tasas USD y VES del día antes de enviar.', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/whatsapp/recordatorios/vista-previa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasas: { USD: tasaUsd, VES: tasaVes } })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error', 'danger'); return; }

    if (!data.total) {
      const msg = (data.sinTelefono && data.sinTelefono.length)
        ? 'No hay clientes con deuda y teléfono válido para enviar.'
        : 'No hay clientes con deuda pendiente.';
      showToast(msg, 'info');
      return;
    }
    mostrarVistaPrevia(data);
  } catch (e) {
    showToast('Error al preparar los recordatorios', 'danger');
  }
}

function mostrarVistaPrevia(data) {
  const aEnviar = Math.min(data.total, data.disponible);
  const listHtml = data.mensajes.map((m, i) =>
    '<div class="wa-msg-item">' +
      '<div class="wa-msg-head"><strong>' + (i + 1) + '. ' + waEscapeHtml(m.nombre) + '</strong><span>' + waEscapeHtml(m.telefono) + '</span></div>' +
      '<pre class="wa-msg-text">' + waEscapeHtml(m.mensaje) + '</pre>' +
    '</div>'
  ).join('');

  let avisos = '';
  if (data.sinTelefono && data.sinTelefono.length) {
    avisos += '<div class="alert-item alert-warning" style="margin-bottom:8px;"><i data-lucide="alert-triangle"></i> ' + data.sinTelefono.length + ' cliente(s) sin teléfono válido serán omitidos: ' + data.sinTelefono.map((s) => waEscapeHtml(s.nombre)).join(', ') + '.</div>';
  }
  if (data.disponible < data.total) {
    avisos += '<div class="alert-item alert-warning" style="margin-bottom:8px;"><i data-lucide="info"></i> Límite diario: se enviarán ' + data.disponible + ' de ' + data.total + ' mensajes (ya enviados hoy: ' + data.enviadosHoy + '/' + data.limiteDiario + ').</div>';
  }

  openWhatsAppModal(
    avisos +
    '<p style="color:var(--color-muted); font-size:0.85rem; margin-bottom:8px;">Se enviarán <strong style="color:var(--color-text)">' + aEnviar + '</strong> mensaje(s) con pausas aleatorias de 10–30 segundos.</p>' +
    '<div style="max-height:52vh; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:4px;">' + listHtml + '</div>'
  );

  const footer = document.getElementById('wa-modal-footer-confirm');
  footer.style.display = 'flex';
  const btnConfirmar = document.getElementById('btn-wa-confirmar');
  btnConfirmar.disabled = false;
  btnConfirmar.innerHTML = '<i data-lucide="send"></i> Enviar ' + aEnviar + ' mensaje(s)';
  btnConfirmar.onclick = function () { confirmarEnvio(aEnviar); };
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function confirmarEnvio(total) {
  if (!confirm('¿Enviar ' + total + ' mensajes de WhatsApp?')) return;

  const tasaUsd = STATE.tasas.USD, tasaVes = STATE.tasas.VES;
  document.getElementById('wa-modal-footer-confirm').style.display = 'none';
  document.getElementById('wa-modal-body').innerHTML = '<div id="wa-progress"><p style="color:var(--color-muted);">⏳ Iniciando envío...</p></div>';

  try {
    const res = await fetch('/api/whatsapp/recordatorios/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasas: { USD: tasaUsd, VES: tasaVes } })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error', 'danger'); closeWhatsAppModal(); return; }
    pollProgreso();
  } catch (e) {
    showToast('Error al iniciar el envío', 'danger');
    closeWhatsAppModal();
  }
}

async function pollProgreso() {
  const el = document.getElementById('wa-progress');
  while (true) {
    await waSleep(3000);
    let j;
    try {
      const res = await fetch('/api/whatsapp/recordatorios/progreso');
      j = await res.json();
    } catch (e) { continue; }

    if (!el || !document.body.contains(el)) return;

    const enviados = j.enviados || 0;
    const fallidos = j.fallidos || 0;
    const total = j.total || 0;

    if (j.enProgreso) {
      el.innerHTML = '<p style="margin-bottom:8px;">⏳ Enviando... <strong>' + (enviados + fallidos) + '/' + total + '</strong></p>' +
        '<p style="color:var(--success);">✅ Enviados: ' + enviados + '</p>' +
        '<p style="color:var(--danger);">❌ Fallidos: ' + fallidos + '</p>';
    } else {
      let extra = '';
      if (j.omitidosPorLimite) extra += '<p style="color:var(--warning);">⚠️ Omitidos por límite diario: ' + j.omitidosPorLimite + '</p>';
      if (j.interrumpido) extra += '<p style="color:var(--warning);">⚠️ El envío se interrumpió porque WhatsApp se desconectó.</p>';
      el.innerHTML = '<h4 style="font-family:var(--font-title); color:var(--cyan-neon); margin-bottom:8px;">📋 Resumen del envío</h4>' +
        '<p style="color:var(--success);">✅ Enviados: ' + enviados + '</p>' +
        '<p style="color:var(--danger);">❌ Fallidos: ' + fallidos + '</p>' + extra;
      showToast(enviados + ' enviados, ' + fallidos + ' fallidos', fallidos ? 'warning' : 'success');
      refreshWhatsAppEstado();
      return;
    }
  }
}

// ============================================
// WIRING + ARRANQUE
// ============================================
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('btn-wa-conectar')?.addEventListener('click', conectarWhatsApp);
  document.getElementById('btn-wa-enviar')?.addEventListener('click', enviarRecordatorios);
  document.getElementById('btn-wa-cerrar')?.addEventListener('click', closeWhatsAppModal);
  document.getElementById('btn-wa-cancelar')?.addEventListener('click', closeWhatsAppModal);

  // Refrescar al entrar a "Cuentas por Cobrar" (instantáneo)
  document.getElementById('nav-credito')?.addEventListener('click', function () {
    setTimeout(refreshWhatsAppEstado, 300);
  });

  refreshWhatsAppEstado();
  setInterval(refreshWhatsAppEstado, 30000);
});


