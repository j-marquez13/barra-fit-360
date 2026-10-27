process.env.TZ = 'America/Caracas';
import express from 'express';
import bcrypt from 'bcryptjs';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { processSale, anularVenta } from './controllers/salesController.js';
import { createClient, getClients, getClientDetails, processAbono, registrarDeuda, deleteAbono, updateClient } from './controllers/creditController.js';
import { getInsumos, createInsumo, updateInsumo, restockInsumo, getMermas, createMerma, toggleMermaGanancia, getProductos, createProducto, updateProducto, deleteProducto, deleteInsumo, getValorizacionInventario, getOrdenCompra, confirmarOrdenCompra, listarOrdenesCompra, getOrdenCompraDetalle, recibirOrdenCompra, borrarOrdenCompra, getProductoReceta, getRecetasBase, createRecetaBase, updateRecetaBase, deleteRecetaBase, toggleRecetaBaseBatido } from './controllers/inventoryController.js';
import { cierreDiario, cierreSemanal, cierreRango, historialVentas } from './controllers/reportsController.js';
import { listarGastos, registrarGasto } from './controllers/expensesController.js';
import { estadoCaja, abrirCaja, cerrarCaja, cierreDia, listarCierresAdmin } from './controllers/cashierController.js';
import { getSaldos, transferirFondos } from './controllers/treasuryController.js';
import { initializeDatabase } from './initDb.js';
import * as db from './db.js';
import { signToken, verifyToken, requireAuth, requireAdmin, requirePermiso, revokeToken, getTokenFromRequest, esAdmin, validarPasswordAdmin } from './auth.js';
import * as whatsapp from './controllers/whatsappController.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// ============================================
// Protección contra XSS almacenado: el frontend inserta nombres, notas, etc.
// con innerHTML, así que se eliminan los caracteres < y > de todos los textos
// recibidos (excepto contraseñas, que nunca se muestran).
// ============================================
function limpiarTexto(valor, clave = '') {
  if (typeof valor === 'string') {
    return /password/i.test(clave) ? valor : valor.replace(/[<>]/g, '');
  }
  if (Array.isArray(valor)) return valor.map(v => limpiarTexto(v, clave));
  if (valor && typeof valor === 'object') {
    for (const k of Object.keys(valor)) valor[k] = limpiarTexto(valor[k], k);
  }
  return valor;
}
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) limpiarTexto(req.body);
  next();
});

// Servir archivos estáticos del frontend
app.use(express.static('public'));

// ============================================
// AUTH MIDDLEWARE — Protege todas las rutas /api
// excepto las públicas (login, salud y estado de caja).
// /api/restore-db hace su propia verificación (token admin o contraseña admin).
// ============================================
const PUBLIC_ROUTES = [
  /^\/api\/health$/,
  /^\/api\/auth\/login$/,
  /^\/api\/caja\/estado$/,
  /^\/api\/restore-db$/
];

app.use('/api', (req, res, next) => {
  const fullPath = (req.baseUrl + req.path).split('?')[0];
  const isPublic = PUBLIC_ROUTES.some(re => re.test(fullPath));
  if (isPublic) return next();
  return requireAuth(req, res, next);
});

// Ruta principal para verificar salud del servidor
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'Barra Fit 360 Backend', timestamp: new Date() });
});

// Permisos por módulo (los administradores siempre pasan)
const inventario = requirePermiso('inventario');
const reportes = requirePermiso('reportes');
const credito = requirePermiso('credito');
const caja = requirePermiso('caja');
const tesoreria = requirePermiso('tesoreria');
const pos = requirePermiso('pos');

// Endpoint para descargar la base de datos (Backup)
app.get('/api/backup-db', requireAdmin, (req, res) => {
  const dbFile = process.env.DB_PATH || 'database.sqlite';
  const dbPath = path.resolve(dbFile);
  
  if (fs.existsSync(dbPath)) {
    res.download(dbPath, 'backup_barrafit_360.sqlite', (err) => {
      if (err) {
        console.error('Error al enviar el archivo:', err);
        if (!res.headersSent) res.status(500).send('Error al descargar el backup');
      }
    });
  } else {
    res.status(404).send('No se encontró el archivo de la base de datos local');
  }
});


