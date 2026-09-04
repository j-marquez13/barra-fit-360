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
      !!es_para_batidos,
      !!es_base_liquida,
      !!es_sabor_batido,
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
      !!es_para_batidos,
      !!es_base_liquida,
      !!es_sabor_batido,
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

        // Nota: la tesorería (cuentas_bancarias) se descuenta automáticamente
        // mediante el trigger `func_tesoreria_gasto_out` al insertar el gasto.
        // No se debe hacer un UPDATE manual aquí para evitar el doble descuento.
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
      const stockMinimo = parseFloat(ins.stock_minimo) || 0;
      const costo = parseFloat(ins.costo_unitario) || 0;
      
      const porComprar = stockFijo - stockActual;
      const reposicionCop = porComprar * costo;
      totalOrdenCop += reposicionCop;
      itemsComprar.push({
        id: ins.id,
        nombre: ins.nombre,
        unidad_medida: ins.unidad_medida,
        stock_actual: stockActual,
        stock_fijo: stockFijo,
        stock_minimo: stockMinimo,
        por_comprar: porComprar,
        costo_unitario: costo,
        reposicion_cop: reposicionCop
      });
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

// POST /api/inventario/orden-compra/confirmar — Confirma la compra de los items seleccionados
export async function confirmarOrdenCompra(req, res) {
  const { metodo_pago, moneda, tasa_cambio, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La orden no tiene items seleccionados.' });
  }
  if (!metodo_pago) {
    return res.status(400).json({ error: 'Selecciona un método de pago.' });
  }

  try {
    const tasa = parseFloat(tasa_cambio) || 1;
    const monedaPago = moneda || 'COP';
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
    let totalCop = 0;
    const procesados = [];

    await db.transaction(async (tx) => {
      const openSession = await tx.query("SELECT id FROM sesiones_caja WHERE fecha_cierre IS NULL AND estado = 'Abierta' ORDER BY id DESC LIMIT 1");
      const sesion_caja_id = openSession.length > 0 ? openSession[0].id : null;

      // 1. Validar y calcular los items seleccionados (sin escribir aún).
      for (const item of items) {
        const insumoId = item.insumo_id;
        const cantidad = parseFloat(item.cantidad);
        const costo = parseFloat(item.costo_unitario) || 0;

        if (!insumoId || !cantidad || cantidad <= 0) continue;

        const existing = await tx.query('SELECT id, nombre FROM insumos WHERE id = $1', [insumoId]);
        if (existing.length === 0) continue;

        const nombre = existing[0].nombre;
        const montoCop = cantidad * costo;
        totalCop += montoCop;

        procesados.push({ insumo_id: insumoId, nombre, cantidad, costo_unitario: costo, monto_cop: montoCop });
      }

      // 2. Cabecera de la orden de compra (historial).
      // La orden se crea SIN tocar el inventario: el stock se suma al "recibir".
      const ordenSql = isPg
        ? 'INSERT INTO ordenes_compra (metodo_pago, moneda, tasa_cambio, total_cop, sesion_caja_id, afecta_inventario, recibida) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id'
        : 'INSERT INTO ordenes_compra (metodo_pago, moneda, tasa_cambio, total_cop, sesion_caja_id, afecta_inventario, recibida) VALUES ($1, $2, $3, $4, $5, $6, $7)';
      const ordenRes = await tx.execute(ordenSql, [metodo_pago, monedaPago, tasa, totalCop, sesion_caja_id, false, false]);
      const ordenId = ordenRes[0]?.id;

      // 3. Guardar los items de la orden.
      //    AQUÍ NO se registra plata ni stock: ambos se hacen al "recibir" la orden.
      for (const p of procesados) {
        await tx.execute(
          'INSERT INTO ordenes_compra_items (orden_id, insumo_id, cantidad, costo_unitario, monto_cop) VALUES ($1, $2, $3, $4, $5)',
          [ordenId, p.insumo_id, p.cantidad, p.costo_unitario, p.monto_cop]
        );
      }
    });

    return res.json({
      mensaje: 'Orden de compra registrada. La plata se descontará cuando la recibas.',
      total_cop: totalCop,
      items: procesados
    });
  } catch (error) {
    console.error('Error al confirmar orden de compra:', error);
    return res.status(500).json({ error: 'Error al confirmar la orden de compra.', detalle: error.message });
  }
}

