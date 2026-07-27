const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL + '?sslmode=require' });
async function test() {
  await client.connect();
  await client.query("SET TIME ZONE '-04:00'");
  const res = await client.query("SELECT CURRENT_TIMESTAMP::VARCHAR as with_tz, CURRENT_TIMESTAMP::TIMESTAMP::VARCHAR as tz_removed");
  console.log(res.rows[0]);
  process.exit(0);
}
test();
