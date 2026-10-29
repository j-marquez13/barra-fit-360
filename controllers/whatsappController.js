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

// Socket vigente aunque ya se haya cerrado (`sock` queda en null al desconectarse);
// se usa para cerrar la conexión anterior antes de abrir otra.
let socketActual = null;
// Guarda de inmediato las claves pendientes de la sesión actual (ver useNeonAuthState).
let flushAuthPendiente = async () => {};
// Deja de guardar las claves de la sesión actual (otra instancia tomó la sesión).
let desactivarAuthActual = () => {};

// Job de envío en curso
let sendJob = null;

// ============================================
// MENSAJES ENVIADOS (reintentos de descifrado)
// Cuando el teléfono del cliente no logra descifrar un mensaje, le pide a este
// sistema que lo reenvíe. Si no podemos entregarle el contenido original (getMessage),
// el cliente se queda para siempre con "Esperando el mensaje. Esto puede demorar un poco".
// Se guardan en memoria y en la BD para que sobrevivan a reinicios del servidor.
// ============================================
const mensajesEnviados = new Map(); // id del mensaje → proto.IMessage
const MAX_MENSAJES_MEMORIA = 2000;
const DIAS_CONSERVAR_MENSAJES = 14;

// Contador de reintentos fuera del socket, para que no se reinicie en cada reconexión.
const msgRetryCounterCache = (() => {
  const m = new Map();
  return { get: (k) => m.get(k), set: (k, v) => { m.set(k, v); }, del: (k) => { m.delete(k); }, flushAll: () => m.clear() };
})();

export async function guardarMensajeEnviado(enviado) {
  const id = enviado?.key?.id;
  const contenido = enviado?.message;
  if (!id || !contenido) return;
  mensajesEnviados.set(id, contenido);
  if (mensajesEnviados.size > MAX_MENSAJES_MEMORIA) {
    mensajesEnviados.delete(mensajesEnviados.keys().next().value);
  }
  try {
    await db.execute(
      'INSERT INTO whatsapp_mensajes (id, jid, contenido) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [id, enviado.key.remoteJid || null, JSON.stringify(contenido, BufferJSON.replacer)]
    );
  } catch (e) {
    logger.error('Error guardando mensaje WA enviado:', e.message);
  }
}

export async function obtenerMensajeEnviado(key) {
  const id = key?.id;
  if (!id) return undefined;
  if (mensajesEnviados.has(id)) return mensajesEnviados.get(id);
  try {
    const rows = await db.query('SELECT contenido FROM whatsapp_mensajes WHERE id = $1', [id]);
    const obj = rows.length ? revive(rows[0].contenido) : null;
    if (obj) return proto.Message.fromObject(obj);
  } catch (e) {
    logger.error('Error leyendo mensaje WA para reintento:', e.message);
  }
  return undefined;
}

async function limpiarMensajesViejos() {
  try {
    const sql = db.isPostgres()
      ? `DELETE FROM whatsapp_mensajes WHERE fecha < NOW() - INTERVAL '${DIAS_CONSERVAR_MENSAJES} days'`
      : `DELETE FROM whatsapp_mensajes WHERE fecha < datetime('now', '-${DIAS_CONSERVAR_MENSAJES} days')`;
    await db.execute(sql);
  } catch (e) {
    logger.error('Error limpiando mensajes WA viejos:', e.message);
  }
}

