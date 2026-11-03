// Prueba de los reportes: ventas a crédito con el nombre del cliente e historial detallado.
// Se ejecuta al final (usa las ventas, créditos y anulaciones de las pruebas anteriores).
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
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });

// Venta a crédito a un cliente con nombre
const clientes = (await api('GET', '/api/clientes', null, t)).data;
let cli = clientes.find(c => c.nombre === 'Rosa Crédito');
if (!cli) cli = (await api('POST', '/api/clientes', { nombre: 'Rosa Crédito', identificacion: 'V-777', telefono: '584141112233', limite_credito: 0 }, t)).data.cliente;
const agua = (await api('GET', '/api/productos', null, t)).data.productos.find(p => p.nombre === 'Agua');
let r = await api('POST', '/api/ventas', { items: [{ producto_id: agua.id, cantidad: 2 }], pagos: [{ metodo_pago: 'Crédito', moneda: 'COP', monto_original: 10000 }], tasas: { USD: 4000, VES: 100 }, tipo_transaccion: 'Venta', cliente_id: cli.id }, t);
check('venta a crédito a Rosa', r.status === 201, r);
const idCredito = r.data.venta_id;

// Cierre diario: quién quedó debiendo
r = await api('GET', `/api/reportes/cierre-diario?fecha=${hoy}`, null, t);
const ventaRosa = r.data.creditos && r.data.creditos.ventas.find(v => v.venta_id === idCredito);
check('cierre diario: la venta a crédito trae el nombre del cliente', ventaRosa && ventaRosa.cliente === 'Rosa Crédito' && near(ventaRosa.monto, 10000) && /2x Agua/.test(ventaRosa.productos), r.data.creditos);
const grupo = r.data.creditos.por_cliente.find(c => c.cliente === 'Rosa Crédito');
check('cierre diario: resumen por cliente con lo que debe hoy', grupo && grupo.ventas >= 1 && grupo.debe_hoy >= 10000, grupo);
check('la suma por cliente = total a crédito del día', near(r.data.creditos.por_cliente.reduce((s, c) => s + c.total, 0), r.data.resumen.ventas_credito_cop), { suma: r.data.creditos.por_cliente.reduce((s, c) => s + c.total, 0), total: r.data.resumen.ventas_credito_cop });

// Semanal / mensual (rango)
r = await api('GET', `/api/reportes/cierre-rango?desde=${hoy}&hasta=${hoy}`, null, t);
check('reporte por rango: créditos con nombre', r.status === 200 && r.data.creditos.ventas.some(v => v.cliente === 'Rosa Crédito'), r.data.creditos);

// Historial detallado
r = await api('GET', `/api/reportes/ventas?desde=${hoy}&hasta=${hoy}`, null, t);
const h = r.data.ventas.find(v => v.id === idCredito);
check('historial: cliente, productos con precio y pago a crédito', h && h.cliente_nombre === 'Rosa Crédito' && h.detalles[0].subtotal > 0 && h.pagos[0].metodo_pago === 'Crédito' && h.fecha_txt, h);
check('historial: resumen con total, crédito y métodos', r.data.resumen && r.data.resumen.credito_cop >= 10000 && r.data.resumen.por_metodo['Crédito'], r.data.resumen);
check('historial: dice qué cajero cobró', r.data.ventas.some(v => v.cajero === 'Admin Principal'), r.data.ventas.slice(0, 3).map(v => v.cajero));
const sinAnuladas = r.data.ventas.length;
r = await api('GET', `/api/reportes/ventas?desde=2000-01-01&hasta=${hoy}&anuladas=1`, null, t);
check('historial: con "ver anuladas" aparecen las anuladas', r.data.ventas.some(v => v.tipo_transaccion === 'Anulada') && r.data.resumen.anuladas > 0, r.data.resumen);
check('historial: sin el filtro no salen anuladas', !(await api('GET', `/api/reportes/ventas?desde=2000-01-01&hasta=${hoy}`, null, t)).data.ventas.some(v => v.tipo_transaccion === 'Anulada'));

console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLAS' : 'todo OK'}`);
process.exit(fallos ? 1 : 0);
