// ============================================
// Controlador de Recordatorios WhatsApp (Baileys)
// Sesión persistente en Neon + envío masivo con límite diario.
// ============================================
import makeWASocket, {
  initAuthCreds,
  BufferJSON,
  proto,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import * as db from '../db.js';

const SESSION_NAME = 'fit360_whatsapp';
const LIMITE_DIARIO = parseInt(process.env.WHATSAPP_LIMITE_DIARIO || '50', 10);

const logger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Estado global del socket
let sock = null;
let status = 'desconectado'; // 'desconectado' | 'conectando' | 'conectado'
let currentQR = null;
let currentQRDataURL = null;
let waInfo = { nombre: null, telefono: null };
let connectedAt = null;
let reconnectTimer = null;
let connectStartedAt = null;
let lastDisconnectReason = null;

// Job de envío en curso
let sendJob = null;

// ============================================
// UTILIDADES
// ============================================
function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) digits = '58' + digits;
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  return digits;
}

function toJid(phone) {
  return `${phone}@s.whatsapp.net`;
}

function fmtPesos(n) {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtMoneda(n) {
  return Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PLANTILLA = `Hola {nombre} 🩵

En Fit 360 queremos recordarte que tienes un saldo pendiente por la compra de tu barra de proteínas.

Monto total:
• COP: {pesos}
• USD: {usd}
• Bs: {bs}

Puedes pagar directamente en la barra, o mediante transferencia o pago móvil.

Si ya gestionaste el pago, envíanos el comprobante para actualizar tu cuenta. Si tienes alguna duda, contáctanos y lo resolvemos.

¡Gracias por tu atención y por ser parte de nuestra comunidad 360! 🩵`;

function buildMessage(nombre, pesos, usd, bs) {
  return PLANTILLA
    .replace('{nombre}', nombre)
    .replace('{pesos}', fmtPesos(pesos))
    .replace('{usd}', fmtMoneda(usd))
    .replace('{bs}', fmtMoneda(bs));
}

// ============================================
// SESIÓN PERSISTENTE EN NEON
// ============================================
function revive(data) {
  if (data === null || data === undefined) return null;
  try {
    if (typeof data === 'string') return JSON.parse(data, BufferJSON.reviver);
    return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
  } catch (e) {
    return null;
  }
}

async function loadSessionData() {
  try {
    const rows = await db.query('SELECT session_data FROM whatsapp_sessions WHERE session_name = $1', [SESSION_NAME]);
    if (rows.length) return revive(rows[0].session_data);
    return null;
  } catch (e) {
    logger.error('Error cargando sesión WA de Neon:', e.message);
    return null;
  }
}

async function persistSession(data) {
  const json = JSON.stringify(data, BufferJSON.replacer);
  if (db.isPostgres()) {
    await db.execute(
      `INSERT INTO whatsapp_sessions (session_name, session_data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (session_name)
       DO UPDATE SET session_data = EXCLUDED.session_data, updated_at = NOW()`,
      [SESSION_NAME, json]
    );
  } else {
    await db.execute(
      `INSERT INTO whatsapp_sessions (session_name, session_data, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT(session_name)
       DO UPDATE SET session_data = excluded.session_data, updated_at = CURRENT_TIMESTAMP`,
      [SESSION_NAME, json]
    );
  }
}

async function hasStoredSession() {
  try {
    const rows = await db.query('SELECT session_data FROM whatsapp_sessions WHERE session_name = $1', [SESSION_NAME]);
    if (!rows.length) return false;
    const data = revive(rows[0].session_data);
    return !!(data && data.creds && data.creds.me && data.creds.me.id);
  } catch (e) {
    return false;
  }
}

async function useNeonAuthState() {
  const stored = await loadSessionData();
  let creds = (stored && stored.creds && stored.creds.me && stored.creds.me.id) ? stored.creds : initAuthCreds();
  const keys = (stored && stored.keys) ? stored.keys : {};

  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistSession({ creds, keys }).catch((e) => logger.error('Error guardando claves WA:', e.message));
    }, 3000);
  };

  const saveCreds = async () => {
    try { await persistSession({ creds, keys }); } catch (e) { logger.error('Error guardando credenciales WA:', e.message); }
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            const key = `${type}-${id}`;
            let value = keys[key];
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) keys[key] = value;
              else delete keys[key];
            }
          }
          scheduleSave();
        }
      }
    },
    saveCreds
  };
}

