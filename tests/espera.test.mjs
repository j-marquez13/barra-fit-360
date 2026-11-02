// Prueba de las facturas en espera (pedido con el nombre del cliente para cobrarlo después).
// Se ejecuta al final (usa el admin de flujos.test.mjs, el producto "Agua" y la caja abierta).
// Uso: npm test   (ver tests/run.mjs)
const BASE = process.argv[2] || 'http://localhost:3999';
let fallos = 0;
const check = (n, c, i = '') => { console.log((c ? '  OK   ' : '  FALLA ') + n + (c ? '' : '  -> ' + JSON.stringify(i))); if (!c) fallos++; };
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}

const t = (await api('POST', '/api/auth/login', { usuario: 'Admin Principal', password: 'AdminPrueba1' })).data.token;
const agua = (await api('GET', '/api/productos', null, t)).data.productos.find(p => p.nombre === 'Agua');
const stockAgua = async () => (await api('GET', '/api/productos', null, t)).data.productos.find(p => p.id === agua.id).stock_disponible;
const items = [{ producto_id: agua.id, cantidad: 2 }];

check('sin sesión no se ven', (await api('GET', '/api/ventas-espera')).status === 401);
let r = await api('POST', '/api/ventas-espera', { nombre: '  ', items }, t);
check('sin nombre -> 400', r.status === 400, r);
r = await api('POST', '/api/ventas-espera', { nombre: 'María', items: [] }, t);
check('sin productos -> 400', r.status === 400, r);

const antes = await stockAgua();
r = await api('POST', '/api/ventas-espera', { nombre: 'María', telefono: '0414 1234567', notas: 'paga al salir', items, total: 10000, resumen: '2x Agua' }, t);
const id1 = r.data && r.data.id;
check('poner en espera con nombre, teléfono y nota', r.status === 201 && r.data.nombre === 'María' && r.data.telefono === '0414 1234567' && r.data.items[0].cantidad === 2 && r.data.usuario_nombre === 'Admin Principal', r);
check('poner en espera NO descuenta inventario', await stockAgua() === antes);
r = await api('GET', '/api/ventas-espera', null, t);
check('aparece en la lista', r.status === 200 && r.data.some(f => f.id === id1), r.data);

r = await api('PUT', `/api/ventas-espera/${id1}`, { nombre: 'María José', items: [{ producto_id: agua.id, cantidad: 3 }], total: 15000, resumen: '3x Agua' }, t);
check('retomar, cambiar y volver a poner en espera actualiza la misma factura', r.status === 200 && r.data.id === id1 && r.data.nombre === 'María José' && r.data.items[0].cantidad === 3, r);

// Cobrarla: la venta lleva espera_id y la factura sale de la lista
r = await api('POST', '/api/ventas', { items: [{ producto_id: agua.id, cantidad: 3 }], pagos: [{ metodo_pago: 'Efectivo COP', moneda: 'COP', monto_original: 15000 }], tasas: { USD: 4000, VES: 100 }, tipo_transaccion: 'Venta', notas: 'Pago rápido · Cliente: María José', espera_id: id1 }, t);
check('cobrar la factura en espera -> venta 201', r.status === 201, r);
check('al cobrarla se descuenta el inventario', await stockAgua() === antes - 3);
r = await api('GET', '/api/ventas-espera', null, t);
check('cobrada: ya no está en espera', !r.data.some(f => f.id === id1), r.data);
r = await api('PUT', `/api/ventas-espera/${id1}`, { nombre: 'X', items }, t);
check('actualizar una ya cobrada -> 404', r.status === 404 && r.data.no_existe === true, r);

r = await api('POST', '/api/ventas-espera', { nombre: 'Pedro', items }, t);
const id2 = r.data.id;
r = await api('DELETE', `/api/ventas-espera/${id2}`, null, t);
check('eliminar una factura en espera', r.status === 200, r);
r = await api('DELETE', `/api/ventas-espera/${id2}`, null, t);
check('eliminarla otra vez -> 404', r.status === 404, r);

// Dejar una en espera para revisar la interfaz
await api('POST', '/api/ventas-espera', { nombre: 'Ana (prueba)', telefono: '0424 5550000', notas: 'paga con Zelle', items: [{ producto_id: agua.id, cantidad: 1 }], total: 5000, resumen: '1x Agua' }, t);
console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLAS' : 'todo OK'}`);
process.exit(fallos ? 1 : 0);
