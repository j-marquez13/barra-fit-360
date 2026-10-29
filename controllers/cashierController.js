import * as db from '../db.js';
import { localNow, isPostgres, localDate, dateExpr } from '../db.js';
import { obtenerTasas } from '../tasas.js';

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
    const { fondo_inicial_cop, fondo_inicial_usd, turno } = req.body;

    // La caja se abre siempre a nombre del usuario autenticado (no del que venga en el body),
    // para que nadie pueda abrir un turno a nombre de otro cajero.
    const usuario_id = req.usuario && req.usuario.usuario_id;
    if (!usuario_id) {
      return res.status(401).json({ error: 'No autorizado. Inicia sesión nuevamente.' });
    }

    // Verificar si el usuario existe
    const usr = await db.query('SELECT id, nombre, permisos FROM usuarios WHERE id = $1', [usuario_id]);
    if (usr.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const fondo = Math.max(0, parseFloat(fondo_inicial_cop) || 0);
    const fondoUsd = Math.max(0, parseFloat(fondo_inicial_usd) || 0);
    const turnoValido = (turno === 'Tarde') ? 'Tarde' : (turno === 'Completo' ? 'Completo' : 'Mañana');
    const cajero = usr[0].nombre || 'Cajero';

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
        COALESCE(SUM(total_ventas_credito_cop), 0) as total_ventas_credito_cop,
        COALESCE(SUM(total_abonos_cop), 0) as total_abonos_cop,
        COALESCE(SUM(total_gastos_cop), 0) as total_gastos_cop,
        COALESCE(SUM(costo_produccion), 0) as costo_produccion,
        COALESCE(SUM(utilidad_neta), 0) as utilidad_neta,
        COALESCE(SUM(declarado_cop), 0) as declarado_cop,
        COALESCE(SUM(declarado_pago_movil), 0) as declarado_pago_movil,
        COALESCE(SUM(declarado_zelle), 0) as declarado_zelle,
        COALESCE(SUM(declarado_binance), 0) as declarado_binance,
        COALESCE(SUM(declarado_efectivo_pesos), 0) as declarado_efectivo_pesos,
        COALESCE(SUM(declarado_bancolombia), 0) as declarado_bancolombia,
        COALESCE(SUM(declarado_efectivo_usd), 0) as declarado_efectivo_usd,
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
      total_ventas_credito_cop: parseFloat(r.total_ventas_credito_cop || 0),
      total_abonos_cop: parseFloat(r.total_abonos_cop || 0),
      total_ventas_contado_cop: Math.max(0, parseFloat(r.total_ventas_cop || 0) - parseFloat(r.total_ventas_credito_cop || 0)),
      total_gastos_cop: parseFloat(r.total_gastos_cop || 0),
      costo_produccion: parseFloat(r.costo_produccion || 0),
      reposicion: reposicionPorFecha[r.fecha] || 0,
      utilidad_neta: parseFloat(r.utilidad_neta || 0),
      declarado_cop: parseFloat(r.declarado_cop || 0),
      declarado_pago_movil: parseFloat(r.declarado_pago_movil || 0),
      declarado_zelle: parseFloat(r.declarado_zelle || 0),
      declarado_binance: parseFloat(r.declarado_binance || 0),
      declarado_efectivo_pesos: parseFloat(r.declarado_efectivo_pesos || 0),
      declarado_bancolombia: parseFloat(r.declarado_bancolombia || 0),
      declarado_efectivo_usd: parseFloat(r.declarado_efectivo_usd || 0),
      diferencia_caja: parseFloat(r.diferencia_caja || 0),
      turnos: []
    }));

    // Turnos de cada día, para poder abrir el ticket de cada uno por separado
    const turnos = await db.query(`
      SELECT id, ${fechaExpr} as fecha, turno, nombre_cajero, fecha_apertura, fecha_cierre,
             total_ventas_cop, total_ventas_credito_cop, total_abonos_cop, declarado_cop, diferencia_caja
      FROM sesiones_caja
      ${where}
      ORDER BY fecha_apertura ASC
    `, params);
    const porFecha = new Map(cierres.map(c => [c.fecha, c]));
    for (const t of turnos) {
      const dia = porFecha.get(t.fecha);
      if (!dia) continue;
      dia.turnos.push({
        id: t.id,
        turno: t.turno,
        cajero: t.nombre_cajero || 'Cajero',
        apertura: t.fecha_apertura,
        cierre: t.fecha_cierre,
        hora_apertura: horaLocal(t.fecha_apertura),
        hora_cierre: horaLocal(t.fecha_cierre),
        total_ventas_cop: parseFloat(t.total_ventas_cop || 0),
        diferencia_caja: parseFloat(t.diferencia_caja || 0)
      });
    }

    return res.json({ cierres });
  } catch (error) {
    console.error('Error al listar cierres admin:', error);
    return res.status(500).json({ error: 'Error al obtener el histórico de cierres.', detalle: error.message });
  }
}