// ============================================
// CONEXIÓN / RECONEXIÓN
// ============================================
function scheduleReconnect(delayMs) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try { await startSocket(); }
    catch (e) { logger.error('Error reconectando WA:', e.message); scheduleReconnect(15000); }
  }, delayMs);
}

async function startSocket() {
  sock = null; // abandona cualquier socket previo (su close se ignorará)

  status = 'conectando';
  connectStartedAt = Date.now();
  currentQR = null;
  currentQRDataURL = null;

  const { state, saveCreds } = await useNeonAuthState();

  let version = [2, 3000, 1015901307];
  try { ({ version } = await fetchLatestBaileysVersion()); } catch (e) { /* usar fallback */ }

  const thisSocket = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: state,
    browser: ['Fit 360', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000
  });
  sock = thisSocket;

  thisSocket.ev.on('creds.update', saveCreds);

  thisSocket.ev.on('connection.update', async (update) => {
    if (sock !== thisSocket) return; // socket reemplazado

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      status = 'conectando';
      connectStartedAt = Date.now();
      currentQR = qr;
      logger.info('📱 QR de WhatsApp generado. Esperando escaneo...');
      try { currentQRDataURL = await QRCode.toDataURL(qr, { width: 512, margin: 2, errorCorrectionLevel: 'M' }); }
      catch (e) { currentQRDataURL = null; }
    }

    if (connection === 'open') {
      status = 'conectado';
      connectStartedAt = null;
      lastDisconnectReason = null;
      currentQR = null;
      currentQRDataURL = null;
      connectedAt = new Date();
      const rawId = thisSocket.user?.id || '';
      waInfo.telefono = rawId.split(':')[0].replace('@s.whatsapp.net', '') || null;
      waInfo.nombre = thisSocket.user?.name || thisSocket.user?.verifiedName || waInfo.telefono || null;
      logger.info('✅ WhatsApp conectado:', waInfo.nombre);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const wasLoggedOut = code === DisconnectReason.loggedOut;
      status = 'desconectado';
      connectStartedAt = null;
      lastDisconnectReason = code;
      currentQR = null;
      currentQRDataURL = null;
      sock = null;

      if (wasLoggedOut) {
        logger.warn('⚠️ WhatsApp deslogueado (sesión invalidada). Se requiere escanear QR de nuevo.');
        try { await db.execute('DELETE FROM whatsapp_sessions WHERE session_name = $1', [SESSION_NAME]); } catch (e) {}
        return;
      }

      logger.warn('WhatsApp desconectado (code=' + code + '). Reintentando en 5s...');
      scheduleReconnect(5000);
    }
  });
}

function startWatchdog() {
  setInterval(async () => {
    if (status === 'conectando' && connectStartedAt && (Date.now() - connectStartedAt) > 90000) {
      logger.warn('⏱️ Conexión de WhatsApp atascada (>90s). Reiniciando...');
      try { await startSocket(); } catch (e) { logger.error('Error en watchdog:', e.message); }
    }
  }, 15000);
}

export function initWhatsApp() {
  startWatchdog();
  (async () => {
    try {
      const stored = await hasStoredSession();
      if (!stored) {
        status = 'desconectado';
        logger.info('Sin sesión de WhatsApp guardada. A la espera de conexión manual.');
        return;
      }
      await startSocket();
    } catch (e) {
      logger.error('Error iniciando WhatsApp:', e.message);
    }
  })();
}

