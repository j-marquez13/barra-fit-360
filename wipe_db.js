import fs from 'fs';
import sqlite3 from 'sqlite3';

// 1. Create a backup just in case
try {
  fs.copyFileSync('database.sqlite', 'database.sqlite.bak');
  console.log('✅ Backup created as database.sqlite.bak');
} catch (e) {
  console.log('Warning: could not create backup.', e);
}

const db = new sqlite3.Database('database.sqlite');

db.serialize(() => {
  db.run("UPDATE insumos SET stock_actual = 0, updated_at = CURRENT_TIMESTAMP", (err) => {
    if (err) {
      console.error("Error reseteando el stock:", err);
    } else {
      console.log('✅ El reseteo del sistema se completó con éxito.');
      console.log('✅ TODO el stock actual ha sido puesto en 0.');
      console.log('✅ Las ventas, productos y recetas se mantuvieron intactos.');
    }
    db.close();
  });
});