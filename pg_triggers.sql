-- PostgreSQL Triggers for Barra Fit 360

-- 1. Descontar Inventario por Venta
CREATE OR REPLACE FUNCTION func_descontar_inventario_venta()
RETURNS TRIGGER AS $$
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
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_descontar_inventario_venta ON detalle_ventas;
CREATE TRIGGER trg_descontar_inventario_venta
AFTER INSERT ON detalle_ventas
FOR EACH ROW
EXECUTE FUNCTION func_descontar_inventario_venta();

-- 2. Descontar Extras
CREATE OR REPLACE FUNCTION func_descontar_extras_venta()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE insumos
    SET stock_actual = stock_actual - NEW.cantidad,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.insumo_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_descontar_extras_venta ON detalle_ventas_extras;
CREATE TRIGGER trg_descontar_extras_venta
AFTER INSERT ON detalle_ventas_extras
FOR EACH ROW
EXECUTE FUNCTION func_descontar_extras_venta();

-- 3. Tesorería: Ingreso Venta
CREATE OR REPLACE FUNCTION func_tesoreria_venta_in()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE cuentas_bancarias
    SET saldo = saldo + NEW.monto_original
    WHERE nombre = NEW.metodo_pago;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tesoreria_venta_in ON pagos_ventas;
CREATE TRIGGER trg_tesoreria_venta_in
AFTER INSERT ON pagos_ventas
FOR EACH ROW
EXECUTE FUNCTION func_tesoreria_venta_in();

-- 4. Tesorería: Ingreso Abono
CREATE OR REPLACE FUNCTION func_tesoreria_abono_in()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE cuentas_bancarias
    SET saldo = saldo + NEW.monto_original
    WHERE nombre = NEW.metodo_pago;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tesoreria_abono_in ON pagos_abonos;
CREATE TRIGGER trg_tesoreria_abono_in
AFTER INSERT ON pagos_abonos
FOR EACH ROW
EXECUTE FUNCTION func_tesoreria_abono_in();

-- 5. Tesorería: Salida Gasto
CREATE OR REPLACE FUNCTION func_tesoreria_gasto_out()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE cuentas_bancarias
    SET saldo = saldo - NEW.monto
    WHERE nombre = NEW.metodo_pago;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tesoreria_gasto_out ON gastos;
CREATE TRIGGER trg_tesoreria_gasto_out
AFTER INSERT ON gastos
FOR EACH ROW
EXECUTE FUNCTION func_tesoreria_gasto_out();

-- 6. Tesorería: Transferencia
CREATE OR REPLACE FUNCTION func_tesoreria_transferencia()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE cuentas_bancarias SET saldo = saldo - NEW.monto_origen WHERE nombre = NEW.cuenta_origen;
    UPDATE cuentas_bancarias SET saldo = saldo + NEW.monto_destino WHERE nombre = NEW.cuenta_destino;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tesoreria_transferencia ON movimientos_tesoreria;
CREATE TRIGGER trg_tesoreria_transferencia
AFTER INSERT ON movimientos_tesoreria
FOR EACH ROW
EXECUTE FUNCTION func_tesoreria_transferencia();
