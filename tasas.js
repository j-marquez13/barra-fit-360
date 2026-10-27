import * as db from './db.js';
import { localDate, localNow } from './db.js';

/**
 * Tasa de cambio del día (COP por USD y COP por Bs).
 * La fija SOLO el administrador y queda guardada en el servidor con historial
 * (quién y cuándo). Las ventas y abonos usan siempre esta tasa: la que envía la
 * pantalla del POS ya no se acepta como válida.
 */

function filaATasa(f) {
  if (!f) return null;
  return {
    fecha: String(f.fecha).slice(0, 10),
    USD: parseFloat(f.usd),
    VES: parseFloat(f.ves),
    fijada_por: f.usuario_nombre || null,
    fijada_en: f.creado_en || null
  };
}

// Devuelve { fecha (hoy), hoy: tasa de hoy | null, ultima: última tasa guardada | null }
export async function obtenerTasas() {
  const rows = await db.query('SELECT fecha, usd, ves, usuario_nombre, creado_en FROM tasas_cambio ORDER BY id DESC LIMIT 1');
  const ultima = filaATasa(rows[0]);
  const fecha = localDate();
  return { fecha, hoy: ultima && ultima.fecha === fecha ? ultima : null, ultima };
}

export async function historialTasas(limite = 30) {
  const rows = await db.query('SELECT fecha, usd, ves, usuario_nombre, creado_en FROM tasas_cambio ORDER BY id DESC LIMIT $1', [limite]);
  return rows.map(filaATasa);
}

export async function fijarTasa({ USD, VES }, usuario) {
  const usd = parseFloat(USD);
  const ves = parseFloat(VES);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(ves) || ves <= 0) {
    throw Object.assign(new Error('Las tasas USD y VES deben ser números mayores a 0.'), { status: 400 });
  }
  await db.execute(
    'INSERT INTO tasas_cambio (fecha, usd, ves, usuario_id, usuario_nombre, creado_en) VALUES ($1, $2, $3, $4, $5, $6)',
    [localDate(), usd, ves, usuario?.usuario_id || null, usuario?.nombre || null, localNow()]
  );
  return obtenerTasas();
}

/**
 * Tasas a usar en una venta o abono.
 * - Si hay pagos en USD o VES y el admin no ha fijado la tasa de HOY → error 400
 *   (sin tasa del día solo se cobra en pesos).
 * - Si la pantalla envió una tasa distinta a la del servidor (otra pestaña con la tasa
 *   vieja, o manipulación) → error 409 para que el cajero revise el cobro.
 * Devuelve { USD, VES } del servidor (las de hoy, o la última conocida si solo hay COP).
 */
export async function resolverTasas(pagos, tasasCliente) {
  const { hoy, ultima } = await obtenerTasas();
  const usaDivisas = (pagos || []).some(p => {
    const m = String(p.moneda || '').toUpperCase();
    return (m === 'USD' || m === 'VES') && parseFloat(p.monto_original) > 0;
  });

  if (usaDivisas) {
    if (!hoy) {
      throw Object.assign(new Error('No hay tasa del día. El administrador debe fijarla; mientras tanto solo se puede cobrar en pesos (COP).'), { status: 400, extra: { sin_tasa: true } });
    }
    const difiere = (a, b) => a !== undefined && a !== null && a !== '' && Math.abs(parseFloat(a) - b) > 1e-6;
    if (tasasCliente && (difiere(tasasCliente.USD, hoy.USD) || difiere(tasasCliente.VES, hoy.VES))) {
      throw Object.assign(new Error(`La tasa del día cambió (USD ${hoy.USD} · VES ${hoy.VES}). Revisa los montos y vuelve a cobrar.`), { status: 409, extra: { tasas: { USD: hoy.USD, VES: hoy.VES } } });
    }
  }

  const ref = hoy || ultima;
  return { USD: ref ? ref.USD : 1, VES: ref ? ref.VES : 1 };
}
