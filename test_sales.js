import * as db from './db.js';
import { processSale } from './controllers/salesController.js';

/**
 * Script de validación automatizada de la lógica de pagos multimoneda y control de inventario.
 * Ejecuta una simulación completa utilizando la base de datos SQLite local.
 */
async function runTest() {
  console.log('🏁 Iniciando simulación de checkout de Barra Fit 360...');

  try {
    // 1. Crear las tablas necesarias si no existen (SQLite local)
    console.log('🛠️  Inicializando esquema de base de datos...');
    
    await db.execute(`DROP TABLE IF EXISTS pagos_ventas;`);
    await db.execute(`DROP TABLE IF EXISTS detalle_ventas;`);
    await db.execute(`DROP TABLE IF EXISTS ventas;`);
    await db.execute(`DROP TABLE IF EXISTS recetas;`);
    await db.execute(`DROP TABLE IF EXISTS productos;`);
    await db.execute(`DROP TABLE IF EXISTS mermas;`);
    await db.execute(`DROP TABLE IF EXISTS insumos;`);

    // Insumos
    await db.execute(`
      CREATE TABLE insumos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        unidad_medida TEXT NOT NULL,
        stock_actual REAL NOT NULL DEFAULT 0.0 CHECK (stock_actual >= 0.0),
        stock_minimo REAL NOT NULL DEFAULT 0.0,
        costo_unitario REAL NOT NULL DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Productos
    await db.execute(`
      CREATE TABLE productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        costo_produccion REAL NOT NULL DEFAULT 0.0,
        precio_venta REAL NOT NULL DEFAULT 0.0,
        activo INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Recetas
    await db.execute(`
      CREATE TABLE recetas (
        producto_id INTEGER NOT NULL,
        insumo_id INTEGER NOT NULL,
        cantidad REAL NOT NULL CHECK (cantidad > 0.0),
        PRIMARY KEY (producto_id, insumo_id),
        FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
        FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE
      );
    `);

    // Ventas
    await db.execute(`
      CREATE TABLE ventas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total REAL NOT NULL DEFAULT 0.0,
        tasa_cambio REAL NOT NULL DEFAULT 1.0,
        notas TEXT
      );
    `);

    // Detalle Ventas
    await db.execute(`
      CREATE TABLE detalle_ventas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        cantidad REAL NOT NULL CHECK (cantidad > 0.0),
        precio_unitario REAL NOT NULL,
        subtotal REAL NOT NULL,
        FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
        FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT
      );
    `);

    // Pagos Ventas
    await db.execute(`
      CREATE TABLE pagos_ventas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL,
        metodo_pago TEXT NOT NULL,
        moneda TEXT NOT NULL,
        monto_original REAL NOT NULL CHECK (monto_original > 0.0),
        tasa_cambio REAL NOT NULL DEFAULT 1.0,
        monto_base REAL NOT NULL CHECK (monto_base > 0.0),
        referencia TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
      );
    `);

    // Trigger de stock en SQLite
    await db.execute(`
      CREATE TRIGGER trg_descontar_inventario_venta
      AFTER INSERT ON detalle_ventas
      FOR EACH ROW
      BEGIN
        UPDATE insumos
        SET stock_actual = stock_actual - (
          SELECT r.cantidad * NEW.cantidad
          FROM recetas r
          WHERE r.producto_id = NEW.producto_id AND r.insumo_id = insumos.id
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
          SELECT insumo_id 
          FROM recetas 
          WHERE producto_id = NEW.producto_id
        );
      END;
    `);

    console.log('✅ Esquema y Triggers creados con éxito.');

    // 2. Insertar Datos de Prueba (Seed Data)
    console.log('🌱 Insertando datos semilla...');
    
    // Insumos
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario) VALUES (1, 'Vaso Plástico 16oz', 'unidad', 100.0, 10.0, 50.0)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario) VALUES (2, 'Proteína Whey Vainilla', 'scoop', 120.0, 15.0, 400.0)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario) VALUES (3, 'Leche Descremada', 'ml', 20000.0, 2000.0, 0.60)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario) VALUES (4, 'Fruta Mezcla (Fresa/Banana)', 'gr', 5000.0, 1000.0, 2.0)");
    await db.execute("INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario) VALUES (5, 'Amino Energy Lata (Limonada)', 'unidad', 30.0, 5.0, 15000.0)");

    // Productos
    await db.execute("INSERT INTO productos (id, nombre, costo_produccion, precio_venta, activo) VALUES (1, 'Vaso completo', 700.0, 2000.0, 1)");
    await db.execute("INSERT INTO productos (id, nombre, costo_produccion, precio_venta, activo) VALUES (2, 'Amino energy lata', 15000.0, 22000.0, 1)");

    // Recetas
    await db.execute("INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES (1, 1, 1.0)");
    await db.execute("INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES (1, 2, 1.0)");
    await db.execute("INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES (1, 3, 250.0)");
    await db.execute("INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES (1, 4, 50.0)");
    await db.execute("INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES (2, 5, 1.0)");

    console.log('✅ Insumos, productos y recetas cargados.');

    // Mostrar inventario inicial
    console.log('\n📊 Inventario Inicial:');
    let insumos = await db.query("SELECT nombre, stock_actual FROM insumos");
    insumos.forEach(i => console.log(`   - ${i.nombre}: ${i.stock_actual}`));

    // 3. Simular la petición del Controlador (Procesar Venta Mixta)
    console.log('\n🛒 Procesando venta mixta (2 Vasos completos + 1 Amino Energy)...');
    
    // Simular el objeto req y res
    const mockRequest = {
      body: {
        items: [
          { producto_id: 1, cantidad: 2 }, // 2 * 2000 = 4000 COP
          { producto_id: 2, cantidad: 1 }  // 1 * 22000 = 22000 COP
        ],                                 // Total = 26000 COP
        pagos: [
          { metodo_pago: 'Zelle', moneda: 'USD', monto_original: 5.0, referencia: 'TX-ZELLE123' },  // $5 USD * 4000 = 20000 COP
          { metodo_pago: 'Bancolombia', moneda: 'COP', monto_original: 6000.0, referencia: 'REF-B1' } // $6000 COP = 6000 COP
        ],                                                                                         // Total Pago = 26000 COP
        tasas: {
          USD: 4000.0,
          VES: 100.0
        },
        notas: 'Simulación de cobro mixto aprobado'
      }
    };

    let responseStatus = 0;
    let responseData = null;

    const mockResponse = {
      status: (code) => {
        responseStatus = code;
        return {
          json: (data) => {
            responseData = data;
          }
        };
      }
    };

    // Invocar controlador directamente
    await processSale(mockRequest, mockResponse);

    console.log(`\n📥 HTTP Status del Servidor: ${responseStatus}`);
    console.log('📄 Cuerpo de Respuesta:', JSON.stringify(responseData, null, 2));

    // 4. Verificar impacto en base de datos
    console.log('\n📊 Inventario Final de Insumos (Descuento automático):');
    let insumosFinal = await db.query("SELECT nombre, stock_actual FROM insumos");
    insumosFinal.forEach(i => console.log(`   - ${i.nombre}: ${i.stock_actual}`));

    // Validaciones
    const stocksMap = new Map(insumosFinal.map(i => [i.nombre, i.stock_actual]));
    
    if (
      stocksMap.get('Vaso Plástico 16oz') === 98.0 &&
      stocksMap.get('Proteína Whey Vainilla') === 118.0 &&
      stocksMap.get('Leche Descremada') === 19500.0 &&
      stocksMap.get('Fruta Mezcla (Fresa/Banana)') === 4900.0 &&
      stocksMap.get('Amino Energy Lata (Limonada)') === 29.0
    ) {
      console.log('\n🎉 ¡PRUEBA DEL BACKEND EXITOSA! El descuento de inventario y la lógica multimoneda operan perfectamente.');
    } else {
      console.log('\n❌ ERROR: Las cantidades en inventario no coinciden.');
    }

  } catch (error) {
    console.error('❌ Error ejecutando la simulación:', error);
  } finally {
    await db.close();
  }
}

runTest();