// Hora local de Venezuela (HH:MM) de una fecha de sesiones_caja, venga como venga:
// - Date (PostgreSQL): se formatea en America/Caracas.
// - Texto con 'T' (localNow, ya en hora local): se toma la hora tal cual.
// - Texto 'YYYY-MM-DD HH:MM:SS' (CURRENT_TIMESTAMP de SQLite, en UTC): se convierte a local.
function horaLocal(v) {
  if (!v) return null;
  const enCaracas = (d) => d.toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: false });
  if (v instanceof Date) return enCaracas(v);
  const s = String(v);
  if (s.includes('T')) return s.slice(11, 16);
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? s.slice(11, 16) : enCaracas(d);
}

// GET /api/admin/cierres/turno/:id — Ticket de un turno ya cerrado (solo administrador).
// Lo guardado al cerrar (fondo, declarado, diferencias, costo, utilidad) + el desglose por
// método de pago, reconstruido con los pagos registrados entre la apertura y el cierre.
export async function ticketTurnoAdmin(req, res) {
  try {
    const rows = await db.query("SELECT * FROM sesiones_caja WHERE id = $1 AND estado = 'Cerrada'", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Turno no encontrado o aún abierto.' });
    const s = rows[0];

    // fecha_cierre se guarda en hora local (localNow). En PostgreSQL los pagos también están en
    // hora local; en SQLite están en UTC, así que el límite se pasa a UTC (+4 h).
    const hastaExpr = isPostgres()
      ? '$2::timestamp'
      : "datetime(replace(substr($2, 1, 19), 'T', ' '), '+4 hours')";
    const params = [s.fecha_apertura, s.fecha_cierre];

    // Tasa con la que se cerró el turno (guardada desde esta versión). Con ella el ticket
    // sale idéntico al del cierre; en turnos más viejos se usa la tasa de cada pago.
    const tasaUsd = parseFloat(s.tasa_usd) || null;
    const tasaVes = parseFloat(s.tasa_ves) || null;
    const tasaDe = (moneda) => (moneda === 'USD' ? tasaUsd : moneda === 'VES' ? tasaVes : 1);

    const detalle = async (sqlTexto) => {
      const filas = await db.query(sqlTexto, params);
      const out = {};
      let totalCop = 0;
      for (const r of filas) {
        const moneda = (r.moneda || '').toUpperCase();
        if (!out[moneda]) out[moneda] = {};
        const monto = parseFloat(r.total_original || 0);
        const tasa = tasaDe(moneda);
        const cop = tasa ? monto * tasa : parseFloat(r.total_base || 0);
        out[moneda][r.metodo_pago] = { monto, total_cop: cop };
        totalCop += cop;
      }
      return { out, totalCop };
    };

    // Ventas registradas y anuladas en el turno (control)
    const [conteo] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo_transaccion != 'Anulada' THEN 1 ELSE 0 END), 0) AS ventas,
        COALESCE(SUM(CASE WHEN tipo_transaccion = 'Anulada' THEN 1 ELSE 0 END), 0) AS anuladas
      FROM ventas WHERE fecha >= $1 AND fecha <= ${hastaExpr}
    `, params);

    const ventas = await detalle(`
      SELECT pv.moneda, pv.metodo_pago, SUM(pv.monto_original) AS total_original, SUM(pv.monto_base) AS total_base
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE pv.fecha >= $1 AND pv.fecha <= ${hastaExpr}
        AND pv.metodo_pago != 'Crédito' AND v.tipo_transaccion != 'Anulada'
      GROUP BY pv.moneda, pv.metodo_pago
    `);
    const abonos = await detalle(`
      SELECT pa.moneda, pa.metodo_pago, SUM(pa.monto_original) AS total_original, SUM(pa.monto_base) AS total_base
      FROM pagos_abonos pa
      WHERE pa.fecha >= $1 AND pa.fecha <= ${hastaExpr}
      GROUP BY pa.moneda, pa.metodo_pago
    `);

    const num = (v) => (v === null || v === undefined ? null : parseFloat(v));
    return res.json({
      turno: {
        id: s.id,
        turno: s.turno,
        cajero: s.nombre_cajero || 'Cajero',
        apertura: s.fecha_apertura,
        cierre: s.fecha_cierre,
        hora_apertura: horaLocal(s.fecha_apertura),
        hora_cierre: horaLocal(s.fecha_cierre),
        fondo_inicial_cop: num(s.fondo_inicial_cop) || 0,
        fondo_inicial_usd: num(s.fondo_inicial_usd) || 0,
        fondo_completo: [1, true, '1', 't'].includes(s.fondo_completo)
      },
      ventas_detalle: ventas.out,
      abonos_detalle: abonos.out,
      total_ventas_contado_cop: ventas.totalCop,
      total_abonos_cop: abonos.totalCop,
      total_ventas_credito_cop: num(s.total_ventas_credito_cop) || 0,
      total_ventas_real_cop: num(s.total_ventas_cop) || 0,
      costo_produccion: num(s.costo_produccion) || 0,
      utilidad_neta: num(s.utilidad_neta) || 0,
      declarado_cop: num(s.declarado_cop) || 0,
      declarado_ventas_cop: num(s.declarado_ventas_cop),
      declarado_abonos_cop: num(s.declarado_abonos_cop),
      diferencia_ventas_cop: num(s.diferencia_ventas_cop),
      diferencia_abonos_cop: num(s.diferencia_abonos_cop),
      diferencia_caja: num(s.diferencia_caja) || 0,
      // Lo que el cajero contó por método (ventas + abonos, en la moneda de cada método)
      declarado_pago_movil: num(s.declarado_pago_movil) || 0,
      declarado_zelle: num(s.declarado_zelle) || 0,
      declarado_binance: num(s.declarado_binance) || 0,
      declarado_efectivo_usd: num(s.declarado_efectivo_usd) || 0,
      declarado_efectivo_pesos: num(s.declarado_efectivo_pesos) || 0,
      declarado_bancolombia: num(s.declarado_bancolombia) || 0,
      tasas: tasaUsd || tasaVes ? { USD: tasaUsd, VES: tasaVes } : null,
      cantidad_ventas: parseInt(conteo?.ventas || 0, 10),
      cantidad_anuladas: parseInt(conteo?.anuladas || 0, 10)
    });
  } catch (error) {
    console.error('Error al obtener ticket del turno:', error);
    return res.status(500).json({ error: 'Error al obtener el ticket del turno.' });
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
        COALESCE(SUM(total_ventas_credito_cop), 0) as total_ventas_credito_cop,
        COALESCE(SUM(total_abonos_cop), 0) as total_abonos_cop,
        COALESCE(SUM(total_gastos_cop), 0) as total_gastos_cop,
        COALESCE(SUM(costo_produccion), 0) as costo_produccion,
        COALESCE(SUM(utilidad_neta), 0) as utilidad_neta,
        COALESCE(SUM(declarado_cop), 0) as declarado_cop,
        COALESCE(SUM(declarado_pago_movil), 0) as declarado_pago_movil,
        COALESCE(SUM(declarado_zelle), 0) as declarado_zelle,
        COALESCE(SUM(declarado_binance), 0) as declarado_binance,
        COALESCE(SUM(declarado_efectivo_pesos), 0) as declarado_efectivo_pesos,
        COALESCE(SUM(declarado_bancolombia), 0) as declarado_bancolombia,
        COALESCE(SUM(declarado_efectivo_usd), 0) as declarado_efectivo_usd,
        COALESCE(SUM(diferencia_caja), 0) as diferencia_caja,
        COALESCE(SUM(fondo_inicial_cop), 0) as fondo_inicial_cop,
        COALESCE(SUM(fondo_inicial_usd), 0) as fondo_inicial_usd,
        COALESCE(SUM(CASE WHEN fondo_completo = 1 THEN 1 ELSE 0 END), 0) as turnos_fondo_completo,
        COUNT(declarado_ventas_cop) as turnos_con_desglose,
        COALESCE(SUM(declarado_ventas_cop), 0) as declarado_ventas_cop,
        COALESCE(SUM(declarado_abonos_cop), 0) as declarado_abonos_cop,
        COALESCE(SUM(diferencia_ventas_cop), 0) as diferencia_ventas_cop,
        COALESCE(SUM(diferencia_abonos_cop), 0) as diferencia_abonos_cop
      FROM sesiones_caja
      WHERE ${dateExpr('fecha_apertura')} = $1 AND estado = 'Cerrada'
    `, [fecha]);

    // Desglose por método de pago (ventas de contado y abonos) del día
    const ventasDetalleQuery = `
      SELECT pv.moneda, pv.metodo_pago,
             SUM(pv.monto_original) as total_original,
             SUM(pv.monto_base) as total_base
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE ${dateExpr('pv.fecha')} = $1 AND pv.metodo_pago != 'Crédito' AND v.tipo_transaccion != 'Anulada'
      GROUP BY pv.moneda, pv.metodo_pago
    `;
    const ventasDetalleData = await db.query(ventasDetalleQuery, [fecha]);

    const abonosDetalleQuery = `
      SELECT pa.moneda, pa.metodo_pago,
             SUM(pa.monto_original) as total_original,
             SUM(pa.monto_base) as total_base
      FROM pagos_abonos pa
      WHERE ${dateExpr('pa.fecha')} = $1
      GROUP BY pa.moneda, pa.metodo_pago
    `;
    const abonosDetalleData = await db.query(abonosDetalleQuery, [fecha]);

    const ventasDetalle = {};
    const abonosDetalle = {};
    ventasDetalleData.forEach(r => {
      const moneda = (r.moneda || '').toUpperCase();
      if (!ventasDetalle[moneda]) ventasDetalle[moneda] = {};
      ventasDetalle[moneda][r.metodo_pago] = {
        monto: parseFloat(r.total_original || 0),
        total_cop: parseFloat(r.total_base || 0)
      };
    });
    abonosDetalleData.forEach(r => {
      const moneda = (r.moneda || '').toUpperCase();
      if (!abonosDetalle[moneda]) abonosDetalle[moneda] = {};
      abonosDetalle[moneda][r.metodo_pago] = {
        monto: parseFloat(r.total_original || 0),
        total_cop: parseFloat(r.total_base || 0)
      };
    });

    const r = rows[0] || {};
    return res.json({
      fecha,
      resumen: {
        total_turnos: parseInt(r.total_turnos || 0, 10),
        total_ventas_cop: parseFloat(r.total_ventas_cop || 0),
        total_ventas_credito_cop: parseFloat(r.total_ventas_credito_cop || 0),
        total_abonos_cop: parseFloat(r.total_abonos_cop || 0),
        total_ventas_contado_cop: Math.max(0, parseFloat(r.total_ventas_cop || 0) - parseFloat(r.total_ventas_credito_cop || 0)),
        total_gastos_cop: parseFloat(r.total_gastos_cop || 0),
        costo_produccion: parseFloat(r.costo_produccion || 0),
        utilidad_neta: parseFloat(r.utilidad_neta || 0),
        declarado_cop: parseFloat(r.declarado_cop || 0),
        declarado_pago_movil: parseFloat(r.declarado_pago_movil || 0),
        declarado_zelle: parseFloat(r.declarado_zelle || 0),
        declarado_binance: parseFloat(r.declarado_binance || 0),
        declarado_efectivo_pesos: parseFloat(r.declarado_efectivo_pesos || 0),
        declarado_bancolombia: parseFloat(r.declarado_bancolombia || 0),
        declarado_efectivo_usd: parseFloat(r.declarado_efectivo_usd || 0),
        diferencia_caja: parseFloat(r.diferencia_caja || 0),
        fondo_inicial_cop: parseFloat(r.fondo_inicial_cop || 0),
        fondo_inicial_usd: parseFloat(r.fondo_inicial_usd || 0),
        turnos_fondo_completo: parseInt(r.turnos_fondo_completo || 0, 10),
        turnos_con_desglose: parseInt(r.turnos_con_desglose || 0, 10),
        declarado_ventas_cop: parseFloat(r.declarado_ventas_cop || 0),
        declarado_abonos_cop: parseFloat(r.declarado_abonos_cop || 0),
        diferencia_ventas_cop: parseFloat(r.diferencia_ventas_cop || 0),
        diferencia_abonos_cop: parseFloat(r.diferencia_abonos_cop || 0),
        ventas_detalle: ventasDetalle,
        abonos_detalle: abonosDetalle
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
      fondo_declarado_cop,
      fondo_declarado_usd,
      fondo_completo,
      declarado_pago_movil,
      declarado_zelle,
      declarado_binance,
      declarado_efectivo_pesos,
      declarado_bancolombia,
      declarado_efectivo_usd 
    } = req.body; // Lo que cuenta el cajero físicamente

    const session = await db.query('SELECT * FROM sesiones_caja WHERE fecha_cierre IS NULL ORDER BY id DESC LIMIT 1');
    if (session.length === 0) {
      return res.status(400).json({ error: 'No hay ninguna caja abierta' });
    }

    const currentSession = session[0];
    const fechaApertura = currentSession.fecha_apertura;
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);

    // Tasas para convertir a COP: la tasa del día del servidor (o la última fijada).
    // Solo si nunca se ha fijado ninguna se usa la que envía la pantalla.
    const { hoy, ultima } = await obtenerTasas();
    const tasaRef = hoy || ultima;
    const tasasCliente = req.body.tasas || {};
    const tasaUsd = tasaRef ? tasaRef.USD : (parseFloat(tasasCliente.USD) || 4000.00);
    const tasaVes = tasaRef ? tasaRef.VES : (parseFloat(tasasCliente.VES) || 100.00);

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

    // 1.2 Ventas a crédito (cuentas por cobrar) del turno, en COP
    const creditoTurnoQuery = `
      SELECT COALESCE(SUM(pv.monto_base), 0) as total
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE pv.fecha >= $1 AND pv.metodo_pago = 'Crédito' AND v.tipo_transaccion != 'Anulada'
    `;
    const creditoTurnoData = await db.query(creditoTurnoQuery, [fechaApertura]);
    const totalVentasCreditoCop = parseFloat(creditoTurnoData[0]?.total || 0);

    // 1.3 Desglose por método de pago (para el ticket de cierre: ventas de contado + abonos)
    const ventasDetalleQuery = `
      SELECT pv.moneda, pv.metodo_pago, SUM(pv.monto_original) as total
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE pv.fecha >= $1 AND pv.metodo_pago != 'Crédito' AND v.tipo_transaccion != 'Anulada'
      GROUP BY pv.moneda, pv.metodo_pago
    `;
    const ventasDetalleData = await db.query(ventasDetalleQuery, [fechaApertura]);

    const abonosDetalleQuery = `
      SELECT pa.moneda, pa.metodo_pago, SUM(pa.monto_original) as total
      FROM pagos_abonos pa JOIN abonos_credito a ON pa.abono_id = a.id
      WHERE pa.fecha >= $1
      GROUP BY pa.moneda, pa.metodo_pago
    `;
    const abonosDetalleData = await db.query(abonosDetalleQuery, [fechaApertura]);

    const ventasDetalle = {};
    const abonosDetalle = {};
    ventasDetalleData.forEach(r => {
      const moneda = (r.moneda || '').toUpperCase();
      if (!ventasDetalle[moneda]) ventasDetalle[moneda] = {};
      ventasDetalle[moneda][r.metodo_pago] = parseFloat(r.total || 0);
    });
    abonosDetalleData.forEach(r => {
      const moneda = (r.moneda || '').toUpperCase();
      if (!abonosDetalle[moneda]) abonosDetalle[moneda] = {};
      abonosDetalle[moneda][r.metodo_pago] = parseFloat(r.total || 0);
    });

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

    // 3. Total esperado por moneda = ventas + abonos (SIN fondo: se verifica aparte)
    const saldosMoneda = {
      COP: 0,
      USD: 0,
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
    // Los gastos, la reposición de stock y las mermas salen de la TESORERÍA general:
    // NO restan del efectivo teórico de la caja ni de la diferencia de caja.
    const saldoTeorico = (saldosMoneda.COP || 0) + (saldosMoneda.USD || 0) * tasaUsd + (saldosMoneda.VES || 0) * tasaVes;
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

    // 3.2.1 Mermas que el usuario decidió descontar de la ganancia (desde apertura)
    const mermaFlag = isPg ? 'TRUE' : '1';
    const mermasQuery = `
      SELECT COALESCE(SUM(COALESCE(m.costo, m.cantidad * i.costo_unitario)), 0) as total_mermas
      FROM mermas m JOIN insumos i ON m.insumo_id = i.id
      WHERE m.fecha >= $1 AND m.descontar_ganancia = ${mermaFlag}
    `;
    const mermasData = await db.query(mermasQuery, [fechaApertura]);
    const totalMermas = parseFloat(mermasData[0]?.total_mermas || 0);

    // 3.3 Utilidad Neta = Total Ventas del Turno - Costo de producción de lo vendido.
    // Las cortesías ya entran en el costo. Gastos, reposición y mermas se gestionan
    // desde Tesorería y NO restan de la utilidad de ventas.
    const utilidadNeta = totalVentasReal - costoProduccion;

    // 4. Diferencia de Caja = Monto Físico Declarado (COP) - Saldo Teórico
    const declarado = parseFloat(monto_declarado_cop) || 0;
    const diferencia = declarado - saldoTeorico;

    // Obtener montos por separado
    const decPagoMovil = parseFloat(declarado_pago_movil) || 0;
    const decZelle = parseFloat(declarado_zelle) || 0;
    const decBinance = parseFloat(declarado_binance) || 0;
    const decPesos = parseFloat(declarado_efectivo_pesos) || 0;
    const decBancolombia = parseFloat(declarado_bancolombia) || 0;
    const decUsd = parseFloat(declarado_efectivo_usd) || 0;
    const decFondoPesos = parseFloat(fondo_declarado_cop) || 0;
    const decFondoUsd = parseFloat(fondo_declarado_usd) || 0;
    const fondoCompleto = fondo_completo ? 1 : 0;

    // Desglose del declarado entre ventas y abonos (lo calcula el frontend con las mismas
    // tasas). Se guarda para que el cierre consolidado del día muestre el mismo arqueo
    // que el ticket del turno.
    const decVentasNum = parseFloat(req.body.declarado_ventas_cop);
    const decAbonosNum = parseFloat(req.body.declarado_abonos_cop);
    const hayDesglose = Number.isFinite(decVentasNum) && Number.isFinite(decAbonosNum);
    const declaradoVentasCop = hayDesglose ? decVentasNum : null;
    const declaradoAbonosCop = hayDesglose ? decAbonosNum : null;
    const diferenciaVentasCop = hayDesglose ? decVentasNum - totalVentasCop : null;
    const diferenciaAbonosCop = hayDesglose ? decAbonosNum - totalAbonosCop : null;

    // Cerrar la sesión
    const now = localNow();
    const sqlUpdate = `UPDATE sesiones_caja SET fecha_cierre = $1, total_ventas_cop = $2, total_gastos_cop = $3, diferencia_caja = $4, estado = 'Cerrada', declarado_pago_movil = $5, declarado_zelle = $6, declarado_binance = $7, declarado_efectivo_pesos = $8, declarado_bancolombia = $9, declarado_efectivo_usd = $10, costo_produccion = $11, utilidad_neta = $12, declarado_cop = $13, total_ventas_credito_cop = $14, fondo_declarado_cop = $15, fondo_declarado_usd = $16, fondo_completo = $17, total_abonos_cop = $18, declarado_ventas_cop = $19, declarado_abonos_cop = $20, diferencia_ventas_cop = $21, diferencia_abonos_cop = $22, tasa_usd = $23, tasa_ves = $24 WHERE id = $25${isPg ? ' RETURNING *' : ''}`;

    const result = await db.execute(sqlUpdate, [now, totalVentasReal, totalGastos, diferencia, decPagoMovil, decZelle, decBinance, decPesos, decBancolombia, decUsd, costoProduccion, utilidadNeta, declarado, totalVentasCreditoCop, decFondoPesos, decFondoUsd, fondoCompleto, totalAbonosCop, declaradoVentasCop, declaradoAbonosCop, diferenciaVentasCop, diferenciaAbonosCop, tasaUsd, tasaVes, currentSession.id]);
    
    let sessionRes = result;
    if (!isPg) {
      const rows = await db.query('SELECT * FROM sesiones_caja WHERE id = $1', [currentSession.id]);
      sessionRes = rows;
    }

    res.json({
      mensaje: 'Caja cerrada correctamente',
      resumen: {
        fondo_inicial: currentSession.fondo_inicial_cop,
        fondo_inicial_usd: currentSession.fondo_inicial_usd,
        fondo_declarado_cop: decFondoPesos,
        fondo_declarado_usd: decFondoUsd,
        fondo_completo: !!fondoCompleto,
        total_ventas: totalIngresosCop,
        total_ventas_detalle_cop: totalVentasCop,
        total_ventas_contado_cop: totalVentasCop,
        total_ventas_credito_cop: totalVentasCreditoCop,
        total_abonos_cop: totalAbonosCop,
        total_gastos: totalGastos,
        total_reposicion: totalReposicion,
        costo_produccion: costoProduccion,
        costo_cortesias: costoCortesias,
        mermas_descontadas: totalMermas,
        total_ventas_real_cop: totalVentasReal,
        utilidad_neta: utilidadNeta,
        saldo_teorico: saldoTeorico,
        monto_declarado: declarado,
        declarado_pago_movil: decPagoMovil,
        declarado_zelle: decZelle,
        declarado_binance: decBinance,
        declarado_efectivo_pesos: decPesos,
        declarado_bancolombia: decBancolombia,
        declarado_efectivo_usd: decUsd,
        declarado_ventas_cop: declaradoVentasCop,
        declarado_abonos_cop: declaradoAbonosCop,
        diferencia_ventas_cop: diferenciaVentasCop,
        diferencia_abonos_cop: diferenciaAbonosCop,
        tasas: { USD: tasaUsd, VES: tasaVes },
        ventas_detalle: ventasDetalle,
        abonos_detalle: abonosDetalle,
        diferencia: diferencia
      },
      sesion: sessionRes[0]
    });
  } catch (err) {
    console.error('Error al cerrar caja:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

