// Prueba de las ventas hechas SIN INTERNET que la tablet sube después.
// Se ejecuta después de cierre.test.mjs (usa su admin, la caja que deja abierta y el producto "Agua").
// Uso: npm test   (ver tests/run.mjs)
const BASE = process.argv[2] || 'http://localhost:3999';
let fallos = 0;
const check = (n, c, i = '') => { console.log((c ? '  OK   ' : '  FALLA ') + n + (c ? '' : '  -> ' + JSON.stringify(i))); if (!c) fallos++; };
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}

const t = (await api('POST', '/api/auth/login', { usuario: 'Admin Principal', password: 'AdminPrueba1' })).data.token;
const tasasViejas = { USD: 4000, VES: 100 };
const agua = (await api('GET', '/api/productos', null, t)).data.productos.find(p => p.nombre === 'Agua').id;
const venta = (extra = {}) => ({
  items: [{ producto_id: agua, cantidad: 1 }],
  pagos: [{ metodo_pago: 'Efectivo COP', moneda: 'COP', monto_original: 5000 }],
  tasas: tasasViejas, tipo_transaccion: 'Venta', ...extra
});
const uid = () => 'prueba-' + Math.random().toString(36).slice(2, 12);
const hace = (ms) => new Date(Date.now() - ms).toISOString();

// La misma venta enviada dos veces (corte de red, reintento de la cola) se registra UNA vez
const u1 = uid();
let r = await api('POST', '/api/ventas', venta({ uid: u1 }), t);
check('venta con código único -> 201', r.status === 201, r);
const id1 = r.data && r.data.venta_id;
r = await api('POST', '/api/ventas', venta({ uid: u1, fecha_offline: hace(0) }), t);
check('reenviar la misma venta -> 200 duplicada, mismo id', r.status === 200 && r.data.duplicada === true && r.data.venta_id === id1, r);

r = await api('POST', '/api/ventas', venta({ uid: 'x' }), t);
check('código de venta inválido -> 400', r.status === 400, r);

// Fecha de la venta sin internet: ni muy vieja ni en el futuro
r = await api('POST', '/api/ventas', venta({ uid: uid(), fecha_offline: hace(3 * 24 * 3600 * 1000) }), t);
check('venta sin internet de hace 3 días -> 400', r.status === 400, r);
r = await api('POST', '/api/ventas', venta({ uid: uid(), fecha_offline: hace(-3600 * 1000) }), t);
check('venta sin internet con fecha futura -> 400', r.status === 400, r);

// Venta de antes de abrir el turno actual (de un turno que ya se cerró) -> rechazada, no se mezcla
r = await api('POST', '/api/ventas', venta({ uid: uid(), fecha_offline: hace(2 * 3600 * 1000) }), t);
check('venta de un turno ya cerrado -> 400 turno_cerrado', r.status === 400 && r.data.turno_cerrado === true, r);

// El admin cambia la tasa mientras la tablet estaba sin internet: la venta pendiente, hecha con la
// tasa anterior DEL MISMO DÍA, se acepta; una venta normal con la tasa vieja sigue dando 409.
r = await api('POST', '/api/tasas', { USD: 4100, VES: 105 }, t);
check('admin cambia la tasa', r.status === 200 || r.status === 201, r);
const pagoUsd = [{ metodo_pago: 'Zelle', moneda: 'USD', monto_original: 1.25 }];
r = await api('POST', '/api/ventas', venta({ uid: uid(), pagos: pagoUsd }), t);
check('venta normal con la tasa vieja -> 409', r.status === 409, r);
const u2 = uid();
r = await api('POST', '/api/ventas', venta({ uid: u2, pagos: pagoUsd, fecha_offline: hace(1000) }), t);
check('venta sin internet con la tasa anterior del día -> 201', r.status === 201, r);
const id2 = r.data && r.data.venta_id;
r = await api('POST', '/api/ventas', venta({ uid: uid(), pagos: pagoUsd, tasas: { USD: 9999, VES: 1 }, fecha_offline: hace(1000) }), t);
check('venta sin internet con una tasa que nunca se fijó -> 409', r.status === 409, r);

// La venta subida aparece en el historial de hoy
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
r = await api('GET', `/api/reportes/ventas?desde=${hoy}&hasta=${hoy}`, null, t);
const ids = ((r.data && r.data.ventas) || []).map(v => v.id);
check('la venta sin internet aparece en el historial de hoy', ids.includes(id2), { id2, ids: ids.slice(0, 10) });

// Dejar la tasa como estaba para no afectar otras pruebas
await api('POST', '/api/tasas', tasasViejas, t);

console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLAS' : 'todo OK'}`);
process.exit(fallos ? 1 : 0);
