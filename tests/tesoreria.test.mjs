// Prueba de Tesorería: resumen con total, movimientos de cada cuenta, cuadres, aportes y retiros.
// Se ejecuta al final (usa el admin de flujos.test.mjs y las ventas, abonos y anulaciones de las pruebas anteriores).
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
const saldo = async (cuenta) => (await api('GET', '/api/tesoreria/saldos', null, t)).data.find(c => c.nombre === cuenta).saldo * 1;
const EFE = encodeURIComponent('Efectivo COP');

let r = await api('GET', '/api/tesoreria/resumen', null, t);
const efe = r.data && r.data.cuentas.find(c => c.nombre === 'Efectivo COP');
check('resumen: cuentas, total en COP y USD con la tasa del día', r.status === 200 && efe && typeof r.data.total_cop === 'number' && r.data.total_usd !== null && r.data.tasas.USD === 4000, r.data);
const sumaCop = r.data.cuentas.reduce((s, c) => s + (c.saldo_cop || 0), 0);
check('el total es la suma de las cuentas convertidas', near(sumaCop, r.data.total_cop), { sumaCop, total: r.data.total_cop });
check('resumen del período por cuenta (entradas y salidas)', r.data.por_cuenta.length === r.data.cuentas.length, r.data.por_cuenta);

// Movimientos de una cuenta: terminan en su saldo actual
r = await api('GET', '/api/tesoreria/movimientos?cuenta=' + EFE, null, t);
const movs = r.data.movimientos;
check('movimientos de Efectivo COP con concepto y saldo', r.status === 200 && movs.length > 0 && movs.every(m => m.concepto && typeof m.saldo === 'number'), movs && movs[0]);
check('el último saldo de la lista es el saldo de la cuenta', near(movs[movs.length - 1].saldo, await saldo('Efectivo COP')));
check('saldo inicial + movimientos = saldo final', near(r.data.saldo_inicial + movs.reduce((s, m) => s + m.monto, 0), r.data.saldo_final));
check('aparecen ventas', movs.some(m => m.tipo === 'venta' && /^Venta #\d+/.test(m.concepto)), movs.slice(0, 3));
const todas = (await api('GET', '/api/tesoreria/movimientos', null, t)).data.movimientos;
check('las anulaciones aparecen como salida', todas.some(m => m.tipo === 'anulacion' && m.monto < 0), todas.filter(m => m.tipo !== 'venta').slice(0, 5));
check('los abonos aparecen como entrada', todas.some(m => m.tipo === 'abono' && m.monto > 0));

// Cuadrar con la realidad
r = await api('POST', '/api/tesoreria/ajuste', { cuenta: 'Efectivo COP', tipo: 'ajuste', saldo_real: 50000 }, t);
check('cuadre sin motivo -> 400', r.status === 400, r);
const antes = await saldo('Efectivo COP');
r = await api('POST', '/api/tesoreria/ajuste', { cuenta: 'Efectivo COP', tipo: 'ajuste', saldo_real: 50000, motivo: 'Conté la caja' }, t);
check('cuadrar: el saldo queda en lo que hay de verdad', r.status === 201 && near(r.data.delta, 50000 - antes) && near(await saldo('Efectivo COP'), 50000), r);
r = await api('POST', '/api/tesoreria/ajuste', { cuenta: 'Efectivo COP', tipo: 'ajuste', saldo_real: 50000, motivo: 'otra vez' }, t);
check('cuadrar con el mismo saldo -> 400 (nada que ajustar)', r.status === 400, r);

// Aporte y retiro del dueño
r = await api('POST', '/api/tesoreria/ajuste', { cuenta: 'Efectivo COP', tipo: 'aporte', monto: 10000, motivo: 'Para pagar proveedor' }, t);
check('aporte del dueño suma', r.status === 201 && near(await saldo('Efectivo COP'), 60000), r);
r = await api('POST', '/api/tesoreria/ajuste', { cuenta: 'Efectivo COP', tipo: 'retiro', monto: 15000, motivo: 'Retiro de ganancias' }, t);
check('retiro del dueño resta', r.status === 201 && near(await saldo('Efectivo COP'), 45000), r);
r = await api('POST', '/api/tesoreria/ajuste', { cuenta: 'Efectivo COP', tipo: 'retiro', monto: 0, motivo: 'x' }, t);
check('retiro de 0 -> 400', r.status === 400, r);
r = await api('GET', '/api/tesoreria/movimientos?cuenta=' + EFE, null, t);
const ult = r.data.movimientos.slice(-3).map(m => m.tipo).join(',');
check('cuadre, aporte y retiro aparecen en los movimientos', ult === 'ajuste,aporte,retiro' && /Retiro del dueño: Retiro de ganancias/.test(r.data.movimientos.slice(-1)[0].concepto), r.data.movimientos.slice(-3));
check('y la lista sigue terminando en el saldo', near(r.data.saldo_final, 45000) && near(r.data.movimientos.slice(-1)[0].saldo, 45000));

// Compra pagada por el dueño: no toca ninguna cuenta
const saldosAntes = (await api('GET', '/api/tesoreria/saldos', null, t)).data.map(c => c.saldo * 1).join();
r = await api('POST', '/api/gastos', { categoria: 'REPOSICION', descripcion: 'Proteína pagada por el dueño', monto: 80000, moneda: 'COP', tasa_cambio: 1, metodo_pago: 'Dueño' }, t);
check('registrar compra pagada por el dueño', r.status === 201 || r.status === 200, r);
check('no cambia el saldo de ninguna cuenta', (await api('GET', '/api/tesoreria/saldos', null, t)).data.map(c => c.saldo * 1).join() === saldosAntes);
r = await api('GET', '/api/tesoreria/resumen', null, t);
check('el resumen muestra lo pagado por el dueño', near(r.data.pagado_por_dueno.total_cop, 80000), r.data.pagado_por_dueno);

// Permisos: un cajero sin permiso de tesorería no la ve ni la ajusta
await api('POST', '/api/usuarios', { nombre: 'Cajero Tesoreria', turno: 'Mañana', password: 'tesoreria1', permisos: ['pos', 'caja'] }, t);
const tc = (await api('POST', '/api/auth/login', { usuario: 'Cajero Tesoreria', password: 'tesoreria1' })).data.token;
await api('POST', '/api/auth/cambiar-password', { password_nueva: 'tesoreria2' }, tc);
check('un cajero no ve la tesorería', (await api('GET', '/api/tesoreria/resumen', null, tc)).status === 403);
check('ni puede hacer cuadres, aportes o retiros', (await api('POST', '/api/tesoreria/ajuste', { cuenta: 'Efectivo COP', tipo: 'aporte', monto: 1, motivo: 'x' }, tc)).status === 403);

console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLAS' : 'todo OK'}`);
process.exit(fallos ? 1 : 0);
