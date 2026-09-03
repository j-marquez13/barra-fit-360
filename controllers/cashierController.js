import * as db from '../db.js';
import { localNow, isPostgres, localDate, dateExpr } from '../db.js';

/**
 * Controlador de Arqueo y Sesiones de Caja (Turnos)
 */

// GET /api/caja/estado
export async function estadoCaja(req, res) {
  try {
    const session = await db.query('SELECT s.*, u.nombre as usuario_nombre, u.permisos FROM sesiones_caja s LEFT JOIN usuarios u ON s.usuario_id = u.id WHERE s.fecha_cierre IS NULL AND s.estado = $1 ORDER BY s.id DESC LIMIT 1', ['Abierta']);
    if (session.length === 0) {
      return res.json({ abierta: false });
    }

    const currentSession = session[0];
    const fechaApertura = currentSession.fecha_apertura;

    // Obtener desglose de Ventas por Moneda y Método de Pago (sin ventas anuladas)
    const ventasBreakdown = await db.query(`
      SELECT pv.moneda, pv.metodo_pago, SUM(pv.monto_original) as total_original, SUM(pv.monto_base) as total_base
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE pv.fecha >= $1 AND v.tipo_transaccion != 'Anulada'
      GROUP BY pv.moneda, pv.metodo_pago
    `, [fechaApertura]);

    // Obtener desglose de Abonos por Moneda y Método de Pago
    const abonosBreakdown = await db.query(`
      SELECT moneda, metodo_pago, SUM(monto_original) as total_original, SUM(monto_base) as total_base
      FROM pagos_abonos 
      WHERE fecha >= $1 
      GROUP BY moneda, metodo_pago
    `, [fechaApertura]);

    // Consolidar todos los ingresos
    const ingresosMoneda = { COP: 0, USD: 0, VES: 0 };
    const ingresosDetalle = {}; // Ej: { "USD": { "Efectivo": 100, "Zelle": 50 } }

    const ventasMoneda = { COP: 0, USD: 0, VES: 0 };
    const ventasDetalle = {};

    const abonosMoneda = { COP: 0, USD: 0, VES: 0 };
    const abonosDetalle = {};

    const processBreakdown = (rows, outMoneda, outDetalle) => {
      rows.forEach(row => {
        const moneda = row.moneda.toUpperCase();
        const metodo = row.metodo_pago;
        const monto = parseFloat(row.total_original) || 0;
        
        // Sumar a la categoría específica
        if (!outMoneda[moneda]) outMoneda[moneda] = 0;
        outMoneda[moneda] += monto;

        if (!outDetalle[moneda]) outDetalle[moneda] = {};
        if (!outDetalle[moneda][metodo]) outDetalle[moneda][metodo] = 0;
        outDetalle[moneda][metodo] += monto;

        // Sumar al global
        if (!ingresosMoneda[moneda]) ingresosMoneda[moneda] = 0;
        ingresosMoneda[moneda] += monto;

        if (!ingresosDetalle[moneda]) ingresosDetalle[moneda] = {};
        if (!ingresosDetalle[moneda][metodo]) ingresosDetalle[moneda][metodo] = 0;
        ingresosDetalle[moneda][metodo] += monto;
      });
    };

    processBreakdown(ventasBreakdown, ventasMoneda, ventasDetalle);
    processBreakdown(abonosBreakdown, abonosMoneda, abonosDetalle);

    // Obtener total de Gastos en COP
    const gastosData = await db.query(`SELECT SUM(monto_cop) as total FROM gastos WHERE fecha >= $1`, [fechaApertura]);
    const totalGastosCop = parseFloat(gastosData[0]?.total || 0);

    res.json({
      abierta: true,
      sesion: currentSession,
      arqueo: {
        ingresos_moneda: ingresosMoneda,
        ingresos_detalle: ingresosDetalle,
        ventas_moneda: ventasMoneda,
        ventas_detalle: ventasDetalle,
        abonos_moneda: abonosMoneda,
        abonos_detalle: abonosDetalle,
        total_gastos_cop: totalGastosCop
      }
    });

  } catch (err) {
    console.error('Error al obtener estado de caja:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

// POST /api/caja/abrir
export async function abrirCaja(req, res) {
  try {
    const { usuario_id, fondo_inicial_cop, fondo_inicial_usd, turno, nombre_cajero } = req.body;

    if (!usuario_id) {
      return res.status(400).json({ error: 'El ID de usuario es obligatorio' });
    }

    // Verificar si el usuario existe
    const usr = await db.query('SELECT id, permisos FROM usuarios WHERE id = $1', [usuario_id]);
    if (usr.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const fondo = parseFloat(fondo_inicial_cop) || 0;
    const fondoUsd = parseFloat(fondo_inicial_usd) || 0;
    const turnoValido = (turno === 'Tarde') ? 'Tarde' : (turno === 'Completo' ? 'Completo' : 'Mañana');
    const cajero = nombre_cajero || 'Cajero';

    // Verificar si ya hay una caja abierta
    const openSession = await db.query('SELECT id FROM sesiones_caja WHERE fecha_cierre IS NULL AND estado = $1 LIMIT 1', ['Abierta']);
    if (openSession.length > 0) {
      return res.status(400).json({ error: 'Ya existe un turno de caja abierto' });
    }

    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
    const sql = isPg 
      ? `INSERT INTO sesiones_caja (usuario_id, fondo_inicial_cop, fondo_inicial_usd, estado, turno, nombre_cajero) VALUES ($1, $2, $3, 'Abierta', $4, $5) RETURNING *`
      : `INSERT INTO sesiones_caja (usuario_id, fondo_inicial_cop, fondo_inicial_usd, estado, turno, nombre_cajero) VALUES ($1, $2, $3, 'Abierta', $4, $5)`;
      
    const result = await db.execute(sql, [usuario_id, fondo, fondoUsd, turnoValido, cajero]);
    
    let sessionRes = result;
    if (!isPg) {
      const rows = await db.query('SELECT * FROM sesiones_caja WHERE id = $1', [result[0].id]);
      sessionRes = rows;
    }
    
    const finalSession = { ...sessionRes[0], permisos: usr[0].permisos };

    res.status(201).json({ mensaje: 'Caja abierta correctamente', sesion: finalSession });
  } catch (err) {
    console.error('Error al abrir caja:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

// GET /api/admin/cierres — Histórico de cierres diarios (solo administrador)
export async function listarCierresAdmin(req, res) {
  try {
    const desde = req.query.desde || null;
    const hasta = req.query.hasta || null;

    let where = "WHERE estado = 'Cerrada'";
    const params = [];
    if (desde) {
      params.push(desde);
      where += ` AND ${dateExpr('fecha_apertura')} >= $${params.length}`;
    }
    if (hasta) {
      params.push(hasta);
      where += ` AND ${dateExpr('fecha_apertura')} <= $${params.length}`;
    }

    const fechaExpr = `CAST(${dateExpr('fecha_apertura')} AS TEXT)`;

    const rows = await db.query(`
      SELECT
        ${fechaExpr} as fecha,
        COUNT(*) as total_turnos,
        COALESCE(SUM(total_ventas_cop), 0) as total_ventas_cop,
        COALESCE(SUM(total_gastos_cop), 0) as total_gastos_cop,
        COALESCE(SUM(costo_produccion), 0) as costo_produccion,
        COALESCE(SUM(utilidad_neta), 0) as utilidad_neta,
        COALESCE(SUM(declarado_cop), 0) as declarado_cop,
        COALESCE(SUM(declarado_pago_movil), 0) as declarado_pago_movil,
        COALESCE(SUM(diferencia_caja), 0) as diferencia_caja
      FROM sesiones_caja
      ${where}
      GROUP BY ${fechaExpr}
      ORDER BY fecha DESC
    `, params);

    // Reposición de stock por fecha (compra de inventario, no gasto operativo)
    const reposicionPorFecha = {};
    if (rows.length > 0) {
      const fechas = rows.map(r => r.fecha);
      const placeholders = fechas.map((_, i) => `$${i + 1}`).join(', ');
      const repRows = await db.query(`
        SELECT CAST(${dateExpr('fecha')} AS TEXT) as fecha, COALESCE(SUM(monto_cop), 0) as total
        FROM gastos
        WHERE categoria = 'REPOSICION' AND CAST(${dateExpr('fecha')} AS TEXT) IN (${placeholders})
        GROUP BY CAST(${dateExpr('fecha')} AS TEXT)
      `, fechas);
      repRows.forEach(r => { reposicionPorFecha[r.fecha] = parseFloat(r.total || 0); });
    }

    const cierres = rows.map(r => ({
      fecha: r.fecha,
      total_turnos: parseInt(r.total_turnos || 0, 10),
      total_ventas_cop: parseFloat(r.total_ventas_cop || 0),
      total_gastos_cop: parseFloat(r.total_gastos_cop || 0),
      costo_produccion: parseFloat(r.costo_produccion || 0),
      reposicion: reposicionPorFecha[r.fecha] || 0,
      utilidad_neta: parseFloat(r.utilidad_neta || 0),
      declarado_cop: parseFloat(r.declarado_cop || 0),
      declarado_pago_movil: parseFloat(r.declarado_pago_movil || 0),
      diferencia_caja: parseFloat(r.diferencia_caja || 0)
    }));

    return res.json({ cierres });
  } catch (error) {
    console.error('Error al listar cierres admin:', error);
    return res.status(500).json({ error: 'Error al obtener el histórico de cierres.', detalle: error.message });
  }
}

// GET /api/caja/cierre-dia — Cierre consolidado de todos los turnos del día
export async function cierreDia(req, res) {
  try {
    const fecha = req.query.fecha || localDate();
    const rows = await db.query(`
      SELECT
        COUNT(*) as total_turnos,
        COALESCE(SUM(total_ventas_cop), 0) as total_ventas_cop,
        COALESCE(SUM(total_gastos_cop), 0) as total_gastos_cop,
        COALESCE(SUM(costo_produccion), 0) as costo_produccion,
        COALESCE(SUM(utilidad_neta), 0) as utilidad_neta,
        COALESCE(SUM(declarado_cop), 0) as declarado_cop,
        COALESCE(SUM(declarado_pago_movil), 0) as declarado_pago_movil,
        COALESCE(SUM(diferencia_caja), 0) as diferencia_caja
      FROM sesiones_caja
      WHERE ${dateExpr('fecha_apertura')} = $1 AND estado = 'Cerrada'
    `, [fecha]);

    const r = rows[0] || {};
    return res.json({
      fecha,
      resumen: {
        total_turnos: parseInt(r.total_turnos || 0, 10),
        total_ventas_cop: parseFloat(r.total_ventas_cop || 0),
        total_gastos_cop: parseFloat(r.total_gastos_cop || 0),
        costo_produccion: parseFloat(r.costo_produccion || 0),
        utilidad_neta: parseFloat(r.utilidad_neta || 0),
        declarado_cop: parseFloat(r.declarado_cop || 0),
        declarado_pago_movil: parseFloat(r.declarado_pago_movil || 0),
        diferencia_caja: parseFloat(r.diferencia_caja || 0)
      }
    });
  } catch (error) {
    console.error('Error al generar cierre diario consolidado:', error);
    return res.status(500).json({ error: 'Error al generar el cierre diario consolidado.', detalle: error.message });
  }
}

// POST /api/caja/cerrar
export async function cerrarCaja(req, res) {
  try {
    const { 
      monto_declarado_cop,
      declarado_pago_movil,
      declarado_zelle,
      declarado_binance,
      declarado_efectivo_pesos,
      declarado_bancolombia 
    } = req.body; // Lo que cuenta el cajero físicamente

    const session = await db.query('SELECT * FROM sesiones_caja WHERE fecha_cierre IS NULL ORDER BY id DESC LIMIT 1');
    if (session.length === 0) {
      return res.status(400).json({ error: 'No hay ninguna caja abierta' });
    }

    const currentSession = session[0];
    const fechaApertura = currentSession.fecha_apertura;
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);

    // Tasas del día usadas para convertir a COP (las envía el frontend)
    const tasas = req.body.tasas || {};
    const tasaUsd = parseFloat(tasas.USD) || 4000.00;
    const tasaVes = parseFloat(tasas.VES) || 100.00;

    // 1. Ingresos en efectivo de ventas por moneda (excluye crédito y ventas anuladas)
    const ventasQuery = `
      SELECT pv.moneda, SUM(pv.monto_original) as total
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE pv.fecha >= $1 AND pv.metodo_pago != 'Crédito' AND v.tipo_transaccion != 'Anulada'
      GROUP BY pv.moneda
    `;
    const ventasData = await db.query(ventasQuery, [fechaApertura]);

    // 1.1 Cobranza de deudas (abonos) por moneda
    const abonosQuery = `
      SELECT pa.moneda, SUM(pa.monto_original) as total
      FROM pagos_abonos pa JOIN abonos_credito a ON pa.abono_id = a.id
      WHERE pa.fecha >= $1
      GROUP BY pa.moneda
    `;
    const abonosData = await db.query(abonosQuery, [fechaApertura]);

    // 2. Calcular total de gastos operacionales desde apertura (en COP).
    //    La reposición de inventario NO es gasto operativo: es compra de stock
    //    (activo) y no debe restarse de la utilidad. Solo sale de la caja.
    const expensesQuery = `SELECT SUM(monto_cop) as total FROM gastos WHERE fecha >= $1 AND categoria != 'REPOSICION'`;
    const expensesData = await db.query(expensesQuery, [fechaApertura]);
    const totalGastos = parseFloat(expensesData[0]?.total || 0);

    // 2.1 Reposición de inventario (compra de stock) desde apertura
    const reposicionQuery = `SELECT SUM(monto_cop) as total FROM gastos WHERE fecha >= $1 AND categoria = 'REPOSICION'`;
    const reposicionData = await db.query(reposicionQuery, [fechaApertura]);
    const totalReposicion = parseFloat(reposicionData[0]?.total || 0);

    // 3. Total esperado por moneda = fondo inicial + ingresos (ventas + abonos) - gastos
    const saldosMoneda = {
      COP: parseFloat(currentSession.fondo_inicial_cop) || 0,
      USD: parseFloat(currentSession.fondo_inicial_usd) || 0,
      VES: 0
    };
    const ventasMoneda = {};
    const abonosMoneda = {};
    ventasData.forEach(r => {
      const m = r.moneda.toUpperCase();
      ventasMoneda[m] = (ventasMoneda[m] || 0) + parseFloat(r.total || 0);
      saldosMoneda[m] = (saldosMoneda[m] || 0) + parseFloat(r.total || 0);
    });
    abonosData.forEach(r => {
      const m = r.moneda.toUpperCase();
      abonosMoneda[m] = (abonosMoneda[m] || 0) + parseFloat(r.total || 0);
      saldosMoneda[m] = (saldosMoneda[m] || 0) + parseFloat(r.total || 0);
    });

    const totalVentasCop = (ventasMoneda.COP || 0) + (ventasMoneda.USD || 0) * tasaUsd + (ventasMoneda.VES || 0) * tasaVes;
    const totalAbonosCop = (abonosMoneda.COP || 0) + (abonosMoneda.USD || 0) * tasaUsd + (abonosMoneda.VES || 0) * tasaVes;
    // El saldo teórico sí descuenta la reposición (salió dinero de la caja para
    // comprar stock), pero la utilidad neta NO la resta.
    const saldoTeorico = (saldosMoneda.COP || 0) + (saldosMoneda.USD || 0) * tasaUsd + (saldosMoneda.VES || 0) * tasaVes - totalGastos - totalReposicion;
    const totalIngresosCop = totalVentasCop + totalAbonosCop;

    // 3.0 Total real de ventas del turno (solo tipo 'Venta', en COP según v.total)
    const totalVentasRealQuery = `
      SELECT COALESCE(SUM(v.total), 0) as total
      FROM ventas v
      WHERE v.fecha >= $1 AND v.tipo_transaccion = 'Venta'
    `;
    const totalVentasRealData = await db.query(totalVentasRealQuery, [fechaApertura]);
    const totalVentasReal = parseFloat(totalVentasRealData[0]?.total || 0);

    // 3.1 Costo de producción de las ventas del turno (solo ventas reales tipo 'Venta')
    const costoProdQuery = `
      SELECT COALESCE(SUM(dv.cantidad * COALESCE(dv.costo_unitario, p.costo_produccion)), 0) as total
      FROM detalle_ventas dv
      JOIN ventas v ON dv.venta_id = v.id
      JOIN productos p ON dv.producto_id = p.id
      WHERE v.fecha >= $1 AND v.tipo_transaccion = 'Venta'
    `;
    const costoProdData = await db.query(costoProdQuery, [fechaApertura]);
    const costoProduccion = parseFloat(costoProdData[0]?.total || 0);

    // 3.2 Costo de cortesías del turno (tipo 'Cortesia')
    const cortesiasQuery = `
      SELECT COALESCE(SUM(dv.cantidad * COALESCE(dv.costo_unitario, p.costo_produccion)), 0) as costo_cortesias
      FROM detalle_ventas dv
      JOIN ventas v ON dv.venta_id = v.id
      JOIN productos p ON dv.producto_id = p.id
      WHERE v.fecha >= $1 AND v.tipo_transaccion = 'Cortesia'
    `;
    const cortesiasData = await db.query(cortesiasQuery, [fechaApertura]);
    const costoCortesias = parseFloat(cortesiasData[0]?.costo_cortesias || 0);

    // 3.3 Utilidad Neta = Total Ventas del Turno - Costo de producción - Gastos operacionales - Costo de Cortesías
    const utilidadNeta = totalVentasReal - costoProduccion - totalGastos - costoCortesias;

    // 4. Diferencia de Caja = Monto Físico Declarado (COP) - Saldo Teórico
    const declarado = parseFloat(monto_declarado_cop) || 0;
    const diferencia = declarado - saldoTeorico;

    // Obtener montos por separado
    const decPagoMovil = parseFloat(declarado_pago_movil) || 0;
    const decZelle = parseFloat(declarado_zelle) || 0;
    const decBinance = parseFloat(declarado_binance) || 0;
    const decPesos = parseFloat(declarado_efectivo_pesos) || 0;
    const decBancolombia = parseFloat(declarado_bancolombia) || 0;

    // Cerrar la sesión
    const now = localNow();
    const sqlUpdate = isPg
      ? `UPDATE sesiones_caja SET fecha_cierre = $1, total_ventas_cop = $2, total_gastos_cop = $3, diferencia_caja = $4, estado = 'Cerrada', declarado_pago_movil = $5, declarado_zelle = $6, declarado_binance = $7, declarado_efectivo_pesos = $8, declarado_bancolombia = $9, costo_produccion = $10, utilidad_neta = $11, declarado_cop = $12 WHERE id = $13 RETURNING *`
      : `UPDATE sesiones_caja SET fecha_cierre = $1, total_ventas_cop = $2, total_gastos_cop = $3, diferencia_caja = $4, estado = 'Cerrada', declarado_pago_movil = $5, declarado_zelle = $6, declarado_binance = $7, declarado_efectivo_pesos = $8, declarado_bancolombia = $9, costo_produccion = $10, utilidad_neta = $11, declarado_cop = $12 WHERE id = $13`;
      
    const result = await db.execute(sqlUpdate, [now, totalIngresosCop, totalGastos, diferencia, decPagoMovil, decZelle, decBinance, decPesos, decBancolombia, costoProduccion, utilidadNeta, declarado, currentSession.id]);
    
    let sessionRes = result;
    if (!isPg) {
      const rows = await db.query('SELECT * FROM sesiones_caja WHERE id = $1', [currentSession.id]);
      sessionRes = rows;
    }

    res.json({
      mensaje: 'Caja cerrada correctamente',
      resumen: {
        fondo_inicial: currentSession.fondo_inicial_cop,
        total_ventas: totalIngresosCop,
        total_ventas_detalle_cop: totalVentasCop,
        total_abonos_cop: totalAbonosCop,
        total_gastos: totalGastos,
        total_reposicion: totalReposicion,
        costo_produccion: costoProduccion,
        costo_cortesias: costoCortesias,
        total_ventas_real_cop: totalVentasReal,
        utilidad_neta: utilidadNeta,
        saldo_teorico: saldoTeorico,
        monto_declarado: declarado,
        declarado_pago_movil: decPagoMovil,
        diferencia: diferencia
      },
      sesion: sessionRes[0]
    });
  } catch (err) {
    console.error('Error al cerrar caja:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

