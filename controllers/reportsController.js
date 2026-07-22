import * as db from '../db.js';
import { localDate, dateExpr, dateAgo } from '../db.js';

/**
 * Controlador de Reportes — Cierre Diario, Cierre Semanal e Historial
 */

// GET /api/reportes/cierre-diario — Resumen del día actual
export async function cierreDiario(req, res) {
  try {
    const fecha = req.query.fecha || localDate();
    const tasaCierreUsd = parseFloat(req.query.tasa_usd) || null;
    const tasaCierreVes = parseFloat(req.query.tasa_ves) || null;
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
    const dateFilter = `${dateExpr('v.fecha')} = $1`;

    // 1. Total de ventas del día
    const ventasResumen = await db.query(`
      SELECT 
        COUNT(DISTINCT v.id) as total_transacciones,
        COALESCE(SUM(v.total), 0) as total_ventas_cop
      FROM ventas v
      WHERE ${dateFilter} AND v.tipo_transaccion = 'Venta'
    `, [fecha]);

    // 2. Desglose por método de pago (Ventas + Abonos)
    const pagosPorMetodo = await db.query(`
      SELECT metodo_pago, moneda, sum(cantidad_pagos) as cantidad_pagos, sum(total_original) as total_original, sum(total_cop) as total_cop
      FROM (
        SELECT pv.metodo_pago, pv.moneda, COUNT(*) as cantidad_pagos, SUM(pv.monto_original) as total_original, SUM(pv.monto_base) as total_cop
        FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
        WHERE ${dateFilter} GROUP BY pv.metodo_pago, pv.moneda
        UNION ALL
        SELECT pa.metodo_pago, pa.moneda, COUNT(*) as cantidad_pagos, SUM(pa.monto_original) as total_original, SUM(pa.monto_base) as total_cop
        FROM pagos_abonos pa JOIN abonos_credito a ON pa.abono_id = a.id
        WHERE ${dateFilter.replace('v.fecha', 'a.fecha')} GROUP BY pa.metodo_pago, pa.moneda
      ) combined
      GROUP BY metodo_pago, moneda ORDER BY total_cop DESC
    `, [fecha]);
    
    // 2.5 Cobranza de deudas
    const abonosResumen = await db.query(`
      SELECT COALESCE(SUM(monto_total_cop), 0) as total_abonos
      FROM abonos_credito a
      WHERE ${dateFilter.replace('v.fecha', 'a.fecha')}
    `, [fecha]);
    const totalAbonos = parseFloat(abonosResumen[0]?.total_abonos || 0);

    // 3. Gastos Operacionales
    const gastosResumen = await db.query(`
      SELECT COALESCE(SUM(monto_cop), 0) as total_gastos
      FROM gastos WHERE ${dateExpr('fecha')} = $1
    `, [fecha]);
    const totalGastos = parseFloat(gastosResumen[0]?.total_gastos || 0);

    // 3.1 Desglose individual de gastos del día
    const gastosDetalle = await db.query(`
      SELECT id, fecha, categoria, descripcion, monto, moneda, tasa_cambio, monto_cop, metodo_pago
      FROM gastos WHERE ${dateExpr('fecha')} = $1
      ORDER BY fecha DESC
    `, [fecha]);

    // 4. Cortesías
    const cortesiasResumen = await db.query(`
      SELECT COALESCE(SUM(dv.cantidad * p.costo_produccion), 0) as costo_cortesias
      FROM detalle_ventas dv
      JOIN ventas v ON dv.venta_id = v.id
      JOIN productos p ON dv.producto_id = p.id
      WHERE ${dateFilter} AND v.tipo_transaccion = 'Cortesia'
    `, [fecha]);
    const costoCortesias = parseFloat(cortesiasResumen[0]?.costo_cortesias || 0);

    // 5. Productos vendidos (Top) y Costo de Producción (Solo ventas reales)
    const topProductos = await db.query(`
      SELECT p.nombre, p.categoria, SUM(dv.cantidad) as unidades_vendidas,
             SUM(dv.subtotal) as ingreso_total, SUM(dv.cantidad * p.costo_produccion) as costo_total
      FROM detalle_ventas dv
      JOIN ventas v ON dv.venta_id = v.id JOIN productos p ON dv.producto_id = p.id
      WHERE ${dateFilter} AND v.tipo_transaccion = 'Venta'
      GROUP BY p.id, p.nombre, p.categoria ORDER BY unidades_vendidas DESC
    `, [fecha]);

    // 6. Diferencial Cambiario
    const pagosDivisas = await db.query(`
      SELECT pv.moneda, SUM(pv.monto_original) as total_divisas, SUM(pv.monto_base) as total_cop_recibido, MAX(pv.tasa_cambio) as ultima_tasa
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE ${dateFilter} AND pv.moneda != 'COP' GROUP BY pv.moneda
    `, [fecha]);

    let diferencialCambiarioTotal = 0;
    const detallesDiferencial = pagosDivisas.map(d => {
      const tasaCierre = d.moneda === 'USD' ? (tasaCierreUsd || d.ultima_tasa) : (tasaCierreVes || d.ultima_tasa);
      const valorActualCop = d.total_divisas * tasaCierre;
      const diferencia = valorActualCop - d.total_cop_recibido;
      diferencialCambiarioTotal += diferencia;
      return { moneda: d.moneda, total_divisas: d.total_divisas, tasa_cierre: tasaCierre, diferencia_cop: diferencia };
    });

    // 7. Cálculos Finales
    const totalVentas = parseFloat(ventasResumen[0]?.total_ventas_cop || 0);
    const costoProduccion = topProductos.reduce((sum, p) => sum + parseFloat(p.costo_total || 0), 0);
    
    // Utilidad Neta = Ingresos Totales - Costos Producción - Gastos Operacionales - Costo Cortesías + Diferencial Cambiario
    const utilidadNeta = totalVentas - costoProduccion - totalGastos - costoCortesias + diferencialCambiarioTotal;

    const insumosAlerta = await db.query(`
      SELECT nombre, stock_actual, stock_minimo, unidad_medida FROM insumos WHERE stock_actual <= stock_minimo ORDER BY stock_actual ASC
    `);

    const ventasDelDia = await db.query(`
      SELECT v.id, v.fecha, v.tipo_transaccion, v.total, v.notas, GROUP_CONCAT(DISTINCT pv.metodo_pago) as metodos_pago
      FROM ventas v LEFT JOIN pagos_ventas pv ON pv.venta_id = v.id
      WHERE ${dateFilter} GROUP BY v.id ORDER BY v.fecha DESC
    `, [fecha]);

    return res.json({
      fecha,
      resumen: {
        total_transacciones: parseInt(ventasResumen[0]?.total_transacciones || 0),
        ingresos_totales_cop: totalVentas,
        cobranza_deudas_cop: totalAbonos,
        flujo_caja_ingresos: totalVentas + totalAbonos,
        costo_produccion: costoProduccion,
        gastos_operacionales: totalGastos,
        costo_cortesias: costoCortesias,
        diferencial_cambiario: diferencialCambiarioTotal,
        utilidad_neta: utilidadNeta
      },
      diferencial_detalles: detallesDiferencial,
      desglose_pagos: pagosPorMetodo,
      productos_vendidos: topProductos,
      desglose_gastos: gastosDetalle,
      alertas_inventario: insumosAlerta,
      ventas: ventasDelDia
    });
  } catch (error) {
    console.error('Error al generar cierre diario:', error);
    return res.status(500).json({ error: 'Error al generar el cierre diario.', detalle: error.message });
  }
}

