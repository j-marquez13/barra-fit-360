import * as db from './db.js';
import { processSale } from './controllers/salesController.js';

async function runTest() {
  console.log("=== INICIANDO PRUEBA LÓGICA DE FLUJOS ===");

  try {
    // 1. Limpiar BD
    await db.execute('DELETE FROM detalle_ventas_extras');
    await db.execute('DELETE FROM detalle_ventas');
    await db.execute('DELETE FROM ventas');
    await db.execute('DELETE FROM recetas_base_insumos');
    await db.execute('DELETE FROM recetas_base');
    await db.execute('DELETE FROM recetas');
    await db.execute('DELETE FROM productos');
    await db.execute('DELETE FROM insumos');

    // 2. Crear Insumos
    // Comunes
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (1, 'Vaso', 'und', 100, 1, 1, false)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (2, 'Pitillo', 'und', 100, 1, 1, false)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (3, 'Leche', 'ml', 10000, 200, 200, false)");
    // Frutas para Recetas Base
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (4, 'Fresa', 'porción', 100, 1, 1, true)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (5, 'Mango', 'porción', 100, 1, 1, true)");
    // Frutas para Manual
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (6, 'Piña', 'porción', 100, 1, 1, true)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (7, 'Papaya', 'porción', 100, 1, 1, true)");

    // 3. Crear Recetas Base
    await db.execute("INSERT INTO recetas_base (id, nombre, costo_total) VALUES (1, 'Receta Fresa', 400)");
    await db.execute("INSERT INTO recetas_base_insumos (receta_base_id, insumo_id, cantidad) VALUES (1, 1, 1), (1, 2, 1), (1, 3, 200), (1, 4, 1)");

    await db.execute("INSERT INTO recetas_base (id, nombre, costo_total) VALUES (2, 'Receta Mango', 600)");
    await db.execute("INSERT INTO recetas_base_insumos (receta_base_id, insumo_id, cantidad) VALUES (2, 1, 1), (2, 2, 1), (2, 3, 200), (2, 5, 1)");

    // 4. Crear Productos
    // Batido Normal
    await db.execute("INSERT INTO productos (id, nombre, precio_venta, costo_produccion, es_batido, es_combinado) VALUES (1, 'Batido Normal', 5000, 200, true, false)");
    
    // Batido Combinado Manual (y asignarle receta principal para vaso/pitillo)
    await db.execute("INSERT INTO productos (id, nombre, precio_venta, costo_produccion, es_batido, es_combinado) VALUES (2, 'Batido Combinado', 6000, 700, true, true)");
    await db.execute("INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES (2, 1, 1), (2, 2, 1), (2, 3, 200)"); // Receta principal del batido 2

    // ==========================================
    // PRUEBA 1: FLUJO 1 (BATIDO NORMAL)
    // ==========================================
    console.log("\n--- EJECUTANDO FLUJO 1: BATIDO NORMAL (Fresa + Mango) ---");
    const costoFrontend = 400 + 600; // Suma dinámica del frontend
    const reqVenta1 = {
      body: {
        items: [{ producto_id: 1, cantidad: 1, costo_produccion_calculado: costoFrontend, receta_base_ids: [1, 2] }],
        pagos: [{ metodo_pago: 'Efectivo', moneda: 'COP', monto_original: 5000, referencia: null }],
        tasas: { USD: 4000, VES: 100 },
        notas: 'Test Flujo 1'
      }
    };

    let ventaId1 = null;
    const resVenta1 = {
      status: (code) => { return resVenta1; },
      json: (data) => { ventaId1 = data.venta_id; }
    };

    await processSale(reqVenta1, resVenta1);
    const detalle1 = await db.query("SELECT costo_unitario FROM detalle_ventas WHERE venta_id = $1", [ventaId1]);
    console.log(`Costo guardado en Finanzas Flujo 1: $${detalle1[0].costo_unitario} (Debe ser $1000)`);
    
    console.log("Stock Post-Flujo 1 (Vasos/Pitillos/Leche bajan 1 vez, Fresa/Mango bajan 1):");
    const stock1 = await db.query("SELECT nombre, stock_actual FROM insumos WHERE id <= 5 ORDER BY id");
    console.table(stock1);

    // ==========================================
    // PRUEBA 2: FLUJO 2 (BATIDO COMBINADO MANUAL)
    // ==========================================
    console.log("\n--- EJECUTANDO FLUJO 2: BATIDO COMBINADO (Piña + Papaya Manual) ---");
    const reqVenta2 = {
      body: {
        items: [{ producto_id: 2, cantidad: 1, costo_produccion_calculado: 700, insumos_manuales: [{insumo_id: 6, cantidad: 1}, {insumo_id: 7, cantidad: 1}] }],
        pagos: [{ metodo_pago: 'Efectivo', moneda: 'COP', monto_original: 6000, referencia: null }],
        tasas: { USD: 4000, VES: 100 },
        notas: 'Test Flujo 2'
      }
    };

    let ventaId2 = null;
    const resVenta2 = {
      status: (code) => { return resVenta2; },
      json: (data) => { ventaId2 = data.venta_id; }
    };

    await processSale(reqVenta2, resVenta2);
    const detalle2 = await db.query("SELECT costo_unitario FROM detalle_ventas WHERE venta_id = $1", [ventaId2]);
    console.log(`Costo guardado en Finanzas Flujo 2: $${detalle2[0].costo_unitario} (Debe ser $700)`);
    
    console.log("Stock Post-Flujo 2 (Vasos/Pitillos bajan de nuevo, Piña/Papaya bajan):");
    const stock2 = await db.query("SELECT nombre, stock_actual FROM insumos WHERE id IN (1,2,3,6,7) ORDER BY id");
    console.table(stock2);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    db.close();
  }
}

runTest();
