import * as db from './db.js';

async function testBool() {
  try {
    const trueVal = true;
    const falseVal = false;
    
    console.log('Testing create product with trueVal');
    const r1 = await db.execute('INSERT INTO productos (nombre, costo_produccion, precio_venta, es_batido) VALUES ($1, $2, $3, $4)', ['TestBoolTrue', 0, 0, trueVal]);
    console.log(r1);

    console.log('Testing update product with falseVal');
    const r2 = await db.execute('UPDATE productos SET es_batido = $1 WHERE nombre = $2', [falseVal, 'TestBoolTrue']);
    console.log(r2);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
}

testBool();
