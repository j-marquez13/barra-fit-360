Stock fijo:	 4.284.294,50 
Actual:	 1.780.321,45 
Reposicion:	 2.503.973,05 
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Mapa explícito: cada fila del CSV "nombre;stock actual;stock fijo"
// se asocia al id correspondiente en la tabla insumos de Neon.
// stock_actual = "stock actual", stock_fijo = "stock fijo".
// stock en null => no se toca stock_actual; fijo en null => no se toca stock_fijo.
const updates = [
  { csv: 'Aceite de Oliva 500 ML (pote vacio 37,60)', id: 14, stock: 500, fijo: 500 },
  { csv: 'Agua 1 LT con pico (8 unds)', id: 15, stock: 3, fijo: 34 },
  { csv: 'Agua nevada 1,5 lts', id: 16, stock: 3, fijo: 18 },
  { csv: 'Agua nevada 355', id: 17, stock: 34, fijo: 36 },
  { csv: 'Agua nevada 600 (16 unds)', id: 18, stock: 0, fijo: 35 },
  { csv: 'Agua vida 600 ml (20 unds)', id: 19, stock: 1, fijo: 45 },
  { csv: 'Almendras por bolsita', id: 20, stock: 0, fijo: 0 },
  { csv: 'Amino Energy', id: 21, stock: 0, fijo: 5 },
  { csv: 'Aminox 30 Servicios (435 Gramos )', id: 22, stock: 1, fijo: 1 },
  { csv: 'Amper Energizante', id: 23, stock: 2, fijo: 5 },
  { csv: 'APIO', id: 85, stock: null, fijo: 67 },
  { csv: 'Arandanos (20GR)', id: 1, stock: 18, fijo: 30 },
  { csv: 'Azucar gr (envase vacio 107gr)', id: 7, stock: 0, fijo: 1000 },
  { csv: 'Barra proteina chocolate unds', id: 8, stock: 17, fijo: 60 },
  { csv: 'Basic pre-entreno 240 gr', id: 24, stock: 1, fijo: 1 },
  { csv: 'Bolsa grande 10x14', id: 25, stock: 46, fijo: 110 },
  { csv: 'Bolsas pequeñas', id: 26, stock: 48, fijo: 110 },
  { csv: 'C4 en Lata', id: 27, stock: 0, fijo: 5 },
  { csv: 'Cambur (65G)', id: 2, stock: 11, fijo: 60 },
  { csv: 'Canela en polvo frasco 27 gr', id: 9, stock: 0, fijo: 64 },
  { csv: 'CELSIUS', id: 28, stock: 0, fijo: 8 },
  { csv: 'Cerveza Cardenal Ultra en Lata', id: 71, stock: 23, fijo: 24 },
  { csv: 'Cerveza Zulia', id: 72, stock: 20, fijo: 36 },
  { csv: 'Chia', id: 10, stock: 100, fijo: 100 },
  { csv: 'Chispas de chocolate (envase vacio 8,8gr)', id: 29, stock: 21, fijo: 100 },
  { csv: 'Collagen sascha fitness porc 16gr', id: 30, stock: 30.58, fijo: 35 },
  { csv: 'Cucharas', id: 73, stock: 0, fijo: 100 },
  { csv: 'Cucharitas plastico', id: 74, stock: 99, fijo: 20 },
  { csv: 'Cuchillo plastico', id: 75, stock: 14, fijo: 20 },
  { csv: 'curcuma', id: 82, stock: null, fijo: 100 },
  { csv: 'Energizante espartano', id: 31, stock: 0, fijo: 5 },
  { csv: 'Flora fuxion', id: 32, stock: 11, fijo: 11 },
  { csv: 'Fresas (65GR)', id: 3, stock: 34, fijo: 100 },
  { csv: 'Galletas Coockies Cake de Zanahoria', id: 33, stock: 0, fijo: 0 },
  { csv: 'Gatorade de 600 ml (12 unds)', id: 34, stock: 9, fijo: 24 },
  { csv: 'gelatina', id: 87, stock: 0, fijo: 8 },
  { csv: 'Glutamina (300 Gramos)', id: 35, stock: 1, fijo: 1 },
  { csv: 'Granola fit graan 350gr', id: 36, stock: 0, fijo: 350 },
  { csv: 'Huevos und', id: 11, stock: 0, fijo: 30 },
  { csv: 'jengibre (3 gr)', id: 84, stock: null, fijo: 100 },
  { csv: 'Leche Almendra (150ML) 21 unds', id: 38, stock: 0, fijo: 24 },
  { csv: 'Leche Completa (150ML)', id: 39, stock: 117.5, fijo: 50 },
  { csv: 'Leche Deslatozada (150ML)', id: 40, stock: 135, fijo: 50 },
  { csv: 'limon (limon completo)', id: 83, stock: 0, fijo: 50 },
  { csv: 'Mango (65GR)', id: 4, stock: 29, fijo: 30 },
  { csv: 'Mani por bolsita', id: 41, stock: 0, fijo: 0 },
  { csv: 'manzana (65gr)', id: 79, stock: 10, fijo: 15 },
  { csv: 'Miel natural 350 gr', id: 12, stock: 0, fijo: 500 },
  { csv: 'MONSTER', id: 90, stock: 0, fijo: 15 },
  { csv: 'naranja (una por porcion)', id: 88, stock: null, fijo: 25 },
  { csv: 'Nitro Tech vainilla 2 l', id: 42, stock: 1, fijo: 1 },
  { csv: 'Nocartb', id: 43, stock: 21, fijo: 21 },
  { csv: 'Parchita (65GR)', id: 5, stock: 0, fijo: 20 },
  { csv: 'pepino (35 gr)', id: 86, stock: 7, fijo: 60 },
  { csv: 'Pimienta gr (pimentero vacio 80,20gr y frasco 27gr)', id: 13, stock: 39.9, fijo: 64 },
  { csv: 'Piña (65GR)', id: 6, stock: 40, fijo: 20 },
  { csv: 'piña de los jugos (100 gr)', id: 80, stock: 26, fijo: 20 },
  { csv: 'Pistacho por Bolsita', id: 44, stock: 0, fijo: 0 },
  { csv: 'Pitillo', id: 45, stock: 229, fijo: 250 },
  { csv: 'Pre Entreno C4 30 Servicios (285 Gramos)', id: 46, stock: 1, fijo: 1 },
  { csv: 'Pre Entreno C4 50 porc (9GR)', id: 47, stock: 17.4, fijo: 102 },
  { csv: 'Pre Entreno C4 50 Servicios (475 Gramos)', id: 48, stock: 1, fijo: 2 },
  { csv: 'Proteina vainilla (25GR)', id: 50, stock: 58, fijo: 272.4 },
  { csv: 'Rock Star Energyzante', id: 51, stock: 7, fijo: 8 },
  { csv: 'Sal gr', id: 52, stock: 0, fijo: 1000 },
  { csv: 'Semillas de Ajonjoli', id: 53, stock: 100, fijo: 100 },
  { csv: 'Soda Schweppes', id: 55, stock: 0, fijo: 16 },
  { csv: 'Stiker', id: 56, stock: 80, fijo: 1100 },
  { csv: 'Te hatsu 200 ml', id: 60, stock: 3, fijo: 4 },
  { csv: 'Te macornick bolsita', id: 61, stock: 10, fijo: 20 },
  { csv: 'Tenedor plastico', id: 76, stock: 17, fijo: 20 },
  { csv: 'Vainilla blanca (envase vacio 20,6)', id: 62, stock: 150, fijo: 150 },
  { csv: 'Vaso 5 onz', id: 68, stock: 15, fijo: 50 },
  { csv: 'vaso 8onzas', id: 69, stock: 31, fijo: 100 },
  { csv: 'Vasos 9 onz', id: 70, stock: 37, fijo: 50 },
  { csv: 'Yogurt Griego Entero NATURAL 500G (Pote vacio 33)', id: 64, stock: 600, fijo: 1000 },
  { csv: 'Yogurt Ku de Frutas 150gr', id: 65, stock: 0, fijo: 3 },
  { csv: 'Yogurt ku Natural Griego', id: 66, stock: 2, fijo: 3 },
  { csv: 'yolo firme', id: 91, stock: 5, fijo: 6 },
  { csv: 'yolo fit', id: 92, stock: 1, fijo: 3 },
  { csv: 'zanahoria', id: 81, stock: null, fijo: 30 },
];

