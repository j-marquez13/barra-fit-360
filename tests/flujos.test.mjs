// Prueba de extremo a extremo contra un servidor con BD de prueba (nueva y vacía).
// Uso: npm test   (ver tests/run.mjs)
const BASE = process.argv[2] || 'http://localhost:3999';
let fallos = 0, oks = 0;
function check(nombre, cond, info = '') {
  if (cond) { oks++; console.log('  OK   ' + nombre); }
  else { fallos++; console.log('  FALLA ' + nombre + (info ? '  -> ' + JSON.stringify(info) : '')); }
}
async function api(method, path, body, token, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (token) headers['x-auth-token'] = token;
  let payload;
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) { payload = body; headers['Content-Type'] = 'application/octet-stream'; }
    else { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  let data; const txt = await r.text();
  try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data };
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;

console.log('\n== Autenticación ==');
check('health', (await api('GET', '/api/health')).status === 200);
check('/api/usuarios sin token -> 401', (await api('GET', '/api/usuarios')).status === 401);
let r = await api('POST', '/api/auth/login', { usuario: 'NoExiste', password: 'x' });
check('usuario inexistente -> 401 mensaje genérico', r.status === 401 && r.data.error === 'Usuario o contraseña incorrectos', r);
r = await api('POST', '/api/auth/login', { usuario: 'Admin Principal', password: 'mala' });
check('contraseña mala -> mismo mensaje', r.status === 401 && r.data.error === 'Usuario o contraseña incorrectos', r);
r = await api('POST', '/api/auth/login', { usuario: 'Admin Principal', password: 'admin123' });
check('login admin', r.status === 200 && r.data.token, r);
const admin = r.data.token;
check('debe cambiar contraseña inicial', r.data.debe_cambiar_password === true);
r = await api('GET', '/api/productos', undefined, admin);
check('con contraseña inicial no puede usar el sistema -> 403', r.status === 403, r);
r = await api('POST', '/api/auth/cambiar-password', { password_nueva: 'AdminPrueba1' }, admin);
check('cambiar contraseña', r.status === 200, r);
check('ahora sí accede', (await api('GET', '/api/productos', undefined, admin)).status === 200);
check('/api/fix-timezone eliminado', (await api('GET', '/api/fix-timezone', undefined, admin)).status === 404);

console.log('\n== Preparar catálogo ==');
const mkIns = async (nombre, sabor) => api('POST', '/api/insumos', { nombre, unidad_medida: 'und', stock_actual: 100, stock_minimo: 0, stock_fijo: 100, costo_unitario: 10, es_para_batidos: true, es_sabor_batido: sabor, cantidad_sola: 1, cantidad_combinada: 1 }, admin);
for (const [n, s] of [['Vaso', false], ['Leche', false], ['Fresa', true], ['Mango', true]]) {
  r = await mkIns(n, s); check('crear insumo ' + n, r.status === 201, r);
}
const insumos = (await api('GET', '/api/insumos', undefined, admin)).data;
const id = n => insumos.find(i => i.nombre === n).id;
const stock = async () => {
  const l = (await api('GET', '/api/insumos', undefined, admin)).data;
  return Object.fromEntries(l.map(i => [i.nombre, Number(i.stock_actual)]));
};
r = await api('POST', '/api/productos', { nombre: 'Agua', precio_venta: 5000, costo_produccion: 1000, receta: [{ insumo_id: id('Vaso'), cantidad: 1 }] }, admin);
check('crear producto Agua', r.status === 201, r);
const agua = r.data.producto.id;
r = await api('POST', '/api/recetas-base', { nombre: 'Base Fresa', insumos: [{ insumo_id: id('Vaso'), cantidad: 1 }, { insumo_id: id('Leche'), cantidad: 2 }, { insumo_id: id('Fresa'), cantidad: 1 }] }, admin);
const rbFresa = r.data.id;
r = await api('POST', '/api/recetas-base', { nombre: 'Base Mango', insumos: [{ insumo_id: id('Vaso'), cantidad: 1 }, { insumo_id: id('Leche'), cantidad: 2 }, { insumo_id: id('Mango'), cantidad: 1 }] }, admin);
const rbMango = r.data.id;
check('crear recetas base', rbFresa && rbMango);
r = await api('POST', '/api/productos', { nombre: 'Batido', precio_venta: 10000, costo_produccion: 3000, es_batido: true }, admin);
const batido = r.data.producto.id;
r = await api('POST', '/api/caja/abrir', { usuario_id: 999, fondo_inicial_cop: 0, turno: 'Mañana' }, admin);
check('abrir caja (ignora usuario_id del body)', r.status === 201 && r.data.sesion.nombre_cajero === 'Admin Principal', r);

