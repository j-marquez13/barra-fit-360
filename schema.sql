-- ==========================================
-- Barra Fit 360 - Esquema de Base de Datos
-- Motor: PostgreSQL
-- ==========================================

-- 1. Tabla de Inventario de Insumos (Materia Prima)
CREATE TABLE insumos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL UNIQUE,
    unidad_medida VARCHAR(20) NOT NULL, -- Ej: 'unidad', 'gr', 'ml', 'oz', 'scoop'
    stock_actual NUMERIC(12, 4) NOT NULL DEFAULT 0.0000 CHECK (stock_actual >= 0.0000),
    stock_minimo NUMERIC(12, 4) NOT NULL DEFAULT 0.0000 CHECK (stock_minimo >= 0.0000),
    costo_unitario NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (costo_unitario >= 0.00),
    es_para_batidos BOOLEAN DEFAULT FALSE,
    es_base_liquida BOOLEAN DEFAULT FALSE,
    es_sabor_batido BOOLEAN DEFAULT FALSE,
    cantidad_sola NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    cantidad_combinada NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para optimizar búsquedas de insumos
CREATE INDEX idx_insumos_nombre ON insumos(nombre);

-- 2. Tabla de Mermas (Pérdidas de inventario no asociadas a ventas)
CREATE TABLE mermas (
    id SERIAL PRIMARY KEY,
    insumo_id INT NOT NULL,
    cantidad NUMERIC(12, 4) NOT NULL CHECK (cantidad > 0.0000),
    motivo VARCHAR(255) NOT NULL, -- Ej: 'vencimiento', 'derrame', 'dañado'
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mermas_insumo FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE
);

-- 3. Catálogo de Productos
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL UNIQUE,
    categoria VARCHAR(50) NOT NULL DEFAULT 'General', -- Ej: 'Batidos', 'Nevera', 'Extras', 'Meriendas'
    costo_produccion NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (costo_produccion >= 0.00),
    precio_venta NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (precio_venta >= 0.00),
    activo BOOLEAN DEFAULT TRUE,
    es_batido BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para optimizar el catálogo de ventas
CREATE INDEX idx_productos_nombre ON productos(nombre);

-- 4. Tabla de Recetas / Consumo de Insumos (Relación Muchos a Muchos)
-- Conecta qué insumos y en qué cantidad consume un producto cuando se vende.
CREATE TABLE recetas (
    producto_id INT NOT NULL,
    insumo_id INT NOT NULL,
    cantidad NUMERIC(12, 4) NOT NULL CHECK (cantidad > 0.0000),
    PRIMARY KEY (producto_id, insumo_id),
    CONSTRAINT fk_recetas_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
    CONSTRAINT fk_recetas_insumo FOREIGN KEY (insumo_id) REFERENCES insumos(id) ON DELETE CASCADE
);

-- 5. Tabla de Clientes (Línea de Crédito)
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    identificacion VARCHAR(50) NOT NULL UNIQUE,
    telefono VARCHAR(50),
    limite_credito NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (limite_credito >= 0.00),
    saldo_deudor NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (saldo_deudor >= 0.00),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_clientes_nombre ON clientes(nombre);
CREATE INDEX idx_clientes_identificacion ON clientes(identificacion);

-- 6. Registro de Ventas (Cabecera de la transacción)
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tipo_transaccion VARCHAR(20) NOT NULL DEFAULT 'Venta', -- 'Venta' o 'Cortesia'
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total >= 0.00), -- Total en moneda base (COP)
    tasa_cambio NUMERIC(12, 4) NOT NULL DEFAULT 1.0000 CHECK (tasa_cambio > 0.0000), -- Tasa oficial de referencia USD/COP del día
    cliente_id INT,
    notas TEXT,
    CONSTRAINT fk_ventas_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
);

-- Índices para reportes de ventas por fecha
CREATE INDEX idx_ventas_fecha ON ventas(fecha);

-- 6. Detalle de Ventas (Productos vendidos en cada transacción)
CREATE TABLE detalle_ventas (
    id SERIAL PRIMARY KEY,
    venta_id INT NOT NULL,
    producto_id INT NOT NULL,
    cantidad NUMERIC(12, 4) NOT NULL CHECK (cantidad > 0.0000),
    precio_unitario NUMERIC(12, 2) NOT NULL CHECK (precio_unitario >= 0.00),
    subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0.00),
    CONSTRAINT fk_detalle_ventas_venta FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_ventas_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT
);

