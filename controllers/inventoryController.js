import * as db from '../db.js';

/**
 * Controlador de Inventario — Gestión de Insumos, Productos y Mermas
 */

// ============================================
// INSUMOS (Materia Prima)
// ============================================

// GET /api/insumos — Listar todos los insumos
export async function getInsumos(req, res) {
  try {
    const insumos = await db.query(`
      SELECT id, nombre, unidad_medida, stock_actual, stock_minimo, stock_fijo, costo_unitario, es_para_batidos, es_base_liquida, es_sabor_batido, cantidad_sola, cantidad_combinada, updated_at
      FROM insumos
      ORDER BY nombre ASC
    `);
    return res.json(insumos);
  } catch (error) {
    console.error('Error al listar insumos:', error);
    return res.status(500).json({ error: 'Error al consultar inventario.' });
  }
}

// POST /api/insumos — Crear un nuevo insumo
export async function createInsumo(req, res) {
  const { nombre, unidad_medida, stock_actual, stock_minimo, stock_fijo, costo_unitario, es_para_batidos, es_base_liquida, es_sabor_batido, cantidad_sola, cantidad_combinada } = req.body;

  if (!nombre || !unidad_medida) {
    return res.status(400).json({ error: 'El nombre y la unidad de medida son obligatorios.' });
  }

  try {
    const existing = await db.query('SELECT id FROM insumos WHERE nombre = $1', [nombre]);
    if (existing.length > 0) {
      return res.status(409).json({ error: `Ya existe un insumo con el nombre '${nombre}'.` });
    }

    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
    const sql = isPg
      ? 'INSERT INTO insumos (nombre, unidad_medida, stock_actual, stock_minimo, stock_fijo, costo_unitario, es_para_batidos, es_base_liquida, es_sabor_batido, cantidad_sola, cantidad_combinada) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *'
      : 'INSERT INTO insumos (nombre, unidad_medida, stock_actual, stock_minimo, stock_fijo, costo_unitario, es_para_batidos, es_base_liquida, es_sabor_batido, cantidad_sola, cantidad_combinada) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)';

    const result = await db.execute(sql, [
      nombre,
      unidad_medida,
      parseFloat(stock_actual) || 0,
      parseFloat(stock_minimo) || 0,
      parseFloat(stock_fijo) || 0,
      parseFloat(costo_unitario) || 0,
      es_para_batidos ? 1 : 0,
      es_base_liquida ? 1 : 0,
      es_sabor_batido ? 1 : 0,
      parseFloat(cantidad_sola) || 0,
      parseFloat(cantidad_combinada) || 0
    ]);

    let insumo;
    if (isPg) {
      insumo = result[0];
    } else {
      const rows = await db.query('SELECT * FROM insumos WHERE id = $1', [result[0].id]);
      insumo = rows[0];
    }

    return res.status(201).json({ mensaje: 'Insumo creado con éxito.', insumo });
  } catch (error) {
    console.error('Error al crear insumo:', error);
    return res.status(500).json({ error: 'Error interno al registrar el insumo.', detalle: error.message });
  }
}

// PUT /api/insumos/:id — Actualizar un insumo existente
export async function updateInsumo(req, res) {
  const { id } = req.params;
  const { nombre, unidad_medida, stock_actual, stock_minimo, stock_fijo, costo_unitario, es_para_batidos, es_base_liquida, es_sabor_batido, cantidad_sola, cantidad_combinada } = req.body;

  try {
    const existing = await db.query('SELECT id FROM insumos WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Insumo no encontrado.' });
    }

    await db.execute(`
      UPDATE insumos 
      SET nombre = $1, unidad_medida = $2, stock_actual = $3, stock_minimo = $4, stock_fijo = $5, costo_unitario = $6, es_para_batidos = $7, es_base_liquida = $8, es_sabor_batido = $9, cantidad_sola = $10, cantidad_combinada = $11, updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
    `, [
      nombre,
      unidad_medida,
      parseFloat(stock_actual) || 0,
      parseFloat(stock_minimo) || 0,
      parseFloat(stock_fijo) || 0,
      parseFloat(costo_unitario) || 0,
      es_para_batidos ? 1 : 0,
      es_base_liquida ? 1 : 0,
      es_sabor_batido ? 1 : 0,
      parseFloat(cantidad_sola) || 0,
      parseFloat(cantidad_combinada) || 0,
      id
    ]);

    const updated = await db.query('SELECT * FROM insumos WHERE id = $1', [id]);
    return res.json({ mensaje: 'Insumo actualizado.', insumo: updated[0] });
  } catch (error) {
    console.error('Error al actualizar insumo:', error);
    return res.status(500).json({ error: 'Error al actualizar el insumo.', detalle: error.message });
  }
}

