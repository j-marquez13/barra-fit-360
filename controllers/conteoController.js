import * as db from '../db.js';
import { isPostgres, localNow } from '../db.js';
import { notificarConteoNevera, notificarInventarioMensual, notificarReaperturaInventario } from './whatsappController.js';
import { validarPasswordAdmin, firmarAutorizacion, verificarAutorizacion } from '../auth.js';

/**
 * Conteos físicos de inventario. Son DOS registros separados:
 *  1. Conteo de Nevera: lo hace el cajero en CADA cierre de caja (tablas conteos_nevera*).
 *  2. Cierre de inventario mensual: conteo de todo el inventario a fin de mes
 *     (tablas cierres_inventario*), que se cruza con el Cierre Mensual.
 * En ambos el conteo es "a ciegas": quien cuenta no ve cuánto dice el sistema hasta enviar.
 * Las diferencias NO tocan el stock solas: el administrador decide "Ajustar" o "Ignorar".
 */

const TOLERANCIA = 0.001;

const num = (v) => (v === null || v === undefined || v === '' ? null : parseFloat(v));
const redondear = (v) => Math.round(v * 1000) / 1000;
const err = (status, mensaje, extra = {}) => Object.assign(new Error(mensaje), { status, extra });
function responderError(res, e, contexto) {
  if (e.status) return res.status(e.status).json({ error: e.message, ...e.extra });
  console.error(contexto, e);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

// Insumos de la nevera: los de los productos de la categoría "Nevera" que se venden tal cual
// (receta de UN solo insumo: Agua, Monster, C4…). Los preparados (p. ej. jugo de zanahoria,
// con vaso, pitillo, etc.) no se cuentan aquí.
async function insumosNevera(q = db.query) {
  return q(`
    SELECT i.id, i.nombre, i.unidad_medida, i.stock_actual, i.costo_unitario
    FROM insumos i
    WHERE i.id IN (
      SELECT MIN(x.insumo_id)
      FROM (
        SELECT r.producto_id AS pid, r.insumo_id FROM recetas r
        UNION ALL
        SELECT p2.id AS pid, rbi.insumo_id FROM productos p2
          JOIN recetas_base_insumos rbi ON rbi.receta_base_id = p2.receta_base_id
      ) x
      JOIN productos p ON p.id = x.pid
      WHERE p.activo = TRUE AND p.categoria = 'Nevera'
      GROUP BY p.id
      HAVING COUNT(*) = 1
    )
    ORDER BY i.nombre ASC`);
}

async function sesionAbierta(q = db.query) {
  const rows = await q("SELECT * FROM sesiones_caja WHERE fecha_cierre IS NULL ORDER BY id DESC LIMIT 1");
  return rows[0] || null;
}

function filaConteo(c, items) {
  return {
    id: c.id,
    sesion_caja_id: c.sesion_caja_id,
    usuario_nombre: c.usuario_nombre,
    fecha: c.fecha,
    recontado: !!Number(c.recontado),
    items_total: Number(c.items_total) || 0,
    items_con_diferencia: Number(c.items_con_diferencia) || 0,
    faltante_cop: num(c.faltante_cop) || 0,
    sobrante_cop: num(c.sobrante_cop) || 0,
    turno: c.turno,
    items: (items || []).map(i => ({
      id: i.id,
      insumo_id: i.insumo_id,
      nombre: i.nombre,
      unidad: i.unidad,
      esperado: num(i.esperado),
      primer_conteo: num(i.primer_conteo),
      contado: num(i.contado),
      diferencia: num(i.diferencia),
      costo_unitario: num(i.costo_unitario) || 0,
      valor_diferencia: (num(i.diferencia) || 0) * (num(i.costo_unitario) || 0),
      decision: i.decision || null,
      decidido_por: i.decidido_por || null
    }))
  };
}

export async function conteoNeveraDeSesion(sesionId, q = db.query) {
  const rows = await q('SELECT * FROM conteos_nevera WHERE sesion_caja_id = $1', [sesionId]);
  if (!rows[0]) return null;
  const items = await q('SELECT * FROM conteos_nevera_items WHERE conteo_id = $1 ORDER BY nombre', [rows[0].id]);
  return filaConteo(rows[0], items);
}

// ¿Se puede cerrar la caja? Si hay productos de nevera, el conteo de este turno debe existir.
export async function faltaConteoNevera(sesionId) {
  const items = await insumosNevera();
  if (items.length === 0) return false;
  const rows = await db.query('SELECT id FROM conteos_nevera WHERE sesion_caja_id = $1', [sesionId]);
  return rows.length === 0;
}

// Valida la lista enviada por el cajero contra los productos de la nevera: todos contados,
// números válidos (>= 0). Devuelve un Map insumo_id -> cantidad.
function leerConteos(lista, items, campo = 'conteos') {
  if (!Array.isArray(lista)) throw err(400, 'Falta el conteo.');
  const mapa = new Map();
  for (const c of lista) {
    const v = num(c && c.contado);
    if (v === null || !Number.isFinite(v) || v < 0) throw err(400, 'Cada cantidad debe ser un número mayor o igual a 0.');
    mapa.set(Number(c.insumo_id), v);
  }
  const faltan = items.filter(i => !mapa.has(Number(i.id)));
  if (faltan.length) throw err(400, `Falta contar: ${faltan.map(i => i.nombre.trim()).join(', ')}.`, { [`${campo}_incompleto`]: true });
  return mapa;
}

// GET /api/caja/conteo-nevera — Lista a contar (SIN lo que dice el sistema) o el conteo ya hecho
export async function getConteoNevera(req, res) {
  try {
    const sesion = await sesionAbierta();
    if (!sesion) return res.status(400).json({ error: 'No hay ninguna caja abierta.', sin_turno: true });
    const hecho = await conteoNeveraDeSesion(sesion.id);
    const items = (await insumosNevera()).map(i => ({ insumo_id: i.id, nombre: i.nombre.trim(), unidad: i.unidad_medida }));
    return res.json({ sesion_caja_id: sesion.id, items, conteo: hecho });
  } catch (e) {
    return responderError(res, e, 'Error al cargar el conteo de nevera:');
  }
}

// POST /api/caja/conteo-nevera/verificar — Primer conteo: dice QUÉ productos no cuadran
// (sin decir cuánto) para que el cajero los vuelva a contar. No guarda nada.
export async function verificarConteoNevera(req, res) {
  try {
    const sesion = await sesionAbierta();
    if (!sesion) return res.status(400).json({ error: 'No hay ninguna caja abierta.', sin_turno: true });
    const items = await insumosNevera();
    const mapa = leerConteos(req.body.conteos, items);
    const revisar = items
      .filter(i => Math.abs(mapa.get(Number(i.id)) - (parseFloat(i.stock_actual) || 0)) > TOLERANCIA)
      .map(i => i.id);
    return res.json({ cuadra: revisar.length === 0, revisar });
  } catch (e) {
    return responderError(res, e, 'Error al verificar el conteo de nevera:');
  }
}

// POST /api/caja/conteo-nevera — Conteo definitivo del turno: se guarda y se compara con el sistema
export async function guardarConteoNevera(req, res) {
  try {
    const resultado = await db.transaction(async (tx) => {
      const sesion = await sesionAbierta(tx.query);
      if (!sesion) throw err(400, 'No hay ninguna caja abierta.', { sin_turno: true });
      const existe = await tx.query('SELECT id FROM conteos_nevera WHERE sesion_caja_id = $1', [sesion.id]);
      if (existe.length) throw err(409, 'El conteo de nevera de este turno ya se hizo.', { ya_contado: true });

      const items = await insumosNevera(tx.query);
      if (items.length === 0) throw err(400, 'No hay productos de nevera para contar.');
      const mapa = leerConteos(req.body.conteos, items);
      const primero = new Map((Array.isArray(req.body.primer_conteo) ? req.body.primer_conteo : [])
        .map(c => [Number(c.insumo_id), num(c.contado)]));

      let faltante = 0, sobrante = 0, conDiferencia = 0;
      const filas = items.map(i => {
        const esperado = parseFloat(i.stock_actual) || 0;
        const contado = mapa.get(Number(i.id));
        const diferencia = redondear(contado - esperado);
        const costo = parseFloat(i.costo_unitario) || 0;
        if (Math.abs(diferencia) > TOLERANCIA) {
          conDiferencia++;
          if (diferencia < 0) faltante += -diferencia * costo; else sobrante += diferencia * costo;
        }
        const p = primero.get(Number(i.id));
        return { i, esperado, contado, diferencia: Math.abs(diferencia) > TOLERANCIA ? diferencia : 0, costo, primer: Number.isFinite(p) ? p : contado };
      });
      const recontado = filas.some(f => Math.abs(f.primer - f.contado) > TOLERANCIA) ? 1 : 0;

      const ins = await tx.execute(
        `INSERT INTO conteos_nevera (sesion_caja_id, usuario_id, usuario_nombre, fecha, recontado, items_total, items_con_diferencia, faltante_cop, sobrante_cop)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)${isPostgres() ? ' RETURNING id' : ''}`,
        [sesion.id, req.usuario?.usuario_id || null, req.usuario?.nombre || null, localNow(), recontado, filas.length, conDiferencia, faltante, sobrante]
      );
      const conteoId = ins[0].id;
      for (const f of filas) {
        await tx.execute(
          `INSERT INTO conteos_nevera_items (conteo_id, insumo_id, nombre, unidad, esperado, primer_conteo, contado, diferencia, costo_unitario)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [conteoId, f.i.id, f.i.nombre.trim(), f.i.unidad_medida, f.esperado, f.primer, f.contado, f.diferencia, f.costo]
        );
      }
      return { conteo: await conteoNeveraDeSesion(sesion.id, tx.query), sesion };
    });

    notificarConteoNevera({ ...resultado.conteo, turno: resultado.sesion.turno });
    return res.status(201).json({ conteo: resultado.conteo });
  } catch (e) {
    return responderError(res, e, 'Error al guardar el conteo de nevera:');
  }
}

// ============================================
// ADMIN: revisión de los conteos de nevera
// ============================================

// GET /api/admin/conteos-nevera?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
export async function listarConteosNevera(req, res) {
  try {
    const cond = [], params = [];
    if (req.query.desde) { params.push(req.query.desde); cond.push(`c.fecha >= $${params.length}`); }
    if (req.query.hasta) { params.push(req.query.hasta + 'T23:59:59.999'); cond.push(`c.fecha <= $${params.length}`); }
    const conteos = await db.query(`
      SELECT c.*, s.turno FROM conteos_nevera c
      LEFT JOIN sesiones_caja s ON s.id = c.sesion_caja_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY c.fecha DESC LIMIT 200`, params);
    const resultado = [];
    for (const c of conteos) {
      const items = await db.query('SELECT * FROM conteos_nevera_items WHERE conteo_id = $1 ORDER BY nombre', [c.id]);
      resultado.push(filaConteo(c, items));
    }
    return res.json(resultado);
  } catch (e) {
    return responderError(res, e, 'Error al listar conteos de nevera:');
  }
}

// Corrige el stock de un insumo por la diferencia de un conteo:
// faltante -> se registra como merma (resta de la ganancia del mes); sobrante -> se suma al stock.
async function aplicarDiferencia(tx, insumoId, diferencia, motivo) {
  const ins = await tx.query('SELECT id, stock_actual, costo_unitario FROM insumos WHERE id = $1', [insumoId]);
  if (!ins[0]) throw err(404, 'El insumo ya no existe; no se puede ajustar.');
  const stock = parseFloat(ins[0].stock_actual) || 0;
  if (diferencia < 0) {
    const cantidad = -diferencia;
    const costo = cantidad * (parseFloat(ins[0].costo_unitario) || 0);
    await tx.execute('INSERT INTO mermas (insumo_id, cantidad, motivo, costo, descontar_ganancia) VALUES ($1, $2, $3, $4, $5)',
      [insumoId, cantidad, motivo, costo, isPostgres() ? true : 1]);
    await tx.execute('UPDATE insumos SET stock_actual = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [stock - cantidad, insumoId]);
  } else if (diferencia > 0) {
    await tx.execute('UPDATE insumos SET stock_actual = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [stock + diferencia, insumoId]);
  }
}

// POST /api/admin/conteos-nevera/items/:id  { accion: 'ajustar' | 'ignorar' }
export async function decidirItemNevera(req, res) {
  const accion = req.body && req.body.accion;
  if (accion !== 'ajustar' && accion !== 'ignorar') return res.status(400).json({ error: 'Acción inválida.' });
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.query(`SELECT it.*, c.usuario_nombre, c.fecha, c.sesion_caja_id FROM conteos_nevera_items it
        JOIN conteos_nevera c ON c.id = it.conteo_id WHERE it.id = $1`, [req.params.id]);
      const it = rows[0];
      if (!it) throw err(404, 'Producto del conteo no encontrado.');
      if (it.decision) throw err(409, 'Esta diferencia ya fue revisada.');
      const dif = parseFloat(it.diferencia) || 0;
      if (Math.abs(dif) <= TOLERANCIA) throw err(400, 'Este producto cuadró: no hay nada que ajustar.');
      if (accion === 'ajustar') {
        await aplicarDiferencia(tx, it.insumo_id, dif,
          `Faltante conteo de nevera (cierre #${it.sesion_caja_id}, ${it.usuario_nombre || 'cajero'})`);
      }
      await tx.execute('UPDATE conteos_nevera_items SET decision = $1, decidido_por = $2, decidido_en = $3 WHERE id = $4',
        [accion === 'ajustar' ? 'ajustado' : 'ignorado', req.usuario?.nombre || null, localNow(), it.id]);
    });
    return res.json({ ok: true });
  } catch (e) {
    return responderError(res, e, 'Error al revisar el conteo de nevera:');
  }
}

// ============================================
// ADMIN: cierre de inventario mensual (todo el inventario)
// ============================================
const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

async function seccionesInsumos(q = db.query) {
  const nevera = new Set((await insumosNevera(q)).map(i => Number(i.id)));
  // Los que no tienen stock fijo ni costo no se cuentan: no aportan nada al cierre del mes
  const todos = await q('SELECT id, nombre, unidad_medida, stock_actual, costo_unitario, es_para_batidos, es_base_liquida, es_sabor_batido FROM insumos WHERE COALESCE(stock_fijo, 0) > 0 OR COALESCE(costo_unitario, 0) > 0 ORDER BY nombre ASC');
  const si = (v) => v === true || v === 1 || v === '1' || v === 't';
  return todos.map(i => ({
    ...i,
    seccion: nevera.has(Number(i.id)) ? 'Nevera'
      : (si(i.es_para_batidos) || si(i.es_base_liquida) || si(i.es_sabor_batido)) ? 'Batidos' : 'Otros'
  }));
}

function filaCierreInventario(c) {
  if (!c) return null;
  return {
    id: c.id, mes: c.mes, estado: c.estado, usuario_nombre: c.usuario_nombre,
    creado_en: c.creado_en, cerrado_en: c.cerrado_en,
    valor_sistema: num(c.valor_sistema), valor_contado: num(c.valor_contado),
    faltante_cop: num(c.faltante_cop), sobrante_cop: num(c.sobrante_cop),
    items_contados: c.items_contados === null ? null : Number(c.items_contados),
    items_con_diferencia: c.items_con_diferencia === null ? null : Number(c.items_con_diferencia),
    ajustado: !!Number(c.ajustado), ajustado_por: c.ajustado_por || null,
    autorizado_por: c.autorizado_por || null,
    reaperturas: Number(c.reaperturas) || 0
  };
}

// GET /api/admin/inventario-mensual?mes=YYYY-MM
export async function getInventarioMensual(req, res) {
  const mes = req.query.mes;
  if (!MES_VALIDO.test(mes || '')) return res.status(400).json({ error: 'Mes inválido (formato AAAA-MM).' });
  try {
    const cierre = (await db.query('SELECT * FROM cierres_inventario WHERE mes = $1', [mes]))[0] || null;
    if (cierre && cierre.estado === 'cerrado' && req.autorizadoPor) {
      // Cajero: el mes ya se cerró; la comparación con el sistema la revisa el administrador
      const c = filaCierreInventario(cierre);
      return res.json({ mes, cierre: { id: c.id, mes, estado: c.estado, usuario_nombre: c.usuario_nombre, cerrado_en: c.cerrado_en, autorizado_por: c.autorizado_por }, items: [] });
    }
    const reaperturas = req.autorizadoPor ? [] : await historialReaperturas(mes);
    if (cierre && cierre.estado === 'cerrado') {
      const items = await db.query('SELECT * FROM cierres_inventario_items WHERE cierre_id = $1 ORDER BY seccion, nombre', [cierre.id]);
      return res.json({
        mes, cierre: filaCierreInventario(cierre), reaperturas,
        items: items.map(i => ({
          insumo_id: i.insumo_id, nombre: i.nombre, unidad: i.unidad, seccion: i.seccion,
          contado: num(i.contado), esperado: num(i.esperado), diferencia: num(i.diferencia),
          costo_unitario: num(i.costo_unitario) || 0,
          valor_diferencia: (num(i.diferencia) || 0) * (num(i.costo_unitario) || 0)
        }))
      });
    }
    // Borrador o nuevo: lista de todo el inventario SIN lo que dice el sistema (conteo a ciegas)
    const guardados = new Map();
    if (cierre) {
      for (const i of await db.query('SELECT insumo_id, contado FROM cierres_inventario_items WHERE cierre_id = $1', [cierre.id])) {
        guardados.set(Number(i.insumo_id), num(i.contado));
      }
    }
    const items = (await seccionesInsumos()).map(i => ({
      insumo_id: i.id, nombre: i.nombre.trim(), unidad: i.unidad_medida, seccion: i.seccion,
      contado: guardados.has(Number(i.id)) ? guardados.get(Number(i.id)) : null
    }));
    return res.json({ mes, cierre: filaCierreInventario(cierre), reaperturas, items });
  } catch (e) {
    return responderError(res, e, 'Error al cargar el inventario mensual:');
  }
}

// POST /api/admin/inventario-mensual  { mes, conteos: [{insumo_id, contado|null}], cerrar: bool }
// Guarda el avance (borrador) o cierra el mes: al cerrar se compara con el sistema.
export async function guardarInventarioMensual(req, res) {
  const { mes, conteos, cerrar } = req.body || {};
  if (!MES_VALIDO.test(mes || '')) return res.status(400).json({ error: 'Mes inválido (formato AAAA-MM).' });
  if (!Array.isArray(conteos)) return res.status(400).json({ error: 'Falta el conteo.' });
  try {
    const resultado = await db.transaction(async (tx) => {
      let cierre = (await tx.query('SELECT * FROM cierres_inventario WHERE mes = $1', [mes]))[0];
      if (cierre && cierre.estado === 'cerrado') throw err(409, 'El inventario de este mes ya está cerrado.', { cerrado: true });
      if (!cierre) {
        const ins = await tx.execute(
          `INSERT INTO cierres_inventario (mes, estado, usuario_id, usuario_nombre, creado_en) VALUES ($1, 'borrador', $2, $3, $4)${isPostgres() ? ' RETURNING id' : ''}`,
          [mes, req.usuario?.usuario_id || null, req.usuario?.nombre || null, localNow()]);
        cierre = { id: ins[0].id };
      }

      const insumos = await seccionesInsumos(tx.query);
      const porId = new Map(insumos.map(i => [Number(i.id), i]));
      const valores = new Map();
      for (const c of conteos) {
        const id = Number(c && c.insumo_id);
        if (!porId.has(id)) continue;
        const v = num(c.contado);
        if (v !== null && (!Number.isFinite(v) || v < 0)) throw err(400, 'Cada cantidad debe ser un número mayor o igual a 0.');
        valores.set(id, v);
      }

      // Se reescribe el conteo completo del borrador
      await tx.execute('DELETE FROM cierres_inventario_items WHERE cierre_id = $1', [cierre.id]);
      let valorSistema = 0, valorContado = 0, faltante = 0, sobrante = 0, contados = 0, conDif = 0;
      for (const i of insumos) {
        const contado = valores.has(Number(i.id)) ? valores.get(Number(i.id)) : null;
        let esperado = null, diferencia = null;
        const costo = parseFloat(i.costo_unitario) || 0;
        if (cerrar && contado !== null) {
          esperado = parseFloat(i.stock_actual) || 0;
          diferencia = redondear(contado - esperado);
          if (Math.abs(diferencia) <= TOLERANCIA) diferencia = 0;
          contados++;
          valorSistema += esperado * costo;
          valorContado += contado * costo;
          if (diferencia < 0) { faltante += -diferencia * costo; conDif++; }
          else if (diferencia > 0) { sobrante += diferencia * costo; conDif++; }
        }
        if (contado === null) continue; // lo no contado no se guarda ni entra en el cierre
        await tx.execute(
          `INSERT INTO cierres_inventario_items (cierre_id, insumo_id, nombre, unidad, seccion, contado, esperado, diferencia, costo_unitario)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [cierre.id, i.id, i.nombre.trim(), i.unidad_medida, i.seccion, contado, esperado, diferencia, costo]);
      }

      if (cerrar) {
        if (contados === 0) throw err(400, 'No hay nada contado: cuenta al menos un producto para cerrar el mes.');
        await tx.execute(
          `UPDATE cierres_inventario SET estado = 'cerrado', cerrado_en = $1, usuario_id = $2, usuario_nombre = $3,
             valor_sistema = $4, valor_contado = $5, faltante_cop = $6, sobrante_cop = $7, items_contados = $8, items_con_diferencia = $9,
             autorizado_por = $10
           WHERE id = $11`,
          [localNow(), req.usuario?.usuario_id || null, req.usuario?.nombre || null, valorSistema, valorContado, faltante, sobrante, contados, conDif,
            req.autorizadoPor || req.usuario?.nombre || null, cierre.id]);
      }
      return { id: cierre.id, sin_contar: insumos.length - [...valores.values()].filter(v => v !== null).length };
    });
    if (cerrar) avisarInventarioCerrado(mes).catch(e => console.error('Aviso de inventario mensual:', e.message));
    return res.json({ ok: true, ...resultado, cerrado: !!cerrar });
  } catch (e) {
    return responderError(res, e, 'Error al guardar el inventario mensual:');
  }
}

// POST /api/admin/inventario-mensual/:id/ajustar — Corrige el stock con todas las diferencias del mes
export async function ajustarInventarioMensual(req, res) {
  try {
    await db.transaction(async (tx) => {
      const c = (await tx.query('SELECT * FROM cierres_inventario WHERE id = $1', [req.params.id]))[0];
      if (!c) throw err(404, 'Cierre de inventario no encontrado.');
      if (c.estado !== 'cerrado') throw err(400, 'Primero hay que cerrar el inventario del mes.');
      if (Number(c.ajustado)) throw err(409, 'Este inventario ya se ajustó.');
      const items = await tx.query('SELECT * FROM cierres_inventario_items WHERE cierre_id = $1', [c.id]);
      for (const it of items) {
        const dif = parseFloat(it.diferencia) || 0;
        if (Math.abs(dif) > TOLERANCIA) await aplicarDiferencia(tx, it.insumo_id, dif, `Faltante cierre de inventario ${c.mes}`);
      }
      await tx.execute('UPDATE cierres_inventario SET ajustado = 1, ajustado_por = $1, ajustado_en = $2 WHERE id = $3',
        [req.usuario?.nombre || null, localNow(), c.id]);
    });
    return res.json({ ok: true });
  } catch (e) {
    return responderError(res, e, 'Error al ajustar el inventario mensual:');
  }
}

// GET /api/reportes/inventario-mes?mes=YYYY-MM — Para el Cierre Mensual: conteo del mes vs sistema
// y los faltantes de nevera de los cierres de caja de ese mes, por cajero.
export async function reporteInventarioMes(req, res) {
  const mes = req.query.mes;
  if (!MES_VALIDO.test(mes || '')) return res.status(400).json({ error: 'Mes inválido (formato AAAA-MM).' });
  try {
    const [a, m] = mes.split('-').map(Number);
    const siguiente = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
    const cierre = (await db.query("SELECT * FROM cierres_inventario WHERE mes = $1 AND estado = 'cerrado'", [mes]))[0] || null;
    let topFaltantes = [];
    if (cierre) {
      topFaltantes = (await db.query('SELECT nombre, unidad, diferencia, costo_unitario FROM cierres_inventario_items WHERE cierre_id = $1 AND diferencia < 0', [cierre.id]))
        .map(i => ({ nombre: i.nombre, unidad: i.unidad, diferencia: num(i.diferencia), valor: num(i.diferencia) * (num(i.costo_unitario) || 0) }))
        .sort((x, y) => x.valor - y.valor)
        .slice(0, 8);
    }
    const conteos = await db.query(
      'SELECT usuario_nombre, items_con_diferencia, faltante_cop, sobrante_cop FROM conteos_nevera WHERE fecha >= $1 AND fecha < $2',
      [`${mes}-01`, `${siguiente}-01`]);
    const porCajero = {};
    for (const c of conteos) {
      const k = c.usuario_nombre || 'Sin nombre';
      porCajero[k] = porCajero[k] || { cajero: k, conteos: 0, con_diferencia: 0, faltante_cop: 0, sobrante_cop: 0 };
      porCajero[k].conteos++;
      if (Number(c.items_con_diferencia) > 0) porCajero[k].con_diferencia++;
      porCajero[k].faltante_cop += num(c.faltante_cop) || 0;
      porCajero[k].sobrante_cop += num(c.sobrante_cop) || 0;
    }
    const lista = Object.values(porCajero).sort((x, y) => y.faltante_cop - x.faltante_cop);
    // Faltantes de nevera que el admin todavía no revisó (los ajustados ya están en mermas)
    const pendiente = await db.query(
      `SELECT COALESCE(SUM(-it.diferencia * it.costo_unitario), 0) AS total FROM conteos_nevera_items it
       JOIN conteos_nevera c ON c.id = it.conteo_id
       WHERE c.fecha >= $1 AND c.fecha < $2 AND it.diferencia < 0 AND it.decision IS NULL`,
      [`${mes}-01`, `${siguiente}-01`]);
    return res.json({
      mes,
      inventario: filaCierreInventario(cierre),
      top_faltantes: topFaltantes,
      nevera: {
        conteos: conteos.length,
        con_diferencia: conteos.filter(c => Number(c.items_con_diferencia) > 0).length,
        faltante_cop: lista.reduce((s, x) => s + x.faltante_cop, 0),
        sobrante_cop: lista.reduce((s, x) => s + x.sobrante_cop, 0),
        faltante_sin_revisar_cop: num(pendiente[0]?.total) || 0,
        por_cajero: lista
      }
    });
  } catch (e) {
    return responderError(res, e, 'Error en el reporte de inventario del mes:');
  }
}

// ============================================
// CAJERO: registra el inventario mensual con la CLAVE DEL ADMINISTRADOR (que debe estar
// presente). Cada vez que se abre la pantalla se pide la clave; el permiso dura unas horas
// y solo vale para ese usuario. El administrador lo revisa en Cierres → Inventario Mensual.
// ============================================
const DURACION_AUTORIZACION = 4 * 60 * 60 * 1000;

// POST /api/inventario-mensual/autorizar  { admin_password }
export async function autorizarInventarioMensual(req, res) {
  try {
    const r = await validarPasswordAdmin(req, req.body && req.body.admin_password);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    const autorizacion = firmarAutorizacion({ tipo: 'inventario-mensual', usuario_id: req.usuario.usuario_id, admin: r.admin.nombre }, DURACION_AUTORIZACION);
    return res.json({ autorizacion, admin: r.admin.nombre });
  } catch (e) {
    return responderError(res, e, 'Error al autorizar el inventario mensual:');
  }
}

export function requiereAutorizacionInventario(req, res, next) {
  const p = verificarAutorizacion(req.headers['x-autorizacion-admin'], 'inventario-mensual');
  if (!p || p.usuario_id !== req.usuario?.usuario_id) {
    return res.status(403).json({ error: 'Se requiere la clave del administrador.', requiere_autorizacion: true });
  }
  req.autorizadoPor = p.admin;
  next();
}

// ============================================
// VOLVER A HACER un inventario mensual ya cerrado: solo con la clave del administrador.
// Se guarda una copia del cierre anterior (historial) y el mes vuelve a borrador con lo
// contado, para corregirlo y cerrarlo de nuevo. Si el stock ya se había ajustado, ese ajuste
// queda hecho y el nuevo conteo se compara con el stock actual.
// ============================================
async function historialReaperturas(mes) {
  const filas = await db.query('SELECT fecha, reabierto_por, autorizado_por, datos FROM cierres_inventario_reaperturas WHERE mes = $1 ORDER BY id', [mes]);
  return filas.map(f => {
    let d = {};
    try { d = JSON.parse(f.datos || '{}'); } catch (e) { /* copia dañada */ }
    return {
      fecha: f.fecha, reabierto_por: f.reabierto_por, autorizado_por: f.autorizado_por,
      cerrado_en: d.cerrado_en || null, registrado_por: d.usuario_nombre || null,
      valor_sistema: num(d.valor_sistema), valor_contado: num(d.valor_contado),
      faltante_cop: num(d.faltante_cop), sobrante_cop: num(d.sobrante_cop),
      items_con_diferencia: d.items_con_diferencia ?? null, ajustado: !!Number(d.ajustado)
    };
  });
}

// POST /api/inventario-mensual/reabrir  { mes, admin_password }
export async function reabrirInventarioMensual(req, res) {
  const { mes, admin_password } = req.body || {};
  if (!MES_VALIDO.test(mes || '')) return res.status(400).json({ error: 'Mes inválido (formato AAAA-MM).' });
  try {
    const r = await validarPasswordAdmin(req, admin_password);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    const anterior = await db.transaction(async (tx) => {
      const c = (await tx.query('SELECT * FROM cierres_inventario WHERE mes = $1', [mes]))[0];
      if (!c) throw err(404, 'No hay inventario de ese mes.');
      if (c.estado !== 'cerrado') throw err(400, 'Este inventario no está cerrado: se puede seguir contando.');
      const items = await tx.query('SELECT nombre, unidad, seccion, contado, esperado, diferencia, costo_unitario FROM cierres_inventario_items WHERE cierre_id = $1', [c.id]);
      const copia = {
        cerrado_en: c.cerrado_en, usuario_nombre: c.usuario_nombre, autorizado_por: c.autorizado_por,
        valor_sistema: c.valor_sistema, valor_contado: c.valor_contado, faltante_cop: c.faltante_cop, sobrante_cop: c.sobrante_cop,
        items_contados: c.items_contados, items_con_diferencia: c.items_con_diferencia, ajustado: c.ajustado, items
      };
      await tx.execute('INSERT INTO cierres_inventario_reaperturas (cierre_id, mes, fecha, reabierto_por, autorizado_por, datos) VALUES ($1, $2, $3, $4, $5, $6)',
        [c.id, mes, localNow(), req.usuario?.nombre || null, r.admin.nombre, JSON.stringify(copia)]);
      await tx.execute('UPDATE cierres_inventario_items SET esperado = NULL, diferencia = NULL WHERE cierre_id = $1', [c.id]);
      await tx.execute(`UPDATE cierres_inventario SET estado = 'borrador', cerrado_en = NULL, valor_sistema = NULL, valor_contado = NULL,
          faltante_cop = NULL, sobrante_cop = NULL, items_contados = NULL, items_con_diferencia = NULL,
          ajustado = 0, ajustado_por = NULL, ajustado_en = NULL, autorizado_por = NULL, reaperturas = COALESCE(reaperturas, 0) + 1
        WHERE id = $1`, [c.id]);
      return copia;
    });
    notificarReaperturaInventario({ mes, reabierto_por: req.usuario?.nombre, autorizado_por: r.admin.nombre, anterior });
    // Quien lo reabre puede seguir contando de una vez (misma autorización que al entrar)
    const autorizacion = firmarAutorizacion({ tipo: 'inventario-mensual', usuario_id: req.usuario.usuario_id, admin: r.admin.nombre }, DURACION_AUTORIZACION);
    return res.json({ ok: true, autorizacion, admin: r.admin.nombre });
  } catch (e) {
    return responderError(res, e, 'Error al reabrir el inventario mensual:');
  }
}

// Reporte del inventario recién cerrado (totales + diferencias de cada producto) al WhatsApp del dueño
async function avisarInventarioCerrado(mes) {
  const c = (await db.query("SELECT * FROM cierres_inventario WHERE mes = $1 AND estado = 'cerrado'", [mes]))[0];
  if (!c) return;
  const items = await db.query('SELECT nombre, unidad, contado, esperado, diferencia, costo_unitario FROM cierres_inventario_items WHERE cierre_id = $1', [c.id]);
  notificarInventarioMensual({
    ...filaCierreInventario(c),
    items: items.map(i => ({
      nombre: i.nombre, unidad: i.unidad, contado: num(i.contado), esperado: num(i.esperado),
      diferencia: num(i.diferencia) || 0, valor_diferencia: (num(i.diferencia) || 0) * (num(i.costo_unitario) || 0)
    }))
  });
}