console.log('\n== Tasa del día ==');
r = await api('GET', '/api/tasas', undefined, admin);
check('al inicio no hay tasa de hoy', r.status === 200 && r.data.hoy === null, r.data);
r = await api('POST', '/api/ventas', { items: [{ producto_id: batido, cantidad: 1 }], pagos: [{ metodo_pago: 'Zelle', moneda: 'USD', monto_original: 5 }], tasas: { USD: 4000, VES: 100 } }, admin);
check('sin tasa de hoy: venta en USD rechazada', r.status === 400 && r.data.sin_tasa === true, r);
r = await api('POST', '/api/ventas', { items: [{ producto_id: batido, cantidad: 1 }], pagos: [{ metodo_pago: 'Efectivo COP', moneda: 'COP', monto_original: 10000 }] }, admin);
check('sin tasa de hoy: venta en pesos sí se permite', r.status === 201, r);
r = await api('POST', '/api/tasas', { USD: -5, VES: 100 }, admin);
check('tasa inválida -> 400', r.status === 400, r);
r = await api('POST', '/api/tasas', { USD: 4000, VES: 100 }, admin);
check('admin fija la tasa del día', r.status === 201 && r.data.hoy.USD === 4000 && r.data.hoy.VES === 100, r);
check('queda registrado quién la fijó', r.data.hoy.fijada_por === 'Admin Principal', r.data.hoy);

console.log('\n== Venta y anulación ==');
const saldos = async () => Object.fromEntries((await api('GET', '/api/tesoreria/saldos', undefined, admin)).data.map(c => [c.nombre, Number(c.saldo)]));
const s0 = await saldos();
const venta = {
  items: [
    { producto_id: agua, cantidad: 2 },
    { producto_id: batido, cantidad: 1, receta_base_ids: [rbFresa, rbMango] }
  ],
  pagos: [{ metodo_pago: 'Zelle', moneda: 'USD', monto_original: 5 }],
  tasas: { USD: 4000, VES: 100 }, tipo_transaccion: 'Venta'
};
r = await api('POST', '/api/ventas', venta, admin);
check('venta registrada', r.status === 201, r);
const ventaId = r.data.venta_id;
let st = await stock();
check('stock tras venta (Vaso 97, Leche 98, Fresa 99, Mango 99)', st.Vaso === 97 && st.Leche === 98 && st.Fresa === 99 && st.Mango === 99, st);
let s1 = await saldos();
check('Zelle +5 USD', near(s1.Zelle - s0.Zelle, 5), { antes: s0.Zelle, despues: s1.Zelle });

// Cambiar la receta después de vender: la anulación debe devolver lo realmente descontado
await api('PUT', `/api/recetas-base/${rbFresa}`, { nombre: 'Base Fresa', insumos: [{ insumo_id: id('Vaso'), cantidad: 1 }, { insumo_id: id('Leche'), cantidad: 9 }, { insumo_id: id('Fresa'), cantidad: 1 }] }, admin);
r = await api('POST', `/api/ventas/${ventaId}/anular`, { admin_password: 'mala' }, admin);
check('anular con clave mala -> 401', r.status === 401, r);
r = await api('POST', `/api/ventas/${ventaId}/anular`, { admin_password: 'AdminPrueba1' }, admin);
check('anular venta', r.status === 200, r);
st = await stock();
check('stock vuelve a 100 aunque cambió la receta', Object.values(st).every(v => v === 100), st);
let s2 = await saldos();
check('Zelle vuelve al saldo inicial (no resta 20.000)', near(s2.Zelle, s0.Zelle), { inicial: s0.Zelle, ahora: s2.Zelle });
r = await api('POST', `/api/ventas/${ventaId}/anular`, { admin_password: 'AdminPrueba1' }, admin);
check('anular dos veces -> 400', r.status === 400, r);