// POST /api/insumos/:id/restock — Reabastecer stock de un insumo
export async function restockInsumo(req, res) {
  const { id } = req.params;
  const { cantidad, costo_unitario, metodo_pago, moneda, tasa_cambio } = req.body;

  if (!cantidad || parseFloat(cantidad) <= 0) {
    return res.status(400).json({ error: 'La cantidad a reabastecer debe ser mayor a 0.' });
  }

  try {
    const existing = await db.query('SELECT id, nombre, stock_actual, costo_unitario FROM insumos WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Insumo no encontrado.' });
    }

    const newStock = parseFloat(existing[0].stock_actual) + parseFloat(cantidad);
    const finalCosto = costo_unitario !== undefined ? parseFloat(costo_unitario) : parseFloat(existing[0].costo_unitario);
    
    await db.transaction(async (tx) => {
      // 1. Actualizar Insumo
      await tx.execute(
        'UPDATE insumos SET stock_actual = $1, costo_unitario = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        [newStock, finalCosto, id]
      );
      
      // 2. Registrar Gasto Operativo (Flujo de Caja / Tesorería)
      if (metodo_pago && moneda && tasa_cambio) {
        const tasa = parseFloat(tasa_cambio) || 1;
        let montoCop = parseFloat(cantidad) * finalCosto;
        let montoOriginal = moneda === 'COP' ? montoCop : montoCop / tasa;

        // Buscar sesión de caja activa
        const openSession = await tx.execute("SELECT id FROM sesiones_caja WHERE fecha_cierre IS NULL AND estado = 'Abierta' ORDER BY id DESC LIMIT 1");
        const sesion_caja_id = openSession.length > 0 ? openSession[0].id : null;

        await tx.execute(
          'INSERT INTO gastos (sesion_caja_id, categoria, descripcion, monto, moneda, tasa_cambio, monto_cop, metodo_pago) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [sesion_caja_id, 'REPOSICION', `Reposición de ${cantidad} ${existing[0].nombre}`, montoOriginal, moneda, tasa, montoCop, metodo_pago]
        );
      }
    });

    return res.json({
      mensaje: `Stock de '${existing[0].nombre}' actualizado.`,
      stock_anterior: parseFloat(existing[0].stock_actual),
      cantidad_agregada: parseFloat(cantidad),
      stock_nuevo: newStock
    });
  } catch (error) {
    console.error('Error al reabastecer:', error);
    return res.status(500).json({ error: 'Error al actualizar stock.', detalle: error.message });
  }
}

// ============================================
// MERMAS (Pérdidas de inventario)
// ============================================

// GET /api/mermas — Listar mermas registradas
export async function getMermas(req, res) {
  try {
    const mermas = await db.query(`
      SELECT m.id, m.cantidad, m.motivo, m.fecha, i.nombre as insumo_nombre, i.unidad_medida
      FROM mermas m
      JOIN insumos i ON m.insumo_id = i.id
      ORDER BY m.fecha DESC
      LIMIT 100
    `);
    return res.json(mermas);
  } catch (error) {
    console.error('Error al listar mermas:', error);
    return res.status(500).json({ error: 'Error al consultar mermas.' });
  }
}

// POST /api/mermas — Registrar una merma (descuenta inventario)
export async function createMerma(req, res) {
  const { insumo_id, cantidad, motivo } = req.body;

  if (!insumo_id || !cantidad || !motivo) {
    return res.status(400).json({ error: 'El insumo, la cantidad y el motivo son obligatorios.' });
  }

  const cantidadNum = parseFloat(cantidad);
  if (cantidadNum <= 0) {
    return res.status(400).json({ error: 'La cantidad de merma debe ser mayor a 0.' });
  }

  try {
    const insumo = await db.query('SELECT id, nombre, stock_actual FROM insumos WHERE id = $1', [insumo_id]);
    if (insumo.length === 0) {
      return res.status(404).json({ error: 'Insumo no encontrado.' });
    }

    const stockActual = parseFloat(insumo[0].stock_actual);
    const nuevoStock = Math.max(0, stockActual - cantidadNum);

    // Registrar la merma y actualizar stock en transacción
    await db.transaction(async (tx) => {
      await tx.execute(
        'INSERT INTO mermas (insumo_id, cantidad, motivo) VALUES ($1, $2, $3)',
        [insumo_id, cantidadNum, motivo]
      );
      await tx.execute(
        'UPDATE insumos SET stock_actual = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [nuevoStock, insumo_id]
      );
    });

    return res.status(201).json({
      mensaje: `Merma registrada para '${insumo[0].nombre}'.`,
      stock_anterior: stockActual,
      cantidad_perdida: cantidadNum,
      stock_nuevo: nuevoStock
    });
  } catch (error) {
    console.error('Error al registrar merma:', error);
    return res.status(500).json({ error: 'Error al registrar la pérdida.', detalle: error.message });
  }
}

