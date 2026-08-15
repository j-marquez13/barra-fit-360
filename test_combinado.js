import * as db from './db.js';
import { processSale, anularVenta } from './controllers/salesController.js';

async function runTest() {
  console.log("=== INICIANDO PRUEBA BATIDO COMBINADO ===");

  try {
    await db.execute('DELETE FROM detalle_ventas');
    await db.execute('DELETE FROM ventas');
    await db.execute('DELETE FROM recetas_base_insumos');
    await db.execute('DELETE FROM recetas_base');
    await db.execute('DELETE FROM recetas');
    await db.execute('DELETE FROM mermas');
    await db.execute('DELETE FROM productos');
    await db.execute('DELETE FROM insumos');
    await db.execute('DELETE FROM usuarios');

    // 2. Crear Insumos (Comunes y Sabores)
    // Comunes: Vaso, Pitillo, Leche (es_sabor_batido = false)
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (1, 'Vaso', 'und', 100, 1, 1, false)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (2, 'Pitillo', 'und', 100, 1, 1, false)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (3, 'Leche', 'ml', 10000, 200, 200, false)");
    // Sabores: Fresa, Mango (es_sabor_batido = true)
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (4, 'Fresa', 'porción', 100, 1, 1, true)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, cantidad_sola, cantidad_combinada, es_sabor_batido) VALUES (5, 'Mango', 'porción', 100, 1, 1, true)");

    // 3. Crear Recetas Base
    await db.execute("INSERT INTO recetas_base (id, nombre, costo_total) VALUES (1, 'Receta Fresa', 500)");
    await db.execute("INSERT INTO recetas_base_insumos (receta_base_id, insumo_id, cantidad) VALUES (1, 1, 1), (1, 2, 1), (1, 3, 200), (1, 4, 1)");

    await db.execute("INSERT INTO recetas_base (id, nombre, costo_total) VALUES (2, 'Receta Mango', 500)");
    await db.execute("INSERT INTO recetas_base_insumos (receta_base_id, insumo_id, cantidad) VALUES (2, 1, 1), (2, 2, 1), (2, 3, 200), (2, 5, 1)");

    // 4. Crear Producto Batido
    await db.execute("INSERT INTO productos (id, nombre, precio_venta, costo_produccion, es_batido) VALUES (1, 'Batido', 5000, 500, true)");

    // 5. Simular Venta Combinada (Fresa + Mango)
    const reqVenta = {
      body: {
        items: [
          { producto_id: 1, cantidad: 1, costo_produccion_calculado: 500, receta_base_ids: [1, 2] }
        ],
        pagos: [
          { metodo_pago: 'Efectivo COP', moneda: 'COP', monto_original: 5000, referencia: null }
        ],
        tasas: { USD: 4000, VES: 100 },
        notas: 'Prueba batido combinado'
      }
    };

    let statusCode = 0;
    let respData = null;
    const resVenta = {
      status: (code) => { statusCode = code; return resVenta; },
      json: (data) => { respData = data; }
    };

    console.log("--- Procesando venta combinada...");
    await processSale(reqVenta, resVenta);
    console.log("Status de Venta:", statusCode);
    const ventaId = respData.venta_id;

    // 6. Verificar Stock Post-Venta
    const stockPostVenta = await db.query("SELECT id, nombre, stock_actual FROM insumos ORDER BY id");
    console.log("Stock Post-Venta (Debe ser: Vaso 99, Pitillo 99, Leche 9800, Fresa 99, Mango 99):");
    console.table(stockPostVenta);

    // 7. Simular Anulación
    const reqAnular = {
      params: { id: ventaId },
      body: { admin_password: 'admin' } // Solo para simular, el controller chequea bd
    };

    // Forzar auth en el controller para la prueba (insertar admin)
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('admin', 10);
    await db.execute("INSERT INTO usuarios (id, password_hash, rol) VALUES (999, $1, 'Administrador')", [hash]);

    let anularStatus = 0;
    let anularData = null;
    const resAnular = {
      status: (code) => { anularStatus = code; return resAnular; },
      json: (data) => { anularData = data; }
    };

    console.log("--- Anulando venta...");
    await anularVenta(reqAnular, resAnular);
    console.log("Status Anulación:", anularStatus, anularData);

    // 8. Verificar Stock Post-Anulación
    const stockPostAnulacion = await db.query("SELECT id, nombre, stock_actual FROM insumos ORDER BY id");
    console.log("Stock Post-Anulación (Debe volver a: Vaso 100, Pitillo 100, Leche 10000, Fresa 100, Mango 100):");
    console.table(stockPostAnulacion);

  } catch (error) {
    console.error("Error en prueba:", error);
  } finally {
    db.close();
  }
}

runTest();
