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

    const monto_destino = monto_origen * tasa_cambio;

    await db.execute(
      `INSERT INTO movimientos_tesoreria (cuenta_origen, cuenta_destino, monto_origen, monto_destino, tasa_cambio, motivo) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [cuenta_origen, cuenta_destino, monto_origen, monto_destino, tasa_cambio, motivo]
    );

    res.status(201).json({ mensaje: 'Transferencia realizada con éxito.' });
  } catch (err) {
    console.error('Error al transferir fondos:', err);
    res.status(500).json({ error: 'Error interno al procesar la transferencia.' });
  }
}