// ============================================
// VALORIZACIÓN DE INVENTARIO
// ============================================

// GET /api/inventario/valorizacion — Calcula el capital invertido en mercancía
export async function getValorizacionInventario(req, res) {
  try {
    const insumos = await db.query(`SELECT stock_actual, stock_fijo, costo_unitario FROM insumos`);
    
    let actual = 0;
    let reposicion = 0;
    let fijo = 0;
    
    insumos.forEach(ins => {
      const stockActual = parseFloat(ins.stock_actual) || 0;
      const stockFijo = parseFloat(ins.stock_fijo) || 0;
      const costo = parseFloat(ins.costo_unitario) || 0;
      
      // Capital actual invertido en la mercancía que sí tenemos
      if (stockActual > 0) {
        actual += stockActual * costo;
      }
      
      // Costo para reponer lo que falta para llegar al stock fijo
      // Si stockActual > stockFijo, el excedente RESTA del costo de reposición
      const porComprar = stockFijo - stockActual;
      reposicion += porComprar * costo;
      
      // Capital total que debería haber si el inventario estuviera a tope (Stock Fijo)
      if (stockFijo > 0) {
        fijo += stockFijo * costo;
      }
    });
    
    return res.json({
      "Actual": actual,
      "Reposición": reposicion,
      "Stock Fijo": fijo
    });
  } catch (error) {
    console.error('Error al calcular valorización:', error);
    return res.status(500).json({ error: 'Error al calcular la valorización del inventario.' });
  }
}

// GET /api/inventario/orden-compra — Genera la orden de compra automática
export async function getOrdenCompra(req, res) {
  try {
    const insumos = await db.query(`
      SELECT id, nombre, unidad_medida, stock_actual, stock_minimo, stock_fijo, costo_unitario 
      FROM insumos
      ORDER BY nombre ASC
    `);
    
    const itemsComprar = [];
    let totalOrdenCop = 0;
    
    insumos.forEach(ins => {
      const stockActual = parseFloat(ins.stock_actual) || 0;
      const stockFijo = parseFloat(ins.stock_fijo) || 0;
      const costo = parseFloat(ins.costo_unitario) || 0;
      
      const porComprar = stockFijo - stockActual;
      if (porComprar !== 0) {
        const reposicionCop = porComprar * costo;
        totalOrdenCop += reposicionCop;
        itemsComprar.push({
          id: ins.id,
          nombre: ins.nombre,
          unidad_medida: ins.unidad_medida,
          stock_actual: stockActual,
          stock_fijo: stockFijo,
          por_comprar: porComprar,
          costo_unitario: costo,
          reposicion_cop: reposicionCop
        });
      }
    });
    
    return res.json({
      items: itemsComprar,
      total_orden_cop: totalOrdenCop
    });
  } catch (error) {
    console.error('Error al generar orden de compra:', error);
    return res.status(500).json({ error: 'Error al generar la orden de compra.' });
  }
}

// ============================================
// PRODUCTOS (Catálogo)
// ============================================

// GET /api/productos — Listar catálogo de productos activos
export async function getProductos(req, res) {
  try {
    const productos = await db.query(`
      SELECT p.id, p.nombre, p.categoria, p.costo_produccion, p.precio_venta, p.activo, p.es_batido,
        COALESCE(
          (SELECT MIN(FLOOR(i.stock_actual / r.cantidad))
           FROM recetas r
           JOIN insumos i ON r.insumo_id = i.id
           WHERE r.producto_id = p.id), 0
        ) as stock_disponible
      FROM productos p
      WHERE p.activo = 1
      ORDER BY p.categoria ASC, p.nombre ASC
    `);

    // Obtener categorías únicas
    const categorias = [...new Set(productos.map(p => p.categoria))];

    return res.json({ productos, categorias });
  } catch (error) {
    console.error('Error al listar productos:', error);
    return res.status(500).json({ error: 'Error al consultar catálogo.' });
  }
}

