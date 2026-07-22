-- =========================================================================
-- Barra Fit 360 - Lógica de Descuento de Inventario Automático
-- =========================================================================

-- -------------------------------------------------------------------------
-- OPCIÓN A: IMPLEMENTACIÓN PARA POSTGRESQL (Recomendado para producción)
-- -------------------------------------------------------------------------

-- 1. Crear o reemplazar la función que realiza el descuento
CREATE OR REPLACE FUNCTION fn_descontar_inventario_por_venta()
RETURNS TRIGGER AS $$
DECLARE
    receta_item RECORD;
BEGIN
    -- Recorrer todos los insumos que componen el producto vendido (receta)
    FOR receta_item IN 
        SELECT insumo_id, cantidad 
        FROM recetas 
        WHERE producto_id = NEW.producto_id
    LOOP
        -- Restar del stock actual la cantidad de insumos consumida
        -- Multiplicamos la cantidad unitaria de la receta por la cantidad de productos vendidos
        UPDATE insumos
        SET stock_actual = stock_actual - (receta_item.cantidad * NEW.cantidad),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = receta_item.insumo_id;
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Crear el trigger que invoca la función tras cada inserción en detalle_ventas
-- Se ejecuta AFTER INSERT para asegurar que el detalle de venta ya ha sido registrado
CREATE TRIGGER trg_descontar_inventario_venta
AFTER INSERT ON detalle_ventas
FOR EACH ROW
EXECUTE FUNCTION fn_descontar_inventario_por_venta();


-- -------------------------------------------------------------------------
-- OPCIÓN B: IMPLEMENTACIÓN PARA SQLITE (Alternativa para desarrollo local)
-- -------------------------------------------------------------------------
/*
-- En SQLite no existe PL/pgSQL ni bucles FOR en triggers.
-- Se logra el mismo comportamiento con una sola consulta UPDATE correlacionada:

CREATE TRIGGER trg_descontar_inventario_venta_sqlite
AFTER INSERT ON detalle_ventas
FOR EACH ROW
BEGIN
    UPDATE insumos
    SET 
        stock_actual = stock_actual - (
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
END;
*/
