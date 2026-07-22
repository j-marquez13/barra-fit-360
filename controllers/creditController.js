import * as db from '../db.js';
import bcrypt from 'bcryptjs';

/**
 * Controlador de Clientes y Líneas de Crédito (Cuentas por Cobrar)
 */

// 1. Crear Perfil de Cliente
export async function createClient(req, res) {
  const { nombre, identificacion, telefono, limite_credito } = req.body;

  if (!nombre || !identificacion) {
    return res.status(400).json({ error: 'El nombre y la identificación son obligatorios.' });
  }

  const limite = parseFloat(limite_credito) || 0;
  if (limite < 0) {
    return res.status(400).json({ error: 'El límite de crédito no puede ser negativo.' });
  }

  try {
    const isPg = !process.env.DATABASE_URL && !process.env.PGHOST ? false : true;
    
    // Verificar duplicado
    const existing = await db.query('SELECT id FROM clientes WHERE identificacion = $1', [identificacion]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ya existe un cliente registrado con esa identificación.' });
    }

    const insertSql = isPg
      ? 'INSERT INTO clientes (nombre, identificacion, telefono, limite_credito, saldo_deudor) VALUES ($1, $2, $3, $4, 0.00) RETURNING *'
      : 'INSERT INTO clientes (nombre, identificacion, telefono, limite_credito, saldo_deudor) VALUES ($1, $2, $3, $4, 0.00)';

    const resInsert = await db.execute(insertSql, [nombre, identificacion, telefono || '', limite]);
    
    let client = null;
    if (isPg) {
      client = resInsert[0];
    } else {
      const clientId = resInsert[0].id;
      const select = await db.query('SELECT * FROM clientes WHERE id = $1', [clientId]);
      client = select[0];
    }

    return res.status(201).json({
      mensaje: 'Perfil de cliente creado con éxito.',
      cliente: client
    });
  } catch (error) {
    console.error('Error al crear cliente:', error);
    return res.status(500).json({ error: 'Error interno al registrar el cliente.', detalle: error.message });
  }
}

// 2. Listar Clientes
export async function getClients(req, res) {
  try {
    const clientes = await db.query('SELECT * FROM clientes ORDER BY nombre ASC');
    return res.json(clientes);
  } catch (error) {
    console.error('Error al listar clientes:', error);
    return res.status(500).json({ error: 'Error al consultar catálogo de clientes.' });
  }
}

// 3. Detalle de Cuenta (Historial de compras a crédito y abonos)
export async function getClientDetails(req, res) {
  const { id } = req.params;

  try {
    const clientRes = await db.query('SELECT * FROM clientes WHERE id = $1', [id]);
    if (clientRes.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }
    const cliente = clientRes[0];

    // Obtener compras asociadas
    const ventas = await db.query(`
      SELECT DISTINCT v.id, v.fecha, v.total, v.notas,
             (SELECT COALESCE(SUM(monto_base), 0) FROM pagos_ventas WHERE venta_id = v.id AND metodo_pago = 'Crédito') as monto_credito
      FROM ventas v
      WHERE v.cliente_id = $1
      ORDER BY v.fecha DESC
    `, [id]);

    // Obtener abonos realizados
    const abonos = await db.query(`
      SELECT id, monto_total_cop, fecha, notas
      FROM abonos_credito
      WHERE cliente_id = $1
      ORDER BY fecha DESC
    `, [id]);

    return res.json({
      cliente,
      compras: ventas,
      abonos: abonos
    });
  } catch (error) {
    console.error('Error al obtener detalle del cliente:', error);
    return res.status(500).json({ error: 'Error al consultar historial del cliente.' });
  }
}

