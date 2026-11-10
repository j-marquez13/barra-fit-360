// Prueba del cierre a ciegas: revisión de qué métodos no cuadran (sin montos) y la lista de
// pagos que el cajero escribió guardada en el ticket del turno.
// Se ejecuta al final (usa la caja abierta y las ventas de las pruebas anteriores).
// Uso: npm test   (ver tests/run.mjs)
const BASE = process.argv[2] || 'http://localhost:3999';
let fallos = 0;
const check = (n, c, i = '') => { console.log((c ? '  OK   ' : '  FALLA ') + n + (c ? '' : '  -> ' + JSON.stringify(i))); if (!c) fallos++; };
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const t = (await api('POST', '/api/auth/login', { usuario: 'Admin Principal', password: 'AdminPrueba1' })).data.token;

// Lo que el sistema espera, por método, desde el estado de la caja abierta
const estado = (await api('GET', '/api/caja/estado', null, t)).data;
check('hay una caja abierta para la prueba', estado && estado.abierta, estado);
const METODOS = [
  ['Pago Móvil', 'VES', ['Pago Móvil', 'Pago Movil']], ['Bancolombia', 'COP', ['Bancolombia']], ['Binance', 'USD', ['Binance']],
  ['Efectivo COP', 'COP', ['Efectivo COP', 'Efectivo']], ['Efectivo USD', 'USD', ['Efectivo USD', 'Efectivo']]
];
const esperado = (detalle) => Object.fromEntries(METODOS.map(([m, mon, claves]) =>
  [m, claves.reduce((s, k) => s + (parseFloat(detalle?.[mon]?.[k]) || 0), 0)]));
const ventas = esperado(estado.arqueo.ventas_detalle);
const abonos = esperado(estado.arqueo.abonos_detalle);

let r = await api('POST', '/api/caja/verificar-arqueo', { ventas, abonos }, t);
check('si lo escrito es lo correcto: cuadra', r.status === 200 && r.data.cuadra === true && r.data.revisar.length === 0, r.data);

r = await api('POST', '/api/caja/verificar-arqueo', { ventas: { ...ventas, 'Efectivo COP': ventas['Efectivo COP'] / 1000 }, abonos }, t);
check('efectivo sin los ceros: dice qué revisar', r.data.cuadra === false && r.data.revisar.some(x => x.seccion === 'ventas' && x.metodo === 'Efectivo COP'), r.data);
check('la revisión no dice montos (solo qué método)', r.data.revisar.every(x => Object.keys(x).sort().join() === 'metodo,seccion'), r.data.revisar);

r = await api('POST', '/api/caja/verificar-arqueo', { ventas: { ...ventas, 'Pago Móvil': ventas['Pago Móvil'] + 1.5 }, abonos }, t);
check('unos bolívares de redondeo no cuentan como error', r.data.cuadra === true, r.data);
r = await api('POST', '/api/caja/verificar-arqueo', { ventas: { ...ventas, 'Pago Móvil': ventas['Pago Móvil'] + 500 }, abonos }, t);
check('una diferencia real en Pago Móvil sí se avisa', r.data.revisar.some(x => x.metodo === 'Pago Móvil'), r.data);

// Cerrar con la lista de pagos que escribió el cajero: queda en el ticket
const nevera = (await api('GET', '/api/caja/conteo-nevera', null, t)).data;
if (nevera.items.length && !nevera.conteo) {
  await api('POST', '/api/caja/conteo-nevera', { conteos: nevera.items.map(i => ({ insumo_id: i.insumo_id, contado: 0 })) }, t);
}
const detalle = { ventas: { 'Pago Móvil': [3226, 645], 'Efectivo COP': [ventas['Efectivo COP']] }, abonos: {}, no_cuadraba: [{ seccion: 'ventas', metodo: 'Pago Móvil' }] };
r = await api('POST', '/api/caja/cerrar', {
  monto_declarado_cop: 0, fondo_completo: true, declarado_pago_movil: 3871, declarado_efectivo_pesos: ventas['Efectivo COP'],
  declarado_ventas_cop: 0, declarado_abonos_cop: 0, tasas: { USD: 4000, VES: 100 }, detalle_declarado: detalle
}, t);
check('cerrar la caja con la lista de pagos', r.status === 200, r);
const idTurno = r.data && r.data.sesion && r.data.sesion.id;
r = await api('GET', `/api/admin/cierres/turno/${idTurno}`, null, t);
check('el ticket del turno guarda lo que escribió el cajero', r.status === 200 && r.data.detalle_declarado && r.data.detalle_declarado.ventas['Pago Móvil'].join() === '3226,645', r.data && r.data.detalle_declarado);
check('y que el sistema le avisó que no cuadraba', r.data.detalle_declarado.no_cuadraba[0].metodo === 'Pago Móvil');

r = await api('POST', '/api/caja/verificar-arqueo', { ventas, abonos }, t);
check('sin caja abierta no hay revisión', r.status === 400, r);

// Dejar una caja abierta para revisar la interfaz
await api('POST', '/api/caja/abrir', { fondo_inicial_cop: 100000, fondo_inicial_usd: 20, turno: 'Tarde' }, t);
console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLAS' : 'todo OK'}`);
process.exit(fallos ? 1 : 0);
