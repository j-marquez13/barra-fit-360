import * as db from '../db.js';
import bcrypt from 'bcryptjs';

/**
 * Controlador de Ventas y Pagos Multimoneda
 */

// Identificación del cliente interno usado por "Cortesía Gym" (ver app3.js).
const GYM_IDENT = 'GYM-0001';

// Interpreta booleanos guardados como true/1/'1'/'true'/'t' (SQLite y PostgreSQL).
function esVerdadero(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 't';
}

function numeroValido(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

// Error con código HTTP para lanzarlo desde dentro de una transacción.
function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra });
}

// Valida que la contraseña corresponda a algún administrador.
async function validarPasswordAdmin(password) {
  const admins = await db.query("SELECT id, password_hash FROM usuarios WHERE rol = 'Administrador'");
  for (const admin of admins) {
    if (admin.password_hash && await bcrypt.compare(String(password), admin.password_hash)) {
      return true;
    }
  }
  return false;
}

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
  const tipoTransaccion = isCortesia ? 'Cortesia' : 'Venta';

  // 1. Validaciones iniciales
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe contener al menos un producto (items).' });
  }

  for (const item of items) {
    const cant = numeroValido(item.cantidad);
    if (!Number.isFinite(cant) || cant <= 0) {
      return res.status(400).json({ error: `Cantidad inválida para el producto ${item.producto_id}.` });
    }
    if (!Number.isInteger(Number(item.producto_id))) {
      return res.status(400).json({ error: 'producto_id inválido.' });
    }
  }

  if (!isCortesia && (!pagos || !Array.isArray(pagos) || pagos.length === 0)) {
    return res.status(400).json({ error: 'Debe registrar al menos un método de pago.' });
  }

  // Establecer tasa del día por defecto (USD a COP)
  const tasaDiaUsd = tasas && tasas.USD ? numeroValido(tasas.USD) : 4000.00;
  const tasaDiaVes = tasas && tasas.VES ? numeroValido(tasas.VES) : 100.00;
  if (!(tasaDiaUsd > 0) || !(tasaDiaVes > 0)) {
    return res.status(400).json({ error: 'Las tasas de cambio deben ser números mayores a 0.' });
  }

  try {
    // 2. Consultar catálogo de productos involucrados para evitar alteración de precios
    const productoIds = [...new Set(items.map(item => Number(item.producto_id)))];
    const placeholders = productoIds.map((_, i) => `$${i + 1}`).join(', ');
    const productosQuery = `SELECT id, nombre, costo_produccion, precio_venta FROM productos WHERE id IN (${placeholders})`;
    const productosDB = await db.query(productosQuery, productoIds);

    const productosMap = new Map(productosDB.map(p => [Number(p.id), p]));

    // Validar que todos los productos existan
    for (const item of items) {
      if (!productosMap.has(Number(item.producto_id))) {
        return res.status(404).json({ error: `El producto con ID ${item.producto_id} no existe en el catálogo.` });
      }
    }

    // Cortesía Gym: el gimnasio paga SOLO el costo (no el precio de venta).
    // Solo se permite contra el cliente interno del gimnasio y pagada 100% a crédito,
    // para que no se pueda usar como "descuento" en una venta normal.
    const esCortesiaGym = req.body.cortesia_gym === true;
    if (esCortesiaGym) {
      const gym = cliente_id ? await db.query('SELECT identificacion, nombre FROM clientes WHERE id = $1', [cliente_id]) : [];
      const esGym = gym.length > 0 && (gym[0].identificacion === GYM_IDENT || String(gym[0].nombre || '').toLowerCase() === 'gimnasio');
      const todoCredito = Array.isArray(pagos) && pagos.length > 0 && pagos.every(p => p.metodo_pago === 'Crédito');
      if (!esGym || !todoCredito) {
        return res.status(400).json({ error: 'La Cortesía Gym solo puede registrarse a crédito del cliente Gimnasio.' });
      }
    }

    // 3. Calcular el total de la venta (Moneda Base: COP)
    let totalVentaCop = 0;
    const detallesVenta = items.map(item => {
      const prod = productosMap.get(Number(item.producto_id));
      const costoCalc = numeroValido(item.costo_produccion_calculado);
      const costoUnitario = (item.costo_produccion_calculado !== undefined && costoCalc >= 0)
        ? costoCalc
        : (parseFloat(prod.costo_produccion) || 0);
      const precioUnitario = isCortesia ? 0 : (esCortesiaGym ? costoUnitario : parseFloat(prod.precio_venta));
      const cantidad = parseFloat(item.cantidad);
      const subtotal = precioUnitario * cantidad;
      totalVentaCop += subtotal;

      return {
        producto_id: Number(item.producto_id),
        nombre: prod.nombre,
        cantidad,
        precio_unitario: precioUnitario,
        subtotal,
        costo_unitario: costoUnitario,
        receta_base_ids: (Array.isArray(item.receta_base_ids) && item.receta_base_ids.length > 0) ? JSON.stringify(item.receta_base_ids) : null,
        insumos_manuales: (Array.isArray(item.insumos_manuales) && item.insumos_manuales.length > 0) ? item.insumos_manuales : null,
        extras: Array.isArray(item.extras) ? item.extras : []
      };
    });

    // 4. Calcular los pagos y hacer las conversiones automáticas
    let totalPagadoCop = 0;
    let esVentaACredito = false;

    const pagosProcesados = [];
    if (!isCortesia && pagos) {
      for (const p of pagos) {
        const montoOriginal = numeroValido(p.monto_original);
        if (!Number.isFinite(montoOriginal) || montoOriginal < 0) {
          return res.status(400).json({ error: 'Los montos de pago deben ser números positivos.' });
        }
        if (!p.metodo_pago || typeof p.moneda !== 'string') {
          return res.status(400).json({ error: 'Cada pago debe indicar método de pago y moneda.' });
        }
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
          return res.status(400).json({ error: `Moneda no soportada: ${moneda}` });
        }

        const montoBase = montoOriginal * tasaCambio;
        totalPagadoCop += montoBase;

        pagosProcesados.push({
          metodo_pago: p.metodo_pago,
          moneda,
          monto_original: montoOriginal,
          tasa_cambio: tasaCambio,
          monto_base: montoBase,
          referencia: p.referencia || null
        });
      }
    }

    if (esVentaACredito && !cliente_id) {
      return res.status(400).json({ error: 'Para ventas a Crédito, el cliente_id es obligatorio.' });
    }

    if (cliente_id) {
      const clientExists = await db.query('SELECT id FROM clientes WHERE id = $1', [cliente_id]);
      if (clientExists.length === 0) {
        return res.status(404).json({ error: 'El cliente especificado no existe.' });
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
    for (const det of detallesVenta) {
      const recetasDB = await db.query(
        'SELECT insumo_id, cantidad FROM recetas WHERE producto_id = $1',
        [det.producto_id]
      );
      for (const rec of recetasDB) {
        const insumoId = rec.insumo_id;
        const cantRequerida = parseFloat(rec.cantidad) * det.cantidad;
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
      const isPg = db.isPostgres();

      // Validar límite de crédito dentro de la transacción (con bloqueo de fila en PG)
      // para que dos ventas simultáneas no superen el límite.
      if (esVentaACredito) {
        const cli = await tx.query(
          `SELECT limite_credito, saldo_deudor FROM clientes WHERE id = $1${isPg ? ' FOR UPDATE' : ''}`,
          [cliente_id]
        );
        const saldoActual = parseFloat(cli[0].saldo_deudor) || 0;
        const limite = parseFloat(cli[0].limite_credito) || 0;
        const totalCreditoCop = pagosProcesados.filter(p => p.metodo_pago === 'Crédito').reduce((sum, p) => sum + p.monto_base, 0);
        if (limite > 0 && (saldoActual + totalCreditoCop) > limite) {
          throw httpError(400, 'La venta excede el límite de crédito del cliente.', {
            limite_credito: limite,
            saldo_actual: saldoActual,
            nuevo_saldo_intentado: saldoActual + totalCreditoCop
          });
        }
      }

      // A. Insertar cabecera de la venta
      const insertVentaSql = isPg
        ? 'INSERT INTO ventas (tipo_transaccion, total, tasa_cambio, cliente_id, notas) VALUES ($1, $2, $3, $4, $5) RETURNING id'
        : 'INSERT INTO ventas (tipo_transaccion, total, tasa_cambio, cliente_id, notas) VALUES ($1, $2, $3, $4, $5)';

      const resVenta = await tx.execute(insertVentaSql, [tipoTransaccion, totalVentaCop, tasaDiaUsd, cliente_id || null, notas || '']);
      const ventaId = resVenta[0].id;

      // B. Insertar detalle de productos vendidos (Activa el trigger de inventario)
      const insertDetalleSql = isPg
        ? 'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, costo_unitario, receta_base_ids, insumos_manuales) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id'
        : 'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, costo_unitario, receta_base_ids, insumos_manuales) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';

      const insertExtraSql = 'INSERT INTO detalle_ventas_extras (detalle_venta_id, insumo_id, cantidad, precio_adicional) VALUES ($1, $2, $3, $4)';

      for (const det of detallesVenta) {
        // Registro exacto de lo que se descuenta en esta línea (sin contar extras,
        // que quedan en detalle_ventas_extras). Se usa al anular la venta.
        const consumo = {};
        const descontar = async (insumoId, cantidad) => {
          await tx.execute(
            'UPDATE insumos SET stock_actual = stock_actual - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [cantidad, insumoId]
          );
          consumo[insumoId] = (consumo[insumoId] || 0) + cantidad;
        };

        // La receta individual (tabla `recetas`) la descuenta el trigger; aquí solo se registra.
        const recetasInd = await tx.query('SELECT insumo_id, cantidad FROM recetas WHERE producto_id = $1', [det.producto_id]);
        for (const rec of recetasInd) {
          consumo[rec.insumo_id] = (consumo[rec.insumo_id] || 0) + parseFloat(rec.cantidad) * det.cantidad;
        }

        const insumosManualesJson = det.insumos_manuales ? JSON.stringify(det.insumos_manuales) : null;
        const resDetalle = await tx.execute(insertDetalleSql, [
          ventaId,
          det.producto_id,
          det.cantidad,
          det.precio_unitario,
          det.subtotal,
          det.costo_unitario,
          det.receta_base_ids,
          insumosManualesJson
        ]);
        const detalleId = resDetalle[0].id;

        // Descontar stock de las recetas base seleccionadas (con lógica sola vs combinada)
        if (det.receta_base_ids) {
          const baseIds = JSON.parse(det.receta_base_ids);
          const numBases = baseIds.length; // 1 = sola, 2+ = combinada

          if (numBases >= 2) {
            // --- COMBINADO: recolectar todos los insumos, deduplicar comunes ---
            const comunesMap = new Map(); // insumos NO sabor → solo 1 entrada
            const sabores = []; // insumos sabor → todos se descuentan

            for (const baseId of baseIds) {
              const insumosBase = await tx.query(
                `SELECT rbi.insumo_id, rbi.cantidad, i.es_sabor_batido
                 FROM recetas_base_insumos rbi
                 JOIN insumos i ON rbi.insumo_id = i.id
                 WHERE rbi.receta_base_id = $1`,
                [baseId]
              );

              for (const ins of insumosBase) {
                const cantidadADescontar = parseFloat(ins.cantidad) || 1;

                if (esVerdadero(ins.es_sabor_batido)) {
                  // Frutas/sabores: cada receta base descuenta su fruta
                  sabores.push({ insumo_id: ins.insumo_id, cantidad: cantidadADescontar });
                } else if (!comunesMap.has(ins.insumo_id)) {
                  // Comunes (vaso, pitillo, leche): solo guardar 1 vez (la primera aparición)
                  comunesMap.set(ins.insumo_id, cantidadADescontar);
                }
              }
            }

            // Descontar insumos comunes (1 sola vez)
            for (const [insumoId, cantidad] of comunesMap) {
              await descontar(insumoId, cantidad * det.cantidad);
            }

            // Descontar sabores/frutas (cada uno por separado)
            for (const sab of sabores) {
              await descontar(sab.insumo_id, sab.cantidad * det.cantidad);
            }
          } else {
            // --- SOLA (1 base): descontar todo normalmente ---
            for (const baseId of baseIds) {
              const insumosBase = await tx.query(
                `SELECT rbi.insumo_id, rbi.cantidad
                 FROM recetas_base_insumos rbi
                 WHERE rbi.receta_base_id = $1`,
                [baseId]
              );

              for (const ins of insumosBase) {
                await descontar(ins.insumo_id, (parseFloat(ins.cantidad) || 1) * det.cantidad);
              }
            }
          }
        } else {
          // --- RECETA BASE FIJA asignada al producto ---
          // El frontend manda receta_base_ids = null para estos productos.
          // Hay que descontar la plantilla fija (productos.receta_base_id).
          const prodBase = await tx.query(
            'SELECT receta_base_id FROM productos WHERE id = $1',
            [det.producto_id]
          );

          if (prodBase[0]?.receta_base_id) {
            const insumosBase = await tx.query(
              `SELECT rbi.insumo_id, rbi.cantidad
               FROM recetas_base_insumos rbi
               WHERE rbi.receta_base_id = $1`,
              [prodBase[0].receta_base_id]
            );

            for (const ins of insumosBase) {
              await descontar(ins.insumo_id, (parseFloat(ins.cantidad) || 1) * det.cantidad);
            }
          }
        }

        // Descontar insumos manuales (batido combinado):
        // usa cantidad_combinada si está definida; si no, cantidad_sola; si no, 1.
        if (det.insumos_manuales) {
          for (const ins of det.insumos_manuales) {
            const info = await tx.query(
              'SELECT cantidad_combinada, cantidad_sola FROM insumos WHERE id = $1',
              [ins.insumo_id]
            );
            const comb = parseFloat(info[0]?.cantidad_combinada) || 0;
            const sola = parseFloat(info[0]?.cantidad_sola) || 0;
            const cantidadADescontar = comb > 0 ? comb : (sola > 0 ? sola : 1);

            await descontar(ins.insumo_id, cantidadADescontar * det.cantidad);
          }
        }

        // Insertar insumos extras asociados a este detalle (Activa el trigger trg_descontar_extras_venta)
        for (const extra of det.extras) {
          if (extra.origen === 'receta') continue;
          const cantExtra = numeroValido(extra.cantidad);
          if (!(cantExtra > 0)) continue;
          await tx.execute(insertExtraSql, [
            detalleId,
            extra.insumo_id,
            cantExtra * det.cantidad,
            Math.max(0, numeroValido(extra.precio_adicional) || 0)
          ]);
        }

        await tx.execute('UPDATE detalle_ventas SET consumo_insumos = $1 WHERE id = $2', [JSON.stringify(consumo), detalleId]);
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
    if (error.status) {
      return res.status(error.status).json({ error: error.message, ...error.extra });
    }
    console.error('Error al procesar la venta:', error);
    return res.status(500).json({
      error: 'Error interno del servidor al registrar la venta.',
      detalle: error.message
    });
  }
}

/**
 * Devuelve al inventario el consumo de una línea de venta antigua (sin `consumo_insumos`),
 * recalculándolo con las recetas actuales.
 */
async function devolverConsumoLegacy(tx, det) {
  const devolver = (insumoId, cantidad) => tx.execute(
    'UPDATE insumos SET stock_actual = stock_actual + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [cantidad, insumoId]
  );
  const cantLinea = parseFloat(det.cantidad);

  // Devolver insumos de la receta individual
  const recetas = await tx.query('SELECT insumo_id, cantidad FROM recetas WHERE producto_id = $1', [det.producto_id]);
  for (const rec of recetas) {
    await devolver(rec.insumo_id, parseFloat(rec.cantidad) * cantLinea);
  }

  // Devolver insumos de recetas base (misma lógica sola/combinada que en la venta)
  let baseIds = null;
  if (det.receta_base_ids) {
    try {
      baseIds = Array.isArray(det.receta_base_ids) ? det.receta_base_ids : JSON.parse(det.receta_base_ids);
    } catch (e) {
      baseIds = null;
    }
  }

  if (baseIds && baseIds.length >= 2) {
    // --- COMBINADO: deduplicar comunes al devolver ---
    const comunesMap = new Map();
    const sabores = [];
    for (const baseId of baseIds) {
      const insumosBase = await tx.query(
        `SELECT rbi.insumo_id, rbi.cantidad, i.es_sabor_batido
         FROM recetas_base_insumos rbi
         JOIN insumos i ON rbi.insumo_id = i.id
         WHERE rbi.receta_base_id = $1`,
        [baseId]
      );
      for (const ins of insumosBase) {
        const cantidad = parseFloat(ins.cantidad) || 1;
        if (esVerdadero(ins.es_sabor_batido)) {
          sabores.push({ insumo_id: ins.insumo_id, cantidad });
        } else if (!comunesMap.has(ins.insumo_id)) {
          comunesMap.set(ins.insumo_id, cantidad);
        }
      }
    }
    for (const [insumoId, cantidad] of comunesMap) await devolver(insumoId, cantidad * cantLinea);
    for (const sab of sabores) await devolver(sab.insumo_id, sab.cantidad * cantLinea);
  } else if (baseIds && baseIds.length === 1) {
    // --- SOLA (1 base): devolver todo normalmente ---
    const insumosBase = await tx.query(
      'SELECT rbi.insumo_id, rbi.cantidad FROM recetas_base_insumos rbi WHERE rbi.receta_base_id = $1',
      [baseIds[0]]
    );
    for (const ins of insumosBase) await devolver(ins.insumo_id, (parseFloat(ins.cantidad) || 1) * cantLinea);
  } else if (!det.receta_base_ids) {
    // --- RECETA BASE FIJA asignada al producto ---
    const prodBase = await tx.query('SELECT receta_base_id FROM productos WHERE id = $1', [det.producto_id]);
    if (prodBase[0]?.receta_base_id) {
      const insumosBase = await tx.query(
        'SELECT rbi.insumo_id, rbi.cantidad FROM recetas_base_insumos rbi WHERE rbi.receta_base_id = $1',
        [prodBase[0].receta_base_id]
      );
      for (const ins of insumosBase) await devolver(ins.insumo_id, (parseFloat(ins.cantidad) || 1) * cantLinea);
    }
  }

  // Devolver insumos manuales (batido combinado)
  if (det.insumos_manuales) {
    let manuales = [];
    try {
      manuales = Array.isArray(det.insumos_manuales) ? det.insumos_manuales : JSON.parse(det.insumos_manuales);
    } catch (e) {
      manuales = [];
    }
    for (const ins of manuales) {
      const info = await tx.query('SELECT cantidad_combinada, cantidad_sola FROM insumos WHERE id = $1', [ins.insumo_id]);
      const comb = parseFloat(info[0]?.cantidad_combinada) || 0;
      const sola = parseFloat(info[0]?.cantidad_sola) || 0;
      await devolver(ins.insumo_id, (comb > 0 ? comb : (sola > 0 ? sola : 1)) * cantLinea);
    }
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
    if (!(await validarPasswordAdmin(admin_password))) {
      return res.status(401).json({ error: 'Contraseña de administrador incorrecta.' });
    }

    // 2. Ejecutar la anulación en una transacción
    await db.transaction(async (tx) => {
      const isPg = db.isPostgres();

      // a. Verificar que la venta exista y no esté anulada (bloqueo de fila en PG
      //    para que dos anulaciones simultáneas no reviertan dos veces)
      const ventasDB = await tx.query(`SELECT * FROM ventas WHERE id = $1${isPg ? ' FOR UPDATE' : ''}`, [id]);
      if (ventasDB.length === 0) {
        throw httpError(404, 'La venta no existe.');
      }
      const venta = ventasDB[0];
      if (venta.tipo_transaccion === 'Anulada') {
        throw httpError(400, 'Esta venta ya fue anulada previamente.');
      }

      // b. Devolver inventario: exactamente lo que se descontó (consumo_insumos);
      //    las ventas antiguas sin ese registro se recalculan con las recetas actuales.
      const detalles = await tx.query('SELECT producto_id, cantidad, receta_base_ids, insumos_manuales, consumo_insumos FROM detalle_ventas WHERE venta_id = $1', [id]);
      for (const det of detalles) {
        let consumo = null;
        if (det.consumo_insumos) {
          try { consumo = JSON.parse(det.consumo_insumos); } catch (e) { consumo = null; }
        }
        if (consumo) {
          for (const [insumoId, cantidad] of Object.entries(consumo)) {
            await tx.execute(
              'UPDATE insumos SET stock_actual = stock_actual + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
              [parseFloat(cantidad), Number(insumoId)]
            );
          }
        } else {
          await devolverConsumoLegacy(tx, det);
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
        if (pago.metodo_pago === 'Crédito') {
          // Si fue a crédito, descontar del saldo del cliente
          if (venta.cliente_id) {
            await tx.execute(
              'UPDATE clientes SET saldo_deudor = saldo_deudor - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
              [parseFloat(pago.monto_base), venta.cliente_id]
            );
          }
        } else {
          // El trigger trg_tesoreria_venta_in sumó `monto_original` (en la moneda del
          // pago) a la cuenta; se revierte exactamente ese mismo monto.
          await tx.execute(
            'UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE nombre = $2',
            [parseFloat(pago.monto_original), pago.metodo_pago]
          );
        }
      }

      // e. NO se eliminan los pagos_ventas: se conservan para trazabilidad.
      //    Los reportes y el arqueo de caja excluyen las ventas anuladas.

      // f. Marcar la venta como anulada (no se borra para dejar registro)
      await tx.execute(
        "UPDATE ventas SET tipo_transaccion = 'Anulada', total = 0, notas = $1 WHERE id = $2",
        [`${venta.notas || ''} [ANULADA]`.trim(), id]
      );
    });

    res.json({ ok: true, mensaje: 'Venta anulada correctamente. Inventario, tesorería y créditos devueltos.' });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error al anular venta:', error);
    res.status(500).json({ error: 'Error interno al anular la venta.' });
  }
}
