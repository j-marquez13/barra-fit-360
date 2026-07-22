import * as db from './db.js';

async function migrate() {
  try {
    console.log('Adding es_batido column to productos...');
    await db.execute('ALTER TABLE productos ADD COLUMN es_batido BOOLEAN DEFAULT 0');
    console.log('Migration successful.');
  } catch (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('Column already exists, ignoring.');
    } else {
      console.error('Migration failed:', err);
    }
  } finally {
    process.exit(0);
  }
}

migrate();
