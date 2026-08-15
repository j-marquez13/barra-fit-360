import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Mapeo [id, stock_actual, stock_fijo] basado en los nombres del CSV.
// stock_actual / stock_fijo en "" o "-" se interpretan como 0.
const updates = [
  [1, 18, 30],       // Arandanos (20GR)
  [2, 11, 60],       // Cambur (65G)
  [3, 34, 100],      // Fresas (65GR)
  [4, 29, 30],       // Mango (65GR)
  [5, 0, 20],        // Parchita (65GR)
  [6, 40, 20],       // Piña (65GR)
  [7, 0, 1000],      // Azucar gr (envase vacio 107gr)
  [8, 17, 60],       // Barra proteina chocolate unds
  [9, 0, 64],        // Canela en polvo frasco 27 gr
  [10, 100, 100],    // Chia
  [11, 0, 30],       // Huevos und
  [12, 0, 500],      // Miel natural 350 gr
  [13, 39.9, 64],    // Pimienta gr
  [14, 500, 500],    // Aceite de Oliva 500 ML
  [15, 3, 34],       // Agua 1 LT con pico
  [16, 3, 18],       // Agua nevada 1,5 lts
  [17, 34, 36],      // Agua nevada 355
  [18, 0, 35],       // Agua nevada 600 (16 unds)
  [19, 1, 45],       // Agua vida 600 ml (20 unds)
  [20, 0, 0],        // Almendras por bolsita
  [21, 0, 5],        // Amino Energy
  [22, 1, 1],        // Aminox 30 Servicios
  [23, 2, 5],        // Amper Energizante
  [24, 1, 1],        // Basic pre-entreno 240 gr
  [25, 46, 110],     // Bolsa grande 10x14
  [26, 48, 110],     // Bolsas pequeñas
  [27, 0, 5],        // C4 en Lata
  [28, 0, 8],        // CELSIUS
  [29, 21, 100],     // Chispas de chocolate
  [30, 30.58, 35],   // Collagen sascha fitness
  [31, 0, 5],        // Energizante espartano
  [32, 11, 11],      // Flora fuxion
  [33, 0, 0],        // Galletas Coockies Cake de Zanahoria
  [34, 9, 24],       // Gatorade de 600 ml (12 unds)
  [35, 1, 1],        // Glutamina (300 Gramos)
  [36, 0, 350],      // Granola fit graan 350gr
  [38, 0, 24],       // Leche Almendra (150ML) 21 unds
  [39, 117.5, 50],   // Leche Completa (150ML)
  [40, 135, 50],     // Leche Deslatozada (150ML)
  [41, 0, 0],        // Mani por bolsita
  [42, 1, 1],        // Nitro Tech vainilla 2 l
  [43, 21, 21],      // Nocartb
  [44, 0, 0],        // Pistacho por Bolsita
  [45, 229, 250],    // Pitillo
  [46, 1, 1],        // Pre Entreno C4 30 Servicios
  [47, 17.4, 102],   // Pre Entreno C4 50 porc (9GR)
  [48, 1, 2],        // Pre Entreno C4 50 Servicios (475 Gramos)
  [49, 41, 92],      // Iso 100 Chocolate 5 Libras -> Proteina de chocolate (25GR)
  [50, 58, 272.4],   // Proteina vainilla (25GR)
  [51, 7, 8],        // Rock Star Energyzante
  [52, 0, 1000],     // Sal gr
  [53, 100, 100],    // Semillas de Ajonjoli
  [55, 0, 16],       // Soda Schweppes
  [56, 80, 1100],    // Stiker
  [60, 3, 4],        // Te hatsu 200 ml
  [61, 10, 20],      // Te macornick bolsita
  [62, 150, 150],    // Vainilla blanca
  [63, 70, 200],     // Vasos 14 onz -> "Vasos"
  [64, 600, 1000],   // Yogurt Griego Entero NATURAL 500G
  [65, 0, 3],        // Yogurt Ku de Frutas 150gr
  [66, 2, 3],        // Yogurt ku Natural Griego
  [68, 15, 50],      // Vaso 5 onz
  [69, 31, 100],     // vaso 8onzas
  [70, 37, 50],      // Vasos 9 onz
  [71, 23, 24],      // Cerveza Cardenal Ultra en Lata
  [72, 20, 36],      // Cerveza Zulia
  [73, 0, 100],      // Cucharas
  [74, 99, 20],      // Cucharitas plastico
  [75, 14, 20],      // Cuchillo plastico
  [76, 17, 20],      // Tenedor plastico
  [79, 10, 15],      // manzana (65gr)
  [80, 26, 20],      // piña de los jugos (100 gr) -> piña (jugos)
  [81, 0, 30],       // zanahoria
  [82, 0, 100],      // curcuma
  [83, 0, 50],       // limon (limon completo) -> Limon
  [84, 0, 100],      // jengibre (3 gr)
  [85, 0, 67],       // APIO -> apio
  [86, 7, 60],       // pepino (35 gr)
  [87, 0, 8],        // gelatina
  [88, 0, 25],       // naranja (una por porcion)
  [90, 0, 15],       // MONSTER
  [91, 5, 6],        // yolo firme -> yogurt firme
  [92, 1, 3],        // yolo fit
];

// Filas del CSV sin equivalencia clara en la BD (no se tocan, quedan en 0 tras el reset)
const skipped = [
  'Café 200 gr',
  'Harina De Avena',
  'Mantequilla de mani (25GR)',
  'mora',
  'Vaso 14 onz Tapas',
  'Vaso 5, 7 Y 10 onz TAPA',
  'vaso 8 onzas tapa',
  'Vaso 9 onz TAPA',
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Reiniciar TODAS las cantidades a 0
    await client.query(
      `UPDATE insumos SET stock_actual = 0, stock_fijo = 0, updated_at = CURRENT_TIMESTAMP`
    );

    // 2. Aplicar valores del CSV
    let ok = 0;
    for (const [id, actual, fijo] of updates) {
      const res = await client.query(
        `UPDATE insumos
            SET stock_actual = $1,
                stock_fijo = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $3`,
        [actual, fijo, id]
      );
      if (res.rowCount > 0) ok++;
    }

    await client.query('COMMIT');
    console.log(`✅ Inventario reiniciado. ${ok} insumos actualizados con valores del CSV.\n`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error, se revirtió todo:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // Verificación
  const res = await pool.query(
    `SELECT id, nombre, stock_actual, stock_fijo FROM insumos ORDER BY id`
  );
  console.log('--- Resultado final (todas las cantidades) ---');
  let sumActual = 0;
  let sumFijo = 0;
  for (const r of res.rows) {
    const actual = parseFloat(r.stock_actual) || 0;
    const fijo = parseFloat(r.stock_fijo) || 0;
    sumActual += actual;
    sumFijo += fijo;
    console.log(`${r.id}\t${r.nombre.trim()}\tactual=${r.stock_actual}\tfijo=${r.stock_fijo}`);
  }
  console.log(`\nTOTAL insumos: ${res.rows.length}`);
  console.log(`SUMA stock_actual: ${sumActual}`);
  console.log(`SUMA stock_fijo: ${sumFijo}`);

  console.log('\n--- Filas del CSV sin equivalencia clara (quedan en 0) ---');
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