// GET /api/reportes/cierre-semanal — Resumen de los últimos 7 días
export async function cierreSemanal(req, res) {
  try {
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
    const dateFilter = `${dateExpr('v.fecha')} >= ${dateAgo(7)}`;
    const dateFilterGastos = `${dateExpr('fecha')} >= ${dateAgo(7)}`;

    // 1. Resumen general de la semana
    const resumenSemana = await db.query(`
      SELECT COUNT(DISTINCT v.id) as total_transacciones, COALESCE(SUM(v.total), 0) as total_ventas_cop
      FROM ventas v WHERE ${dateFilter} AND v.tipo_transaccion = 'Venta'
    `);

    // 2. Ventas por día de la semana
    const ventasPorDia = await db.query(`
      SELECT ${dateExpr('v.fecha')} as dia, COUNT(*) as transacciones, SUM(v.total) as total_cop
      FROM ventas v WHERE ${dateFilter} AND v.tipo_transaccion = 'Venta'
      GROUP BY ${dateExpr('v.fecha')} ORDER BY dia ASC
    `);

    // 3. Desglose por método de pago semanal
    const pagosSemanal = await db.query(`
      SELECT pv.metodo_pago, pv.moneda, COUNT(*) as cantidad, SUM(pv.monto_original) as total_original, SUM(pv.monto_base) as total_cop
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE ${dateFilter} GROUP BY pv.metodo_pago, pv.moneda ORDER BY total_cop DESC
    `);

    // 4. Gastos Operacionales
    const gastosResumen = await db.query(`
      SELECT COALESCE(SUM(monto_cop), 0) as total_gastos
      FROM gastos WHERE ${dateFilterGastos}
    `);
    const totalGastos = parseFloat(gastosResumen[0]?.total_gastos || 0);

    // 5. Cortesías
    const cortesiasResumen = await db.query(`
      SELECT COALESCE(SUM(dv.cantidad * p.costo_produccion), 0) as costo_cortesias
      FROM detalle_ventas dv JOIN ventas v ON dv.venta_id = v.id JOIN productos p ON dv.producto_id = p.id
      WHERE ${dateFilter} AND v.tipo_transaccion = 'Cortesia'
    `);
    const costoCortesias = parseFloat(cortesiasResumen[0]?.costo_cortesias || 0);

    // 6. Top productos de la semana
    const topProductos = await db.query(`
      SELECT p.nombre, p.categoria, SUM(dv.cantidad) as unidades_vendidas,
             SUM(dv.subtotal) as ingreso_total, SUM(dv.cantidad * p.costo_produccion) as costo_total
      FROM detalle_ventas dv JOIN ventas v ON dv.venta_id = v.id JOIN productos p ON dv.producto_id = p.id
      WHERE ${dateFilter} AND v.tipo_transaccion = 'Venta'
      GROUP BY p.id, p.nombre, p.categoria ORDER BY unidades_vendidas DESC
    `);

    // 7. Calcular utilidad semanal
    const totalVentas = parseFloat(resumenSemana[0]?.total_ventas_cop || 0);
    const costoProduccion = topProductos.reduce((sum, p) => sum + parseFloat(p.costo_total || 0), 0);
    
    // No calculamos diferencial cambiario aquí, pero restamos gastos y cortesías
    const utilidadNeta = totalVentas - costoProduccion - totalGastos - costoCortesias;

    return res.json({
      periodo: 'Últimos 7 días',
      resumen: {
        total_transacciones: parseInt(resumenSemana[0]?.total_transacciones || 0),
        ingresos_totales_cop: totalVentas,
        costo_produccion: costoProduccion,
        gastos_operacionales: totalGastos,
        costo_cortesias: costoCortesias,
        utilidad_neta: utilidadNeta
      },
      ventas_por_dia: ventasPorDia,
      desglose_pagos: pagosSemanal,
      productos_vendidos: topProductos
    });
  } catch (error) {
    console.error('Error al generar cierre semanal:', error);
    return res.status(500).json({ error: 'Error al generar el cierre semanal.', detalle: error.message });
  }
}

