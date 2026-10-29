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

// Los recordatorios de WhatsApp son del módulo de crédito: solo se consultan si el
// usuario tiene ese permiso (el servidor responde 403 a los demás).
function waIsLoggedIn() {
  try {
    const auth = JSON.parse(sessionStorage.getItem('bf360_auth') || 'null');
    const p = Array.isArray(auth && auth.permisos) ? auth.permisos : [];
    return !!(auth && auth.token) && (p.includes('all') || p.includes('admin') || p.includes('credito'));
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
    btnConectar.innerHTML = '<i data-lucide="refresh-cw"></i> Reintentar conexión';
    btnConectar.disabled = false;
    btnConectar.style.opacity = '1';
    btnEnviar.disabled = true;
    let extra = '';
    if (data.motivoDesconexion) extra = ' (último error: ' + data.motivoDesconexion + ')';
    banner.innerHTML = '⌛ Generando código QR...' + extra;
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
        <p style="color:var(--color-muted); font-size:0.75rem; margin-top:12px;">Si el código caduca, se genera uno nuevo automáticamente.</p>
        <button type="button" class="action-btn secondary" id="btn-wa-retry" style="margin:12px auto 0;">🔄 Generar nuevo código</button>
      </div>`);
    document.getElementById('btn-wa-retry')?.addEventListener('click', conectarWhatsApp);
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
      qrArea.innerHTML = '<img src="' + data.qr + '" alt="QR WhatsApp" style="width:300px; max-width:80vw; height:auto; border-radius:12px; background:#fff; padding:10px; box-shadow:0 8px 24px rgba(0,0,0,0.4);">';
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
// RESUMEN SEMANAL DE COBRANZA
// ============================================
async function loadReporteSemanal() {
  if (!waIsLoggedIn()) return;
  try {
    const res = await fetch('/api/whatsapp/reporte-semanal/estado');
    if (!res.ok) return;
    const d = await res.json();
    const chk = document.getElementById('wa-reporte-activo');
    const tel = document.getElementById('wa-reporte-telefono');
    const status = document.getElementById('wa-reporte-status');
    if (chk) chk.checked = !!d.activado;
    if (tel) tel.value = d.telefono || '';
    if (status) {
      const p = d.preview || {};
      const total = Number(p.totalCobrado || 0).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      status.style.display = 'block';
      status.className = 'wa-banner wa-ok';
      status.innerHTML = '📊 Próximo envío: Lunes ' + waEscapeHtml(d.hora || '08:00') +
        ' · Semana a reportar: ' + waEscapeHtml(p.inicio || '—') + ' → ' + waEscapeHtml(p.fin || '—') +
        ' · ' + (p.total || 0) + ' cliente(s) · Total $' + total +
        (d.ultimoEnvio ? ' · Último envío: ' + waEscapeHtml(d.ultimoEnvio) : ' · Aún no se ha enviado');
    }
  } catch (e) { /* sin conexión */ }
}

async function guardarReporteSemanal() {
  const telefono = (document.getElementById('wa-reporte-telefono')?.value || '').trim();
  const activado = document.getElementById('wa-reporte-activo')?.checked ? true : false;
  try {
    const res = await fetch('/api/whatsapp/reporte-semanal/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefono, activado })
    });
    const d = await res.json();
    if (!res.ok) { showToast(d.error || 'Error al guardar', 'danger'); return; }
    showToast('Configuración del resumen semanal guardada.', 'success');
    loadReporteSemanal();
  } catch (e) {
    showToast('Error al guardar la configuración', 'danger');
  }
}

async function enviarReporteSemanalAhora() {
  const btn = document.getElementById('btn-wa-reporte-enviar');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Enviando...'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  try {
    const res = await fetch('/api/whatsapp/reporte-semanal/enviar', { method: 'POST' });
    const d = await res.json();
    if (!res.ok) showToast(d.error || 'Error al enviar', 'danger');
    else showToast('Resumen semanal enviado por WhatsApp ✔', 'success');
    loadReporteSemanal();
  } catch (e) {
    showToast('Error al enviar el resumen', 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  }
}

// ============================================
// AVISO DE INICIO DE TURNO (solo administrador)
// ============================================
async function loadAvisoTurno() {
  const panel = document.getElementById('wa-aviso-turno-panel');
  if (!panel || !waIsLoggedIn()) return;
  try {
    const res = await fetch('/api/whatsapp/aviso-turno/estado');
    if (!res.ok) { panel.style.display = 'none'; return; } // no es administrador
    const d = await res.json();
    panel.style.display = '';
    document.getElementById('wa-aviso-activo').checked = !!d.activado;
    document.getElementById('wa-aviso-telefono-1').value = d.telefonos?.[0] || '';
    document.getElementById('wa-aviso-telefono-2').value = d.telefonos?.[1] || '';
    const status = document.getElementById('wa-aviso-status');
    status.style.display = 'block';
    status.className = d.activado && d.telefonos?.length ? 'wa-banner wa-ok' : 'wa-banner wa-warn';
    status.innerHTML = d.activado && d.telefonos?.length
      ? '🔔 Se avisará a: ' + d.telefonos.map(waEscapeHtml).join(' y ')
      : '🔕 Aviso desactivado';
  } catch (e) { /* sin conexión */ }
}

async function guardarAvisoTurno() {
  const telefonos = ['wa-aviso-telefono-1', 'wa-aviso-telefono-2']
    .map(id => waBuildPhone((document.getElementById(id)?.value || '').trim()))
    .filter(Boolean);
  const activado = !!document.getElementById('wa-aviso-activo')?.checked;
  try {
    const res = await fetch('/api/whatsapp/aviso-turno/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefonos, activado })
    });
    const d = await res.json();
    if (!res.ok) { showToast(d.error || 'Error al guardar', 'danger'); return; }
    showToast('Aviso de inicio de turno guardado.', 'success');
    loadAvisoTurno();
  } catch (e) {
    showToast('Error al guardar el aviso', 'danger');
  }
}

async function probarAvisoTurno() {
  const btn = document.getElementById('btn-wa-aviso-probar');
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Enviando...'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
  try {
    const res = await fetch('/api/whatsapp/aviso-turno/probar', { method: 'POST' });
    const d = await res.json();
    if (!res.ok) showToast(d.error || 'Error al enviar la prueba', 'danger');
    else if (d.ok) showToast('Prueba enviada por WhatsApp ✔', 'success');
    else showToast('Algunos números fallaron: ' + d.resultados.filter(r => !r.ok).map(r => r.telefono).join(', '), 'warning');
  } catch (e) {
    showToast('Error al enviar la prueba', 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; if (typeof lucide !== 'undefined') lucide.createIcons(); }
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

  // Resumen semanal de cobranza
  document.getElementById('btn-wa-reporte-guardar')?.addEventListener('click', guardarReporteSemanal);
  document.getElementById('btn-wa-reporte-enviar')?.addEventListener('click', enviarReporteSemanalAhora);

  // Aviso de inicio de turno
  document.getElementById('btn-wa-aviso-guardar')?.addEventListener('click', guardarAvisoTurno);
  document.getElementById('btn-wa-aviso-probar')?.addEventListener('click', probarAvisoTurno);

  // Refrescar al entrar a "Cuentas por Cobrar" (instantáneo)
  document.getElementById('nav-credito')?.addEventListener('click', function () {
    setTimeout(refreshWhatsAppEstado, 300);
    setTimeout(loadReporteSemanal, 300);
    setTimeout(loadAvisoTurno, 300);
  });

  refreshWhatsAppEstado();
  loadReporteSemanal();
  loadAvisoTurno();
  setInterval(refreshWhatsAppEstado, 30000);
});


