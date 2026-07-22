const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');

db.serialize(() => {
  const cols = [
    'declarado_efectivo_bs NUMERIC(12, 2) DEFAULT 0.00',
    'declarado_zelle NUMERIC(12, 2) DEFAULT 0.00',
    'declarado_binance NUMERIC(12, 2) DEFAULT 0.00',
    'declarado_efectivo_pesos NUMERIC(12, 2) DEFAULT 0.00',
    'declarado_bancolombia NUMERIC(12, 2) DEFAULT 0.00'
  ];
  cols.forEach(col => {
    db.run(`ALTER TABLE sesiones_caja ADD COLUMN ${col}`, (err) => {
      if (err) console.log(err.message);
      else console.log(`Added ${col}`);
    });
  });
});
db.close();