// GET /api/inventario/ordenes-compra — Historial de órdenes de compra
export async function listarOrdenesCompra(req, res) {
  try {
    const ordenes = await db.query(`
      SELECT id, fecha, metodo_pago, moneda, tasa_cambio, total_cop, recibida
      FROM ordenes_compra
      ORDER BY id DESC
      LIMIT 100
    `);
    return res.json(ordenes);
  } catch (error) {
    console.error('Error al listar órdenes de compra:', error);
    return res.status(500).json({ error: 'Error al listar las órdenes de compra.' });
  }
}

// GET /api/inventario/ordenes-compra/:id — Detalle de una orden de compra
export async function getOrdenCompraDetalle(req, res) {
  const { id } = req.params;
  try {
    const orden = await db.query('SELECT * FROM ordenes_compra WHERE id = $1', [id]);
    if (orden.length === 0) return res.status(404).json({ error: 'Orden no encontrada.' });
    const items = await db.query(`
      SELECT oci.id AS item_id, oci.insumo_id, oci.cantidad, oci.cantidad_recibida, oci.costo_unitario, oci.monto_cop, i.nombre, i.unidad_medida
      FROM ordenes_compra_items oci
      JOIN insumos i ON oci.insumo_id = i.id
      WHERE oci.orden_id = $1
      ORDER BY oci.id ASC
    `, [id]);
    return res.json({ orden: orden[0], items });
  } catch (error) {
    console.error('Error al obtener detalle de orden:', error);
    return res.status(500).json({ error: 'Error al obtener el detalle de la orden.' });
  }
}

// POST /api/inventario/ordenes-compra/:id/recibir — Registra lo que en verdad llegó
// y suma esas cantidades al inventario.
export async function recibirOrdenCompra(req, res) {
  const { id } = req.params;
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Debes indicar las cantidades recibidas.' });
  }

  try {
    const orden = await db.query('SELECT * FROM ordenes_compra WHERE id = $1', [id]);
    if (orden.length === 0) return res.status(404).json({ error: 'Orden no encontrada.' });

    const o = orden[0];
    const r = o.recibida;
    const yaRecibida = r === true || r === 1 || r === '1' || r === 't' || r === 'true' || r === 'TRUE';
    if (yaRecibida) {
      return res.status(400).json({ error: 'Esta orden ya fue recibida.' });
    }

    const tasa = parseFloat(o.tasa_cambio) || 1;
    const monedaPago = o.moneda || 'COP';
    const metodoPago = o.metodo_pago;

    await db.transaction(async (tx) => {
      const openSession = await tx.query("SELECT id FROM sesiones_caja WHERE fecha_cierre IS NULL AND estado = 'Abierta' ORDER BY id DESC LIMIT 1");
      const sesion_caja_id = openSession.length > 0 ? openSession[0].id : null;
      let totalRecibidoCop = 0;

      for (const it of items) {
        const itemId = it.item_id;
        const cantidadRecibida = parseFloat(it.cantidad_recibida);
        if (!itemId || !cantidadRecibida || cantidadRecibida <= 0) continue;

        const item = await tx.query('SELECT oci.insumo_id, oci.costo_unitario, i.nombre FROM ordenes_compra_items oci JOIN insumos i ON oci.insumo_id = i.id WHERE oci.id = $1 AND oci.orden_id = $2', [itemId, id]);
        if (item.length === 0) continue;

        const insumoId = item[0].insumo_id;
        const costo = parseFloat(item[0].costo_unitario) || 0;
        const nombre = item[0].nombre;
        const montoCop = cantidadRecibida * costo;
        totalRecibidoCop += montoCop;
        const montoOriginal = monedaPago === 'COP' ? montoCop : montoCop / tasa;

        // Sumar lo que en verdad llegó al inventario.
        await tx.execute(
          'UPDATE insumos SET stock_actual = stock_actual + $1, costo_unitario = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [cantidadRecibida, costo, insumoId]
        );

        // Guardar la cantidad recibida en el item de la orden.
        await tx.execute('UPDATE ordenes_compra_items SET cantidad_recibida = $1 WHERE id = $2', [cantidadRecibida, itemId]);

        // Descontar la plata por lo que en verdad llegó.
        await tx.execute(
          'INSERT INTO gastos (sesion_caja_id, orden_compra_id, categoria, descripcion, monto, moneda, tasa_cambio, monto_cop, metodo_pago) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [sesion_caja_id, id, 'REPOSICION', `Reposición de ${cantidadRecibida} ${nombre}`, montoOriginal, monedaPago, tasa, montoCop, metodoPago]
        );
      }

      // Marcar la orden como recibida y actualizar el total real.
      await tx.execute('UPDATE ordenes_compra SET recibida = $1, total_cop = $2 WHERE id = $3', [true, totalRecibidoCop, id]);
    });

    return res.json({ mensaje: 'Recepción guardada. Se sumó lo recibido al inventario y se descontó la plata.' });
  } catch (error) {
    console.error('Error al recibir orden de compra:', error);
    return res.status(500).json({ error: 'Error al recibir la orden de compra.', detalle: error.message });
  }
}