// Filas del CSV que no tienen un insumo equivalente claro en la BD
const skipped = [
  'Café 200 gr',
  'Harina De Avena',
  'Iso 100 Chocolate 5 Libras (2.3 Kgr)',
  'Mantequilla de mani (25GR)',
  'mora',
  'Vaso 14 onz Tapas',
  'Vaso 5, 7 Y 10 onz TAPA',
  'vaso 8 onzas tapa',
  'Vaso 9 onz TAPA',
  'Vasos 14 onz',
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ok = 0;
    for (const u of updates) {
      await client.query(
        `UPDATE insumos
            SET stock_actual = COALESCE($1, stock_actual),
                stock_fijo = COALESCE($2, stock_fijo),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $3`,
        [u.stock, u.fijo, u.id]
      );
      ok++;
    }
    await client.query('COMMIT');
    console.log(`✅ Actualizados ${ok} insumos (stock_actual y stock_fijo).\n`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error, se revirtió todo:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // Verificación
  const ids = updates.map((u) => u.id);
  const res = await pool.query(
    `SELECT id, nombre, stock_actual, stock_fijo FROM insumos WHERE id = ANY($1::int[]) ORDER BY id`,
    [ids]
  );
  console.log('--- Resultado final (insumos actualizados) ---');
  for (const r of res.rows) {
    console.log(`${r.id}\t${r.nombre}\tstock_actual=${r.stock_actual}\tstock_fijo=${r.stock_fijo}`);
  }

  console.log('\n--- Filas del CSV sin equivalencia clara (NO actualizadas) ---');
  for (const s of skipped) {
    console.log('⚠️ ' + s);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error('ERROR:', e.message);
  await pool.end();
  process.exit(1);
});