async function getEstadoPayload() {
  const enviadosHoy = await countEnviadosHoy();
  return {
    conectado: status === 'conectado',
    conectando: status === 'conectando',
    status,
    qr: currentQRDataURL,
    nombre: waInfo.nombre,
    telefono: waInfo.telefono,
    limiteDiario: LIMITE_DIARIO,
    enviadosHoy,
    motivoDesconexion: lastDisconnectReason
  };
}

// ============================================
// LOGS Y LÍMITE DIARIO
// ============================================
async function countEnviadosHoy() {
  try {
    const today = db.localDate();
    let sql;
    if (db.isPostgres()) {
      sql = `SELECT COUNT(*)::int AS total FROM whatsapp_logs WHERE estado = 'enviado' AND fecha::date = '${today}'`;
    } else {
      sql = `SELECT COUNT(*) AS total FROM whatsapp_logs WHERE estado = 'enviado' AND DATE(fecha, '-4 hours') = '${today}'`;
    }
    const rows = await db.query(sql, []);
    return parseInt(rows[0]?.total, 10) || 0;
  } catch (e) {
    logger.error('Error contando envíos de hoy:', e.message);
    return 0;
  }
}

async function logEnvio(telefono, mensaje, estado) {
  try {
    await db.execute('INSERT INTO whatsapp_logs (telefono, mensaje, estado) VALUES ($1, $2, $3)', [telefono, mensaje, estado]);
  } catch (e) {
    logger.error('Error guardando log de WhatsApp:', e.message);
  }
}

// ============================================
// CÁLCULO DE MENSAJES (mismas tasas del sistema)
// ============================================
function buildPreview(clients, tasas) {
  const tasaUsd = parseFloat(tasas?.USD);
  const tasaVes = parseFloat(tasas?.VES);
  if (!tasaUsd || tasaUsd <= 0) throw new Error('La tasa USD no es válida. Configura las tasas del día.');
  if (!tasaVes || tasaVes <= 0) throw new Error('La tasa VES no es válida. Configura las tasas del día.');

  const mensajes = [];
  const sinTelefono = [];
  for (const c of clients) {
    const pesos = parseFloat(c.saldo_deudor) || 0;
    if (pesos <= 0) continue;
    const usd = pesos / tasaUsd;   // misma lógica del sistema: pesos ÷ tasa
    const bs = pesos / tasaVes;    // misma lógica del sistema: pesos ÷ tasa
    const phone = normalizePhone(c.telefono);
    const mensaje = buildMessage(c.nombre, pesos, usd, bs);
    if (!phone) {
      sinTelefono.push({ id: c.id, nombre: c.nombre, telefono: c.telefono || '' });
      continue;
    }
    mensajes.push({ cliente_id: c.id, nombre: c.nombre, telefono: phone, pesos, usd, bs, mensaje });
  }
  return { mensajes, sinTelefono, tasas: { USD: tasaUsd, VES: tasaVes } };
}