console.log('\n== Validaciones de venta ==');
r = await api('POST', '/api/ventas', { ...venta, items: [{ producto_id: agua, cantidad: -3 }] }, admin);
check('cantidad negativa -> 400', r.status === 400, r);
r = await api('POST', '/api/ventas', { ...venta, pagos: [{ metodo_pago: 'Zelle', moneda: 'USD', monto_original: -5 }] }, admin);
check('monto negativo -> 400', r.status === 400, r);
r = await api('POST', '/api/ventas', { ...venta, tasas: { USD: 9000, VES: 100 } }, admin);
check('tasa distinta a la del día (manipulada o vieja) -> 409', r.status === 409 && r.data.tasas.USD === 4000, r);
r = await api('POST', '/api/ventas', { ...venta, tasas: undefined }, admin);
check('sin enviar tasa, el servidor usa la del día', r.status === 201 && r.data.pagos[0].tasa_cambio === 4000, r);
await api('POST', `/api/ventas/${r.data.venta_id}/anular`, { admin_password: 'AdminPrueba1' }, admin);
r = await api('POST', '/api/clientes', { nombre: 'Cliente <script>alert(1)</script>', identificacion: 'V-1', telefono: '', limite_credito: 0 }, admin);
check('crear cliente', r.status === 201, r);
const cli = r.data.cliente;
check('XSS: se quitan < y > del nombre', !/[<>]/.test(cli.nombre), cli.nombre);
r = await api('POST', '/api/ventas', { ...venta, cortesia_gym: true, cliente_id: cli.id, items: [{ producto_id: agua, cantidad: 1, costo_produccion_calculado: 0 }], pagos: [{ metodo_pago: 'Crédito', moneda: 'COP', monto_original: 0 }] }, admin);
check('cortesía gym a cliente normal -> 400', r.status === 400, r);

console.log('\n== Ventas concurrentes (SQLite) ==');
const conc = await Promise.all(Array.from({ length: 8 }, () => api('POST', '/api/ventas', { ...venta, items: [{ producto_id: agua, cantidad: 1 }] }, admin)));
check('8 ventas simultáneas sin error', conc.every(x => x.status === 201), conc.map(x => x.status));
st = await stock();
check('Vaso descontado exactamente 8', st.Vaso === 92, st);

console.log('\n== Transferencias ==');
const t0 = await saldos();
r = await api('POST', '/api/tesoreria/transferir', { cuenta_origen: 'Efectivo COP', cuenta_destino: 'Bancolombia', monto_origen: 100, tasa_cambio: 1, motivo: 'prueba' }, admin);
check('transferencia', r.status === 201, r);
const t1 = await saldos();
check('origen -100 (no -200)', near(t1['Efectivo COP'] - t0['Efectivo COP'], -100), [t0['Efectivo COP'], t1['Efectivo COP']]);
check('destino +100 (no +200)', near(t1.Bancolombia - t0.Bancolombia, 100), [t0.Bancolombia, t1.Bancolombia]);
r = await api('POST', '/api/tesoreria/transferir', { cuenta_origen: 'Efectivo COP', cuenta_destino: 'NoExiste', monto_origen: 1, tasa_cambio: 1, motivo: 'x' }, admin);
check('cuenta inexistente -> 400', r.status === 400, r);

console.log('\n== Crédito y abonos ==');
r = await api('POST', `/api/clientes/${cli.id}/deuda`, { monto: 10000, notas: 'prueba' }, admin);
check('registrar deuda 10.000', r.status === 201, r);
const a0 = await saldos();
const ab = await Promise.all([1, 2].map(() => api('POST', '/api/abonos', { cliente_id: cli.id, pagos: [{ metodo_pago: 'Efectivo COP', moneda: 'COP', monto_original: 3000 }], tasas: { USD: 4000, VES: 100 } }, admin)));
check('2 abonos simultáneos de 3.000', ab.every(x => x.status === 201), ab);
let det = (await api('GET', `/api/clientes/${cli.id}`, undefined, admin)).data;
check('saldo deudor = 4.000 (no se pisan)', near(det.cliente.saldo_deudor, 4000), det.cliente.saldo_deudor);
r = await api('DELETE', `/api/abonos/${ab[0].data.abono_id}`, { admin_password: 'AdminPrueba1' }, admin);
check('eliminar abono', r.status === 200, r);
det = (await api('GET', `/api/clientes/${cli.id}`, undefined, admin)).data;
check('saldo deudor vuelve a 7.000', near(det.cliente.saldo_deudor, 7000), det.cliente.saldo_deudor);
const a1 = await saldos();
check('tesorería: solo queda 1 abono (+3.000)', near(a1['Efectivo COP'] - a0['Efectivo COP'], 3000), [a0['Efectivo COP'], a1['Efectivo COP']]);
r = await api('POST', '/api/abonos', { cliente_id: cli.id, pagos: [{ metodo_pago: 'Efectivo COP', moneda: 'COP', monto_original: -500 }] }, admin);
check('abono negativo -> 400', r.status === 400, r);

