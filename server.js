process.env.TZ = 'America/Caracas';
import express from 'express';
import bcrypt from 'bcryptjs';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { processSale, anularVenta } from './controllers/salesController.js';
import { createClient, getClients, getClientDetails, processAbono, registrarDeuda, deleteAbono } from './controllers/creditController.js';
import { getInsumos, createInsumo, updateInsumo, restockInsumo, getMermas, createMerma, getProductos, createProducto, updateProducto, deleteProducto, deleteInsumo, getValorizacionInventario, getOrdenCompra, getProductoReceta } from './controllers/inventoryController.js';
import { cierreDiario, cierreSemanal, historialVentas } from './controllers/reportsController.js';
import { listarGastos, registrarGasto } from './controllers/expensesController.js';
import { estadoCaja, abrirCaja, cerrarCaja } from './controllers/cashierController.js';
import { getSaldos, transferirFondos } from './controllers/treasuryController.js';
import { initializeDatabase } from './initDb.js';
import * as db from './db.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Servir archivos estáticos del frontend
app.use(express.static('public'));

// Ruta principal para verificar salud del servidor
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'Barra Fit 360 Backend', timestamp: new Date() });
});

app.get('/api/fix-timezone', async (req, res) => {
  try {
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
    if (isPg) {
      await db.execute("UPDATE insumos SET created_at = created_at - interval '4 hours', updated_at = updated_at - interval '4 hours'");
      await db.execute("UPDATE mermas SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE productos SET created_at = created_at - interval '4 hours', updated_at = updated_at - interval '4 hours'");
      await db.execute("UPDATE clientes SET created_at = created_at - interval '4 hours', updated_at = updated_at - interval '4 hours'");
      await db.execute("UPDATE ventas SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE pagos_ventas SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE abonos_credito SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE pagos_abonos SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE gastos SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE sesiones_caja SET fecha_apertura = fecha_apertura - interval '4 hours'");
      await db.execute("UPDATE sesiones_caja SET fecha_cierre = fecha_cierre - interval '4 hours' WHERE fecha_cierre IS NOT NULL");
      res.json({ success: true, message: 'Fechas arregladas en PostgreSQL (Railway)' });
    } else {
      await db.execute("UPDATE insumos SET created_at = datetime(created_at, '-4 hours'), updated_at = datetime(updated_at, '-4 hours')");
      await db.execute("UPDATE mermas SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE productos SET created_at = datetime(created_at, '-4 hours'), updated_at = datetime(updated_at, '-4 hours')");
      await db.execute("UPDATE clientes SET created_at = datetime(created_at, '-4 hours'), updated_at = datetime(updated_at, '-4 hours')");
      await db.execute("UPDATE ventas SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE pagos_ventas SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE abonos_credito SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE pagos_abonos SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE gastos SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE sesiones_caja SET fecha_apertura = datetime(fecha_apertura, '-4 hours')");
      await db.execute("UPDATE sesiones_caja SET fecha_cierre = datetime(fecha_cierre, '-4 hours') WHERE fecha_cierre IS NOT NULL");
      res.json({ success: true, message: 'Fechas arregladas en SQLite local' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para descargar la base de datos (Backup)
app.get('/api/backup-db', (req, res) => {
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


app.get('/api/productos', getProductos);
app.post('/api/productos', createProducto);
app.put('/api/productos/:id', updateProducto);
app.get('/api/insumos', getInsumos);
app.post('/api/insumos', createInsumo);
app.put('/api/insumos/:id', updateInsumo);

app.delete('/api/insumos/:id', deleteInsumo);
app.post('/api/insumos/:id/restock', restockInsumo);

app.get('/api/mermas', getMermas);
app.post('/api/mermas', createMerma);

app.get('/api/inventario/valorizacion', getValorizacionInventario);
app.get('/api/inventario/orden-compra', getOrdenCompra);
// ============================================
// RUTAS DE VENTAS (POS)
// ============================================
app.post('/api/ventas', processSale);
app.post('/api/ventas/:id/anular', anularVenta);


// ============================================
// RUTAS DE INVENTARIO Y CATÁLOGO
// ============================================
app.get('/api/clientes', getClients);
app.post('/api/clientes', createClient);
app.get('/api/clientes/:id', getClientDetails);
app.post('/api/abonos', processAbono);
app.delete('/api/abonos/:id', deleteAbono);
app.post('/api/clientes/:id/deuda', registrarDeuda);

// ============================================
// RUTAS DE REPORTES
// ============================================
app.get('/api/reportes/cierre-diario', cierreDiario);
app.get('/api/reportes/cierre-semanal', cierreSemanal);
app.get('/api/reportes/ventas', historialVentas);

// ============================================
// RUTAS DE GASTOS Y NÓMINA
// ============================================
app.get('/api/gastos', listarGastos);
app.post('/api/gastos', registrarGasto);

// ============================================
// RUTAS DE CAJA (TURNOS)
// ============================================
app.get('/api/caja/estado', estadoCaja);
app.post('/api/caja/abrir', abrirCaja);
app.post('/api/caja/cerrar', cerrarCaja);

// ============================================
// RUTAS DE USUARIOS Y AUTENTICACIÓN
// ============================================

// Listar usuarios (sin exponer password_hash)
app.get('/api/usuarios', async (req, res) => {
  try {
    const usuarios = await db.query('SELECT id, nombre, rol, turno, permisos FROM usuarios ORDER BY turno, nombre');
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// Crear nuevo usuario con contraseña hasheada y permisos
app.post('/api/usuarios', async (req, res) => {
  try {
    const { nombre, turno, password, permisos } = req.body;
    if (!nombre || !turno) return res.status(400).json({ error: 'Nombre y turno son requeridos' });
    const turnoValido = (turno === 'Tarde') ? 'Tarde' : (turno === 'Completo' ? 'Completo' : 'Mañana');
    const rawPass = password && password.trim() ? password.trim() : '1234';
    const passwordHash = await bcrypt.hash(rawPass, 10);
    const permisosJson = permisos ? JSON.stringify(permisos) : '["pos","caja"]';
    const result = await db.execute(
      "INSERT INTO usuarios (nombre, rol, turno, password_hash, permisos) VALUES ($1, 'Cajero', $2, $3, $4)",
      [nombre.trim(), turnoValido, passwordHash, permisosJson]
    );
    const rows = await db.query('SELECT id, nombre, rol, turno, permisos FROM usuarios WHERE id = $1', [result[0].id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// Editar usuario existente (nombre, turno, permisos, y opcionalmente password)
app.put('/api/usuarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, turno, permisos, password } = req.body;
    if (!nombre || !turno) return res.status(400).json({ error: 'Nombre y turno son requeridos' });
    
    const turnoValido = (turno === 'Tarde') ? 'Tarde' : (turno === 'Completo' ? 'Completo' : 'Mañana');
    const permisosJson = permisos ? JSON.stringify(permisos) : '["pos","caja"]';
    
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
app.put('/api/usuarios/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    const { password_actual, password_nueva } = req.body;
    if (!password_nueva || password_nueva.length < 4) {
      return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 4 caracteres' });
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
    const { usuario_id, password } = req.body;
    if (!usuario_id || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    const rows = await db.query(
      'SELECT id, nombre, rol, turno, permisos, password_hash FROM usuarios WHERE id = $1',
      [usuario_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    const user = rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: 'Este usuario no tiene contraseña configurada' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    
    // Parsear permisos si es string
    let permisosArray = [];
    try {
      permisosArray = typeof user.permisos === 'string' ? JSON.parse(user.permisos) : user.permisos;
    } catch(e) {
      permisosArray = ['pos', 'caja'];
    }

    // Autenticación exitosa — devolver datos sin el hash
    res.json({
      ok: true,
      usuario: { id: user.id, nombre: user.nombre, rol: user.rol, turno: user.turno, permisos: permisosArray }
    });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ============================================
// RUTAS DE TESORERÍA (SALDOS Y TRANSFERENCIAS)
// ============================================
app.get('/api/tesoreria/saldos', getSaldos);

// Ruta para descargar la base de datos (Backup manual)
app.get('/api/backup', async (req, res) => {
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
app.post('/api/restore-db', express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
  const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
  if (isPg) return res.status(400).send('No se puede restaurar SQLite sobre PostgreSQL.');
  
  const fs = await import('fs');
  const path = await import('path');
  const dbFile = process.env.DB_PATH || 'database.sqlite';
  const resolvedPath = path.resolve(process.cwd(), dbFile);
  
  try {
    fs.writeFileSync(resolvedPath, req.body);
    res.send('Base de datos restaurada con éxito. Reiniciando servidor...');
    setTimeout(() => {
      process.exit(0); // Forzar reinicio en Railway
    }, 1000);
  } catch (error) {
    res.status(500).send('Error al restaurar: ' + error.message);
  }
});
app.post('/api/tesoreria/transferir', transferirFondos);

// ============================================
// RUTA DE RESET DEL SISTEMA (PONER STOCK EN 0, BORRAR VENTAS, CRÉDITOS, ETC.)
// ============================================
app.post('/api/reset-sistema', async (req, res) => {
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