-- Índices para estadísticas de productos vendidos
CREATE INDEX idx_detalle_ventas_venta ON detalle_ventas(venta_id);
CREATE INDEX idx_detalle_ventas_producto ON detalle_ventas(producto_id);

-- 7. Tabla de Pagos de Ventas (Soporta múltiples métodos de pago por venta)
CREATE TABLE pagos_ventas (
    id SERIAL PRIMARY KEY,
    venta_id INT NOT NULL,
    metodo_pago VARCHAR(50) NOT NULL, -- 'Efectivo COP', 'Efectivo USD', 'Pago Móvil', 'Binance', 'Zelle', 'Bancolombia'
    moneda VARCHAR(10) NOT NULL,       -- 'COP', 'USD', 'VES'
    monto_original NUMERIC(12, 2) NOT NULL CHECK (monto_original > 0.00), -- Monto pagado en la divisa original
    tasa_cambio NUMERIC(12, 4) NOT NULL DEFAULT 1.0000 CHECK (tasa_cambio > 0.0000), -- Tasa aplicada para llevar a la moneda base (COP)
    monto_base NUMERIC(12, 2) NOT NULL CHECK (monto_base >= 0.00), -- Monto equivalente en la moneda base (COP)
    referencia VARCHAR(100),           -- Código de transacción, número de pago móvil, etc.
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pagos_ventas_venta FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
);

-- Índices para reportes y búsquedas de pagos
CREATE INDEX idx_pagos_ventas_venta ON pagos_ventas(venta_id);
CREATE INDEX idx_pagos_ventas_metodo ON pagos_ventas(metodo_pago);

-- 8. Tabla de Abonos de Créditos (Amortización de deudas)
CREATE TABLE abonos_credito (
    id SERIAL PRIMARY KEY,
    cliente_id INT NOT NULL,
    monto_total_cop NUMERIC(12, 2) NOT NULL CHECK (monto_total_cop > 0.00),
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notas TEXT,
    CONSTRAINT fk_abonos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
);

CREATE INDEX idx_abonos_cliente ON abonos_credito(cliente_id);

-- 9. Detalle de Pagos de Abonos (Soporta múltiples divisas para abonar)
CREATE TABLE pagos_abonos (
    id SERIAL PRIMARY KEY,
    abono_id INT NOT NULL,
    metodo_pago VARCHAR(50) NOT NULL, -- 'Efectivo COP', 'Efectivo USD', 'Zelle', etc.
    moneda VARCHAR(10) NOT NULL,       -- 'COP', 'USD', 'VES'
    monto_original NUMERIC(12, 2) NOT NULL CHECK (monto_original > 0.00),
    tasa_cambio NUMERIC(12, 4) NOT NULL DEFAULT 1.0000 CHECK (tasa_cambio > 0.0000),
    monto_base NUMERIC(12, 2) NOT NULL CHECK (monto_base > 0.00),
    referencia VARCHAR(100),
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pagos_abonos_abono FOREIGN KEY (abono_id) REFERENCES abonos_credito(id) ON DELETE CASCADE
);

CREATE INDEX idx_pagos_abonos_abono ON pagos_abonos(abono_id);

-- 10. Gastos Operacionales y Nómina
CREATE TABLE gastos (
    id SERIAL PRIMARY KEY,
    categoria VARCHAR(50) NOT NULL, -- 'NOMINA', 'GASTOS', 'REPOSICION'
    descripcion TEXT NOT NULL,
    monto NUMERIC(12, 2) NOT NULL CHECK (monto > 0.00),
    moneda VARCHAR(10) NOT NULL,    -- 'COP', 'USD', 'VES'
    tasa_cambio NUMERIC(12, 4) NOT NULL DEFAULT 1.0000 CHECK (tasa_cambio > 0.0000),
    monto_cop NUMERIC(12, 2) NOT NULL CHECK (monto_cop > 0.00),
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gastos_fecha ON gastos(fecha);

-- 11. Arqueo y Sesiones de Caja (Turnos)
CREATE TABLE sesiones_caja (
    id SERIAL PRIMARY KEY,
    usuario VARCHAR(100) NOT NULL,
    fecha_apertura TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMP,
    fondo_inicial_cop NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (fondo_inicial_cop >= 0.00),
    total_ventas NUMERIC(12, 2) DEFAULT 0.00,
    total_gastos NUMERIC(12, 2) DEFAULT 0.00,
    diferencia_caja NUMERIC(12, 2)
);

CREATE INDEX idx_sesiones_caja_apertura ON sesiones_caja(fecha_apertura);

