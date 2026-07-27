import sqlite3 from 'sqlite3';
import pg from 'pg';
import path from 'path';
const { Pool } = pg;

const sqliteDb = new sqlite3.Database(path.resolve('backup_barrafit_360.sqlite'), sqlite3.OPEN_READONLY);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const tables = [
  'usuarios', 'insumos', 'mermas', 'productos', 'clientes', 
  'ventas', 'detalle_ventas', 'detalle_ventas_extras', 
  'pagos_ventas', 'abonos_credito', 'pagos_abonos', 
  'sesiones_caja', 'gastos', 'tesoreria_cuentas', 'tesoreria_movimientos'
];

async function run() {
  const client = await pool.connect();
  
  for (const table of tables.slice().reverse()) {
    try {
      await client.query(`DELETE FROM ${table} CASCADE`);
    } catch (e) {
      console.log(`Error cleaning table ${table}:`, e.message);
    }
  }

  for (const table of tables) {
    console.log(`Migrating ${table}...`);
    let rows;
    try {
      rows = await new Promise((res, rej) => {
        sqliteDb.all(`SELECT * FROM ${table}`, [], (err, rows) => {
          if (err) rej(err); else res(rows);
        });
      });
    } catch(e) {
      console.log(`Skipping ${table}, doesn't exist in sqlite or error:`, e.message);
      continue;
    }

    if (rows.length === 0) continue;

    for (const row of rows) {
      const columns = Object.keys(row);
      const values = Object.values(row);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      
      const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
      
      try {
        await client.query(query, values);
      } catch (e) {
        console.error(`Error en ${table}:`, e.message);
      }
    }

    try {
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1)) FROM ${table}`);
    } catch(e) {}
  }

  console.log("✅ Migration complete!");
  client.release();
  process.exit(0);
}

run();
