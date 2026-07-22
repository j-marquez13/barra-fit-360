import pg from 'pg';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

// ============================================
// Helpers de Zona Horaria (Venezuela UTC-4)
// ============================================
const TZ_OFFSET = -4; // Venezuela (UTC-4)

/**
 * Retorna la fecha/hora actual en zona horaria local (Venezuela) como string ISO.
 * Ej: "2026-07-22T15:30:00.000"
 */
export function localNow() {
  const now = new Date();
  const local = new Date(now.getTime() + TZ_OFFSET * 60 * 60 * 1000);
  return local.toISOString().slice(0, 23); // sin la Z para que no sea UTC
}

/**
 * Retorna solo la fecha actual en zona horaria local (Venezuela).
 * Ej: "2026-07-22"
 */
export function localDate() {
  const now = new Date();
  const local = new Date(now.getTime() + TZ_OFFSET * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * Retorna si estamos usando PostgreSQL o SQLite.
 */
export function isPostgres() {
  return !!(process.env.DATABASE_URL || process.env.PGHOST);
}

/**
 * Para SQLite: ajusta DATE(column) restando 4 horas para compensar que 
 * CURRENT_TIMESTAMP almacena en UTC. En PostgreSQL no hace falta porque
 * SET TIME ZONE ya maneja la conversión.
 * 
 * Uso: dateExpr('v.fecha') → "DATE(v.fecha, '-4 hours')" en SQLite
 *                           → "DATE(v.fecha)" en PostgreSQL
 */
export function dateExpr(column) {
  if (isPostgres()) {
    return `DATE(${column})`;
  }
  return `DATE(${column}, '${TZ_OFFSET} hours')`;
}

/**
 * Para SQLite: genera la expresión de "hace N días" ajustada a zona horaria local.
 * Uso: dateAgo(7) → "DATE('now', '-4 hours', '-7 days')" en SQLite
 *                  → "CURRENT_DATE - INTERVAL '7 days'" en PostgreSQL
 */
export function dateAgo(days) {
  if (isPostgres()) {
    return `CURRENT_DATE - INTERVAL '${days} days'`;
  }
  return `DATE('now', '${TZ_OFFSET} hours', '-${days} days')`;
}

const { Pool } = pg;

// Determinar el motor de base de datos a usar
const usePostgres = process.env.DATABASE_URL || process.env.PGHOST;
let pgPool = null;
let sqliteDb = null;

if (usePostgres) {
  console.log('⚡ Conectando a base de datos PostgreSQL...');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
  });
  
  pgPool.on('connect', (client) => {
    client.query("SET TIME ZONE 'America/Caracas'");
  });
} else {
  const dbFile = process.env.DB_PATH || 'database.sqlite';
  console.log(`💾 Usando base de datos local SQLite (${dbFile})...`);
  const dbPath = path.resolve(dbFile);
  sqliteDb = new sqlite3.Database(dbPath);
}

/**
 * Ejecuta una consulta SQL con parámetros y retorna los resultados.
 * Unifica la API para PostgreSQL y SQLite (retornando arreglos de filas).
 */
export async function query(text, params = []) {
  if (usePostgres) {
    const res = await pgPool.query(text, params);
    return res.rows;
  } else {
    // Adaptar marcadores de parámetros de PostgreSQL ($1, $2...) a SQLite (?, ?...)
    const sqliteText = text.replace(/\$(\d+)/g, '?');
    return new Promise((resolve, reject) => {
      sqliteDb.all(sqliteText, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
}

/**
 * Ejecuta una consulta SQL que modifica datos y retorna información del registro insertado/afectado.
 */
export async function execute(text, params = []) {
  if (usePostgres) {
    const res = await pgPool.query(text, params);
    return res.rows;
  } else {
    const sqliteText = text.replace(/\$(\d+)/g, '?');
    return new Promise((resolve, reject) => {
      sqliteDb.run(sqliteText, params, function (err) {
        if (err) return reject(err);
        // Devolver una estructura que incluya el ID generado (lastID)
        resolve([{ id: this.lastID, changes: this.changes }]);
      });
    });
  }
}

/**
 * Ejecuta un callback dentro de una transacción de base de datos.
 * Maneja automáticamente BEGIN, COMMIT y ROLLBACK.
 */
export async function transaction(callback) {
  if (usePostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      // Crear un wrapper del cliente para usar en la transacción
      const tx = {
        query: (text, params) => client.query(text, params).then(res => res.rows),
        execute: (text, params) => client.query(text, params).then(res => res.rows)
      };
      const result = await callback(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.serialize(async () => {
        try {
          sqliteDb.run('BEGIN TRANSACTION');
          // Wrapper del cliente SQLite para promesas
          const tx = {
            query: (text, params) => {
              const sqliteText = text.replace(/\$(\d+)/g, '?');
              return new Promise((res, rej) => {
                sqliteDb.all(sqliteText, params, (err, rows) => {
                  if (err) return rej(err);
                  res(rows || []);
                });
              });
            },
            execute: (text, params) => {
              const sqliteText = text.replace(/\$(\d+)/g, '?');
              return new Promise((res, rej) => {
                sqliteDb.run(sqliteText, params, function (err) {
                  if (err) return rej(err);
                  res([{ id: this.lastID, changes: this.changes }]);
                });
              });
            }
          };
          const result = await callback(tx);
          sqliteDb.run('COMMIT');
          resolve(result);
        } catch (error) {
          sqliteDb.run('ROLLBACK');
          reject(error);
        }
      });
    });
  }
}

/**
 * Cierra las conexiones activas a la base de datos.
 */
export async function close() {
  if (pgPool) {
    await pgPool.end();
  }
  if (sqliteDb) {
    await new Promise((resolve, reject) => {
      sqliteDb.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
