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
  db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'usuarios'", (err, rows) => {
    if (err) {
      console.error(err);
      return;
    }
    
    db.run("BEGIN TRANSACTION");
    
    rows.forEach(row => {
      db.run(`DELETE FROM ${row.name}`, (err) => {
        if (err) console.error(`Error deleting from ${row.name}:`, err);
      });
      db.run(`DELETE FROM sqlite_sequence WHERE name='${row.name}'`, (err) => {
        // Not all tables are in sqlite_sequence, so ignore errors here
      });
    });
    
    db.run("COMMIT", () => {
      console.log('✅ Base de datos vaciada con éxito. Tablas limpiadas:');
      console.log(rows.map(r => r.name).join(', '));
      db.close();
    });
  });
});