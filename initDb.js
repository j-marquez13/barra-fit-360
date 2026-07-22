import * as db from './db.js';
import bcrypt from 'bcryptjs';


/**
 * Inicializador de Base de Datos SQLite para Barra Fit 360.
 * Crea automáticamente las tablas, triggers y datos semilla
 * cuando se usa SQLite como motor de base de datos.
 * 
 * Para PostgreSQL, se asume que el esquema ya fue creado con schema.sql.
 */

const usePostgres = process.env.DATABASE_URL || process.env.PGHOST;

export async function initializeDatabase() {
  if (usePostgres) {
    console.log('⚡ Usando PostgreSQL — se asume que el esquema ya fue aplicado.');
    return;
  }

  console.log('💾 Inicializando base de datos SQLite...');

  try {
    // 1. Crear tablas si no existen
    await createTables();
    
    // 2. Crear trigger de descuento de inventario
    await createTriggers();

    // 3. Verificar si hay datos — si la BD está vacía, insertar seed data
    const productos = await db.query('SELECT COUNT(*) as count FROM productos');
    if (productos[0].count === 0) {
      console.log('🌱 Base de datos vacía. No se insertarán datos semilla por petición del usuario.');
      // await seedData();
      
      // Pero sí insertamos los bancos por defecto si no existen
      const bancos = await db.query('SELECT COUNT(*) as count FROM cuentas_bancarias');
      if (bancos[0].count === 0) {
        console.log('🏦 Insertando cuentas bancarias por defecto...');
        await db.execute("INSERT INTO cuentas_bancarias (nombre, moneda, saldo) VALUES ('Efectivo COP', 'COP', 0)");
        await db.execute("INSERT INTO cuentas_bancarias (nombre, moneda, saldo) VALUES ('Bancolombia', 'COP', 0)");
        await db.execute("INSERT INTO cuentas_bancarias (nombre, moneda, saldo) VALUES ('Efectivo USD', 'USD', 0)");
        await db.execute("INSERT INTO cuentas_bancarias (nombre, moneda, saldo) VALUES ('Zelle', 'USD', 0)");
        await db.execute("INSERT INTO cuentas_bancarias (nombre, moneda, saldo) VALUES ('Pago Móvil', 'VES', 0)");
        await db.execute("INSERT INTO cuentas_bancarias (nombre, moneda, saldo) VALUES ('Binance', 'USDT', 0)");
      }
    } else {
      console.log('✅ Base de datos ya contiene datos. Omitiendo seed.');
    }

    // 4. Migraciones para columnas nuevas
    await runMigrations();

    // 5. Crear usuarios de turno por defecto si no existen
    await ensureDefaultUsers();

    console.log('✅ Inicialización de base de datos completada.');
  } catch (error) {
    console.error('❌ Error al inicializar la base de datos:', error);
    throw error;
  }
}

