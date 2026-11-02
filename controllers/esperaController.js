import * as db from '../db.js';
import { isPostgres, localNow } from '../db.js';

/**
 * Facturas en espera: pedidos guardados con el nombre del cliente para cobrarlos después
 * (p. ej. el cliente pide y paga al salir). Se guardan en el servidor para verlas desde
 * cualquier dispositivo. NO mueven inventario ni caja: eso pasa cuando se cobran. Al cobrar,
 * la venta trae espera_id y processSale la borra en la misma transacción.
 */

const MAX_ITEMS = 100;
const MAX_JSON = 50000;

function leerFactura(body) {
  const nombre = String(body.nombre || '').trim();
  if (!nombre) throw Object.assign(new Error('El nombre del cliente es obligatorio.'), { status: 400 });
  if (nombre.length > 80) throw Object.assign(new Error('El nombre es muy largo (máximo 80 caracteres).'), { status: 400 });
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) throw Object.assign(new Error('El pedido no tiene productos.'), { status: 400 });
  if (items.length > MAX_ITEMS) throw Object.assign(new Error('El pedido tiene demasiados productos.'), { status: 400 });
  for (const it of items) {
    if (!it || !Number.isInteger(Number(it.producto_id)) || !(parseFloat(it.cantidad) > 0)) {
      throw Object.assign(new Error('Producto inválido en el pedido.'), { status: 400 });
    }
  }
  const itemsJson = JSON.stringify(items);
  if (itemsJson.length > MAX_JSON) throw Object.assign(new Error('El pedido es demasiado grande.'), { status: 400 });
  return {
    nombre,
    telefono: String(body.telefono || '').trim().slice(0, 30) || null,
    notas: String(body.notas || '').trim().slice(0, 300) || null,
    itemsJson,
    total: parseFloat(body.total) || 0,
    resumen: String(body.resumen || '').slice(0, 500) || null
  };
}

function fila(f) {
  let items = [];
  try { items = JSON.parse(f.items || '[]'); } catch (e) { /* dato dañado */ }
  return {
    id: f.id, nombre: f.nombre, telefono: f.telefono, notas: f.notas, items,
    total: parseFloat(f.total) || 0, resumen: f.resumen,
    usuario_nombre: f.usuario_nombre, creado_en: f.creado_en, actualizado_en: f.actualizado_en
  };
}

function responderError(res, e, contexto) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(contexto, e);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

// GET /api/ventas-espera
export async function listarEspera(req, res) {
  try {
    const filas = await db.query('SELECT * FROM ventas_espera ORDER BY creado_en ASC, id ASC');
    return res.json(filas.map(fila));
  } catch (e) {
    return responderError(res, e, 'Error al listar facturas en espera:');
  }
}

// POST /api/ventas-espera  { nombre, telefono, notas, items, total, resumen }
export async function crearEspera(req, res) {
  try {
    const f = leerFactura(req.body || {});
    const ahora = localNow();
    const r = await db.execute(
      `INSERT INTO ventas_espera (nombre, telefono, notas, items, total, resumen, usuario_id, usuario_nombre, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)${isPostgres() ? ' RETURNING id' : ''}`,
      [f.nombre, f.telefono, f.notas, f.itemsJson, f.total, f.resumen, req.usuario?.usuario_id || null, req.usuario?.nombre || null, ahora, ahora]);
    const nueva = (await db.query('SELECT * FROM ventas_espera WHERE id = $1', [r[0].id]))[0];
    return res.status(201).json(fila(nueva));
  } catch (e) {
    return responderError(res, e, 'Error al guardar la factura en espera:');
  }
}

// PUT /api/ventas-espera/:id — se retomó, se cambió y se vuelve a poner en espera
export async function actualizarEspera(req, res) {
  try {
    const f = leerFactura(req.body || {});
    const existe = await db.query('SELECT id FROM ventas_espera WHERE id = $1', [req.params.id]);
    if (!existe.length) return res.status(404).json({ error: 'Esa factura en espera ya no existe (¿se cobró o se eliminó?).', no_existe: true });
    await db.execute(
      'UPDATE ventas_espera SET nombre = $1, telefono = $2, notas = $3, items = $4, total = $5, resumen = $6, actualizado_en = $7 WHERE id = $8',
      [f.nombre, f.telefono, f.notas, f.itemsJson, f.total, f.resumen, localNow(), req.params.id]);
    const act = (await db.query('SELECT * FROM ventas_espera WHERE id = $1', [req.params.id]))[0];
    return res.json(fila(act));
  } catch (e) {
    return responderError(res, e, 'Error al actualizar la factura en espera:');
  }
}

// DELETE /api/ventas-espera/:id
export async function eliminarEspera(req, res) {
  try {
    const existe = await db.query('SELECT id FROM ventas_espera WHERE id = $1', [req.params.id]);
    if (!existe.length) return res.status(404).json({ error: 'Esa factura en espera ya no existe.', no_existe: true });
    await db.execute('DELETE FROM ventas_espera WHERE id = $1', [req.params.id]);
    return res.json({ ok: true });
  } catch (e) {
    return responderError(res, e, 'Error al eliminar la factura en espera:');
  }
}
