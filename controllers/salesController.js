import * as db from '../db.js';
import bcrypt from 'bcryptjs';

/**
 * Controlador de Ventas y Pagos Multimoneda
 */

/**
 * Procesa una venta registrando cabecera, detalles y pagos combinados.
 * Realiza conversiones automáticas y descuenta inventario (a través del trigger de BD).
 * 
 * Request Body:
 * {
 *   "items": [
 *     { "producto_id": 1, "cantidad": 2 },
 *     { "producto_id": 2, "cantidad": 1 }
 *   ],
 *   "pagos": [
 *     { "metodo_pago": "Zelle", "moneda": "USD", "monto_original": 5.0, "referencia": "Z-44983" },
 *     { "metodo_pago": "Bancolombia", "moneda": "COP", "monto_original": 6000.0, "referencia": "B-91827" }
 *   ],
 *   "tasas": {
 *     "USD": 4000.00,
 *     "VES": 105.00
 *   },
 *   "notas": "Venta de prueba multimoneda"
 * }
 */
export async function processSale(req, res) {
  const { items, pagos, tasas, notas, tipo_transaccion, cliente_id } = req.body;
  const isCortesia = tipo_transaccion === 'Cortesia';
  console.log('--- NUEVA VENTA ---');
  console.log('Items recibidos:', JSON.stringify(items, null, 2));

  // 1. Validaciones iniciales
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe contener al menos un producto (items). Recibido: ' + JSON.stringify(req.body) });
  }

  if (!isCortesia && (!pagos || !Array.isArray(pagos) || pagos.length === 0)) {
    return res.status(400).json({ error: 'Debe registrar al menos un método de pago.' });
  }

  // Establecer tasa del día por defecto (USD a COP)
  const tasaDiaUsd = tasas && tasas.USD ? parseFloat(tasas.USD) : 4000.00;
  const tasaDiaVes = tasas && tasas.VES ? parseFloat(tasas.VES) : 100.00;

  try {
    // 2. Consultar catálogo de productos involucrados para evitar alteración de precios
    const productoIds = items.map(item => item.producto_id);
    const placeholders = productoIds.map((_, i) => `$${i + 1}`).join(', ');
    const productosQuery = `SELECT id, nombre, costo_produccion, precio_venta FROM productos WHERE id IN (${placeholders})`;
    const productosDB = await db.query(productosQuery, productoIds);

    const productosMap = new Map(productosDB.map(p => [p.id, p]));

    // Validar que todos los productos existan
    for (const item of items) {
      if (!productosMap.has(item.producto_id)) {
        return res.status(404).json({ error: `El producto con ID ${item.producto_id} no existe en el catálogo.` });
      }
    }

    // 3. Calcular el total de la venta (Moneda Base: COP)
    let totalVentaCop = 0;
    const detallesVenta = items.map(item => {
      const prod = productosMap.get(item.producto_id);
      const precioUnitario = isCortesia ? 0 : parseFloat(prod.precio_venta);
      const cantidad = parseFloat(item.cantidad);
      const subtotal = precioUnitario * cantidad;
      totalVentaCop += subtotal;

      return {
        producto_id: item.producto_id,
        nombre: prod.nombre,
        cantidad,
        precio_unitario: precioUnitario,
        subtotal,
        extras: item.extras || []
      };
    });

    // 4. Calcular los pagos y hacer las conversiones automáticas
    let totalPagadoCop = 0;
    let esVentaACredito = false;
    
    const pagosProcesados = (!isCortesia && pagos) ? pagos.map(p => {
      const montoOriginal = parseFloat(p.monto_original);
      const moneda = p.moneda.toUpperCase();
      
      if (p.metodo_pago === 'Crédito') {
        esVentaACredito = true;
      }
      
      // Determinar la tasa de cambio a aplicar
      let tasaCambio = 1.0;
      if (moneda === 'USD') {
        tasaCambio = tasaDiaUsd;
      } else if (moneda === 'VES') {
        tasaCambio = tasaDiaVes;
      } else if (moneda !== 'COP') {
        throw new Error(`Moneda no soportada: ${moneda}`);
      }

      const montoBase = montoOriginal * tasaCambio;
      totalPagadoCop += montoBase;

      return {
        metodo_pago: p.metodo_pago,
        moneda,
        monto_original: montoOriginal,
        tasa_cambio: tasaCambio,
        monto_base: montoBase,
        referencia: p.referencia || null
      };
    }) : [];
    
    if (esVentaACredito && !cliente_id) {
      return res.status(400).json({ error: 'Para ventas a Crédito, el cliente_id es obligatorio.' });
    }
    
    if (cliente_id) {
      const clientExists = await db.query('SELECT id, limite_credito, saldo_deudor FROM clientes WHERE id = $1', [cliente_id]);
      if (clientExists.length === 0) {
        return res.status(404).json({ error: 'El cliente especificado no existe.' });
      }
      
      if (esVentaACredito) {
        // Validar límite de crédito
        const saldoActual = parseFloat(clientExists[0].saldo_deudor);
        const limite = parseFloat(clientExists[0].limite_credito);
        
        // Sumar todos los pagos que sean a Crédito
        const totalCreditoCop = pagosProcesados.filter(p => p.metodo_pago === 'Crédito').reduce((sum, p) => sum + p.monto_base, 0);
        
        if (limite > 0 && (saldoActual + totalCreditoCop) > limite) {
          return res.status(400).json({ 
            error: 'La venta excede el límite de crédito del cliente.',
            limite_credito: limite,
            saldo_actual: saldoActual,
            nuevo_saldo_intentado: saldoActual + totalCreditoCop
          });
        }
      }
    }

    // 5. Verificar si el pago cubre el total de la venta
    // Usamos un delta mayor (10.0 COP) para evitar problemas de precisión con floats al convertir divisas
    if (!isCortesia && totalPagadoCop + 10.0 < totalVentaCop) {
      return res.status(400).json({
        error: 'Monto de pago insuficiente para procesar la transacción.',
        detalles: {
          total_venta_cop: totalVentaCop,
          total_pagado_cop: totalPagadoCop,
          faltante_cop: totalVentaCop - totalPagadoCop
        }
      });
    }

    // 6. Verificar existencias en inventario antes de realizar la venta (Alertas preventivas)
    const insumosRequeridos = {};
    for (const item of items) {
      const recetasDB = await db.query(
        'SELECT insumo_id, cantidad FROM recetas WHERE producto_id = $1',
        [item.producto_id]
      );
      for (const rec of recetasDB) {
        const insumoId = rec.insumo_id;
        const cantRequerida = parseFloat(rec.cantidad) * item.cantidad;
        insumosRequeridos[insumoId] = (insumosRequeridos[insumoId] || 0) + cantRequerida;
      }
    }

    const advertencias = [];
    if (Object.keys(insumosRequeridos).length > 0) {
      const insumoIds = Object.keys(insumosRequeridos).map(Number);
      const placeholdersInsumos = insumoIds.map((_, i) => `$${i + 1}`).join(', ');
      const insumosDB = await db.query(
        `SELECT id, nombre, stock_actual, stock_minimo FROM insumos WHERE id IN (${placeholdersInsumos})`,
        insumoIds
      );

      for (const ins of insumosDB) {
        const reqQty = insumosRequeridos[ins.id];
        const stockActual = parseFloat(ins.stock_actual);
        const stockMinimo = parseFloat(ins.stock_minimo);

        if (stockActual < reqQty) {
          advertencias.push(`Stock insuficiente de '${ins.nombre}'. Solicitado: ${reqQty}, Disponible: ${stockActual}. La venta se procesará pero el stock quedará en negativo.`);
        } else if (stockActual - reqQty < stockMinimo) {
          advertencias.push(`El insumo '${ins.nombre}' ha quedado por debajo del stock mínimo. Remanente: ${stockActual - reqQty}`);
        }
      }
    }

    // 7. Calcular el cambio / vuelto
    const cambioCop = totalPagadoCop - totalVentaCop;
    const cambioUsd = cambioCop > 0 ? cambioCop / tasaDiaUsd : 0;

    // 8. Ejecutar la transacción en base de datos de manera atómica
    const resultVenta = await db.transaction(async (tx) => {
      // Determinar si estamos usando Postgres para adaptar la sintaxis de RETURNING
      const isPg = !process.env.DATABASE_URL && !process.env.PGHOST ? false : true;

      // A. Insertar cabecera de la venta
      const insertVentaSql = isPg
        ? 'INSERT INTO ventas (tipo_transaccion, total, tasa_cambio, cliente_id, notas) VALUES ($1, $2, $3, $4, $5) RETURNING id'
        : 'INSERT INTO ventas (tipo_transaccion, total, tasa_cambio, cliente_id, notas) VALUES ($1, $2, $3, $4, $5)';
      
      const resVenta = await tx.execute(insertVentaSql, [tipo_transaccion || 'Venta', totalVentaCop, tasaDiaUsd, cliente_id || null, notas || '']);
      const ventaId = resVenta[0].id;

      // B. Insertar detalle de productos vendidos (Activa el trigger de inventario)
      const insertDetalleSql = isPg
        ? 'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES ($1, $2, $3, $4, $5) RETURNING id'
        : 'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES ($1, $2, $3, $4, $5)';
      
      const insertExtraSql = 'INSERT INTO detalle_ventas_extras (detalle_venta_id, insumo_id, cantidad, precio_adicional) VALUES ($1, $2, $3, $4)';

      for (const det of detallesVenta) {
        const resDetalle = await tx.execute(insertDetalleSql, [
          ventaId,
          det.producto_id,
          det.cantidad,
          det.precio_unitario,
          det.subtotal
        ]);
        const detalleId = resDetalle[0].id;

        // Insertar insumos extras asociados a este detalle (Activa el trigger trg_descontar_extras_venta)
        if (det.extras && det.extras.length > 0) {
          for (const extra of det.extras) {
            await tx.execute(insertExtraSql, [
              detalleId,
              extra.insumo_id,
              extra.cantidad * det.cantidad,
              extra.precio_adicional || 0
            ]);
          }
        }
      }

      // C. Insertar los pagos asociados
      const insertPagoSql = `
        INSERT INTO pagos_ventas (venta_id, metodo_pago, moneda, monto_original, tasa_cambio, monto_base, referencia)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      for (const pago of pagosProcesados) {
        await tx.execute(insertPagoSql, [
          ventaId,
          pago.metodo_pago,
          pago.moneda,
          pago.monto_original,
          pago.tasa_cambio,
          pago.monto_base,
          pago.referencia
        ]);
        
        // Si el pago es a Crédito, sumar a saldo_deudor del cliente
        if (pago.metodo_pago === 'Crédito' && cliente_id) {
          await tx.execute(
            'UPDATE clientes SET saldo_deudor = saldo_deudor + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [pago.monto_base, cliente_id]
          );
        }
      }

      return ventaId;
    });

    // 9. Responder al cliente
    return res.status(201).json({
      mensaje: 'Venta procesada exitosamente.',
      venta_id: resultVenta,
      resumen: {
        total_venta_cop: totalVentaCop,
        total_pagado_cop: totalPagadoCop,
        cambio_cop: cambioCop,
        cambio_usd: parseFloat(cambioUsd.toFixed(2))
      },
      detalles: detallesVenta,
      pagos: pagosProcesados,
      advertencias: advertencias.length > 0 ? advertencias : null
    });

  } catch (error) {
    console.error('Error al procesar la venta:', error);
    return res.status(500).json({
      error: 'Error interno del servidor al registrar la venta.',
      detalle: error.message
    });
  }
}

/**
 * Anula una venta existente. Revierte inventario, pagos, tesorería y crédito.
 * Requiere la contraseña de un administrador.
 */
export async function anularVenta(req, res) {
  const { id } = req.params;
  const { admin_password } = req.body;

  if (!admin_password) {
    return res.status(400).json({ error: 'Se requiere la contraseña de administrador para anular una venta.' });
  }

  try {
    // 1. Validar que la contraseña corresponda a un administrador
    const admins = await db.query("SELECT id, password_hash FROM usuarios WHERE rol = 'Administrador'");
    if (admins.length === 0) {
      return res.status(500).json({ error: 'No hay administradores configurados en el sistema.' });
    }

    let authSuccess = false;
    for (const admin of admins) {
      if (admin.password_hash) {
        const match = await bcrypt.compare(admin_password, admin.password_hash);
        if (match) {
          authSuccess = true;
          break;
        }
      }
    }

    if (!authSuccess) {
      return res.status(401).json({ error: 'Contraseña de administrador incorrecta.' });
    }

    // 2. Ejecutar la anulación en una transacción
    await db.transaction(async (tx) => {
      // a. Verificar que la venta exista y no esté anulada
      const ventasDB = await tx.query('SELECT * FROM ventas WHERE id = $1', [id]);
      if (ventasDB.length === 0) {
        throw new Error('La venta no existe.');
      }
      const venta = ventasDB[0];
      if (venta.tipo_transaccion === 'Anulada') {
        throw new Error('Esta venta ya fue anulada previamente.');
      }

      // b. Devolver inventario (Detalles principales)
      const detalles = await tx.query('SELECT producto_id, cantidad FROM detalle_ventas WHERE venta_id = $1', [id]);
      for (const det of detalles) {
        const recetas = await tx.query('SELECT insumo_id, cantidad FROM recetas WHERE producto_id = $1', [det.producto_id]);
        for (const rec of recetas) {
          const cantidadADevolver = parseFloat(rec.cantidad) * parseFloat(det.cantidad);
          await tx.execute(
            'UPDATE insumos SET stock_actual = stock_actual + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [cantidadADevolver, rec.insumo_id]
          );
        }
      }

      // c. Devolver inventario (Extras)
      const detallesExtras = await tx.query(`
        SELECT dxe.insumo_id, dxe.cantidad 
        FROM detalle_ventas_extras dxe
        JOIN detalle_ventas dv ON dxe.detalle_venta_id = dv.id
        WHERE dv.venta_id = $1
      `, [id]);
      
      for (const extra of detallesExtras) {
        await tx.execute(
          'UPDATE insumos SET stock_actual = stock_actual + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [parseFloat(extra.cantidad), extra.insumo_id]
        );
      }

      // d. Revertir pagos y tesorería, y crédito si aplica
      const pagos = await tx.query('SELECT * FROM pagos_ventas WHERE venta_id = $1', [id]);
      for (const pago of pagos) {
        // Revertir de tesorería (cuenta bancaria)
        await tx.execute(
          'UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE nombre = $2',
          [parseFloat(pago.monto_original), pago.metodo_pago]
        );

        // Si fue a crédito, descontar del saldo del cliente
        if (pago.metodo_pago === 'Crédito' && venta.cliente_id) {
          await tx.execute(
            'UPDATE clientes SET saldo_deudor = saldo_deudor - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [parseFloat(pago.monto_base), venta.cliente_id]
          );
        }
      }

      // e. Eliminar los pagos de la venta (para no duplicar en reportes)
      await tx.execute('DELETE FROM pagos_ventas WHERE venta_id = $1', [id]);

      // f. Marcar la venta como anulada (no se borra para dejar registro)
      await tx.execute(
        "UPDATE ventas SET tipo_transaccion = 'Anulada', total = 0, notas = $1 WHERE id = $2",
        [`${venta.notas || ''} [ANULADA]`.trim(), id]
      );
    });

    res.json({ ok: true, mensaje: 'Venta anulada correctamente. Inventario, tesorería y créditos devueltos.' });
  } catch (error) {
    console.error('Error al anular venta:', error);
    res.status(500).json({ error: error.message || 'Error interno al anular la venta.' });
  }
}
