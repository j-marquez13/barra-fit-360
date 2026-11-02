import * as db from '../db.js';
import { isPostgres, dateExpr, localDate } from '../db.js';
import { obtenerTasas } from '../tasas.js';

/**
 * Controlador de Tesorería — Gestión de Cuentas Bancarias y Transferencias Internas
 */

// GET /api/tesoreria/saldos
export async function getSaldos(req, res) {
  try {
    const saldos = await db.query('SELECT * FROM cuentas_bancarias ORDER BY nombre ASC');
    res.json(saldos);
  } catch (err) {
    console.error('Error al obtener saldos:', err);
    res.status(500).json({ error: 'Error interno al consultar saldos.' });
  }
}

// POST /api/tesoreria/transferir
export async function transferirFondos(req, res) {
  try {
    const { cuenta_origen, cuenta_destino, monto_origen, tasa_cambio, motivo } = req.body;

    if (!cuenta_origen || !cuenta_destino || !monto_origen || !tasa_cambio || !motivo) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para la transferencia.' });
    }

    if (cuenta_origen === cuenta_destino) {
      return res.status(400).json({ error: 'La cuenta de origen y destino no pueden ser la misma.' });
    }

    const montoOrigen = parseFloat(monto_origen);
    const tasa = parseFloat(tasa_cambio);
    if (!Number.isFinite(montoOrigen) || montoOrigen <= 0 || !Number.isFinite(tasa) || tasa <= 0) {
      return res.status(400).json({ error: 'El monto y la tasa de cambio deben ser números mayores a 0.' });
    }
    const monto_destino = montoOrigen * tasa;

    await db.transaction(async (tx) => {
      const cuentas = await tx.query('SELECT nombre FROM cuentas_bancarias WHERE nombre IN ($1, $2)', [cuenta_origen, cuenta_destino]);
      if (cuentas.length !== 2) {
        throw Object.assign(new Error('La cuenta de origen o destino no existe.'), { status: 400 });
      }
      // Registrar el movimiento. Los saldos los actualiza el trigger
      // `trg_tesoreria_transferencia` al insertar; no se debe hacer un UPDATE
      // manual aquí para evitar mover el dinero dos veces.
      await tx.execute(
        `INSERT INTO movimientos_tesoreria (cuenta_origen, cuenta_destino, monto_origen, monto_destino, tasa_cambio, motivo)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cuenta_origen, cuenta_destino, montoOrigen, monto_destino, tasa, motivo]
      );
    });

    res.status(201).json({ mensaje: 'Transferencia realizada con éxito.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error al transferir fondos:', err);
    res.status(500).json({ error: 'Error interno al procesar la transferencia.' });
  }
}

// ============================================
// RESUMEN, MOVIMIENTOS Y AJUSTES
// No hay una tabla "libro": los movimientos de cada cuenta se arman desde su origen
// (pagos de ventas, anulaciones, abonos, gastos y compras, transferencias y ajustes).
// El saldo se ancla al saldo actual de la cuenta, así la lista siempre termina en él.
// ============================================
const TIPOS_AJUSTE = ['ajuste', 'aporte', 'retiro'];
const num = (v) => parseFloat(v) || 0;

function tasaACop(moneda, t) {
  const m = String(moneda || '').toUpperCase();
  if (m === 'COP') return 1;
  if (m === 'USD' || m === 'USDT') return t ? num(t.USD) : 0;
  if (m === 'VES') return t ? num(t.VES) : 0;
  return 0;
}

function primerDiaDelMes() { return localDate().slice(0, 8) + '01'; }

// Fecha y hora de Venezuela para mostrar. PostgreSQL ya guarda hora local (el driver la
// devuelve como Date); SQLite guarda CURRENT_TIMESTAMP en UTC como texto.
function fechaTexto(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(isPostgres() || /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : String(v).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return String(v);
  return d.toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

const SQL_MOVIMIENTOS = `
  SELECT 'venta' AS tipo, pv.metodo_pago AS cuenta, pv.fecha AS fecha, pv.monto_original AS monto, pv.venta_id AS ref, v.notas AS detalle, CAST(NULL AS TEXT) AS otra
    FROM pagos_ventas pv JOIN ventas v ON v.id = pv.venta_id WHERE pv.metodo_pago <> 'Crédito'
  UNION ALL
  SELECT 'anulacion', pv.metodo_pago, COALESCE(v.fecha_anulacion, v.fecha), -pv.monto_original, pv.venta_id, CAST(NULL AS TEXT), CAST(NULL AS TEXT)
    FROM pagos_ventas pv JOIN ventas v ON v.id = pv.venta_id WHERE pv.metodo_pago <> 'Crédito' AND v.tipo_transaccion = 'Anulada'
  UNION ALL
  SELECT 'abono', pa.metodo_pago, pa.fecha, pa.monto_original, pa.abono_id, c.nombre, CAST(NULL AS TEXT)
    FROM pagos_abonos pa JOIN abonos_credito a ON a.id = pa.abono_id LEFT JOIN clientes c ON c.id = a.cliente_id
  UNION ALL
  SELECT CASE WHEN g.categoria = 'REPOSICION' THEN 'compra' ELSE 'gasto' END, g.metodo_pago, g.fecha, -g.monto, g.id, g.descripcion, g.categoria
    FROM gastos g
  UNION ALL
  SELECT 'transferencia_sale', m.cuenta_origen, m.fecha, -m.monto_origen, m.id, m.motivo, m.cuenta_destino FROM movimientos_tesoreria m
  UNION ALL
  SELECT 'transferencia_entra', m.cuenta_destino, m.fecha, m.monto_destino, m.id, m.motivo, m.cuenta_origen FROM movimientos_tesoreria m
  UNION ALL
  SELECT t.tipo, t.cuenta, t.fecha, t.monto, t.id, t.motivo, t.usuario_nombre FROM ajustes_tesoreria t`;

function concepto(m) {
  const d = (m.detalle || '').trim();
  switch (m.tipo) {
    case 'venta': return `Venta #${m.ref}${d && d !== 'Venta desde Terminal POS' ? ' · ' + d : ''}`;
    case 'anulacion': return `Anulación de la venta #${m.ref}`;
    case 'abono': return `Abono${d ? ' de ' + d : ''}`;
    case 'compra': return `Compra: ${d}`;
    case 'gasto': return `Gasto${m.otra ? ' (' + m.otra.toLowerCase() + ')' : ''}: ${d}`;
    case 'transferencia_sale': return `Transferencia a ${m.otra}${d ? ': ' + d : ''}`;
    case 'transferencia_entra': return `Transferencia desde ${m.otra}${d ? ': ' + d : ''}`;
    case 'ajuste': return `Cuadre con la realidad: ${d}${m.otra ? ' (' + m.otra + ')' : ''}`;
    case 'aporte': return `Aporte del dueño: ${d}${m.otra ? ' (' + m.otra + ')' : ''}`;
    case 'retiro': return `Retiro del dueño: ${d}${m.otra ? ' (' + m.otra + ')' : ''}`;
    default: return d || m.tipo;
  }
}

function leerPeriodo(q) {
  const valida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f || '');
  return { desde: valida(q.desde) ? q.desde : primerDiaDelMes(), hasta: valida(q.hasta) ? q.hasta : localDate() };
}

// GET /api/tesoreria/resumen?desde&hasta — saldos, total en COP/USD y entradas/salidas del período
export async function getResumen(req, res) {
  try {
    const { desde, hasta } = leerPeriodo(req.query);
    const cuentas = await db.query('SELECT nombre, moneda, saldo FROM cuentas_bancarias ORDER BY nombre');
    const { hoy, ultima } = await obtenerTasas();
    const tasa = hoy || ultima || null;
    const lista = cuentas.map(c => {
      const saldo = num(c.saldo);
      const factor = tasaACop(c.moneda, tasa);
      return { nombre: c.nombre, moneda: c.moneda, saldo, saldo_cop: factor ? saldo * factor : null, negativo: saldo < -0.005 };
    });
    const totalCop = lista.reduce((s, c) => s + (c.saldo_cop || 0), 0);
    const sinTasa = lista.some(c => c.saldo_cop === null && Math.abs(c.saldo) > 0.005);

    const fecha = dateExpr('fecha');
    const periodo = await db.query(`SELECT cuenta,
        SUM(CASE WHEN monto > 0 THEN monto ELSE 0 END) AS entradas,
        SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END) AS salidas
      FROM (${SQL_MOVIMIENTOS}) mov WHERE ${fecha} >= $1 AND ${fecha} <= $2 GROUP BY cuenta`, [desde, hasta]);
    const dueno = await db.query(`SELECT COALESCE(SUM(monto_cop), 0) AS total, COUNT(*) AS n FROM gastos WHERE metodo_pago = 'Dueño' AND ${dateExpr('fecha')} >= $1 AND ${dateExpr('fecha')} <= $2`, [desde, hasta]);

    return res.json({
      cuentas: lista,
      total_cop: totalCop,
      total_usd: tasa && num(tasa.USD) ? totalCop / num(tasa.USD) : null,
      total_incompleto: sinTasa,
      tasas: tasa ? { USD: num(tasa.USD), VES: num(tasa.VES), fecha: tasa.fecha } : null,
      periodo: { desde, hasta },
      por_cuenta: lista.map(c => {
        const p = periodo.find(x => x.cuenta === c.nombre);
        return { cuenta: c.nombre, moneda: c.moneda, entradas: p ? num(p.entradas) : 0, salidas: p ? num(p.salidas) : 0 };
      }),
      pagado_por_dueno: { total_cop: num(dueno[0].total), compras: Number(dueno[0].n) || 0 }
    });
  } catch (err) {
    console.error('Error en el resumen de tesorería:', err);
    res.status(500).json({ error: 'Error interno al consultar la tesorería.' });
  }
}

// GET /api/tesoreria/movimientos?cuenta&desde&hasta — lista de entradas y salidas
export async function getMovimientos(req, res) {
  try {
    const { desde, hasta } = leerPeriodo(req.query);
    const cuenta = req.query.cuenta ? String(req.query.cuenta) : null;
    const fecha = dateExpr('fecha');
    const params = [desde, hasta];
    let filtroCuenta = '';
    if (cuenta) { params.push(cuenta); filtroCuenta = ` AND cuenta = $${params.length}`; }
    else filtroCuenta = ' AND cuenta IN (SELECT nombre FROM cuentas_bancarias)';
    const filas = await db.query(`SELECT * FROM (${SQL_MOVIMIENTOS}) mov
      WHERE ${fecha} >= $1 AND ${fecha} <= $2${filtroCuenta}
      ORDER BY fecha ASC, tipo ASC, ref ASC LIMIT 2000`, params);

    let movimientos = filas.map(m => ({
      tipo: m.tipo, cuenta: m.cuenta, fecha: fechaTexto(m.fecha), monto: num(m.monto), concepto: concepto(m)
    }));

    // Una sola cuenta: saldo después de cada movimiento, anclado al saldo actual
    let saldoInicial = null, saldoFinal = null, moneda = null;
    if (cuenta) {
      const c = (await db.query('SELECT moneda, saldo FROM cuentas_bancarias WHERE nombre = $1', [cuenta]))[0];
      if (!c) return res.status(404).json({ error: 'Cuenta no encontrada.' });
      moneda = c.moneda;
      const despues = await db.query(`SELECT COALESCE(SUM(monto), 0) AS s FROM (${SQL_MOVIMIENTOS}) mov WHERE cuenta = $1 AND ${fecha} > $2`, [cuenta, hasta]);
      saldoFinal = num(c.saldo) - num(despues[0].s);
      let saldo = saldoFinal;
      for (let i = movimientos.length - 1; i >= 0; i--) {
        movimientos[i].saldo = saldo;
        saldo -= movimientos[i].monto;
      }
      saldoInicial = saldo;
    }
    return res.json({ periodo: { desde, hasta }, cuenta, moneda, saldo_inicial: saldoInicial, saldo_final: saldoFinal, movimientos });
  } catch (err) {
    console.error('Error en los movimientos de tesorería:', err);
    res.status(500).json({ error: 'Error interno al consultar los movimientos.' });
  }
}

// POST /api/tesoreria/ajuste (admin) { cuenta, tipo: 'ajuste'|'aporte'|'retiro', saldo_real | monto, motivo }
//  - ajuste: "en la cuenta hay de verdad X" -> registra la diferencia y deja el saldo en X
//  - aporte: el dueño mete dinero; retiro: el dueño saca dinero (no son gastos ni ventas)
export async function registrarAjuste(req, res) {
  const { cuenta, tipo } = req.body || {};
  const motivo = String((req.body && req.body.motivo) || '').trim();
  if (!TIPOS_AJUSTE.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' });
  if (!motivo) return res.status(400).json({ error: 'Escribe el motivo (para saber después por qué se hizo).' });
  try {
    const r = await db.transaction(async (tx) => {
      const c = (await tx.query('SELECT nombre, moneda, saldo FROM cuentas_bancarias WHERE nombre = $1', [cuenta]))[0];
      if (!c) throw Object.assign(new Error('La cuenta no existe.'), { status: 400 });
      const antes = num(c.saldo);
      let delta;
      if (tipo === 'ajuste') {
        const real = parseFloat(req.body.saldo_real);
        if (!Number.isFinite(real)) throw Object.assign(new Error('Escribe cuánto hay de verdad en la cuenta.'), { status: 400 });
        delta = Math.round((real - antes) * 100) / 100;
        if (Math.abs(delta) < 0.005) throw Object.assign(new Error('La cuenta ya tiene ese saldo: no hay nada que ajustar.'), { status: 400 });
      } else {
        const monto = parseFloat(req.body.monto);
        if (!(monto > 0)) throw Object.assign(new Error('El monto debe ser mayor a 0.'), { status: 400 });
        delta = tipo === 'aporte' ? monto : -monto;
      }
      await tx.execute(
        'INSERT INTO ajustes_tesoreria (cuenta, tipo, monto, saldo_antes, saldo_despues, motivo, usuario_id, usuario_nombre) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [c.nombre, tipo, delta, antes, antes + delta, motivo.slice(0, 300), req.usuario?.usuario_id || null, req.usuario?.nombre || null]);
      await tx.execute('UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE nombre = $2', [delta, c.nombre]);
      return { delta, saldo_nuevo: antes + delta, moneda: c.moneda };
    });
    return res.status(201).json({ ok: true, ...r });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error al registrar el ajuste de tesorería:', err);
    res.status(500).json({ error: 'Error interno al registrar el ajuste.' });
  }
}