// Envía un texto y guarda el mensaje para poder atender reintentos de descifrado.
async function enviarTexto(phone, texto) {
  const enviado = await sock.sendMessage(toJid(phone), { text: texto });
  await guardarMensajeEnviado(enviado);
  return enviado;
}

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

  // Las escrituras se encadenan para que nunca se pisen ni lleguen en desorden:
  // si las claves de cifrado guardadas quedan atrasadas, los clientes reciben
  // "Esperando el mensaje" en vez del texto.
  let saveTimer = null;
  let cadenaGuardado = Promise.resolve();
  let activo = true; // false cuando otra instancia tomó la sesión: ya no se debe guardar nada
  const guardar = () => {
    if (!activo) return cadenaGuardado;
    cadenaGuardado = cadenaGuardado
      .then(() => persistSession({ creds, keys }))
      .catch((e) => logger.error('Error guardando sesión WA:', e.message));
    return cadenaGuardado;
  };
  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; guardar(); }, 1000);
  };
  // Guarda ya lo que esté pendiente (antes de reconectar o de apagar el servidor)
  const flush = async () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await guardar();
  };
  // Descarta lo pendiente sin guardarlo (las claves de esta instancia quedaron atrasadas)
  const desactivar = () => {
    activo = false;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  };

  const saveCreds = () => guardar();

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
    saveCreds,
    flush,
    desactivar
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
  // Cerrar la conexión anterior y guardar sus claves ANTES de abrir otra.
  // Antes solo se "abandonaba": quedaban dos conexiones vivas con la misma cuenta,
  // cada una con sus claves en memoria, y al guardarse se pisaban entre sí.
  const anterior = socketActual;
  socketActual = null;
  sock = null; // el evento close del socket anterior se ignorará
  if (anterior) { try { anterior.end(undefined); } catch (e) { /* ya estaba cerrado */ } }
  await flushAuthPendiente();

  status = 'conectando';
  connectStartedAt = Date.now();
  currentQR = null;
  currentQRDataURL = null;

  const { state, saveCreds, flush, desactivar } = await useNeonAuthState();
  flushAuthPendiente = flush;
  desactivarAuthActual = desactivar;

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
    connectTimeoutMs: 60000,
    // Permite reenviar un mensaje cuando el teléfono del cliente no pudo descifrarlo
    getMessage: obtenerMensajeEnviado,
    msgRetryCounterCache
  });
  sock = thisSocket;
  socketActual = thisSocket;

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

      // Otra instancia del servidor abrió la misma sesión (p. ej. el servidor nuevo durante
      // un despliegue en Render). Reconectar aquí provocaría un bucle en el que ambos se
      // expulsan mutuamente y corrompen las claves: se cede la sesión a la otra instancia.
      if (code === DisconnectReason.connectionReplaced) {
        logger.warn('WhatsApp abierto desde otra instancia del servidor; esta deja de reconectar.');
        desactivarAuthActual(); // sus claves quedaron atrasadas: no sobrescribir las de la otra
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

// Al apagar el servidor (Render envía SIGTERM en cada despliegue o al dormir la instancia):
// guardar las claves pendientes y cerrar la conexión sin cerrar la sesión de WhatsApp.
async function apagarWhatsApp() {
  try { await flushAuthPendiente(); } catch (e) {}
  const s = socketActual;
  socketActual = null;
  sock = null;
  if (s) { try { s.end(undefined); } catch (e) {} }
}

let apagadoRegistrado = false;
function registrarApagado() {
  if (apagadoRegistrado) return;
  apagadoRegistrado = true;
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.once(senal, async () => {
      logger.info(`${senal} recibido: guardando sesión de WhatsApp antes de salir.`);
      const limite = setTimeout(() => process.exit(0), 5000); // no colgar el apagado
      await apagarWhatsApp();
      clearTimeout(limite);
      process.exit(0);
    });
  }
}

// Espera antes de conectar al arrancar: durante un despliegue el servidor anterior sigue
// vivo unos segundos; así alcanza a guardar sus claves antes de que este las cargue.
const ESPERA_INICIO_MS = parseInt(process.env.WA_ESPERA_INICIO_MS || '15000', 10);

