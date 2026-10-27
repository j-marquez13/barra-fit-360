import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import * as db from './db.js';

/**
 * Autenticación simple por token firmado (HMAC-SHA256).
 * El secreto se persiste en un archivo local para que los tokens
 * sigan siendo válidos si el servidor se reinicia (Fly auto-stop).
 */

function getSecret() {
  // 1. Prioridad: variable de entorno AUTH_SECRET (Railway, producción)
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;

  // 2. Fallback: archivo local .auth-secret (desarrollo)
  const file = process.env.AUTH_SECRET_FILE || path.resolve(process.cwd(), '.auth-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();

  // 3. Generar nuevo secreto (solo desarrollo; en producción configurar AUTH_SECRET)
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret);
  console.warn('⚠️  Nuevo secreto JWT generado. Configura la variable AUTH_SECRET en producción para evitar que los tokens se invaliden en cada deploy.');
  return secret;
}

const SECRET = getSecret();
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 horas

// Lista negra de tokens revocados: token → fecha de expiración.
// Vive en memoria; se limpia sola al expirar cada token.
const revokedTokens = new Map();

function purgeRevoked() {
  const now = Date.now();
  for (const [token, exp] of revokedTokens) {
    if (exp < now) revokedTokens.delete(token);
  }
}

export function getTokenFromRequest(req) {
  return req.headers['x-auth-token']
    || (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ''))
    || null;
}

export function revokeToken(token) {
  if (!token) return;
  const payload = verifyToken(token);
  revokedTokens.set(token, payload ? payload.exp : Date.now() + TOKEN_TTL);
  purgeRevoked();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(user) {
  const payload = {
    usuario_id: user.id,
    nombre: user.nombre,
    rol: user.rol,
    permisos: user.permisos,
    exp: Date.now() + TOKEN_TTL
  };
  const data = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (revokedTokens.has(token)) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  const a = Buffer.from(expected, 'base64url');
  const b = Buffer.from(sig, 'base64url');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

export function parsePermisos(permisos) {
  if (Array.isArray(permisos)) return permisos;
  try { return JSON.parse(permisos) || []; } catch (e) { return []; }
}

export function esAdmin(user) {
  if (!user) return false;
  const perms = parsePermisos(user.permisos);
  return user.rol === 'Administrador' || perms.includes('all') || perms.includes('admin');
}

/**
 * Verifica el token y recarga rol y permisos desde la base de datos, para que
 * un cambio de permisos (o un usuario eliminado) tenga efecto inmediato y no
 * recién cuando el token expire.
 */
export async function requireAuth(req, res, next) {
  if (req.usuario) return next(); // ya autenticado por el middleware global
  const payload = verifyToken(getTokenFromRequest(req));
  if (!payload) {
    return res.status(401).json({ error: 'No autorizado. Inicia sesión nuevamente.' });
  }
  try {
    const rows = await db.query('SELECT id, nombre, rol, permisos, debe_cambiar_password FROM usuarios WHERE id = $1', [payload.usuario_id]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'No autorizado. Inicia sesión nuevamente.' });
    }
    const u = rows[0];

    // Con contraseña inicial (1234 / admin123) solo se permite cambiarla o cerrar sesión.
    const debeCambiar = [1, true, '1', 't', 'true'].includes(u.debe_cambiar_password);
    const ruta = (req.originalUrl || '').split('?')[0];
    if (debeCambiar && ruta !== '/api/auth/cambiar-password' && ruta !== '/api/auth/logout') {
      return res.status(403).json({ error: 'Debes cambiar tu contraseña antes de continuar.', debe_cambiar_password: true });
    }

    req.usuario = { ...payload, nombre: u.nombre, rol: u.rol, permisos: parsePermisos(u.permisos) };
    next();
  } catch (err) {
    console.error('Error al verificar sesión:', err);
    res.status(500).json({ error: 'Error interno al verificar la sesión.' });
  }
}

export function requireAdmin(req, res, next) {
  const user = req.usuario;
  if (!user) return res.status(401).json({ error: 'No autorizado.' });
  if (!esAdmin(user)) {
    return res.status(403).json({ error: 'Se requieren permisos de administrador.' });
  }
  next();
}

// ============================================
// Contraseña de administrador para autorizar acciones (anular venta, eliminar abono,
// restaurar BD). Con límite de intentos: sin él, cualquier usuario con sesión podría
// probar claves sin fin hasta dar con la del administrador.
// ============================================
const MAX_INTENTOS_ADMIN = 5;
const BLOQUEO_ADMIN_MS = 15 * 60 * 1000;
const intentosAdmin = new Map(); // clave (usuario o IP) → { fallos, bloqueadoHasta }

function claveIntentos(req) {
  if (req.usuario && req.usuario.usuario_id) return `u:${req.usuario.usuario_id}`;
  return `ip:${req.ip || (req.socket && req.socket.remoteAddress) || 'desconocida'}`;
}

/**
 * Verifica que `password` sea la contraseña de algún administrador.
 * Devuelve { ok: true } o { ok: false, status, error } listo para responder.
 */
export async function validarPasswordAdmin(req, password) {
  const clave = claveIntentos(req);
  const ahora = Date.now();
  const estado = intentosAdmin.get(clave) || { fallos: 0, bloqueadoHasta: 0 };

  if (estado.bloqueadoHasta > ahora) {
    const minutos = Math.ceil((estado.bloqueadoHasta - ahora) / 60000);
    return { ok: false, status: 429, error: `Demasiados intentos con la contraseña de administrador. Intenta de nuevo en ${minutos} minuto(s).` };
  }
  if (!password) {
    return { ok: false, status: 400, error: 'Se requiere la contraseña de administrador.' };
  }

  const admins = await db.query("SELECT id, password_hash FROM usuarios WHERE rol = 'Administrador'");
  if (admins.length === 0) {
    return { ok: false, status: 500, error: 'No hay administradores configurados en el sistema.' };
  }
  for (const admin of admins) {
    if (admin.password_hash && await bcrypt.compare(String(password), admin.password_hash)) {
      intentosAdmin.delete(clave);
      return { ok: true };
    }
  }

  estado.fallos += 1;
  if (estado.fallos >= MAX_INTENTOS_ADMIN) {
    estado.fallos = 0;
    estado.bloqueadoHasta = ahora + BLOQUEO_ADMIN_MS;
    console.log(`🔒 Bloqueo de 15 min por intentos fallidos de contraseña de administrador (${clave}).`);
  }
  intentosAdmin.set(clave, estado);
  return { ok: false, status: 401, error: 'Contraseña de administrador incorrecta.' };
}

/**
 * Exige que el usuario tenga al menos uno de los permisos indicados
 * (los administradores siempre pasan). Ej: requirePermiso('inventario')
 */
export function requirePermiso(...permisos) {
  return (req, res, next) => {
    const user = req.usuario;
    if (!user) return res.status(401).json({ error: 'No autorizado.' });
    if (esAdmin(user)) return next();
    const perms = parsePermisos(user.permisos);
    if (permisos.some(p => perms.includes(p))) return next();
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  };
}
