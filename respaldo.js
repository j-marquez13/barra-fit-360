import zlib from 'zlib';
import * as db from './db.js';
import { isPostgres, localDate } from './db.js';

/**
 * Respaldo de todos los datos del sistema en un archivo JSON comprimido (.json.gz).
 * Lo usan la descarga del administrador (GET /api/backup) y el envío diario por WhatsApp.
 * No incluye datos de acceso: las claves de los usuarios ni la sesión de WhatsApp.
 */
const EXCLUIDAS = new Set(['whatsapp_sessions', 'whatsapp_mensajes']);

export async function generarRespaldo() {
  const tablas = isPostgres()
    ? await db.query("SELECT table_name AS nombre FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")
    : await db.query("SELECT name AS nombre FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");

  const datos = {};
  let filas = 0;
  for (const { nombre } of tablas) {
    if (EXCLUIDAS.has(nombre) || !/^[a-z_][a-z0-9_]*$/i.test(nombre)) continue;
    let rows = await db.query(`SELECT * FROM ${nombre}`);
    if (nombre === 'usuarios') rows = rows.map(({ password_hash, ...u }) => u);
    datos[nombre] = rows;
    filas += rows.length;
  }

  const fecha = localDate();
  const json = JSON.stringify({ sistema: 'Barra Fit 360', generado_en: new Date().toISOString(), fecha_local: fecha, tablas: datos });
  return {
    nombreArchivo: `respaldo_fit360_${fecha}.json.gz`,
    buffer: zlib.gzipSync(json),
    resumen: { tablas: Object.keys(datos).length, filas }
  };
}