// DELETE /api/inventario/ordenes-compra/:id — Elimina una orden de compra,
// revierte el stock que había sumado al inventario y devuelve la plata (gasto).
export async function borrarOrdenCompra(req, res) {
  const { id } = req.params;
  try {
    const orden = await db.query('SELECT * FROM ordenes_compra WHERE id = $1', [id]);
    if (orden.length === 0) return res.status(404).json({ error: 'Orden no encontrada.' });

    const o = orden[0];
    const afecta = o.afecta_inventario;
    const afectaInventario = afecta === true || afecta === 1 || afecta === '1' || afecta === 't' || afecta === 'true' || afecta === 'TRUE';

    const items = await db.query(
      'SELECT oci.insumo_id, oci.cantidad, oci.cantidad_recibida, oci.monto_cop, i.nombre FROM ordenes_compra_items oci JOIN insumos i ON oci.insumo_id = i.id WHERE oci.orden_id = $1',
      [id]
    );

    // Gastos asociados a esta orden (la plata que salió).
    let gastos = await db.query('SELECT id, metodo_pago, monto FROM gastos WHERE orden_compra_id = $1', [id]);

    // Fallback para órdenes antiguas (creadas antes de existir orden_compra_id):
    // busca los gastos de reposición de la misma sesión y método de pago cuyo
    // monto_cop coincida con el de cada item de la orden.
    if (gastos.length === 0 && o.sesion_caja_id) {
      const candidatos = await db.query(
        "SELECT id, metodo_pago, monto, monto_cop FROM gastos WHERE sesion_caja_id = $1 AND categoria = 'REPOSICION' AND metodo_pago = $2",
        [o.sesion_caja_id, o.metodo_pago]
      );
      const usados = new Set();
      gastos = [];
      for (const it of items) {
        const objetivo = Math.round((parseFloat(it.monto_cop) || 0) * 100) / 100;
        const g = candidatos.find(c => !usados.has(c.id) && (Math.round((parseFloat(c.monto_cop) || 0) * 100) / 100) === objetivo);
        if (g) {
          usados.add(g.id);
          gastos.push(g);
        }
      }
    }

    await db.transaction(async (tx) => {
      // 1. Revertir el stock que se haya sumado (por recepción o por órdenes antiguas).
      for (const it of items) {
        const recibida = it.cantidad_recibida;
        const aRevertir = (recibida !== null && recibida !== undefined && parseFloat(recibida) > 0)
          ? parseFloat(recibida)
          : (afectaInventario ? parseFloat(it.cantidad) : 0);
        if (!aRevertir || aRevertir <= 0) continue;

        const ins = await tx.query('SELECT stock_actual FROM insumos WHERE id = $1', [it.insumo_id]);
        if (ins.length === 0) continue;
        const actual = parseFloat(ins[0].stock_actual) || 0;
        const nuevo = Math.max(0, actual - aRevertir);
        await tx.execute('UPDATE insumos SET stock_actual = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [nuevo, it.insumo_id]);
      }

      // 2. Devolver la plata: restaurar el saldo de tesorería y eliminar el gasto.
      for (const g of gastos) {
        const monto = parseFloat(g.monto) || 0;
        if (g.metodo_pago && monto > 0) {
          await tx.execute('UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE nombre = $2', [monto, g.metodo_pago]);
        }
        await tx.execute('DELETE FROM gastos WHERE id = $1', [g.id]);
      }

      // 3. Eliminar la orden y sus items.
      await tx.execute('DELETE FROM ordenes_compra_items WHERE orden_id = $1', [id]);
      await tx.execute('DELETE FROM ordenes_compra WHERE id = $1', [id]);
    });

    return res.json({ mensaje: 'Orden de compra eliminada. Se revirtió el stock y se devolvió la plata.' });
  } catch (error) {
    console.error('Error al eliminar orden de compra:', error);
    return res.status(500).json({ error: 'Error al eliminar la orden de compra.', detalle: error.message });
  }
}

// ============================================
// PRODUCTOS (Catálogo)
// ============================================

// GET /api/productos — Listar catálogo de productos activos
export async function getProductos(req, res) {
  try {
    const productos = await db.query(`
      SELECT p.id, p.nombre, p.categoria, p.costo_produccion, p.precio_venta, p.activo, p.es_batido, p.es_combinado, p.receta_base_id,
        COALESCE(
          (SELECT MIN(FLOOR(i.stock_actual / req.cantidad))
           FROM (
             SELECT insumo_id, SUM(cantidad) as cantidad
             FROM (
               SELECT insumo_id, cantidad FROM recetas WHERE producto_id = p.id
               UNION
               SELECT rbi.insumo_id, rbi.cantidad FROM recetas_base_insumos rbi WHERE rbi.receta_base_id = p.receta_base_id
             ) combined
             GROUP BY insumo_id
           ) req
           JOIN insumos i ON req.insumo_id = i.id), 0
        ) as stock_disponible
      FROM productos p
      WHERE p.activo = TRUE
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
  const { nombre, categoria, costo_produccion, precio_venta, receta, es_batido, es_combinado, receta_base_id } = req.body;

  if (!nombre || !precio_venta) {
    return res.status(400).json({ error: 'El nombre y el precio de venta son obligatorios.' });
  }

  try {
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);

    const result = await db.transaction(async (tx) => {
      const insertSql = isPg
        ? 'INSERT INTO productos (nombre, categoria, costo_produccion, precio_venta, es_batido, es_combinado, receta_base_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id'
        : 'INSERT INTO productos (nombre, categoria, costo_produccion, precio_venta, es_batido, es_combinado, receta_base_id) VALUES ($1, $2, $3, $4, $5, $6, $7)';

      const res = await tx.execute(insertSql, [
        nombre,
        categoria || 'General',
        parseFloat(costo_produccion) || 0,
        parseFloat(precio_venta),
        !!es_batido,
        !!es_combinado,
        receta_base_id || null
      ]);
      const prodId = res[0].id;

      // Insertar recetas si se proporcionaron (deduplicar por insumo_id)
      if (receta && Array.isArray(receta)) {
        const dedup = {};
        for (const item of receta) {
          const key = item.insumo_id;
          if (dedup[key]) {
            dedup[key].cantidad += parseFloat(item.cantidad);
          } else {
            dedup[key] = { insumo_id: item.insumo_id, cantidad: parseFloat(item.cantidad) };
          }
        }
        for (const item of Object.values(dedup)) {
          await tx.execute(
            'INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES ($1, $2, $3)',
            [prodId, item.insumo_id, item.cantidad]
          );
        }
      }

      // Recalcular costos de productos que usan esta receta base, dentro de la transacción
      if (receta_base_id) await recalcularCostosPorBase(tx, receta_base_id);

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
  const { nombre, categoria, costo_produccion, precio_venta, activo, receta, es_batido, es_combinado, receta_base_id } = req.body;

  try {
    const existing = await db.query('SELECT id FROM productos WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    await db.transaction(async (tx) => {
      const activoVal = activo !== undefined ? !!activo : true;
      const esBatidoVal = !!es_batido;
      await tx.execute(`
        UPDATE productos 
        SET nombre = $1, categoria = $2, costo_produccion = $3, precio_venta = $4, activo = $5, es_batido = $6, es_combinado = $7, receta_base_id = $8, updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
      `, [
        nombre,
        categoria || 'General',
        parseFloat(costo_produccion) || 0,
        parseFloat(precio_venta) || 0,
        activoVal,
        esBatidoVal,
        !!es_combinado,
        receta_base_id || null,
        id
      ]);

      // Si se envía una receta, borrar la anterior y guardar la nueva (deduplicar por insumo_id)
      if (receta && Array.isArray(receta)) {
        console.log('RECETA: Borrando receta anterior del producto', id);
        await tx.execute('DELETE FROM recetas WHERE producto_id = $1', [id]);
        const dedup = {};
        for (const item of receta) {
          const key = item.insumo_id;
          if (dedup[key]) {
            dedup[key].cantidad += parseFloat(item.cantidad);
          } else {
            dedup[key] = { insumo_id: item.insumo_id, cantidad: parseFloat(item.cantidad) };
          }
        }
        const dedupItems = Object.values(dedup);
        console.log('RECETA: Insertando', dedupItems.length, 'ingredientes deduplicados:', JSON.stringify(dedupItems));
        for (const item of dedupItems) {
          const insertResult = await tx.execute(
            'INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES ($1, $2, $3)',
            [id, item.insumo_id, item.cantidad]
          );
          console.log('RECETA INSERT result:', insertResult);
        }
      } else {
        console.log('RECETA: No se envió receta o no es array. receta=', receta);
      }

      // Recalcular costos dentro de la transacción
      if (receta_base_id) await recalcularCostosPorBase(tx, receta_base_id);
    });

    // Verificar que la receta se guardó
    const recetaGuardada = await db.query('SELECT * FROM recetas WHERE producto_id = $1', [id]);
    console.log('RECETA VERIFICACION: recetas guardadas para producto', id, ':', JSON.stringify(recetaGuardada));

    const updated = await db.query('SELECT * FROM productos WHERE id = $1', [id]);
    console.log('Producto after update:', updated[0]);
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
    // Se separan en dos consultas con $1 usado UNA sola vez cada una,
    // para que funcione tanto en PostgreSQL como en SQLite (donde $1 se
    // convierte en "?" posicional y no se puede repetir sin repetir params).
    const [propias, base] = await Promise.all([
      db.query(`
        SELECT r.insumo_id, r.cantidad, i.nombre, i.unidad_medida, i.costo_unitario, 0 AS is_base
        FROM recetas r
        JOIN insumos i ON r.insumo_id = i.id
        WHERE r.producto_id = $1
      `, [id]),
      db.query(`
        SELECT rbi.insumo_id, rbi.cantidad, i.nombre, i.unidad_medida, i.costo_unitario, 1 AS is_base
        FROM productos p
        JOIN recetas_base_insumos rbi ON p.receta_base_id = rbi.receta_base_id
        JOIN insumos i ON rbi.insumo_id = i.id
        WHERE p.id = $1
      `, [id])
    ]);

    const receta = [
      ...propias.map(r => ({ ...r, is_base: 0 })),
      ...base.map(r => ({ ...r, is_base: 1 }))
    ];

    return res.json(receta);
  } catch (error) {
    console.error('Error al obtener receta:', error);
    return res.status(500).json({ error: 'Error al consultar receta.' });
  }
}

export async function deleteProducto(req, res) {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT id FROM productos WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    await db.execute('UPDATE productos SET activo = FALSE WHERE id = $1', [id]);
    return res.json({ mensaje: 'Producto eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

export async function deleteInsumo(req, res) {
  try {
    const { id } = req.params;
    const existing = await db.query('SELECT id FROM insumos WHERE id = $1', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Insumo no encontrado' });
    await db.execute('DELETE FROM insumos WHERE id = $1', [id]);
    return res.json({ mensaje: 'Insumo eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar insumo:', error);
    return res.status(500).json({ error: 'No se pudo eliminar el insumo. Verifica que no esté en uso.' });
  }
}

// ============================================
// RECETAS BASE (Plantillas)
// ============================================

export async function getRecetasBase(req, res) {
  try {
    const recetasBase = await db.query('SELECT * FROM recetas_base ORDER BY nombre ASC');
    for (const rb of recetasBase) {
      rb.insumos = await db.query(`
        SELECT rbi.insumo_id, rbi.cantidad, i.nombre, i.unidad_medida, i.costo_unitario
        FROM recetas_base_insumos rbi
        JOIN insumos i ON rbi.insumo_id = i.id
        WHERE rbi.receta_base_id = $1
      `, [rb.id]);
      const manual = parseFloat(rb.costo_total);
      if (isNaN(manual) || manual < 0) {
        rb.costo_total = rb.insumos.reduce((s, ing) => s + (parseFloat(ing.cantidad) || 0) * (parseFloat(ing.costo_unitario) || 0), 0);
      }
    }
    return res.json(recetasBase);
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar recetas base.' });
  }
}

export async function createRecetaBase(req, res) {
  const { nombre, insumos, costo_total } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  try {
    const costoTotal = normalizeCostoTotal(costo_total, insumos);
    const result = await db.transaction(async (tx) => {
      const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
      const sql = isPg ? 'INSERT INTO recetas_base (nombre, costo_total) VALUES ($1, $2) RETURNING id' : 'INSERT INTO recetas_base (nombre, costo_total) VALUES ($1, $2)';
      const res = await tx.execute(sql, [nombre, costoTotal]);
      const rbId = res[0].id;
      if (insumos && Array.isArray(insumos)) {
        for (const item of insumos) {
          await tx.execute('INSERT INTO recetas_base_insumos (receta_base_id, insumo_id, cantidad) VALUES ($1, $2, $3)', [rbId, item.insumo_id, parseFloat(item.cantidad) || 0]);
          await applyInsumoCostoDesdePlantilla(tx, item);
        }
      }
      return rbId;
    });
    return res.status(201).json({ mensaje: 'Receta base creada.', id: result });
  } catch (error) {
    console.error('Error al crear receta base:', error);
    return res.status(500).json({ error: 'Error al crear receta base.' });
  }
}

export async function updateRecetaBase(req, res) {
  const { id } = req.params;
  const { nombre, insumos, costo_total } = req.body;
  try {
    const costoTotal = normalizeCostoTotal(costo_total, insumos);
    await db.transaction(async (tx) => {
      await tx.execute('UPDATE recetas_base SET nombre = $1, costo_total = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [nombre, costoTotal, id]);
      if (insumos && Array.isArray(insumos)) {
        await tx.execute('DELETE FROM recetas_base_insumos WHERE receta_base_id = $1', [id]);
        for (const item of insumos) {
          await tx.execute('INSERT INTO recetas_base_insumos (receta_base_id, insumo_id, cantidad) VALUES ($1, $2, $3)', [id, item.insumo_id, parseFloat(item.cantidad) || 0]);
          await applyInsumoCostoDesdePlantilla(tx, item);
        }
      }
      // Recalcular el costo de producción de todos los productos que usan esta plantilla
      await recalcularCostosPorBase(tx, id);
      return id;
    });
    return res.json({ mensaje: 'Receta base actualizada. Costos de productos vinculados recalculados.' });
  } catch (error) {
    console.error('Error al actualizar receta base:', error);
    return res.status(500).json({ error: 'Error al actualizar receta base.' });
  }
}

/**
 * Determina el costo TOTAL editable de una receta base.
 * Usa el costo_total enviado, o si no viene, lo calcula desde los insumos.
 */
function normalizeCostoTotal(costo_total, insumos) {
  const manual = parseFloat(costo_total);
  if (!isNaN(manual) && manual >= 0) return manual;
  return (insumos || []).reduce((s, it) => s + (parseFloat(it.cantidad) || 0) * (parseFloat(it.costo) || 0), 0);
}

/**
 * Actualiza el costo unitario de un insumo desde la plantilla (si se envió un costo).
 */
async function applyInsumoCostoDesdePlantilla(tx, item) {
  if (item.costo != null && !isNaN(parseFloat(item.costo))) {
    await tx.execute(
      'UPDATE insumos SET costo_unitario = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [parseFloat(item.costo), item.insumo_id]
    );
  }
}

/**
 * Recalcula y guarda el costo de producción de todos los productos
 * que usan una receta base. El costo del producto = el COSTO TOTAL editable
 * de la receta base (la receta propia del producto NO se suma aquí).
 */
async function recalcularCostosPorBase(tx, recetaBaseId) {
  const base = await tx.query('SELECT costo_total FROM recetas_base WHERE id = $1', [recetaBaseId]);
  let costoBase = parseFloat(base[0]?.costo_total);
  if (isNaN(costoBase) || costoBase < 0) {
    const sum = await tx.query(`
      SELECT COALESCE(SUM(rbi.cantidad * i.costo_unitario), 0) as total
      FROM recetas_base_insumos rbi JOIN insumos i ON rbi.insumo_id = i.id
      WHERE rbi.receta_base_id = $1
    `, [recetaBaseId]);
    costoBase = parseFloat(sum[0]?.total) || 0;
  }
  const productos = await tx.query('SELECT id FROM productos WHERE receta_base_id = $1', [recetaBaseId]);
  for (const prod of productos) {
    await tx.execute(
      'UPDATE productos SET costo_produccion = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [costoBase, prod.id]
    );
  }
}

export async function deleteRecetaBase(req, res) {
  const { id } = req.params;
  try {
    await db.transaction(async (tx) => {
      // Desvincular productos que usan la plantilla (evita referencias huérfanas en SQLite)
      await tx.execute('UPDATE productos SET receta_base_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE receta_base_id = $1', [id]);
      await tx.execute('DELETE FROM recetas_base WHERE id = $1', [id]);
    });
    return res.json({ mensaje: 'Receta base eliminada.' });
  } catch (error) {
    console.error('Error al eliminar receta base:', error);
    return res.status(500).json({ error: 'Error al eliminar receta base.' });
  }
}

/**
 * Marca/desmarca una receta base para que aparezca en las opciones del batido.
 */
export async function toggleRecetaBaseBatido(req, res) {
  const { id } = req.params;
  const { activa_batido } = req.body;
  try {
    await db.execute('UPDATE recetas_base SET activa_batido = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [!!activa_batido, id]);
    return res.json({ mensaje: 'Receta base actualizada.', activa_batido: !!activa_batido });
  } catch (error) {
    console.error('Error al actualizar receta base:', error);
    return res.status(500).json({ error: 'Error al actualizar receta base.' });
  }
}