// ============================================
// HANDLERS (endpoints)
// ============================================
export async function getEstado(req, res) {
  try {
    res.json(await getEstadoPayload());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function conectar(req, res) {
  try {
    if (status === 'conectado') {
      return res.json(await getEstadoPayload());
    }
    if (status === 'conectando') {
      // Si lleva demasiado tiempo conectando, reinicia y genera un QR nuevo.
      if (connectStartedAt && (Date.now() - connectStartedAt) > 60000) {
        logger.info('Reinicio forzado de conexión solicitado.');
        await startSocket();
      }
      return res.json(await getEstadoPayload());
    }
    await startSocket();
    res.json(await getEstadoPayload());
  } catch (e) {
    logger.error('Error al conectar WhatsApp:', e.message);
    res.status(500).json({ error: 'No se pudo iniciar la conexión de WhatsApp: ' + e.message });
  }
}

export async function desconectar(req, res) {
  try {
    if (sock) { try { await sock.logout(); } catch (e) {} sock = null; }
    status = 'desconectado';
    currentQR = null;
    currentQRDataURL = null;
    waInfo = { nombre: null, telefono: null };
    await db.execute('DELETE FROM whatsapp_sessions WHERE session_name = $1', [SESSION_NAME]);
    res.json({ ok: true, mensaje: 'Sesión de WhatsApp desconectada.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function vistaPrevia(req, res) {
  try {
    const tasas = req.body?.tasas || {};
    const clients = await db.query(
      'SELECT id, nombre, telefono, saldo_deudor FROM clientes WHERE saldo_deudor > 0 ORDER BY nombre ASC',
      []
    );
    const preview = buildPreview(clients, tasas);
    const enviadosHoy = await countEnviadosHoy();
    res.json({
      total: preview.mensajes.length,
      sinTelefono: preview.sinTelefono,
      mensajes: preview.mensajes,
      enviadosHoy,
      limiteDiario: LIMITE_DIARIO,
      disponible: Math.max(0, LIMITE_DIARIO - enviadosHoy)
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

export async function enviar(req, res) {
  try {
    if (sendJob && sendJob.enProgreso) {
      return res.status(409).json({ error: 'Ya hay un envío de recordatorios en curso.' });
    }
    if (status !== 'conectado' || !sock) {
      return res.status(400).json({ error: 'WhatsApp no está conectado. Conéctalo primero.' });
    }

    const tasas = req.body?.tasas || {};
    const clients = await db.query(
      'SELECT id, nombre, telefono, saldo_deudor FROM clientes WHERE saldo_deudor > 0 ORDER BY nombre ASC',
      []
    );
    const preview = buildPreview(clients, tasas);

    if (preview.mensajes.length === 0) {
      return res.json({
        ok: false,
        mensaje: preview.sinTelefono.length
          ? 'No hay clientes con deuda y teléfono válido.'
          : 'No hay clientes con deuda pendiente.',
        total: 0, enviados: 0, fallidos: 0
      });
    }

    const enviadosHoy = await countEnviadosHoy();
    const disponible = LIMITE_DIARIO - enviadosHoy;
    if (disponible <= 0) {
      return res.status(429).json({ error: 'Límite diario alcanzado, intenta mañana.' });
    }

    const aEnviar = preview.mensajes.slice(0, disponible);
    const omitidosPorLimite = preview.mensajes.length - aEnviar.length;

    const job = {
      jobId: Date.now().toString(),
      enProgreso: true,
      total: aEnviar.length,
      enviados: 0,
      fallidos: 0,
      omitidosPorLimite,
      interrumpido: false,
      items: aEnviar.map((m) => ({ ...m, estado: 'pendiente' }))
    };
    sendJob = job;

    runSendJob(job);

    res.json({ ok: true, jobId: job.jobId, total: aEnviar.length, omitidosPorLimite });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

async function runSendJob(job) {
  for (let i = 0; i < job.items.length; i++) {
    const item = job.items[i];

    if (status !== 'conectado' || !sock) {
      for (let j = i; j < job.items.length; j++) {
        job.items[j].estado = 'omitido';
        job.items[j].error = 'WhatsApp se desconectó durante el envío.';
      }
      job.interrumpido = true;
      break;
    }

    try {
      await sock.sendMessage(toJid(item.telefono), { text: item.mensaje });
      await logEnvio(item.telefono, item.mensaje, 'enviado');
      item.estado = 'enviado';
      job.enviados++;
    } catch (e) {
      logger.error('Error enviando a ' + item.telefono + ':', e.message);
      item.estado = 'fallido';
      item.error = e.message;
      job.fallidos++;
      await logEnvio(item.telefono, item.mensaje, 'fallido');
    }

    if (i < job.items.length - 1) {
      const pausa = 10000 + Math.floor(Math.random() * 20001); // 10–30 seg
      await sleep(pausa);
    }
  }
  job.enProgreso = false;
  job.finalizado = new Date();
  logger.info(`📲 Envío finalizado: ${job.enviados} enviados, ${job.fallidos} fallidos.`);
}

export async function progreso(req, res) {
  res.json(sendJob || { enProgreso: false });
}




