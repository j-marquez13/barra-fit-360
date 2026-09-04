import fs from 'fs';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    const schema = fs.readFileSync('schema.sql', 'utf8');
    await client.query(schema);
    
    // Add missing tables that were originally in initDb.js but not in schema.sql
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        rol TEXT NOT NULL DEFAULT 'Cajero',
        turno TEXT NOT NULL DEFAULT 'Mañana',
        password_hash TEXT,
        permisos TEXT NOT NULL DEFAULT '["pos","caja"]',
        debe_cambiar_password INTEGER DEFAULT 1,
        intentos_fallidos INTEGER DEFAULT 0,
        bloqueado_hasta BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS cuentas_bancarias (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL UNIQUE,
        moneda TEXT NOT NULL,
        saldo REAL NOT NULL DEFAULT 0.0
      );

      CREATE TABLE IF NOT EXISTS movimientos_tesoreria (
        id SERIAL PRIMARY KEY,
        cuenta_origen TEXT NOT NULL,
        cuenta_destino TEXT NOT NULL,
        monto_origen REAL NOT NULL,
        monto_destino REAL NOT NULL,
        tasa_cambio REAL NOT NULL DEFAULT 1.0,
        motivo TEXT NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS detalle_ventas_extras (
        id SERIAL PRIMARY KEY,
        detalle_venta_id INTEGER NOT NULL REFERENCES detalle_ventas(id) ON DELETE CASCADE,
        insumo_id INTEGER NOT NULL REFERENCES insumos(id) ON DELETE RESTRICT,
        cantidad REAL NOT NULL CHECK (cantidad > 0.0),
        precio_adicional REAL NOT NULL DEFAULT 0.0
      );

      CREATE TABLE IF NOT EXISTS ordenes_compra (
        id SERIAL PRIMARY KEY,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metodo_pago VARCHAR(50) NOT NULL,
        moneda VARCHAR(10) NOT NULL,
        tasa_cambio NUMERIC(12, 4) DEFAULT 1.0000,
        total_cop NUMERIC(12, 2) NOT NULL,
        sesion_caja_id INTEGER REFERENCES sesiones_caja(id) ON DELETE SET NULL,
        afecta_inventario BOOLEAN DEFAULT TRUE,
        recibida BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS ordenes_compra_items (
        id SERIAL PRIMARY KEY,
        orden_id INT NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
        insumo_id INT NOT NULL REFERENCES insumos(id) ON DELETE RESTRICT,
        cantidad NUMERIC(12, 2) NOT NULL,
        costo_unitario NUMERIC(12, 2) NOT NULL,
        monto_cop NUMERIC(12, 2) NOT NULL,
        cantidad_recibida NUMERIC(12, 2)
      );

      -- Add missing columns to sesiones_caja
      ALTER TABLE sesiones_caja DROP COLUMN IF EXISTS usuario;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS turno TEXT NOT NULL DEFAULT 'Mañana';
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS nombre_cajero TEXT;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS fondo_inicial_usd REAL NOT NULL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS total_ventas_cop REAL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS total_gastos_cop REAL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'Abierta';
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS usuario_id INTEGER;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS declarado_efectivo_bs REAL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS declarado_efectivo_usd REAL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS declarado_zelle REAL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS declarado_binance REAL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS declarado_efectivo_pesos REAL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS declarado_bancolombia REAL DEFAULT 0.0;
      ALTER TABLE sesiones_caja ADD COLUMN IF NOT EXISTS declarado_pago_movil REAL DEFAULT 0.0;

      -- Add missing columns to insumos
      ALTER TABLE insumos ADD COLUMN IF NOT EXISTS stock_fijo REAL NOT NULL DEFAULT 0.0;

      -- Add missing columns to gastos
      ALTER TABLE gastos ADD COLUMN IF NOT EXISTS sesion_caja_id INTEGER REFERENCES sesiones_caja(id);
      ALTER TABLE gastos ADD COLUMN IF NOT EXISTS metodo_pago TEXT NOT NULL DEFAULT 'Efectivo COP';
      ALTER TABLE gastos ADD COLUMN IF NOT EXISTS orden_compra_id INTEGER;
      ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS recibida BOOLEAN DEFAULT FALSE;
      ALTER TABLE ordenes_compra_items ADD COLUMN IF NOT EXISTS cantidad_recibida NUMERIC(12, 2);
    `);
    
    console.log("✅ Schema applied successfully");
  } catch (e) {
    console.error("Error applying schema:", e.message);
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
