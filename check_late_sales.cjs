const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL + '?sslmode=require' });
async function check() {
  await client.connect();
  await client.query("SET TIME ZONE 'America/Caracas'");
  const res = await client.query("SELECT id, fecha, tipo_transaccion, total FROM ventas WHERE EXTRACT(HOUR FROM fecha) < 6 ORDER BY fecha DESC LIMIT 10");
  console.log('Ventas de madrugada:');
  console.table(res.rows);
  
  const resGastos = await client.query("SELECT id, fecha, descripcion, monto FROM gastos WHERE EXTRACT(HOUR FROM fecha) < 6 ORDER BY fecha DESC LIMIT 10");
  console.log('Gastos de madrugada:');
  console.table(resGastos.rows);
  process.exit(0);
}
check();