// 4. Registrar Abono Multimoneda
export async function processAbono(req, res) {
  const { cliente_id, pagos, tasas, notas } = req.body;

  if (!cliente_id) {
    return res.status(400).json({ error: 'El ID del cliente es obligatorio.' });
  }
  if (!pagos || !Array.isArray(pagos) || pagos.length === 0) {
    return res.status(400).json({ error: 'Debe ingresar al menos un pago para procesar el abono.' });
  }

  const tasaDiaUsd = tasas && tasas.USD ? parseFloat(tasas.USD) : 4000.00;
  const tasaDiaVes = tasas && tasas.VES ? parseFloat(tasas.VES) : 100.00;

  try {
    // Verificar si el cliente existe
    const clientRes = await db.query('SELECT id, nombre, saldo_deudor FROM clientes WHERE id = $1', [cliente_id]);
    if (clientRes.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }
    const cliente = clientRes[0];
    const saldoActual = parseFloat(cliente.saldo_deudor);

    if (saldoActual <= 0) {
      return res.status(400).json({ error: 'Este cliente no presenta deudas activas.' });
    }

    // Calcular total del abono en COP
    let totalAbonoCop = 0;
    const pagosProcesados = pagos.map(p => {
      const montoOriginal = parseFloat(p.monto_original);
      const moneda = p.moneda.toUpperCase();

      let tasaCambio = 1.0;
      if (moneda === 'USD') {
        tasaCambio = tasaDiaUsd;
      } else if (moneda === 'VES') {
        tasaCambio = tasaDiaVes;
      } else if (moneda !== 'COP') {
        throw new Error(`Moneda no soportada: ${moneda}`);
      }

      const montoBase = montoOriginal * tasaCambio;
      totalAbonoCop += montoBase;

      return {
        metodo_pago: p.metodo_pago,
        moneda,
        monto_original: montoOriginal,
        tasa_cambio: tasaCambio,
        monto_base: montoBase,
        referencia: p.referencia || null
      };
    });

    // Validar que el abono no exceda la deuda (con un pequeño delta)
    if (totalAbonoCop > saldoActual + 0.05) {
      return res.status(400).json({
        error: 'El monto abonado excede el saldo deudor del cliente.',
        saldo_deudor: saldoActual,
        monto_abono_ingresado: totalAbonoCop
      });
    }

    // Determinar si es Postgres o SQLite
    const isPg = !process.env.DATABASE_URL && !process.env.PGHOST ? false : true;

    // Ejecutar transacción
    const resultado = await db.transaction(async (tx) => {
      // A. Disminuir saldo deudor del cliente
      const nuevoSaldo = Math.max(0, saldoActual - totalAbonoCop);
      await tx.execute('UPDATE clientes SET saldo_deudor = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [nuevoSaldo, cliente_id]);

      // B. Insertar cabecera del abono
      const insertAbonoSql = isPg
        ? 'INSERT INTO abonos_credito (cliente_id, monto_total_cop, notas) VALUES ($1, $2, $3) RETURNING id'
        : 'INSERT INTO abonos_credito (cliente_id, monto_total_cop, notas) VALUES ($1, $2, $3)';
      
      const resAbono = await tx.execute(insertAbonoSql, [cliente_id, totalAbonoCop, notas || '']);
      const abonoId = resAbono[0].id;

      // C. Insertar desglose de pagos del abono
      const insertPagoSql = `
        INSERT INTO pagos_abonos (abono_id, metodo_pago, moneda, monto_original, tasa_cambio, monto_base, referencia)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      for (const pago of pagosProcesados) {
        await tx.execute(insertPagoSql, [
          abonoId,
          pago.metodo_pago,
          pago.moneda,
          pago.monto_original,
          pago.tasa_cambio,
          pago.monto_base,
          pago.referencia
        ]);
      }

      return { abonoId, nuevoSaldo };
    });

    return res.status(201).json({
      mensaje: 'Abono registrado con éxito.',
      abono_id: resultado.abonoId,
      saldo_deudor_previo: saldoActual,
      monto_abonado_cop: totalAbonoCop,
      nuevo_saldo_deudor: resultado.nuevoSaldo,
      pagos: pagosProcesados
    });

  } catch (error) {
    console.error('Error al procesar abono:', error);
    return res.status(500).json({ error: 'Error interno del servidor al aplicar abono.', detalle: error.message });
  }
}


// 5. Registrar Deuda Manual (sin venta)
export async function registrarDeuda(req, res) {
  const { id } = req.params;
  const { monto, notas } = req.body;

  if (!monto || parseFloat(monto) <= 0) {
    return res.status(400).json({ error: 'El monto de la deuda debe ser mayor a 0.' });
  }

  try {
    const clientRes = await db.query('SELECT id, nombre, saldo_deudor, limite_credito FROM clientes WHERE id = $1', [id]);
    if (clientRes.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }
    const cliente = clientRes[0];
    const saldoActual = parseFloat(cliente.saldo_deudor);
    const limite = parseFloat(cliente.limite_credito);
    const montoDeuda = parseFloat(monto);

    if (limite > 0 && (saldoActual + montoDeuda) > limite + 0.05) {
      return res.status(400).json({
        error: 'La deuda excedería el límite de crédito del cliente.',
        saldo_actual: saldoActual,
        limite_credito: limite,
        monto_solicitado: montoDeuda
      });
    }

    const nuevoSaldo = saldoActual + montoDeuda;
    await db.execute('UPDATE clientes SET saldo_deudor = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [nuevoSaldo, id]);

    return res.status(201).json({
      mensaje: 'Deuda registrada con éxito.',
      saldo_anterior: saldoActual,
      monto_deuda: montoDeuda,
      nuevo_saldo: nuevoSaldo,
      notas: notas || ''
    });
  } catch (error) {
    console.error('Error al registrar deuda:', error);
    return res.status(500).json({ error: 'Error interno del servidor.', detalle: error.message });
  }
}

// 6. Eliminar Abono
export async function deleteAbono(req, res) {
  const { id } = req.params;
  const { admin_password } = req.body;
  
  if (!admin_password) {
    return res.status(400).json({ error: 'Se requiere la contraseña de administrador para anular un abono.' });
  }

  try {
    // 1. Validar contraseña
    const admins = await db.query("SELECT id, password_hash FROM usuarios WHERE rol = 'Administrador'");
    if (admins.length === 0) {
      return res.status(500).json({ error: 'No hay administradores configurados en el sistema.' });
    }

    let authSuccess = false;
    for (const admin of admins) {
      if (admin.password_hash) {
        const match = await bcrypt.compare(admin_password, admin.password_hash);
        if (match) {
          authSuccess = true;
          break;
        }
      }
    }

    if (!authSuccess) {
      return res.status(401).json({ error: 'Contraseña de administrador incorrecta.' });
    }

    const abonoRes = await db.query('SELECT cliente_id, monto_total_cop FROM abonos_credito WHERE id = $1', [id]);
    if (abonoRes.length === 0) {
      return res.status(404).json({ error: 'Abono no encontrado.' });
    }
    const abono = abonoRes[0];
    const { cliente_id, monto_total_cop } = abono;

    await db.transaction(async (tx) => {
      // Devolver saldo al cliente
      const clientRes = await tx.query('SELECT saldo_deudor FROM clientes WHERE id = $1', [cliente_id]);
      const saldoActual = parseFloat(clientRes[0].saldo_deudor) || 0;
      const nuevoSaldo = saldoActual + parseFloat(monto_total_cop);
      await tx.execute('UPDATE clientes SET saldo_deudor = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [nuevoSaldo, cliente_id]);

      // Eliminar desglose y cabecera
      await tx.execute('DELETE FROM pagos_abonos WHERE abono_id = $1', [id]);
      await tx.execute('DELETE FROM abonos_credito WHERE id = $1', [id]);
    });

    return res.json({ mensaje: 'Abono eliminado con éxito y saldo revertido.' });
  } catch (error) {
    console.error('Error al eliminar abono:', error);
    return res.status(500).json({ error: 'Error al eliminar abono.' });
  }
}