// Catálogo: lectura para cualquier usuario (lo usa el POS); escritura solo con permiso de inventario.
app.get('/api/productos', getProductos);
app.post('/api/productos', inventario, createProducto);
app.put('/api/productos/:id', inventario, updateProducto);
app.get('/api/productos/:id/receta', getProductoReceta);
app.delete('/api/productos/:id', inventario, deleteProducto);

app.get('/api/recetas-base', getRecetasBase);
app.post('/api/recetas-base', inventario, createRecetaBase);
app.put('/api/recetas-base/:id', inventario, updateRecetaBase);
app.delete('/api/recetas-base/:id', inventario, deleteRecetaBase);
app.post('/api/recetas-base/:id/incluir-batido', inventario, toggleRecetaBaseBatido);
app.get('/api/insumos', getInsumos);
app.post('/api/insumos', inventario, createInsumo);
app.put('/api/insumos/:id', inventario, updateInsumo);

app.delete('/api/insumos/:id', inventario, deleteInsumo);
app.post('/api/insumos/:id/restock', inventario, restockInsumo);

app.get('/api/mermas', inventario, getMermas);
app.post('/api/mermas', inventario, createMerma);
app.post('/api/mermas/:id/descontar-ganancia', inventario, toggleMermaGanancia);

app.get('/api/inventario/valorizacion', inventario, getValorizacionInventario);
app.get('/api/inventario/orden-compra', inventario, getOrdenCompra);
app.post('/api/inventario/orden-compra/confirmar', inventario, confirmarOrdenCompra);
app.get('/api/inventario/ordenes-compra', inventario, listarOrdenesCompra);
app.get('/api/inventario/ordenes-compra/:id', inventario, getOrdenCompraDetalle);
app.post('/api/inventario/ordenes-compra/:id/recibir', inventario, recibirOrdenCompra);
app.delete('/api/inventario/ordenes-compra/:id', inventario, borrarOrdenCompra);
// ============================================
// RUTAS DE VENTAS (POS)
// ============================================
app.post('/api/ventas', pos, processSale);
// La anulación además exige la contraseña de un administrador (ver salesController).
app.post('/api/ventas/:id/anular', anularVenta);


// ============================================
// RUTAS DE CLIENTES Y CRÉDITO
// ============================================
app.get('/api/clientes', getClients);
app.post('/api/clientes', requirePermiso('pos', 'credito'), createClient);
app.put('/api/clientes/:id', credito, updateClient);
app.get('/api/clientes/:id', getClientDetails);
app.post('/api/abonos', credito, processAbono);
app.delete('/api/abonos/:id', credito, deleteAbono);
app.post('/api/clientes/:id/deuda', credito, registrarDeuda);

// ============================================
// RUTAS DE REPORTES
// ============================================
app.get('/api/reportes/cierre-diario', reportes, cierreDiario);
app.get('/api/reportes/cierre-semanal', reportes, cierreSemanal);
app.get('/api/reportes/cierre-rango', reportes, cierreRango);
app.get('/api/reportes/ventas', reportes, historialVentas);

// ============================================
// RUTAS DE GASTOS Y NÓMINA
// ============================================
app.get('/api/gastos', caja, listarGastos);
app.post('/api/gastos', caja, registrarGasto);

// ============================================
// RUTAS DE CAJA (TURNOS)
// ============================================
app.get('/api/caja/estado', estadoCaja);
app.post('/api/caja/abrir', abrirCaja);
app.post('/api/caja/cerrar', cerrarCaja);
app.get('/api/caja/cierre-dia', cierreDia);

// Histórico de cierres diarios (solo administrador)
app.get('/api/admin/cierres', requireAdmin, listarCierresAdmin);

