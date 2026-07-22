import * as db from '../db.js';
import { localNow } from '../db.js';

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

    // Obtener desglose de Ventas por Moneda y Método de Pago
    const ventasBreakdown = await db.query(`
      SELECT moneda, metodo_pago, SUM(monto_original) as total_original, SUM(monto_base) as total_base
      FROM pagos_ventas 
      WHERE fecha >= $1 
      GROUP BY moneda, metodo_pago
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
    const turnoValido = (turno === 'Tarde') ? 'Tarde' : 'Mañana';
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

// POST /api/caja/cerrar
export async function cerrarCaja(req, res) {
  try {
    const { 
      monto_declarado_cop,
      declarado_efectivo_bs,
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

    // 1. Calcular total de ventas desde la fecha de apertura (excluyendo el vuelto)
    const salesQuery = isPg 
      ? `SELECT COALESCE(SUM(total), 0) as total FROM ventas WHERE fecha >= $1`
      : `SELECT COALESCE(SUM(total), 0) as total FROM ventas WHERE fecha >= $1`;
    const salesData = await db.query(salesQuery, [fechaApertura]);
    const totalVentas = parseFloat(salesData[0]?.total || 0);

    // Obtener total de pagos a crédito (no entran a la caja física)
    const creditQuery = isPg
      ? `SELECT COALESCE(SUM(monto_base), 0) as total FROM pagos_ventas WHERE fecha >= $1 AND metodo_pago = 'Crédito'`
      : `SELECT COALESCE(SUM(monto_base), 0) as total FROM pagos_ventas WHERE fecha >= $1 AND metodo_pago = 'Crédito'`;
    const creditData = await db.query(creditQuery, [fechaApertura]);
    const totalCredito = parseFloat(creditData[0]?.total || 0);

    const ingresosRealesCaja = totalVentas - totalCredito;

    // 2. Calcular total de gastos operacionales desde apertura
    const expensesQuery = isPg
      ? `SELECT SUM(monto_cop) as total FROM gastos WHERE fecha >= $1`
      : `SELECT SUM(monto_cop) as total FROM gastos WHERE fecha >= $1`;
    const expensesData = await db.query(expensesQuery, [fechaApertura]);
    const totalGastos = parseFloat(expensesData[0]?.total || 0);

    // 3. Diferencia de Caja = Monto Físico Declarado - (Fondo Inicial + VentasReales - Gastos)
    const saldoTeorico = parseFloat(currentSession.fondo_inicial_cop) + ingresosRealesCaja - totalGastos;
    const declarado = parseFloat(monto_declarado_cop) || 0;
    const diferencia = declarado - saldoTeorico;

    // Obtener montos por separado
    const decBs = parseFloat(declarado_efectivo_bs) || 0;
    const decZelle = parseFloat(declarado_zelle) || 0;
    const decBinance = parseFloat(declarado_binance) || 0;
    const decPesos = parseFloat(declarado_efectivo_pesos) || 0;
    const decBancolombia = parseFloat(declarado_bancolombia) || 0;

    // Cerrar la sesión
    const now = localNow();
    const sqlUpdate = isPg
      ? `UPDATE sesiones_caja SET fecha_cierre = $1, total_ventas_cop = $2, total_gastos_cop = $3, diferencia_caja = $4, estado = 'Cerrada', declarado_efectivo_bs = $5, declarado_zelle = $6, declarado_binance = $7, declarado_efectivo_pesos = $8, declarado_bancolombia = $9 WHERE id = $10 RETURNING *`
      : `UPDATE sesiones_caja SET fecha_cierre = $1, total_ventas_cop = $2, total_gastos_cop = $3, diferencia_caja = $4, estado = 'Cerrada', declarado_efectivo_bs = $5, declarado_zelle = $6, declarado_binance = $7, declarado_efectivo_pesos = $8, declarado_bancolombia = $9 WHERE id = $10`;
      
    const result = await db.execute(sqlUpdate, [now, totalVentas, totalGastos, diferencia, decBs, decZelle, decBinance, decPesos, decBancolombia, currentSession.id]);
    
    let sessionRes = result;
    if (!isPg) {
      const rows = await db.query('SELECT * FROM sesiones_caja WHERE id = $1', [currentSession.id]);
      sessionRes = rows;
    }

    res.json({
      mensaje: 'Caja cerrada correctamente',
      resumen: {
        fondo_inicial: currentSession.fondo_inicial_cop,
        total_ventas: totalVentas,
        total_gastos: totalGastos,
        saldo_teorico: saldoTeorico,
        monto_declarado: declarado,
        diferencia: diferencia
      },
      sesion: sessionRes[0]
    });
  } catch (err) {
    console.error('Error al cerrar caja:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