export function initWhatsApp() {
  startWatchdog();
  startReporteSemanalScheduler();
  registrarApagado();
  limpiarMensajesViejos();
  (async () => {
    try {
      const stored = await hasStoredSession();
      if (!stored) {
        status = 'desconectado';
        logger.info('Sin sesión de WhatsApp guardada. A la espera de conexión manual.');
        return;
      }
      await sleep(ESPERA_INICIO_MS);
      if (socketActual) return; // ya se conectó manualmente mientras esperaba
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
    socketActual = null;
    desactivarAuthActual(); // la sesión se borra: no volver a guardarla
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
      await enviarTexto(item.telefono, item.mensaje);
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


// ============================================
// RESUMEN SEMANAL DE COBRANZA (automatizado)
// ============================================
const REPORTE_SEMANAL_DEFECTO = {
  telefono: '584247805402',
  dia: 1,            // 1 = Lunes (0=Dom ... 6=Sáb)
  hora: '08:00'
};

function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - 4 * 60 * 60 * 1000); // Venezuela (UTC-4)
}

function getSemanaAnterior() {
  const local = localDateTime();
  const day = local.getUTCDay(); // 0=Dom
  const daysSinceMonday = (day + 6) % 7; // Lunes=0 ... Domingo=6
  const inicio = new Date(local.getTime() - (daysSinceMonday + 7) * 86400000);
  const fin = new Date(inicio.getTime() + 6 * 86400000);
  return { inicio: inicio.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

async function getConfig(clave) {
  try {
    const rows = await db.query('SELECT valor FROM configuracion WHERE clave = $1', [clave]);
    return rows.length ? rows[0].valor : null;
  } catch (e) {
    logger.error('Error leyendo configuración:', e.message);
    return null;
  }
}

async function setConfig(clave, valor) {
  await db.execute(
    `INSERT INTO configuracion (clave, valor) VALUES ($1, $2)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    [clave, String(valor ?? '')]
  );
}

async function getReporteSemanalConfig() {
  const telefono = (await getConfig('reporte_semanal_telefono')) || REPORTE_SEMANAL_DEFECTO.telefono;
  const activado = (await getConfig('reporte_semanal_activado')) !== '0';
  const dia = parseInt((await getConfig('reporte_semanal_dia')) || String(REPORTE_SEMANAL_DEFECTO.dia), 10);
  const hora = (await getConfig('reporte_semanal_hora')) || REPORTE_SEMANAL_DEFECTO.hora;
  const ultimoEnvio = await getConfig('reporte_semanal_ultimo_envio');
  return { telefono, activado, dia, hora, ultimoEnvio };
}

async function getPagosSemana(inicio, fin) {
  const dateCol = db.dateExpr('a.fecha');
  const rows = await db.query(`
    SELECT c.nombre, SUM(a.monto_total_cop) as total_pagado, COUNT(*) as num_abonos
    FROM abonos_credito a JOIN clientes c ON a.cliente_id = c.id
    WHERE ${dateCol} >= $1 AND ${dateCol} <= $2 AND a.monto_total_cop > 0
    GROUP BY c.id, c.nombre
    ORDER BY total_pagado DESC
  `, [inicio, fin]);
  return rows.map(r => ({
    nombre: r.nombre,
    total_pagado: parseFloat(r.total_pagado || 0),
    num_abonos: parseInt(r.num_abonos || 0, 10)
  }));
}

function buildReporteSemanal(pagos, inicio, fin) {
  const total = pagos.reduce((s, p) => s + p.total_pagado, 0);
  const totalAbonos = pagos.reduce((s, p) => s + p.num_abonos, 0);
  const lineas = pagos.map((p) =>
    `• ${p.nombre} — $${fmtPesos(p.total_pagado)} COP${p.num_abonos > 1 ? ` (${p.num_abonos} abonos)` : ''}`
  ).join('\n');
  return `📊 *Resumen semanal de cobranza*\n📅 ${inicio} → ${fin}\n\n` +
    (pagos.length ? `Clientes que abonaron:\n${lineas}\n\n` : `No hubo abonos esta semana.\n\n`) +
    `💰 *Total cobrado: $${fmtPesos(total)} COP* (${totalAbonos} abonos)`;
}

async function buildReporteSemanalEstado() {
  const cfg = await getReporteSemanalConfig();
  const { inicio, fin } = getSemanaAnterior();
  const pagos = await getPagosSemana(inicio, fin);
  const totalCobrado = pagos.reduce((s, p) => s + p.total_pagado, 0);
  return {
    activado: cfg.activado,
    telefono: cfg.telefono,
    dia: cfg.dia,
    hora: cfg.hora,
    ultimoEnvio: cfg.ultimoEnvio,
    preview: { inicio, fin, total: pagos.length, totalCobrado, pagos }
  };
}

async function enviarReporteSemanal() {
  const cfg = await getReporteSemanalConfig();
  const phone = normalizePhone(cfg.telefono);
  if (!phone) throw new Error('No hay número de WhatsApp configurado.');
  if (status !== 'conectado' || !sock) throw new Error('WhatsApp no está conectado.');

  const { inicio, fin } = getSemanaAnterior();
  const pagos = await getPagosSemana(inicio, fin);
  const mensaje = buildReporteSemanal(pagos, inicio, fin);
  await enviarTexto(phone, mensaje);
  await logEnvio(phone, mensaje, 'enviado');
  await setConfig('reporte_semanal_ultimo_envio', localDateTime().toISOString().slice(0, 10));
  return { inicio, fin, total: pagos.length, mensaje };
}

let reporteSemanalTimer = null;
export function startReporteSemanalScheduler() {
  if (reporteSemanalTimer) return;
  reporteSemanalTimer = setInterval(checkYEnviarReporteSemanal, 15 * 60 * 1000);
  setTimeout(checkYEnviarReporteSemanal, 90 * 1000); // primer chequeo tras arrancar
}

async function checkYEnviarReporteSemanal() {
  try {
    const cfg = await getReporteSemanalConfig();
    if (!cfg.activado) return;
    const local = localDateTime();
    if (local.getUTCDay() !== cfg.dia) return;
    const [h, m] = String(cfg.hora || '08:00').split(':').map(Number);
    if (local.getUTCHours() < h || (local.getUTCHours() === h && local.getUTCMinutes() < m)) return;
    const hoy = local.toISOString().slice(0, 10);
    if (cfg.ultimoEnvio === hoy) return; // ya se envió hoy

    await enviarReporteSemanal();
    logger.info('📊 Reporte semanal de cobranza enviado automáticamente.');
  } catch (e) {
    logger.error('Error en el reporte semanal:', e.message);
  }
}

export async function reporteSemanalEstado(req, res) {
  try { res.json(await buildReporteSemanalEstado()); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

export async function reporteSemanalGuardarConfig(req, res) {
  try {
    const { telefono, activado } = req.body || {};
    if (telefono !== undefined) await setConfig('reporte_semanal_telefono', telefono);
    if (activado !== undefined) await setConfig('reporte_semanal_activado', activado ? '1' : '0');
    res.json(await buildReporteSemanalEstado());
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function reporteSemanalEnviarAhora(req, res) {
  try {
    const resultado = await enviarReporteSemanal();
    res.json({ ok: true, ...resultado });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}





// ============================================
// AVISO DE INICIO DE TURNO
// Cada vez que se abre caja se avisa por WhatsApp a los números configurados
// (el dueño y uno o más números adicionales). No cuenta para el límite diario
// de recordatorios.
// ============================================
const MAX_TELEFONOS_AVISO = 5;

async function getAvisoTurnoConfig() {
  const raw = await getConfig('aviso_turno_telefonos');
  // Por defecto, el mismo número que recibe el resumen semanal (el del dueño)
  const telefonos = raw === null
    ? [(await getConfig('reporte_semanal_telefono')) || REPORTE_SEMANAL_DEFECTO.telefono]
    : raw.split(',').map(s => s.trim()).filter(Boolean);
  const activado = (await getConfig('aviso_turno_activado')) !== '0';
  return { telefonos, activado };
}

function buildMensajeInicioTurno(sesion) {
  const ahora = localDateTime(); // hora de Venezuela
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const fecha = `${dias[ahora.getUTCDay()]} ${String(ahora.getUTCDate()).padStart(2, '0')}/${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;
  const hora = `${String(ahora.getUTCHours()).padStart(2, '0')}:${String(ahora.getUTCMinutes()).padStart(2, '0')}`;
  return `🟢 *Turno iniciado* — Fit 360

• Turno: ${sesion.turno || '—'}
• Cajero: ${sesion.nombre_cajero || 'Cajero'}
• Hora: ${hora} (${fecha})
• Fondo: $${fmtPesos(sesion.fondo_inicial_cop)} COP + $${fmtMoneda(sesion.fondo_inicial_usd)} USD`;
}

/**
 * Avisa del inicio de un turno. No bloquea la apertura de caja: corre en segundo plano.
 * Si WhatsApp todavía se está conectando (p. ej. el servidor acaba de despertar),
 * espera hasta 3 minutos antes de darlo por fallido.
 */
export function notificarInicioTurno(sesion) {
  (async () => {
    const cfg = await getAvisoTurnoConfig();
    if (!cfg.activado) return;
    const telefonos = [...new Set(cfg.telefonos.map(normalizePhone).filter(Boolean))];
    if (telefonos.length === 0) return;
    if (!(await hasStoredSession())) {
      logger.warn('Aviso de inicio de turno no enviado: WhatsApp no está vinculado.');
      return;
    }
    const mensaje = buildMensajeInicioTurno(sesion);
    for (let i = 0; i < 18 && (status !== 'conectado' || !sock); i++) await sleep(10000);
    if (status !== 'conectado' || !sock) {
      logger.warn('Aviso de inicio de turno no enviado: WhatsApp no se conectó a tiempo.');
      for (const t of telefonos) await logEnvio(t, mensaje, 'aviso_fallido');
      return;
    }
    for (const t of telefonos) {
      try {
        await enviarTexto(t, mensaje);
        await logEnvio(t, mensaje, 'aviso_turno');
      } catch (e) {
        logger.error('Error enviando aviso de turno a ' + t + ':', e.message);
        await logEnvio(t, mensaje, 'aviso_fallido');
      }
    }
  })().catch((e) => logger.error('Error en aviso de inicio de turno:', e.message));
}

export async function avisoTurnoEstado(req, res) {
  try { res.json(await getAvisoTurnoConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

export async function avisoTurnoGuardarConfig(req, res) {
  try {
    const { telefonos, activado } = req.body || {};
    if (telefonos !== undefined) {
      if (!Array.isArray(telefonos)) return res.status(400).json({ error: 'telefonos debe ser una lista.' });
      const limpios = telefonos.map(t => String(t || '').trim()).filter(Boolean);
      if (limpios.length > MAX_TELEFONOS_AVISO) return res.status(400).json({ error: `Máximo ${MAX_TELEFONOS_AVISO} números.` });
      const normalizados = [];
      for (const t of limpios) {
        const n = normalizePhone(t);
        if (!n) return res.status(400).json({ error: `Número inválido: ${t}. Usa el formato 584141234567.` });
        normalizados.push(n);
      }
      await setConfig('aviso_turno_telefonos', [...new Set(normalizados)].join(','));
    }
    if (activado !== undefined) await setConfig('aviso_turno_activado', activado ? '1' : '0');
    res.json(await getAvisoTurnoConfig());
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// Envía un aviso de prueba a los números configurados
export async function avisoTurnoProbar(req, res) {
  try {
    if (status !== 'conectado' || !sock) return res.status(400).json({ error: 'WhatsApp no está conectado.' });
    const cfg = await getAvisoTurnoConfig();
    const telefonos = [...new Set(cfg.telefonos.map(normalizePhone).filter(Boolean))];
    if (telefonos.length === 0) return res.status(400).json({ error: 'No hay números configurados.' });
    const mensaje = '🧪 *Prueba* — Así te llegará el aviso cada vez que se inicie un turno:\n\n' +
      buildMensajeInicioTurno({ turno: 'Mañana', nombre_cajero: 'Ejemplo', fondo_inicial_cop: 50000, fondo_inicial_usd: 10 });
    const resultados = [];
    for (const t of telefonos) {
      try { await enviarTexto(t, mensaje); resultados.push({ telefono: t, ok: true }); }
      catch (e) { resultados.push({ telefono: t, ok: false, error: e.message }); }
    }
    res.json({ ok: resultados.every(r => r.ok), resultados });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