// ============================================
// RUTAS DE USUARIOS Y AUTENTICACIÓN
// ============================================

// Listar usuarios (sin exponer password_hash) — solo administrador
app.get('/api/usuarios', requireAdmin, async (req, res) => {
  try {
    const usuarios = await db.query('SELECT id, nombre, rol, turno, permisos FROM usuarios ORDER BY turno, nombre');
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// Crear nuevo usuario con contraseña hasheada y permisos
app.post('/api/usuarios', requireAdmin, async (req, res) => {
  try {
    const { nombre, turno, password, permisos } = req.body;
    if (!nombre || !turno) return res.status(400).json({ error: 'Nombre y turno son requeridos' });
    const turnoValido = (turno === 'Tarde') ? 'Tarde' : (turno === 'Completo' ? 'Completo' : 'Mañana');
    // Ya no hay contraseña por defecto ('1234'): se exige una de al menos 6 caracteres.
    // El usuario deberá cambiarla en su primer inicio de sesión.
    if (!password || password.trim().length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const existe = await db.query('SELECT id FROM usuarios WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))', [nombre]);
    if (existe.length > 0) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
    const passwordHash = await bcrypt.hash(password.trim(), 10);
    const permisosJson = Array.isArray(permisos) ? JSON.stringify(permisos) : '["pos","caja"]';
    const insertSql = db.isPostgres()
      ? "INSERT INTO usuarios (nombre, rol, turno, password_hash, permisos, debe_cambiar_password) VALUES ($1, 'Cajero', $2, $3, $4, 1) RETURNING id"
      : "INSERT INTO usuarios (nombre, rol, turno, password_hash, permisos, debe_cambiar_password) VALUES ($1, 'Cajero', $2, $3, $4, 1)";
    const result = await db.execute(insertSql, [nombre.trim(), turnoValido, passwordHash, permisosJson]);
    const rows = await db.query('SELECT id, nombre, rol, turno, permisos FROM usuarios WHERE id = $1', [result[0].id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// Editar usuario existente (nombre, turno, permisos, y opcionalmente password)
app.put('/api/usuarios/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, turno, permisos, password } = req.body;
    if (!nombre || !turno) return res.status(400).json({ error: 'Nombre y turno son requeridos' });
    
    const turnoValido = (turno === 'Tarde') ? 'Tarde' : (turno === 'Completo' ? 'Completo' : 'Mañana');
    const permisosJson = Array.isArray(permisos) ? JSON.stringify(permisos) : '["pos","caja"]';

    if (password && password.trim().length > 0 && password.trim().length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    if (password && password.trim().length > 0) {
      const passwordHash = await bcrypt.hash(password.trim(), 10);
      await db.execute(
        'UPDATE usuarios SET nombre = $1, turno = $2, permisos = $3, password_hash = $4 WHERE id = $5',
        [nombre.trim(), turnoValido, permisosJson, passwordHash, id]
      );
    } else {
      await db.execute(
        'UPDATE usuarios SET nombre = $1, turno = $2, permisos = $3 WHERE id = $4',
        [nombre.trim(), turnoValido, permisosJson, id]
      );
    }
    const rows = await db.query('SELECT id, nombre, rol, turno, permisos FROM usuarios WHERE id = $1', [id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// Cambiar contraseña de usuario
app.put('/api/usuarios/:id/password', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { password_actual, password_nueva } = req.body;
    if (!password_nueva || password_nueva.length < 6) {
      return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 6 caracteres' });
    }
    if (!password_actual) {
      return res.status(400).json({ error: 'Debe indicar la contraseña actual' });
    }
    // Verificar contraseña actual
    const rows = await db.query('SELECT password_hash FROM usuarios WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const match = await bcrypt.compare(password_actual, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    // Actualizar contraseña
    const nuevoHash = await bcrypt.hash(password_nueva, 10);
    await db.execute('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [nuevoHash, id]);
    res.json({ mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// LOGIN — Validar usuario + contraseña (no abre caja, solo autentica)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    const rows = await db.query(
      'SELECT id, nombre, rol, turno, permisos, password_hash, debe_cambiar_password, intentos_fallidos, bloqueado_hasta FROM usuarios WHERE LOWER(TRIM(nombre)) = LOWER(TRIM($1))',
      [usuario]
    );
    // Mismo mensaje para usuario inexistente o contraseña incorrecta,
    // para no revelar qué nombres de usuario existen.
    const CREDENCIALES_INVALIDAS = 'Usuario o contraseña incorrectos';
    if (rows.length === 0) return res.status(401).json({ error: CREDENCIALES_INVALIDAS });
    const user = rows[0];

    // Bloqueo temporal por demasiados intentos fallidos
    const bloqueadoHasta = user.bloqueado_hasta ? Number(user.bloqueado_hasta) : 0;
    if (bloqueadoHasta > Date.now()) {
      const minutos = Math.ceil((bloqueadoHasta - Date.now()) / 60000);
      return res.status(423).json({ error: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutos} minuto(s).` });
    }

    if (!user.password_hash) {
      return res.status(401).json({ error: CREDENCIALES_INVALIDAS });
    }
    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) {
      const intentos = (parseInt(user.intentos_fallidos) || 0) + 1;
      if (intentos >= 5) {
        const bloqueo = Date.now() + 15 * 60 * 1000;
        await db.execute('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = $1 WHERE id = $2', [bloqueo, user.id]);
        console.log(`🔒 Usuario ${user.id} (${user.nombre}) bloqueado por 15 minutos por intentos fallidos.`);
        return res.status(423).json({ error: 'Demasiados intentos fallidos. Cuenta bloqueada por 15 minutos.' });
      }
      await db.execute('UPDATE usuarios SET intentos_fallidos = $1 WHERE id = $2', [intentos, user.id]);
      return res.status(401).json({ error: CREDENCIALES_INVALIDAS });
    }

    // Login exitoso → resetear contador y bloqueo
    await db.execute('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [user.id]);
    console.log(`✅ Login exitoso: ${user.nombre} (id ${user.id})`);

    // Parsear permisos si es string
    let permisosArray = [];
    try {
      permisosArray = typeof user.permisos === 'string' ? JSON.parse(user.permisos) : user.permisos;
    } catch(e) {
      permisosArray = ['pos', 'caja'];
    }

    const debeCambiar = user.debe_cambiar_password === 1 || user.debe_cambiar_password === true || user.debe_cambiar_password === '1' || user.debe_cambiar_password === 't';

    // Autenticación exitosa — devolver datos sin el hash
    res.json({
      ok: true,
      token: signToken(user),
      debe_cambiar_password: !!debeCambiar,
      usuario: { id: user.id, nombre: user.nombre, rol: user.rol, turno: user.turno, permisos: permisosArray }
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// CAMBIAR CONTRASEÑA (obligatorio en primer login) — requiere token válido
app.post('/api/auth/cambiar-password', requireAuth, async (req, res) => {
  try {
    const { password_nueva } = req.body;
    if (!password_nueva || password_nueva.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const userId = req.usuario.usuario_id;
    const nuevoHash = await bcrypt.hash(password_nueva, 10);
    await db.execute('UPDATE usuarios SET password_hash = $1, debe_cambiar_password = 0 WHERE id = $2', [nuevoHash, userId]);
    res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Error al cambiar contraseña:', err);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// LOGOUT — revoca el token actual para invalidarlo
app.post('/api/auth/logout', requireAuth, (req, res) => {
  try {
    revokeToken(getTokenFromRequest(req));
    res.json({ ok: true, mensaje: 'Sesión cerrada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
});

// ============================================
// RUTAS DE TESORERÍA (SALDOS Y TRANSFERENCIAS)
// ============================================
app.get('/api/tesoreria/saldos', tesoreria, getSaldos);

// Ruta para descargar la base de datos (Backup manual)
app.get('/api/backup', requireAdmin, async (req, res) => {
  const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
  if (isPg) {
    return res.status(400).send('La base de datos actual es PostgreSQL, no SQLite. El respaldo debe hacerse desde Railway.');
  }
  
  const fs = await import('fs');
  const path = await import('path');
  const dbFile = process.env.DB_PATH || 'database.sqlite';
  const resolvedPath = path.resolve(process.cwd(), dbFile);
  
  if (fs.existsSync(resolvedPath)) {
    res.download(resolvedPath, 'database_backup.sqlite', (err) => {
      if (err) {
        console.error('Error al descargar la base de datos:', err);
      }
    });
  } else {
    res.status(404).send('No se encontró el archivo de la base de datos.');
  }
});

// Ruta para subir/restaurar la base de datos
// Permite autenticarse con token de administrador (desde la app) o
// con la contraseña de administrador (desde restaurar.html).
app.post('/api/restore-db', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  // Verificar autenticación: token admin O contraseña admin
  const tokenPayload = verifyToken(getTokenFromRequest(req));
  let isAdmin = false;
  if (tokenPayload) {
    // Permisos actuales desde la BD (no los guardados en el token)
    const rows = await db.query('SELECT rol, permisos FROM usuarios WHERE id = $1', [tokenPayload.usuario_id]);
    isAdmin = rows.length > 0 && esAdmin(rows[0]);
  }

  if (!isAdmin) {
    const pwd = req.headers['x-admin-password'];
    if (pwd) {
      // Los intentos se cuentan por usuario (si trae token) o por IP (restaurar.html)
      if (tokenPayload) req.usuario = { usuario_id: tokenPayload.usuario_id };
      const auth = await validarPasswordAdmin(req, pwd);
      if (auth.status === 429) return res.status(429).send(auth.error);
      isAdmin = auth.ok;
    }
  }
  if (!isAdmin) {
    return res.status(401).send('No autorizado. Se requiere autenticación de administrador.');
  }

  const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
  if (isPg) return res.status(400).send('No se puede restaurar SQLite sobre PostgreSQL.');
  
  const fs = await import('fs');
  const path = await import('path');
  const dbFile = process.env.DB_PATH || 'database.sqlite';
  const resolvedPath = path.resolve(process.cwd(), dbFile);
  
  // Validar que el archivo subido sea realmente una base de datos SQLite
  const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');
  if (!Buffer.isBuffer(req.body) || req.body.length < 100 || !req.body.subarray(0, 16).equals(SQLITE_HEADER)) {
    return res.status(400).send('El archivo no es una base de datos SQLite válida.');
  }

  try {
    // Guardar copia del archivo actual antes de sobrescribirlo
    if (fs.existsSync(resolvedPath)) {
      fs.copyFileSync(resolvedPath, `${resolvedPath}.antes_de_restaurar`);
    }
    fs.writeFileSync(resolvedPath, req.body);
    res.send('Base de datos restaurada con éxito. Reiniciando servidor...');
    setTimeout(() => {
      process.exit(0); // Forzar reinicio en Railway
    }, 1000);
  } catch (error) {
    res.status(500).send('Error al restaurar: ' + error.message);
  }
});
app.post('/api/tesoreria/transferir', tesoreria, transferirFondos);

// ============================================
// RUTAS DE WHATSAPP (RECORDATORIOS AUTOMÁTICOS)
// ============================================
app.get('/api/whatsapp/estado', credito, whatsapp.getEstado);
app.post('/api/whatsapp/conectar', credito, whatsapp.conectar);
app.post('/api/whatsapp/desconectar', credito, whatsapp.desconectar);
app.post('/api/whatsapp/recordatorios/vista-previa', credito, whatsapp.vistaPrevia);
app.post('/api/whatsapp/recordatorios/enviar', credito, whatsapp.enviar);
app.get('/api/whatsapp/recordatorios/progreso', credito, whatsapp.progreso);
app.get('/api/whatsapp/reporte-semanal/estado', credito, whatsapp.reporteSemanalEstado);
app.post('/api/whatsapp/reporte-semanal/config', credito, whatsapp.reporteSemanalGuardarConfig);
app.post('/api/whatsapp/reporte-semanal/enviar', credito, whatsapp.reporteSemanalEnviarAhora);

// ============================================
// RUTA DE RESET DEL SISTEMA (PONER STOCK EN 0, BORRAR VENTAS, CRÉDITOS, ETC.)
// ============================================
app.post('/api/reset-sistema', requireAdmin, async (req, res) => {
  const { confirmacion } = req.body;
  if (confirmacion !== 'RESET TOTAL') {
    return res.status(400).json({ error: 'Debe enviar confirmacion: "RESET TOTAL" para proceder.' });
  }

  try {
    await db.transaction(async (tx) => {
      // 1. Eliminar pagos de abonos
      await tx.execute('DELETE FROM pagos_abonos');
      // 2. Eliminar abonos de crédito
      await tx.execute('DELETE FROM abonos_credito');
      // 3. Eliminar pagos de ventas
      await tx.execute('DELETE FROM pagos_ventas');
      // 4. Eliminar detalle de ventas extras (si existe)
      try { await tx.execute('DELETE FROM detalle_ventas_extras'); } catch(e) { /* tabla puede no existir */ }
      // 5. Eliminar detalle de ventas
      await tx.execute('DELETE FROM detalle_ventas');
      // 6. Eliminar ventas
      await tx.execute('DELETE FROM ventas');
      // 7. Resetear saldo_deudor de clientes a 0
      await tx.execute('UPDATE clientes SET saldo_deudor = 0');
      // 8. Eliminar mermas
      await tx.execute('DELETE FROM mermas');
      // 9. Eliminar gastos
      await tx.execute('DELETE FROM gastos');
      // 10. Eliminar movimientos de tesorería
      try { await tx.execute('DELETE FROM movimientos_tesoreria'); } catch(e) { /* tabla puede no existir */ }
      // 11. Resetear saldos de cuentas bancarias a 0
      try { await tx.execute('UPDATE cuentas_bancarias SET saldo = 0'); } catch(e) { /* tabla puede no existir */ }
      // 12. Eliminar sesiones de caja
      await tx.execute('DELETE FROM sesiones_caja');
      // 13. Poner todo el stock de insumos en 0 (actual y fijo)
      await tx.execute('UPDATE insumos SET stock_actual = 0, stock_fijo = 0');
    });

    console.log('⚠️ RESET DEL SISTEMA ejecutado correctamente.');
    res.json({ ok: true, mensaje: 'Sistema reseteado exitosamente. Stock en 0, ventas, créditos y gastos eliminados.' });
  } catch (err) {
    console.error('Error en reset del sistema:', err);
    res.status(500).json({ error: 'Error al resetear el sistema: ' + err.message });
  }
});

// Iniciar servidor con inicialización de base de datos
async function startServer() {
  try {
    await initializeDatabase();
    whatsapp.initWhatsApp();
    app.listen(PORT, '0.0.0.0', () => {
      
      // Obtener IP local para que el usuario sepa cómo acceder desde su celular
      const interfaces = os.networkInterfaces();
      let localIp = 'localhost';
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            localIp = iface.address;
          }
        }
      }

      console.log(`🚀 Servidor ejecutándose en:`);
      console.log(`   Local: http://localhost:${PORT}`);
      console.log(`   Red (Celular): http://${localIp}:${PORT}`);
      console.log(`📋 Rutas disponibles:`);
      console.log(`   GET  /api/health`);
      console.log(`   GET  /api/productos`);
      console.log(`   GET  /api/insumos`);
      console.log(`   POST /api/ventas`);
      console.log(`   GET  /api/clientes`);
      console.log(`   GET  /api/reportes/cierre-diario`);
      console.log(`   GET  /api/reportes/cierre-semanal`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exit(1);
  }
}

startServer();
