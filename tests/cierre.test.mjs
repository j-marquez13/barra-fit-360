// Prueba del cierre consolidado: varios turnos (con desglose ventas/abonos y uno "antiguo" sin él).
// Se ejecuta después de flujos.test.mjs (usa su admin, su caja abierta y el producto "Agua").
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

// Turno 1 (abierto por la prueba anterior): cerrar CON desglose.
let r = await api('POST', '/api/caja/cerrar', {
  monto_declarado_cop: 0, fondo_completo: true,
  declarado_zelle: 0, declarado_pago_movil: 0, declarado_binance: 0, declarado_efectivo_pesos: 0, declarado_bancolombia: 0, declarado_efectivo_usd: 0,
  declarado_ventas_cop: 0, declarado_abonos_cop: 0, tasas
}, t);
check('cerrar turno 1 con desglose', r.status === 200, r);
const v1 = r.data.resumen.total_ventas_contado_cop, a1 = r.data.resumen.total_abonos_cop;
check('turno 1 devuelve diferencias separadas', near(r.data.resumen.diferencia_ventas_cop, -v1) && near(r.data.resumen.diferencia_abonos_cop, -a1), r.data.resumen);

// Turno 2: venta de 20.000 en Zelle (5 USD) y cierre declarando 18.000 de ventas.
r = await api('POST', '/api/caja/abrir', { fondo_inicial_cop: 50000, fondo_inicial_usd: 10, turno: 'Tarde' }, t);
check('abrir turno 2', r.status === 201, r);
const prods = (await api('GET', '/api/productos', null, t)).data.productos;
const agua = prods.find(p => p.nombre === 'Agua').id;
await api('POST', '/api/ventas', { items: [{ producto_id: agua, cantidad: 4 }], pagos: [{ metodo_pago: 'Zelle', moneda: 'USD', monto_original: 5 }], tasas, tipo_transaccion: 'Venta' }, t);
r = await api('POST', '/api/caja/cerrar', {
  monto_declarado_cop: 18000, fondo_completo: false,
  declarado_zelle: 4.5, declarado_ventas_cop: 18000, declarado_abonos_cop: 0, tasas
}, t);
check('cerrar turno 2', r.status === 200, r);
check('turno 2: diferencia ventas -2.000', near(r.data.resumen.diferencia_ventas_cop, -2000), r.data.resumen.diferencia_ventas_cop);

let dia = (await api('GET', '/api/caja/cierre-dia', null, t)).data.resumen;
check('consolidado: 2 turnos', dia.total_turnos === 2, dia.total_turnos);
check('consolidado: fondo suma 50.000 COP + 10 USD', near(dia.fondo_inicial_cop, 50000) && near(dia.fondo_inicial_usd, 10), dia);
check('consolidado: 1 de 2 con fondo completo', dia.turnos_fondo_completo === 1, dia.turnos_fondo_completo);
check('consolidado: 2 turnos con desglose', dia.turnos_con_desglose === 2, dia.turnos_con_desglose);
check('consolidado: declarado ventas 18.000', near(dia.declarado_ventas_cop, 18000), dia.declarado_ventas_cop);
check('consolidado: dif ventas = suma de turnos', near(dia.diferencia_ventas_cop, -v1 - 2000), dia.diferencia_ventas_cop);
check('consolidado: dif ventas + dif abonos = dif total', near(dia.diferencia_ventas_cop + dia.diferencia_abonos_cop, dia.diferencia_caja), dia);

// Turno 3 "antiguo": cierre SIN enviar el desglose (como el frontend anterior).
await api('POST', '/api/caja/abrir', { fondo_inicial_cop: 0, turno: 'Tarde' }, t);
r = await api('POST', '/api/caja/cerrar', { monto_declarado_cop: 0, tasas }, t);
check('cerrar turno 3 sin desglose (compatibilidad)', r.status === 200 && r.data.resumen.declarado_ventas_cop === null, r.data && r.data.resumen);
dia = (await api('GET', '/api/caja/cierre-dia', null, t)).data.resumen;
check('consolidado: 3 turnos, 2 con desglose', dia.total_turnos === 3 && dia.turnos_con_desglose === 2, dia);

// Dejar una caja abierta con una venta y un abono, para revisar la interfaz.
await api('POST', '/api/caja/abrir', { fondo_inicial_cop: 20000, turno: 'Tarde' }, t);
console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLAS' : 'todo OK'}`);
process.exit(fallos ? 1 : 0);
