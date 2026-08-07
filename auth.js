import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Autenticación simple por token firmado (HMAC-SHA256).
 * El secreto se persiste en un archivo local para que los tokens
 * sigan siendo válidos si el servidor se reinicia (Fly auto-stop).
 */

function getSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = process.env.AUTH_SECRET_FILE || path.resolve(process.cwd(), '.auth-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret);
  return secret;
}

const SECRET = getSecret();
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 horas

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

function parsePermisos(permisos) {
  if (Array.isArray(permisos)) return permisos;
  try { return JSON.parse(permisos); } catch (e) { return []; }
}

export function requireAuth(req, res, next) {
  const header = req.headers['x-auth-token']
    || (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ''));
  const user = verifyToken(header);
  if (!user) {
    return res.status(401).json({ error: 'No autorizado. Inicia sesión nuevamente.' });
  }
  req.usuario = user;
  next();
}

export function requireAdmin(req, res, next) {
  const user = req.usuario;
  if (!user) return res.status(401).json({ error: 'No autorizado.' });
  const perms = parsePermisos(user.permisos);
  if (user.rol !== 'Administrador' && !perms.includes('all') && !perms.includes('admin')) {
    return res.status(403).json({ error: 'Se requieren permisos de administrador.' });
  }
  next();
}