// POST /api/productos — Crear un nuevo producto
export async function createProducto(req, res) {
  const { nombre, categoria, costo_produccion, precio_venta, receta, es_batido } = req.body;

  if (!nombre || !precio_venta) {
    return res.status(400).json({ error: 'El nombre y el precio de venta son obligatorios.' });
  }

  try {
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);

    const result = await db.transaction(async (tx) => {
      const insertSql = isPg
        ? 'INSERT INTO productos (nombre, categoria, costo_produccion, precio_venta, es_batido) VALUES ($1, $2, $3, $4, $5) RETURNING id'
        : 'INSERT INTO productos (nombre, categoria, costo_produccion, precio_venta, es_batido) VALUES ($1, $2, $3, $4, $5)';

      const res = await tx.execute(insertSql, [
        nombre,
        categoria || 'General',
        parseFloat(costo_produccion) || 0,
        parseFloat(precio_venta),
        es_batido ? 1 : 0
      ]);
      const prodId = res[0].id;

      // Insertar recetas si se proporcionaron
      if (receta && Array.isArray(receta)) {
        for (const item of receta) {
          await tx.execute(
            'INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES ($1, $2, $3)',
            [prodId, item.insumo_id, parseFloat(item.cantidad)]
          );
        }
      }

      return prodId;
    });

    const producto = await db.query('SELECT * FROM productos WHERE id = $1', [result]);
    return res.status(201).json({ mensaje: 'Producto creado.', producto: producto[0] });
  } catch (error) {
    console.error('Error al crear producto:', error);
    return res.status(500).json({ error: 'Error al crear el producto.', detalle: error.message });
  }
}

// PUT /api/productos/:id — Actualizar un producto
export async function updateProducto(req, res) {
  const { id } = req.params;
  const { nombre, categoria, costo_produccion, precio_venta, activo, receta, es_batido } = req.body;

  try {
    const existing = await db.query('SELECT id FROM productos WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    await db.transaction(async (tx) => {
      await tx.execute(`
        UPDATE productos 
        SET nombre = $1, categoria = $2, costo_produccion = $3, precio_venta = $4, activo = $5, es_batido = $6, updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
      `, [
        nombre,
        categoria || 'General',
        parseFloat(costo_produccion) || 0,
        parseFloat(precio_venta) || 0,
        activo !== undefined ? (activo ? 1 : 0) : 1,
        es_batido ? 1 : 0,
        id
      ]);

      // Si se envía una receta, borrar la anterior y guardar la nueva
      if (receta && Array.isArray(receta)) {
        await tx.execute('DELETE FROM recetas WHERE producto_id = $1', [id]);
        for (const item of receta) {
          await tx.execute(
            'INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES ($1, $2, $3)',
            [id, item.insumo_id, parseFloat(item.cantidad)]
          );
        }
      }
    });

    const updated = await db.query('SELECT * FROM productos WHERE id = $1', [id]);
    return res.json({ mensaje: 'Producto y receta actualizados.', producto: updated[0] });
  } catch (error) {
    console.error('Error al actualizar producto:', error);
    return res.status(500).json({ error: 'Error al actualizar el producto.', detalle: error.message });
  }
}

// GET /api/productos/:id/receta — Obtener receta de un producto
export async function getProductoReceta(req, res) {
  const { id } = req.params;
  try {
    const receta = await db.query(`
      SELECT r.insumo_id, r.cantidad, i.nombre, i.unidad_medida, i.costo_unitario
      FROM recetas r
      JOIN insumos i ON r.insumo_id = i.id
      WHERE r.producto_id = $1
    `, [id]);
    return res.json(receta);
  } catch (error) {
    console.error('Error al obtener receta:', error);
    return res.status(500).json({ error: 'Error al consultar receta.' });
  }
}

export async function deleteProducto(req, res) {
  try {
    const { id } = req.params;
    const result = await db.execute('UPDATE productos SET activo = 0 WHERE id = $1', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    return res.json({ mensaje: 'Producto eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

export async function deleteInsumo(req, res) {
  try {
    const { id } = req.params;
    const result = await db.execute('DELETE FROM insumos WHERE id = $1', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Insumo no encontrado' });
    return res.json({ mensaje: 'Insumo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar insumo:', error);
    return res.status(500).json({ error: 'No se pudo eliminar el insumo. Verifica que no esté en uso.' });
  }
}
