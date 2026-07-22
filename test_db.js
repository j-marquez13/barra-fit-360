import * as db from './db.js';

async function run() {
  try {
    await db.execute("UPDATE productos SET es_batido = 1 WHERE nombre LIKE '%batido%'");
    console.log("Actualizado con éxito");
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