// GET /api/reportes/ventas — Historial de ventas con filtros
export async function historialVentas(req, res) {
  try {
    const { desde, hasta, limit } = req.query;

    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (desde) {
      conditions.push(`${dateExpr('v.fecha')} >= $${paramIndex}`);
      params.push(desde);
      paramIndex++;
    }
    if (hasta) {
      conditions.push(`${dateExpr('v.fecha')} <= $${paramIndex}`);
      params.push(hasta);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = `LIMIT ${parseInt(limit) || 50}`;

    const ventas = await db.query(`
      SELECT 
        v.id,
        v.fecha,
        v.total,
        v.tasa_cambio,
        v.notas,
        c.nombre as cliente_nombre
      FROM ventas v
      LEFT JOIN clientes c ON v.cliente_id = c.id
      ${whereClause}
      ORDER BY v.fecha DESC
      ${limitClause}
    `, params);

    // Para cada venta, obtener los detalles y pagos
    const ventasDetalladas = [];
    for (const venta of ventas) {
      const detalles = await db.query(`
        SELECT dv.cantidad, dv.precio_unitario, dv.subtotal, p.nombre as producto
        FROM detalle_ventas dv
        JOIN productos p ON dv.producto_id = p.id
        WHERE dv.venta_id = $1
      `, [venta.id]);

      const pagos = await db.query(`
        SELECT metodo_pago, moneda, monto_original, tasa_cambio, monto_base, referencia
        FROM pagos_ventas
        WHERE venta_id = $1
      `, [venta.id]);

      ventasDetalladas.push({
        ...venta,
        detalles,
        pagos
      });
    }

    return res.json({
      total_resultados: ventasDetalladas.length,
      ventas: ventasDetalladas
    });
  } catch (error) {
    console.error('Error al consultar historial:', error);
    return res.status(500).json({ error: 'Error al consultar historial de ventas.', detalle: error.message });
  }
}
