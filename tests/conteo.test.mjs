// Prueba del conteo de la nevera en cada cierre y del cierre de inventario mensual.
// Se ejecuta al final (usa el admin de flujos.test.mjs y la caja que dejan abierta las pruebas anteriores).
// Uso: npm test   (ver tests/run.mjs)
const BASE = process.argv[2] || 'http://localhost:3999';
let fallos = 0;
const check = (n, c, i = '') => { console.log((c ? '  OK   ' : '  FALLA ') + n + (c ? '' : '  -> ' + JSON.stringify(i))); if (!c) fallos++; };
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const near = (a, b) => Math.abs(a - b) < 0.01;

const t = (await api('POST', '/api/auth/login', { usuario: 'Admin Principal', password: 'AdminPrueba1' })).data.token;
const tasas = { USD: 4000, VES: 100 };

// Productos de nevera: "Lata" se vende tal cual (1 insumo) -> se cuenta.
// "Jugo" es preparado (vaso + zanahoria) aunque esté en Nevera -> NO se cuenta.
const mk = async (nombre, stock, costo) => (await api('POST', '/api/insumos', { nombre, unidad_medida: 'und', stock_actual: stock, stock_minimo: 0, stock_fijo: stock, costo_unitario: costo }, t)).data.insumo.id;
const lata = await mk('Lata prueba', 10, 1000);
const vaso = await mk('Vaso prueba', 50, 100);
const zanahoria = await mk('Zanahoria prueba', 20, 50);
await api('POST', '/api/productos', { nombre: 'Lata', categoria: 'Nevera', precio_venta: 3000, costo_produccion: 1000, receta: [{ insumo_id: lata, cantidad: 1 }] }, t);
await api('POST', '/api/productos', { nombre: 'Jugo', categoria: 'Nevera', precio_venta: 4000, costo_produccion: 150, receta: [{ insumo_id: vaso, cantidad: 1 }, { insumo_id: zanahoria, cantidad: 1 }] }, t);

let r = await api('GET', '/api/caja/conteo-nevera', null, t);
check('lista a contar: solo productos de nevera que se venden tal cual', r.status === 200 && r.data.items.length === 1 && r.data.items[0].insumo_id === lata, r.data);
check('conteo a ciegas: la lista no trae lo que dice el sistema', r.status === 200 && !('stock_actual' in r.data.items[0]) && !('esperado' in r.data.items[0]), r.data.items);

r = await api('POST', '/api/caja/cerrar', { monto_declarado_cop: 0, tasas }, t);
check('no se puede cerrar la caja sin contar la nevera', r.status === 400 && r.data.falta_conteo_nevera === true, r);

r = await api('POST', '/api/caja/conteo-nevera/verificar', { conteos: [] }, t);
check('verificar sin contar todo -> 400', r.status === 400, r);
r = await api('POST', '/api/caja/conteo-nevera/verificar', { conteos: [{ insumo_id: lata, contado: 8 }] }, t);
check('primer conteo con diferencia: dice qué recontar, sin decir cuánto', r.status === 200 && r.data.cuadra === false && r.data.revisar[0] === lata && Object.keys(r.data).length === 2, r.data);
r = await api('POST', '/api/caja/conteo-nevera/verificar', { conteos: [{ insumo_id: lata, contado: 10 }] }, t);
check('primer conteo correcto: cuadra', r.status === 200 && r.data.cuadra === true, r.data);

r = await api('POST', '/api/caja/conteo-nevera', { conteos: [{ insumo_id: lata, contado: 9 }], primer_conteo: [{ insumo_id: lata, contado: 8 }] }, t);
const c = r.data && r.data.conteo;
check('conteo definitivo guardado', r.status === 201 && c, r);
check('resultado: falta 1 lata = -$1.000 a costo, marcado como recontado', c && c.items[0].esperado === 10 && c.items[0].contado === 9 && c.items[0].diferencia === -1 && near(c.faltante_cop, 1000) && c.recontado === true && c.items[0].primer_conteo === 8, c);
r = await api('POST', '/api/caja/conteo-nevera', { conteos: [{ insumo_id: lata, contado: 10 }] }, t);
check('el conteo del turno no se puede repetir', r.status === 409 && r.data.ya_contado === true, r);
check('el conteo NO cambia el stock solo', (await api('GET', '/api/insumos', null, t)).data.find(i => i.id === lata).stock_actual == 10);

r = await api('POST', '/api/caja/cerrar', { monto_declarado_cop: 0, tasas }, t);
check('con el conteo hecho, la caja cierra y el ticket trae la nevera', r.status === 200 && r.data.resumen.conteo_nevera && r.data.resumen.conteo_nevera.items_con_diferencia === 1, r.data && r.data.resumen && r.data.resumen.conteo_nevera);
const sesionId = r.data.sesion.id;

r = await api('GET', `/api/admin/cierres/turno/${sesionId}`, null, t);
check('el ticket del turno (historial) trae el conteo de nevera', r.status === 200 && r.data.conteo_nevera && r.data.conteo_nevera.items.length === 1, r.data && r.data.conteo_nevera);

