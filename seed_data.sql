-- =========================================================================
-- Barra Fit 360 - Datos Semilla (Seed Data) y Casos de Prueba
-- =========================================================================

-- Limpiar tablas previas (para entornos de prueba)
TRUNCATE detalle_ventas, ventas, recetas, productos, mermas, insumos RESTART IDENTITY CASCADE;

-- 1. Insertar Insumos (Inventario)
-- NOTA: El costo unitario y cantidades iniciales están configurados
-- para concordar con los costos de producción reales.
INSERT INTO insumos (id, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario) VALUES
-- Insumos para licuados y preparados
(1, 'Vaso Plástico 16oz', 'unidad', 100.0000, 10.0000, 50.00),     -- 1 unidad = 50.00
(2, 'Proteína Whey Vainilla', 'scoop', 120.0000, 15.0000, 400.00), -- 1 scoop = 400.00
(3, 'Leche Descremada', 'ml', 20000.0000, 2000.0000, 0.60),        -- 250 ml = 150.00
(4, 'Fruta Mezcla (Fresa/Banana)', 'gr', 5000.0000, 1000.0000, 2.00),-- 50 gr = 100.00
-- Insumos para productos de reventa directa
(5, 'Amino Energy Lata (Limonada)', 'unidad', 30.0000, 5.0000, 15000.00); -- 1 lata = 15000.00

-- Reiniciar la secuencia para la inserción automática futura
SELECT setval('insumos_id_seq', 5);


-- 2. Insertar Productos (Catálogo)
INSERT INTO productos (id, nombre, costo_produccion, precio_venta, activo) VALUES
(1, 'Vaso completo', 700.00, 2000.00, TRUE), -- Costo: 50 + 400 + (250 * 0.60) + (50 * 2) = 700
(2, 'Amino energy lata', 15000.00, 22000.00, TRUE);

-- Reiniciar la secuencia
SELECT setval('productos_id_seq', 2);


-- 3. Insertar Recetas (Relación Insumo-Producto)
-- Vaso completo consume: 1 vaso, 1 scoop proteína, 250ml leche y 50g fruta.
INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES
(1, 1, 1.0000),   -- 1 Vaso Plástico
(1, 2, 1.0000),   -- 1 scoop de proteína
(1, 3, 250.0000), -- 250 ml de leche
(1, 4, 50.0000);  -- 50 gramos de fruta

-- Amino energy lata es reventa directa, consume 1 lata del insumo.
INSERT INTO recetas (producto_id, insumo_id, cantidad) VALUES
(2, 5, 1.0000);   -- 1 Lata de Amino Energy


-- 4. Registrar una Merma de prueba
-- Ejemplo: Se venció/dañó 1 scoop de proteína y 1 lata de Amino Energy
INSERT INTO mermas (insumo_id, cantidad, motivo) VALUES
(2, 1.0000, 'Derrame accidental en barra'),
(5, 1.0000, 'Lata golpeada y rota al recibir mercadería');
