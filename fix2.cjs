const fs = require('fs');

// 1. Fix schema.sql
let schema = fs.readFileSync('c:/360fi sistema/schema.sql', 'utf8');
schema = schema.replace(/costo_unitario NUMERIC\(12, 2\)/g, 'costo_unitario DOUBLE PRECISION');
schema = schema.replace(/costo_produccion NUMERIC\(12, 2\)/g, 'costo_produccion DOUBLE PRECISION');
schema = schema.replace(/precio_venta NUMERIC\(12, 2\)/g, 'precio_venta DOUBLE PRECISION');
fs.writeFileSync('c:/360fi sistema/schema.sql', schema);

// 2. Fix initDb.js
let initdb = fs.readFileSync('c:/360fi sistema/initDb.js', 'utf8');
const migrationCode = `
  if (isPg) {
    try { await db.execute('ALTER TABLE insumos ALTER COLUMN costo_unitario TYPE DOUBLE PRECISION'); console.log('Migracion: costo_unitario -> DOUBLE PRECISION'); } catch(e) {}
    try { await db.execute('ALTER TABLE productos ALTER COLUMN costo_produccion TYPE DOUBLE PRECISION'); } catch(e) {}
    try { await db.execute('ALTER TABLE productos ALTER COLUMN precio_venta TYPE DOUBLE PRECISION'); } catch(e) {}
  }
  try { await db.execute('ALTER TABLE productos ADD COLUMN es_batido`;
initdb = initdb.replace("try { await db.execute('ALTER TABLE productos ADD COLUMN es_batido", migrationCode);
fs.writeFileSync('c:/360fi sistema/initDb.js', initdb);

console.log('Done DB migrations');