// Revisión del admin: "Ajustar" registra el faltante como merma y corrige el stock
r = await api('GET', '/api/admin/conteos-nevera', null, t);
const item = r.data[0] && r.data[0].items.find(i => i.insumo_id === lata);
check('admin ve el conteo con su diferencia', r.status === 200 && item && item.diferencia === -1 && !item.decision, r.data[0]);
r = await api('POST', `/api/admin/conteos-nevera/items/${item.id}`, { accion: 'ajustar' }, t);
check('ajustar faltante -> 200', r.status === 200, r);
check('stock corregido a lo contado (9)', (await api('GET', '/api/insumos', null, t)).data.find(i => i.id === lata).stock_actual == 9);
const merma = (await api('GET', '/api/mermas', null, t)).data.find(m => /conteo de nevera/i.test(m.motivo));
check('el faltante quedó como merma que resta de la ganancia', merma && near(merma.costo, 1000) && merma.descontar_ganancia === true, merma);
r = await api('POST', `/api/admin/conteos-nevera/items/${item.id}`, { accion: 'ajustar' }, t);
check('no se puede ajustar dos veces', r.status === 409, r);

// Cierre de inventario mensual (registro aparte)
const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' }).slice(0, 7);
r = await api('GET', `/api/admin/inventario-mensual?mes=${mes}`, null, t);
const itLata = r.data.items.find(i => i.insumo_id === lata), itVaso = r.data.items.find(i => i.insumo_id === vaso);
check('inventario mensual: lista todo el inventario por secciones', r.status === 200 && itLata.seccion === 'Nevera' && itVaso.seccion === 'Otros' && r.data.cierre === null, { itLata, itVaso });
check('inventario mensual a ciegas: sin lo que dice el sistema', !('esperado' in itVaso), itVaso);
r = await api('POST', '/api/admin/inventario-mensual', { mes, conteos: [{ insumo_id: lata, contado: 9 }, { insumo_id: vaso, contado: 45 }] }, t);
check('guardar avance (borrador)', r.status === 200 && r.data.cerrado === false, r);
r = await api('GET', `/api/admin/inventario-mensual?mes=${mes}`, null, t);
check('el borrador recuerda lo contado', r.data.cierre.estado === 'borrador' && r.data.items.find(i => i.insumo_id === vaso).contado === 45, r.data.cierre);
r = await api('POST', '/api/admin/inventario-mensual', { mes, conteos: [{ insumo_id: lata, contado: 9 }, { insumo_id: vaso, contado: 45 }], cerrar: true }, t);
check('cerrar el inventario del mes', r.status === 200 && r.data.cerrado === true, r);
r = await api('GET', `/api/admin/inventario-mensual?mes=${mes}`, null, t);
const cv = r.data.items.find(i => i.insumo_id === vaso), cl = r.data.items.find(i => i.insumo_id === lata);
check('cerrado: compara con el sistema (vaso -5, lata cuadra)', r.data.cierre.estado === 'cerrado' && cv.esperado === 50 && cv.diferencia === -5 && cl.diferencia === 0, { cv, cl });
check('cerrado: faltante $500, solo cuenta lo contado (2 productos)', near(r.data.cierre.faltante_cop, 500) && r.data.cierre.items_contados === 2 && r.data.items.length === 2, r.data.cierre);
r = await api('POST', '/api/admin/inventario-mensual', { mes, conteos: [{ insumo_id: vaso, contado: 50 }] }, t);
check('el mes cerrado no se puede modificar', r.status === 409, r);

r = await api('GET', `/api/reportes/inventario-mes?mes=${mes}`, null, t);
check('reporte del mes: inventario vs sistema', r.status === 200 && near(r.data.inventario.faltante_cop, 500) && r.data.top_faltantes[0].nombre === 'Vaso prueba', r.data);
check('reporte del mes: faltantes de nevera por cajero', r.data.nevera.conteos === 1 && near(r.data.nevera.faltante_cop, 1000) && r.data.nevera.por_cajero[0].cajero === 'Admin Principal', r.data.nevera);

const idCierre = r.data.inventario.id;
r = await api('POST', `/api/admin/inventario-mensual/${idCierre}/ajustar`, null, t);
check('ajustar el inventario del mes', r.status === 200, r);
check('stock del vaso corregido a 45', (await api('GET', '/api/insumos', null, t)).data.find(i => i.id === vaso).stock_actual == 45);
r = await api('POST', `/api/admin/inventario-mensual/${idCierre}/ajustar`, null, t);
check('no se puede ajustar dos veces', r.status === 409, r);

// Dejar una caja abierta para revisar la interfaz
await api('POST', '/api/caja/abrir', { fondo_inicial_cop: 20000, turno: 'Tarde' }, t);
console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLAS' : 'todo OK'}`);
process.exit(fallos ? 1 : 0);
