const sqlite3 = require('sqlite3');
const { Client } = require('pg');
const sqlite = new sqlite3.Database('backup_barrafit_360.sqlite');
const client = new Client({ connectionString: process.env.DATABASE_URL + '?sslmode=require' });
async function migrateGastos() {
  await client.connect();
  sqlite.all("SELECT * FROM gastos WHERE id IN (1, 2, 3, 4)", async (err, rows) => {
    for (const row of rows || []) {
      try {
        await client.query(
          "INSERT INTO gastos (id, categoria, descripcion, monto, moneda, tasa_cambio, monto_cop, metodo_pago, fecha) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [row.id, row.categoria, row.descripcion, row.monto, row.moneda, row.tasa_cambio, row.monto_cop, row.metodo_pago, row.fecha]
        );
        console.log("Migrated gasto ID", row.id);
      } catch(e) {
        console.log("Error inserting gasto ID", row.id, e.message);
      }
    }
    process.exit(0);
  });
}
migrateGastos();
