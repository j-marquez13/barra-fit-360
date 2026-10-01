import pg from 'pg';
import sqlite3 from 'sqlite3';

/**
 * Restaurador de costo_unitario de insumos.
 *
 * Compara el costo_unitario ACTUAL (en Neon/PostgreSQL) contra el ORIGINAL
 * guardado en backup_barrafit_360.sqlite y, opcionalmente, lo restaura.
 *
 * Uso (desde la carpeta del proyecto, con DATABASE_URL apuntando a Neon):
 *   PowerShell:
 *     $env:DATABASE_URL = "postgres://..."
 *     node restaurar_costos_insumos.js             # 1) Solo LISTAR diferencias (no cambia nada)
 *     node restaurar_costos_insumos.js --restore   # 2) APLICAR los costos originales
 */

const { Pool } = pg;
const BACKUP_FILE = 'backup_barrafit_360.sqlite';
const RESTORE = process.argv.includes('--restore');

function normalizeName(s) {
  return String(s || '').trim().toLowerCase();
}

// Lee los costos originales desde el backup SQLite (id -> costo, y nombre -> costo).
function readBackupCosts() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(BACKUP_FILE, sqlite3.OPEN_READONLY);
    db.all('SELECT id, nombre, costo_unitario FROM insumos', (err, rows) => {
      db.close();
      if (err) return reject(err);
      const byId = {};
      const byName = {};
      for (const r of rows) {
        byId[Number(r.id)] = parseFloat(r.costo_unitario);
        const key = normalizeName(r.nombre);
        if (key) byName[key] = parseFloat(r.costo_unitario);
      }
      resolve({ byId, byName });
    });
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ Falta DATABASE_URL. Ejecuta primero:');
    console.error('   $env:DATABASE_URL = "postgres://USUARIO:PASS@HOST/DB?sslmode=require"');
    console.error('Luego:');
    console.error('   node restaurar_costos_insumos.js             (solo listar)');
    console.error('   node restaurar_costos_insumos.js --restore   (aplicar)');
    process.exit(1);
  }

  const { byId, byName } = await readBackupCosts();
  console.log(`📦 Backup leído: ${Object.keys(byId).length} insumos con costo original.\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT id, nombre, costo_unitario FROM insumos ORDER BY id');
    const diffs = [];
    for (const r of res.rows) {
      const id = Number(r.id);
      const actual = parseFloat(r.costo_unitario) || 0;
      const backup = byId[id] ?? byName[normalizeName(r.nombre)];
      const backupVal = backup != null ? parseFloat(backup) : null;
      const changed = backupVal != null && Math.abs(backupVal - actual) > 0.0001;
      if (changed || backupVal == null) {
        diffs.push({ id, nombre: (r.nombre || '').trim(), actual, backup: backupVal, changed });
      }
    }

    console.log('=== Diferencias / insumos sin respaldo ===');
    console.log('ID\tINSUMO\t\tACTUAL\tORIGINAL(BACKUP)');
    for (const d of diffs) {
      console.log(`${d.id}\t${d.nombre}\t${d.actual}\t${d.changed ? d.backup : '— (sin respaldo)'}`);
    }
    console.log(`\nTotal a revisar: ${diffs.length}`);

    if (RESTORE) {
      await client.query('BEGIN');
      let ok = 0;
      for (const d of diffs) {
        if (d.changed) {
          await client.query(
            'UPDATE insumos SET costo_unitario = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [d.backup, d.id]
          );
          ok++;
        }
      }
      await client.query('COMMIT');
      console.log(`\n✅ Se restauraron ${ok} insumos a su costo original.`);
    } else {
      console.log('\nℹ️  Modo solo-lectura. Para aplicar los cambios: node restaurar_costos_insumos.js --restore');
    }
  } catch (e) {
    if (RESTORE) await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
