// Prueba de usuarios y permisos: roles, desactivar sin borrar y protecciones.
// Se ejecuta al final (usa el "Admin Principal" de flujos.test.mjs).
// Uso: npm test   (ver tests/run.mjs)
const BASE = process.argv[2] || 'http://localhost:3999';
let fallos = 0;
const check = (n, c, i = '') => { console.log((c ? '  OK   ' : '  FALLA ') + n + (c ? '' : '  -> ' + JSON.stringify(i))); if (!c) fallos++; };
async function api(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const login = async (usuario, password) => api('POST', '/api/auth/login', { usuario, password });

const t = (await login('Admin Principal', 'AdminPrueba1')).data.token;
let r = await api('GET', '/api/usuarios', null, t);
const yo = r.data && r.data.find(u => u.es_yo);
check('lista con estado, actividad y quién soy', r.status === 200 && yo && yo.nombre === 'Admin Principal' && yo.activo === true && typeof yo.turnos === 'number', r.data && r.data[0]);

// Un cajero nunca queda con "acceso total"
r = await api('POST', '/api/usuarios', { nombre: 'Cajero Total', turno: 'Mañana', password: 'cajero123', permisos: ['all', 'pos'] }, t);
check('cajero con "acceso total" -> se guarda solo con sus módulos', r.status === 201 && r.data.rol === 'Cajero' && JSON.parse(r.data.permisos).join() === 'pos', r.data);
const idCaj = r.data.id;

// Administrador: su clave autoriza
r = await api('POST', '/api/usuarios', { nombre: 'Jefa Prueba', turno: 'Completo', password: 'jefa1234', rol: 'Administrador' }, t);
check('crear Administrador -> acceso a todo', r.status === 201 && r.data.rol === 'Administrador' && JSON.parse(r.data.permisos).join() === 'all', r.data);
const idJefa = r.data.id;
r = await api('POST', '/api/inventario-mensual/autorizar', { admin_password: 'jefa1234' }, t);
check('la clave del nuevo Administrador sirve para autorizar', r.status === 200 && r.data.admin === 'Jefa Prueba', r);

// Pasar un cajero a Administrador desde Editar
r = await api('PUT', `/api/usuarios/${idCaj}`, { nombre: 'Cajero Total', turno: 'Mañana', rol: 'Administrador', permisos: [] }, t);
check('cambiar el rol de un cajero a Administrador', r.status === 200 && r.data.rol === 'Administrador', r.data);
r = await api('PUT', `/api/usuarios/${idCaj}`, { nombre: 'Cajero Total', turno: 'Mañana', rol: 'Cajero', permisos: ['pos', 'caja', 'credito'] }, t);
check('y devolverlo a cajero con sus módulos', r.status === 200 && r.data.rol === 'Cajero' && JSON.parse(r.data.permisos).length === 3, r.data);

// Desactivar: no entra, pierde la sesión y su clave ya no autoriza; no se borra
const tCaj = (await login('Cajero Total', 'cajero123')).data.token;
await api('POST', '/api/auth/cambiar-password', { password_nueva: 'cajero456' }, tCaj);
check('cajero activo usa el sistema', (await api('GET', '/api/productos', null, tCaj)).status === 200);
r = await api('PUT', `/api/usuarios/${idCaj}`, { nombre: 'Cajero Total', turno: 'Mañana', rol: 'Cajero', permisos: ['pos'], activo: false }, t);
check('desactivar un usuario', r.status === 200, r);
check('desactivado: su sesión abierta deja de servir', (await api('GET', '/api/productos', null, tCaj)).status === 401);
r = await login('Cajero Total', 'cajero456');
check('desactivado: no puede entrar (mensaje claro)', r.status === 403 && /desactivado/i.test(r.data.error), r);
r = await api('GET', '/api/usuarios', null, t);
check('desactivado: sigue en la lista (no se borró)', r.data.some(u => u.id === idCaj && u.activo === false), r.data);
await api('PUT', `/api/usuarios/${idJefa}`, { nombre: 'Jefa Prueba', turno: 'Completo', rol: 'Administrador', activo: false }, t);
r = await api('POST', '/api/inventario-mensual/autorizar', { admin_password: 'jefa1234' }, t);
check('un Administrador desactivado ya no autoriza con su clave', r.status === 403, r);

// Reactivar con clave nueva: debe cambiarla al entrar
r = await api('PUT', `/api/usuarios/${idCaj}`, { nombre: 'Cajero Total', turno: 'Mañana', rol: 'Cajero', permisos: ['pos'], activo: true, password: 'nueva789' }, t);
check('reactivar con clave nueva', r.status === 200, r);
r = await login('Cajero Total', 'nueva789');
check('reactivado: entra y debe cambiar la clave', r.status === 200 && r.data.debe_cambiar_password === true, r.data);

// Protecciones
r = await api('PUT', `/api/usuarios/${yo.id}`, { nombre: yo.nombre, turno: yo.turno, rol: 'Administrador', activo: false }, t);
check('no puedes desactivarte a ti mismo', r.status === 400, r);
r = await api('PUT', `/api/usuarios/${yo.id}`, { nombre: yo.nombre, turno: yo.turno, rol: 'Cajero', permisos: ['pos'] }, t);
check('no puedes quitarte tu propio rol de Administrador', r.status === 400, r);
r = await api('GET', '/api/usuarios', null, tCaj);
check('un cajero no ve la lista de usuarios', r.status === 401 || r.status === 403, r.status);

console.log(`\nRESULTADO: ${fallos ? fallos + ' FALLAS' : 'todo OK'}`);
process.exit(fallos ? 1 : 0);
