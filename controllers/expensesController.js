import * as db from '../db.js';

/**
 * Controlador de Gastos Operacionales y Nómina
 */

// GET /api/gastos
export async function listarGastos(req, res) {
  try {
    const gastos = await db.query('SELECT * FROM gastos ORDER BY fecha DESC');
    res.json(gastos);
  } catch (err) {
    console.error('Error al listar gastos:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

// POST /api/gastos
export async function registrarGasto(req, res) {
  try {
    const { categoria, descripcion, monto, moneda, tasa_cambio, metodo_pago } = req.body;

    if (!categoria || !descripcion || !monto || !moneda || !tasa_cambio) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const metodoPagoFinal = metodo_pago || 'Efectivo COP';

    // Calcular el monto en COP
    const monto_cop = monto * tasa_cambio;

    // Buscar sesión de caja activa
    const openSession = await db.query("SELECT id FROM sesiones_caja WHERE fecha_cierre IS NULL AND estado = 'Abierta' ORDER BY id DESC LIMIT 1");
    const sesion_caja_id = openSession.length > 0 ? openSession[0].id : null;

    // Para SQLite
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
    let result;
    if (isPg) {
      result = await db.execute(
        `INSERT INTO gastos (sesion_caja_id, categoria, descripcion, monto, moneda, tasa_cambio, monto_cop, metodo_pago)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [sesion_caja_id, categoria, descripcion, monto, moneda, tasa_cambio, monto_cop, metodoPagoFinal]
      );
    } else {
      const sqlResult = await db.execute(
        `INSERT INTO gastos (sesion_caja_id, categoria, descripcion, monto, moneda, tasa_cambio, monto_cop, metodo_pago)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sesion_caja_id, categoria, descripcion, monto, moneda, tasa_cambio, monto_cop, metodoPagoFinal]
      );
      const rows = await db.query('SELECT * FROM gastos WHERE id = $1', [sqlResult[0].id]);
      result = rows;
    }

    res.status(201).json({ mensaje: 'Gasto registrado correctamente', gasto: result[0] });
  } catch (err) {
    console.error('Error al registrar gasto:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}
