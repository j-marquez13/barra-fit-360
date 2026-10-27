import * as db from '../db.js';

/**
 * Controlador de Tesorería — Gestión de Cuentas Bancarias y Transferencias Internas
 */

// GET /api/tesoreria/saldos
export async function getSaldos(req, res) {
  try {
    const saldos = await db.query('SELECT * FROM cuentas_bancarias ORDER BY nombre ASC');
    res.json(saldos);
  } catch (err) {
    console.error('Error al obtener saldos:', err);
    res.status(500).json({ error: 'Error interno al consultar saldos.' });
  }
}

// POST /api/tesoreria/transferir
export async function transferirFondos(req, res) {
  try {
    const { cuenta_origen, cuenta_destino, monto_origen, tasa_cambio, motivo } = req.body;

    if (!cuenta_origen || !cuenta_destino || !monto_origen || !tasa_cambio || !motivo) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para la transferencia.' });
    }

    if (cuenta_origen === cuenta_destino) {
      return res.status(400).json({ error: 'La cuenta de origen y destino no pueden ser la misma.' });
    }

    const montoOrigen = parseFloat(monto_origen);
    const tasa = parseFloat(tasa_cambio);
    if (!Number.isFinite(montoOrigen) || montoOrigen <= 0 || !Number.isFinite(tasa) || tasa <= 0) {
      return res.status(400).json({ error: 'El monto y la tasa de cambio deben ser números mayores a 0.' });
    }
    const monto_destino = montoOrigen * tasa;

    await db.transaction(async (tx) => {
      const cuentas = await tx.query('SELECT nombre FROM cuentas_bancarias WHERE nombre IN ($1, $2)', [cuenta_origen, cuenta_destino]);
      if (cuentas.length !== 2) {
        throw Object.assign(new Error('La cuenta de origen o destino no existe.'), { status: 400 });
      }
      // Registrar el movimiento. Los saldos los actualiza el trigger
      // `trg_tesoreria_transferencia` al insertar; no se debe hacer un UPDATE
      // manual aquí para evitar mover el dinero dos veces.
      await tx.execute(
        `INSERT INTO movimientos_tesoreria (cuenta_origen, cuenta_destino, monto_origen, monto_destino, tasa_cambio, motivo)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cuenta_origen, cuenta_destino, montoOrigen, monto_destino, tasa, motivo]
      );
    });

    res.status(201).json({ mensaje: 'Transferencia realizada con éxito.' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error al transferir fondos:', err);
    res.status(500).json({ error: 'Error interno al procesar la transferencia.' });
  }
}
