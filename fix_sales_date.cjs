const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL + '?sslmode=require' });
async function fix() {
  await client.connect();
  await client.query("SET TIME ZONE 'America/Caracas'");
  
  // Subtract 1 day from the sales that happened between 04:00 and 06:00 today 
  // so they fall on the previous day as the user requested.
  const res = await client.query("UPDATE ventas SET fecha = fecha - interval '1 day' WHERE id IN (168, 169, 170, 171, 172, 173, 174, 175)");
  console.log('Fixed', res.rowCount, 'ventas');
  process.exit(0);
}
fix();