async function createTables() {
  // Usuarios
  await db.execute(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'Cajero',
      turno TEXT NOT NULL DEFAULT 'Mañana',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insumos (Materia Prima)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS insumos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      unidad_medida TEXT NOT NULL,
      stock_actual REAL NOT NULL DEFAULT 0.0,
      stock_minimo REAL NOT NULL DEFAULT 0.0,
      stock_fijo REAL NOT NULL DEFAULT 0.0,
      costo_unitario REAL NOT NULL DEFAULT 0.0,
      es_para_batidos BOOLEAN DEFAULT 0,
      es_base_liquida BOOLEAN DEFAULT 0,
      es_sabor_batido BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Mermas (Pérdidas de inventario)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mermas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insumo_id INTEGER NOT NULL,
      cantidad REAL NOT NULL CHECK (cantidad > 0.0),
      motivo TEXT NOT NULL,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE
    )
  `);

  // Productos (Catálogo)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      categoria TEXT NOT NULL DEFAULT 'General',
      costo_produccion REAL NOT NULL DEFAULT 0.0,
      precio_venta REAL NOT NULL DEFAULT 0.0,
      activo BOOLEAN DEFAULT 1,
      es_batido BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations for new columns (ignoring errors if they already exist)
  try { await db.execute('ALTER TABLE productos ADD COLUMN es_batido BOOLEAN DEFAULT 0'); } catch (e) {}
  try { await db.execute('ALTER TABLE insumos ADD COLUMN es_para_batidos BOOLEAN DEFAULT 0'); } catch (e) {}
  try { await db.execute('ALTER TABLE insumos ADD COLUMN es_base_liquida BOOLEAN DEFAULT 0'); } catch (e) {}
  try { await db.execute('ALTER TABLE insumos ADD COLUMN es_sabor_batido BOOLEAN DEFAULT 0'); } catch (e) {}

  // Recetas (Relación Producto - Insumo)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS recetas (
      producto_id INTEGER NOT NULL,
      insumo_id INTEGER NOT NULL,
      cantidad REAL NOT NULL CHECK (cantidad > 0.0),
      PRIMARY KEY (producto_id, insumo_id),
      FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
      FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE
    )
  `);

  // Clientes (Líneas de Crédito)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      identificacion TEXT NOT NULL UNIQUE,
      telefono TEXT,
      limite_credito REAL NOT NULL DEFAULT 0.0,
      saldo_deudor REAL NOT NULL DEFAULT 0.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Ventas (Cabecera)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      tipo_transaccion TEXT NOT NULL DEFAULT 'Venta',
      total REAL NOT NULL DEFAULT 0.0,
      tasa_cambio REAL NOT NULL DEFAULT 1.0,
      cliente_id INTEGER,
      notas TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
    )
  `);

  // Asegurar que la columna tipo_transaccion exista (en caso de BD existente)
  try {
    await db.execute("ALTER TABLE ventas ADD COLUMN tipo_transaccion TEXT NOT NULL DEFAULT 'Venta'");
  } catch (e) {
    // La columna ya existe
  }

  // Detalle de Ventas
  await db.execute(`
    CREATE TABLE IF NOT EXISTS detalle_ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL,
      producto_id INTEGER NOT NULL,
      cantidad REAL NOT NULL CHECK (cantidad > 0.0),
      precio_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
      FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT
    )
  `);

  // Pagos de Ventas (Multimoneda)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pagos_ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL,
      metodo_pago TEXT NOT NULL,
      moneda TEXT NOT NULL,
      monto_original REAL NOT NULL CHECK (monto_original > 0.0),
      tasa_cambio REAL NOT NULL DEFAULT 1.0,
      monto_base REAL NOT NULL CHECK (monto_base >= 0.0),
      referencia TEXT,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
    )
  `);

  // Abonos de Crédito
  await db.execute(`
    CREATE TABLE IF NOT EXISTS abonos_credito (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      monto_total_cop REAL NOT NULL CHECK (monto_total_cop > 0.0),
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notas TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    )
  `);

  // Pagos de Abonos
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pagos_abonos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      abono_id INTEGER NOT NULL,
      metodo_pago TEXT NOT NULL,
      moneda TEXT NOT NULL,
      monto_original REAL NOT NULL CHECK (monto_original > 0.0),
      tasa_cambio REAL NOT NULL DEFAULT 1.0,
      monto_base REAL NOT NULL CHECK (monto_base > 0.0),
      referencia TEXT,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (abono_id) REFERENCES abonos_credito(id) ON DELETE CASCADE
    )
  `);

  // Gastos Operacionales y Nómina
  await db.execute(`
    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sesion_caja_id INTEGER,
      categoria TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      monto REAL NOT NULL CHECK (monto > 0.0),
      moneda TEXT NOT NULL,
      tasa_cambio REAL NOT NULL DEFAULT 1.0,
      monto_cop REAL NOT NULL CHECK (monto_cop > 0.0),
      metodo_pago TEXT NOT NULL DEFAULT 'Efectivo COP',
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sesion_caja_id) REFERENCES sesiones_caja(id) ON DELETE SET NULL
    )
  `);

  // Asegurar columna sesion_caja_id y metodo_pago en gastos
  try { await db.execute("ALTER TABLE gastos ADD COLUMN sesion_caja_id INTEGER REFERENCES sesiones_caja(id)"); } catch(e){}
  try { await db.execute("ALTER TABLE gastos ADD COLUMN metodo_pago TEXT NOT NULL DEFAULT 'Efectivo COP'"); } catch(e){}

  // Tesorería - Cuentas Bancarias
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cuentas_bancarias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      moneda TEXT NOT NULL,
      saldo REAL NOT NULL DEFAULT 0.0
    )
  `);

  // Tesorería - Movimientos Internos
  await db.execute(`
    CREATE TABLE IF NOT EXISTS movimientos_tesoreria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuenta_origen TEXT NOT NULL,
      cuenta_destino TEXT NOT NULL,
      monto_origen REAL NOT NULL,
      monto_destino REAL NOT NULL,
      tasa_cambio REAL NOT NULL DEFAULT 1.0,
      motivo TEXT NOT NULL,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Detalle de Ventas - Insumos Extras
  await db.execute(`
    CREATE TABLE IF NOT EXISTS detalle_ventas_extras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      detalle_venta_id INTEGER NOT NULL,
      insumo_id INTEGER NOT NULL,
      cantidad REAL NOT NULL CHECK (cantidad > 0.0),
      precio_adicional REAL NOT NULL DEFAULT 0.0,
      FOREIGN KEY (detalle_venta_id) REFERENCES detalle_ventas(id) ON DELETE CASCADE,
      FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE RESTRICT
    )
  `);

  // Arqueo y Sesiones de Caja (Turnos)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sesiones_caja (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      fecha_apertura TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_cierre TIMESTAMP,
      fondo_inicial_cop REAL NOT NULL DEFAULT 0.0,
      fondo_inicial_usd REAL NOT NULL DEFAULT 0.0,
      total_ventas_cop REAL DEFAULT 0.0,
      total_gastos_cop REAL DEFAULT 0.0,
      diferencia_caja REAL,
      estado TEXT NOT NULL DEFAULT 'Abierta',
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);

  console.log('   ✅ Tablas creadas/verificadas.');
}

async function runMigrations() {
  // Agregar columna 'turno' a sesiones_caja si no existe
  try { await db.execute("ALTER TABLE sesiones_caja ADD COLUMN turno TEXT NOT NULL DEFAULT 'Mañana'"); console.log('   🔄 Migración: columna turno agregada a sesiones_caja.'); } catch(e) {}
  // Agregar columna 'nombre_cajero' a sesiones_caja si no existe (para mostrar en UI)
  try { await db.execute("ALTER TABLE sesiones_caja ADD COLUMN nombre_cajero TEXT"); } catch(e) {}
  // Agregar columna 'password_hash' a usuarios si no existe
  try { await db.execute("ALTER TABLE usuarios ADD COLUMN password_hash TEXT"); console.log('   🔄 Migración: columna password_hash agregada a usuarios.'); } catch(e) {}
  // Agregar columna 'permisos' a usuarios si no existe
  try { 
    await db.execute("ALTER TABLE usuarios ADD COLUMN permisos TEXT NOT NULL DEFAULT '[\"pos\",\"caja\"]'"); 
    console.log('   🔄 Migración: columna permisos agregada a usuarios.'); 
    // Asegurar que los admins tengan permiso 'all'
    await db.execute("UPDATE usuarios SET permisos = '[\"all\"]' WHERE rol = 'Administrador'");
  } catch(e) {}
  // Agregar columna 'stock_fijo' a insumos si no existe
  try { 
    await db.execute("ALTER TABLE insumos ADD COLUMN stock_fijo REAL NOT NULL DEFAULT 0.0"); 
    console.log('   🔄 Migración: columna stock_fijo agregada a insumos.'); 
  } catch(e) {}
  // Agregar columna 'fondo_inicial_usd' a sesiones_caja si no existe
  try { 
    await db.execute("ALTER TABLE sesiones_caja ADD COLUMN fondo_inicial_usd REAL NOT NULL DEFAULT 0.0"); 
    console.log('   🔄 Migración: columna fondo_inicial_usd agregada a sesiones_caja.'); 
  } catch(e) {}
  // Agregar columnas para base líquida de batidos en insumos
  try { 
    await db.execute("ALTER TABLE insumos ADD COLUMN es_base_liquida BOOLEAN DEFAULT 0"); 
    console.log('   🔄 Migración: columna es_base_liquida agregada a insumos.'); 
  } catch(e) {}
  try { 
    await db.execute("ALTER TABLE insumos ADD COLUMN cantidad_sola REAL NOT NULL DEFAULT 0"); 
    console.log('   🔄 Migración: columna cantidad_sola agregada a insumos.'); 
  } catch(e) {}
  try { 
    await db.execute("ALTER TABLE insumos ADD COLUMN es_sabor_batido BOOLEAN DEFAULT 0"); 
    console.log('   🔄 Migración: columna es_sabor_batido agregada a insumos.'); 
  } catch(e) {}
  try { 
    await db.execute("ALTER TABLE insumos ADD COLUMN cantidad_combinada REAL NOT NULL DEFAULT 0"); 
    console.log('   🔄 Migración: columna cantidad_combinada agregada a insumos.'); 
  } catch(e) {}

  // Agregar columnas de desglose de pagos a sesiones_caja
  try { 
    await db.execute("ALTER TABLE sesiones_caja ADD COLUMN declarado_efectivo_bs REAL DEFAULT 0.0"); 
  } catch(e) {}
  try { 
    await db.execute("ALTER TABLE sesiones_caja ADD COLUMN declarado_zelle REAL DEFAULT 0.0"); 
  } catch(e) {}
  try { 
    await db.execute("ALTER TABLE sesiones_caja ADD COLUMN declarado_binance REAL DEFAULT 0.0"); 
  } catch(e) {}
  try { 
    await db.execute("ALTER TABLE sesiones_caja ADD COLUMN declarado_efectivo_pesos REAL DEFAULT 0.0"); 
  } catch(e) {}
  try { 
    await db.execute("ALTER TABLE sesiones_caja ADD COLUMN declarado_bancolombia REAL DEFAULT 0.0"); 
  } catch(e) {}
}

async function ensureDefaultUsers() {
  const usuarios = await db.query('SELECT COUNT(*) as count FROM usuarios');
  if (usuarios[0].count === 0) {
    console.log('   👤 Creando usuarios de turno por defecto...');
    const hash1234 = await bcrypt.hash('1234', 10);
    await db.execute(
      "INSERT INTO usuarios (nombre, rol, turno, password_hash, permisos) VALUES ('Cajero Mañana', 'Cajero', 'Mañana', ?, '[\"pos\",\"caja\"]')",
      [hash1234]
    );
    await db.execute(
      "INSERT INTO usuarios (nombre, rol, turno, password_hash, permisos) VALUES ('Cajero Tarde', 'Cajero', 'Tarde', ?, '[\"pos\",\"caja\"]')",
      [hash1234]
    );
    console.log('   ✅ Usuarios creados con contraseña por defecto: 1234');
  } else {
    // Asegurar que los usuarios existentes tengan contraseña si no la tienen
    const sinPass = await db.query('SELECT id FROM usuarios WHERE password_hash IS NULL');
    if (sinPass.length > 0) {
      const hash1234 = await bcrypt.hash('1234', 10);
      for (const u of sinPass) {
        await db.execute('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash1234, u.id]);
      }
      console.log(`   🔄 Contraseña 1234 asignada a ${sinPass.length} usuario(s) sin contraseña.`);
    }
  }

  // Asegurar que el Administrador existe
  const adminQuery = await db.query("SELECT COUNT(*) as count FROM usuarios WHERE rol = 'Administrador'");
  if (adminQuery[0].count === 0) {
    console.log('   👑 Creando usuario Administrador Principal...');
    const hashAdmin = await bcrypt.hash('admin123', 10);
    await db.execute(
      "INSERT INTO usuarios (nombre, rol, turno, password_hash, permisos) VALUES ('Admin Principal', 'Administrador', 'Completo', ?, '[\"all\"]')",
      [hashAdmin]
    );
  }
}
async function createTriggers() {
  // Verificar si el trigger ya existe
  const existing = await db.query(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_descontar_inventario_venta'"
  );
  
  if (existing.length === 0) {
    await db.execute(`
      CREATE TRIGGER trg_descontar_inventario_venta
      AFTER INSERT ON detalle_ventas
      FOR EACH ROW
      BEGIN
        UPDATE insumos
        SET stock_actual = stock_actual - (
          SELECT r.cantidad * NEW.cantidad
          FROM recetas r
          WHERE r.producto_id = NEW.producto_id AND r.insumo_id = insumos.id
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
          SELECT insumo_id 
          FROM recetas 
          WHERE producto_id = NEW.producto_id
        );
      END
    `);
    console.log('   ✅ Trigger de inventario creado.');
  } else {
    console.log('   ✅ Trigger de inventario ya existe.');
  }

  // Trigger para descontar inventario de Extras
  try {
    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_descontar_extras_venta
      AFTER INSERT ON detalle_ventas_extras
      FOR EACH ROW
      BEGIN
        UPDATE insumos
        SET stock_actual = stock_actual - NEW.cantidad,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.insumo_id;
      END
    `);
  } catch(e) {}

  // Triggers de Tesorería (Saldos)
  try {
    // Cuando hay un pago de venta, entra dinero
    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_tesoreria_venta_in
      AFTER INSERT ON pagos_ventas
      FOR EACH ROW
      BEGIN
        UPDATE cuentas_bancarias
        SET saldo = saldo + NEW.monto_original
        WHERE nombre = NEW.metodo_pago;
      END
    `);
    
    // Cuando hay un abono, entra dinero
    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_tesoreria_abono_in
      AFTER INSERT ON pagos_abonos
      FOR EACH ROW
      BEGIN
        UPDATE cuentas_bancarias
        SET saldo = saldo + NEW.monto_original
        WHERE nombre = NEW.metodo_pago;
      END
    `);
    
    // Cuando hay un gasto, sale dinero
    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_tesoreria_gasto_out
      AFTER INSERT ON gastos
      FOR EACH ROW
      BEGIN
        UPDATE cuentas_bancarias
        SET saldo = saldo - NEW.monto
        WHERE nombre = NEW.metodo_pago;
      END
    `);
    
    // Movimientos Internos de Tesorería (Transfiere de una a otra)
    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_tesoreria_transferencia
      AFTER INSERT ON movimientos_tesoreria
      FOR EACH ROW
      BEGIN
        UPDATE cuentas_bancarias SET saldo = saldo - NEW.monto_origen WHERE nombre = NEW.cuenta_origen;
        UPDATE cuentas_bancarias SET saldo = saldo + NEW.monto_destino WHERE nombre = NEW.cuenta_destino;
      END
    `);
  } catch(e) {
    console.error('Error al crear triggers de tesorería', e);
  }
}

async function seedData() {
  console.log('   ✅ Datos semilla vacíos (listo para uso en producción).');
  
  // Crear usuario administrador por defecto si no existe
  const usuarios = await db.query('SELECT COUNT(*) as count FROM usuarios');
  if (usuarios[0].count === 0) {
    console.log('   👤 Creando usuario administrador por defecto...');
    await db.execute(
      "INSERT INTO usuarios (nombre, rol, turno) VALUES ('Admin Principal', 'Administrador', 'Completo')"
    );
  }
}
