const sqlite3 = require('sqlite3');
const { Pool } = require('pg');
const sqlite = new sqlite3.Database('backup_barrafit_360.sqlite');
const pg = new Pool({ connectionString: process.env.DATABASE_URL + '?sslmode=require' });
async function migrate() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS cuentas_bancarias (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE,
      moneda TEXT NOT NULL,
      saldo REAL NOT NULL DEFAULT 0.0
    );
    CREATE TABLE IF NOT EXISTS movimientos_tesoreria (
      id SERIAL PRIMARY KEY,
      cuenta_origen TEXT NOT NULL,
      cuenta_destino TEXT NOT NULL,
      monto_origen REAL NOT NULL,
      monto_destino REAL NOT NULL,
      tasa_cambio REAL NOT NULL DEFAULT 1.0,
      motivo TEXT NOT NULL,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  sqlite.all('SELECT * FROM cuentas_bancarias', async (err, rows) => {
    for (const row of rows || []) {
      await pg.query('INSERT INTO cuentas_bancarias (id, nombre, moneda, saldo) VALUES ($1, $2, $3, $4) ON CONFLICT (nombre) DO NOTHING', [row.id, row.nombre, row.moneda, row.saldo]);
    }
    sqlite.all('SELECT * FROM movimientos_tesoreria', async (err, rows) => {
      for (const row of rows || []) {
        try { await pg.query('INSERT INTO movimientos_tesoreria (id, cuenta_origen, cuenta_destino, monto_origen, monto_destino, tasa_cambio, motivo, fecha) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING', [row.id, row.cuenta_origen, row.cuenta_destino, row.monto_origen, row.monto_destino, row.tasa_cambio, row.motivo, row.fecha]); } catch(e){}
      }
      sqlite.all('SELECT * FROM recetas', async (err, rows) => {
        for (const row of rows || []) {
          try { await pg.query('INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES ($1, $2, $3)', [row.producto_id, row.insumo_id, row.cantidad]); } catch(e){}
        }
        console.log('Migration Complete');
        process.exit(0);
      });
    });
  });
}
migrate();