console.log('\n== Usuarios y permisos ==');
r = await api('POST', '/api/usuarios', { nombre: 'Cajero Prueba', turno: 'Mañana', permisos: ['pos', 'caja'] }, admin);
check('crear usuario sin contraseña -> 400 (ya no hay 1234)', r.status === 400, r);
r = await api('POST', '/api/usuarios', { nombre: 'Cajero Prueba', turno: 'Mañana', password: 'cajero1', permisos: ['pos', 'caja'] }, admin);
check('crear usuario', r.status === 201, r);
const cajeroId = r.data.id;
r = await api('POST', '/api/auth/login', { usuario: 'Cajero Prueba', password: 'cajero1' });
let caj = r.data.token;
check('cajero debe cambiar contraseña', r.data.debe_cambiar_password === true, r.data);
await api('POST', '/api/auth/cambiar-password', { password_nueva: 'cajero22' }, caj);
check('cajero puede vender', (await api('POST', '/api/ventas', { ...venta, items: [{ producto_id: agua, cantidad: 1 }] }, caj)).status === 201);
check('cajero NO crea insumos -> 403', (await api('POST', '/api/insumos', { nombre: 'X' }, caj)).status === 403);
check('cajero NO ve reportes -> 403', (await api('GET', '/api/reportes/ventas', undefined, caj)).status === 403);
check('cajero NO transfiere -> 403', (await api('POST', '/api/tesoreria/transferir', { cuenta_origen: 'Zelle', cuenta_destino: 'Binance', monto_origen: 1, tasa_cambio: 1, motivo: 'x' }, caj)).status === 403);
check('cajero NO lista usuarios -> 403', (await api('GET', '/api/usuarios', undefined, caj)).status === 403);
check('cajero NO puede fijar la tasa -> 403', (await api('POST', '/api/tasas', { USD: 1, VES: 1 }, caj)).status === 403);
r = await api('GET', '/api/tasas', undefined, caj);
check('cajero sí ve la tasa del día', r.status === 200 && r.data.hoy && r.data.hoy.USD === 4000, r.data);
check('cajero sí registra gastos (permiso caja)', (await api('GET', '/api/gastos', undefined, caj)).status === 200);
// Dar permiso de reportes: debe aplicar sin volver a iniciar sesión
await api('PUT', `/api/usuarios/${cajeroId}`, { nombre: 'Cajero Prueba', turno: 'Mañana', permisos: ['pos', 'caja', 'reportes'] }, admin);
check('permiso nuevo aplica de inmediato', (await api('GET', '/api/reportes/ventas', undefined, caj)).status === 200);

console.log('\n== Límite de intentos de la clave de administrador ==');
// Venta del cajero para intentar anularla
r = await api('POST', '/api/ventas', { ...venta, items: [{ producto_id: agua, cantidad: 1 }] }, caj);
const ventaCaj = r.data.venta_id;
const intentos = [];
for (let i = 0; i < 5; i++) {
  intentos.push((await api('POST', `/api/ventas/${ventaCaj}/anular`, { admin_password: 'adivinando' + i }, caj)).status);
}
check('5 claves de admin equivocadas -> 401', intentos.every(s => s === 401), intentos);
r = await api('POST', `/api/ventas/${ventaCaj}/anular`, { admin_password: 'AdminPrueba1' }, caj);
check('bloqueado 15 min aunque ahora acierte -> 429', r.status === 429, r);
r = await api('POST', '/api/restore-db', Buffer.from('x'), caj, { 'x-admin-password': 'AdminPrueba1' });
check('el bloqueo aplica también a restaurar BD', r.status === 429, r);
r = await api('POST', `/api/ventas/${ventaCaj}/anular`, { admin_password: 'AdminPrueba1' }, admin);
check('el admin (otro usuario) no queda bloqueado', r.status === 200, r);
r = await api('POST', `/api/ventas/${ventaCaj}/anular`, { admin_password: 'mala' }, admin);
check('un acierto reinicia el contador del admin (1 fallo -> 401, no 429)', r.status === 401 || r.status === 400, r);

await api('POST', '/api/auth/logout', {}, caj);
check('token revocado tras logout -> 401', (await api('GET', '/api/productos', undefined, caj)).status === 401);

console.log('\n== Restaurar BD ==');
r = await api('POST', '/api/restore-db', Buffer.from('esto no es sqlite'), admin);
check('archivo inválido -> 400', r.status === 400, r);
r = await api('POST', '/api/restore-db', Buffer.from('x'));
check('sin credenciales -> 401', r.status === 401, r);

console.log(`\nRESULTADO: ${oks} OK, ${fallos} FALLAS`);
process.exit(fallos ? 1 : 0);
