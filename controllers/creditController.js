import * as db from '../db.js';
import bcrypt from 'bcryptjs';

/**
 * Controlador de Clientes y Líneas de Crédito (Cuentas por Cobrar)
 */

// 1. Crear Perfil de Cliente
export async function createClient(req, res) {
  const { nombre, identificacion, telefono, limite_credito, permite_saldo_favor } = req.body;

  if (!nombre || !identificacion) {
    return res.status(400).json({ error: 'El nombre y la identificación son obligatorios.' });
  }

  const limite = parseFloat(limite_credito) || 0;
  if (limite < 0) {
    return res.status(400).json({ error: 'El límite de crédito no puede ser negativo.' });
  }
  const saldoFavorFlag = !!permite_saldo_favor;

  try {
    const isPg = !process.env.DATABASE_URL && !process.env.PGHOST ? false : true;
    
    // Verificar duplicado
    const existing = await db.query('SELECT id FROM clientes WHERE identificacion = $1', [identificacion]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ya existe un cliente registrado con esa identificación.' });
    }

    const insertSql = isPg
      ? 'INSERT INTO clientes (nombre, identificacion, telefono, limite_credito, saldo_deudor, permite_saldo_favor) VALUES ($1, $2, $3, $4, 0.00, $5) RETURNING *'
      : 'INSERT INTO clientes (nombre, identificacion, telefono, limite_credito, saldo_deudor, permite_saldo_favor) VALUES ($1, $2, $3, $4, 0.00, $5)';

    const resInsert = await db.execute(insertSql, [nombre, identificacion, telefono || '', limite, saldoFavorFlag]);
    
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
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// 2.1 Editar Cliente
export async function updateClient(req, res) {
  const { id } = req.params;
  const { nombre, identificacion, telefono, limite_credito, permite_saldo_favor } = req.body;

  if (!nombre || !identificacion) {
    return res.status(400).json({ error: 'El nombre y la identificación son obligatorios.' });
  }

  const limite = parseFloat(limite_credito) || 0;
  if (limite < 0) {
    return res.status(400).json({ error: 'El límite de crédito no puede ser negativo.' });
  }
  const saldoFavorFlag = !!permite_saldo_favor;

  try {
    const existing = await db.query('SELECT id FROM clientes WHERE id = $1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado.' });
    }

    const checkIdent = await db.query('SELECT id FROM clientes WHERE identificacion = $1 AND id != $2', [identificacion, id]);
    if (checkIdent.length > 0) {
      return res.status(409).json({ error: 'Ya existe otro cliente con esa identificación.' });
    }

    await db.execute(
      'UPDATE clientes SET nombre = $1, identificacion = $2, telefono = $3, limite_credito = $4, permite_saldo_favor = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6',
      [nombre, identificacion, telefono || '', limite, saldoFavorFlag, id]
    );

    const updated = await db.query('SELECT * FROM clientes WHERE id = $1', [id]);
    return res.json({ mensaje: 'Cliente actualizado con éxito.', cliente: updated[0] });
  } catch (error) {
    console.error('Error al actualizar cliente:', error);
    return res.status(500).json({ error: 'Error al actualizar el cliente.', detalle: error.message });
  }
}

// 3. Obtener Detalle de Cliente (Historial) de compras a crédito y abonos)
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
             (SELECT COALESCE(SUM(monto_base), 0) FROM pagos_ventas pv JOIN ventas vv ON pv.venta_id = vv.id WHERE pv.venta_id = v.id AND pv.metodo_pago = 'Crédito' AND vv.tipo_transaccion != 'Anulada') as monto_credito
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

  if (!(tasaDiaUsd > 0) || !(tasaDiaVes > 0)) {
    return res.status(400).json({ error: 'Las tasas de cambio deben ser números mayores a 0.' });
  }

  try {
    // Calcular total del abono en COP
    let totalAbonoCop = 0;
    const pagosProcesados = [];
    for (const p of pagos) {
      const montoOriginal = parseFloat(p.monto_original);
      if (!Number.isFinite(montoOriginal) || montoOriginal <= 0) {
        return res.status(400).json({ error: 'Los montos del abono deben ser números mayores a 0.' });
      }
      if (!p.metodo_pago || typeof p.moneda !== 'string') {
        return res.status(400).json({ error: 'Cada pago debe indicar método de pago y moneda.' });
      }
      const moneda = p.moneda.toUpperCase();

      let tasaCambio = 1.0;
      if (moneda === 'USD') {
        tasaCambio = tasaDiaUsd;
      } else if (moneda === 'VES') {
        tasaCambio = tasaDiaVes;
      } else if (moneda !== 'COP') {
        return res.status(400).json({ error: `Moneda no soportada: ${moneda}` });
      }

      const montoBase = montoOriginal * tasaCambio;
      totalAbonoCop += montoBase;

      pagosProcesados.push({
        metodo_pago: p.metodo_pago,
        moneda,
        monto_original: montoOriginal,
        tasa_cambio: tasaCambio,
        monto_base: montoBase,
        referencia: p.referencia || null
      });
    }

    // Determinar si es Postgres o SQLite
    const isPg = db.isPostgres();

    // Ejecutar transacción. El saldo se lee DENTRO de la transacción (con bloqueo
    // de fila en PG) para que dos abonos simultáneos no se pisen.
    const resultado = await db.transaction(async (tx) => {
      const clientRes = await tx.query(
        `SELECT id, nombre, saldo_deudor, permite_saldo_favor FROM clientes WHERE id = $1${isPg ? ' FOR UPDATE' : ''}`,
        [cliente_id]
      );
      if (clientRes.length === 0) {
        throw Object.assign(new Error('Cliente no encontrado.'), { status: 404 });
      }
      const cliente = clientRes[0];
      const saldoActual = parseFloat(cliente.saldo_deudor) || 0;
      const permiteFavor = cliente.permite_saldo_favor == 1 || cliente.permite_saldo_favor === true || cliente.permite_saldo_favor === 't';

      if (saldoActual <= 0 && !permiteFavor) {
        throw Object.assign(new Error('Este cliente no presenta deudas activas.'), { status: 400 });
      }

      // Validar que el abono no exceda la deuda (con un pequeño delta)
      if (totalAbonoCop > saldoActual + 0.05 && !permiteFavor) {
        throw Object.assign(new Error('El monto abonado excede el saldo deudor del cliente y no se permiten saldos a favor.'), {
          status: 400,
          extra: { saldo_deudor: saldoActual, monto_abono_ingresado: totalAbonoCop }
        });
      }

      // A. Disminuir saldo deudor del cliente
      const nuevoSaldo = permiteFavor ? (saldoActual - totalAbonoCop) : Math.max(0, saldoActual - totalAbonoCop);
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

      return { abonoId, nuevoSaldo, saldoActual };
    });

    return res.status(201).json({
      mensaje: 'Abono registrado con éxito.',
      abono_id: resultado.abonoId,
      saldo_deudor_previo: resultado.saldoActual,
      monto_abonado_cop: totalAbonoCop,
      nuevo_saldo_deudor: resultado.nuevoSaldo,
      pagos: pagosProcesados
    });

  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message, ...(error.extra || {}) });
    }
    console.error('Error al procesar abono:', error);
    return res.status(500).json({ error: 'Error interno del servidor al aplicar abono.', detalle: error.message });
  }
}

// 5. Registrar Deuda Manual (sin venta)
export async function registrarDeuda(req, res) {
  const { id } = req.params;
  const { monto, notas } = req.body;

  const montoDeuda = parseFloat(monto);
  if (!Number.isFinite(montoDeuda) || montoDeuda <= 0) {
    return res.status(400).json({ error: 'El monto de la deuda debe ser mayor a 0.' });
  }

  try {
    const isPg = db.isPostgres();
    const resultado = await db.transaction(async (tx) => {
      const clientRes = await tx.query(
        `SELECT id, nombre, saldo_deudor, limite_credito FROM clientes WHERE id = $1${isPg ? ' FOR UPDATE' : ''}`,
        [id]
      );
      if (clientRes.length === 0) {
        throw Object.assign(new Error('Cliente no encontrado.'), { status: 404 });
      }
      const cliente = clientRes[0];
      const saldoActual = parseFloat(cliente.saldo_deudor) || 0;
      const limite = parseFloat(cliente.limite_credito) || 0;

      if (limite > 0 && (saldoActual + montoDeuda) > limite + 0.05) {
        throw Object.assign(new Error('La deuda excedería el límite de crédito del cliente.'), {
          status: 400,
          extra: { saldo_actual: saldoActual, limite_credito: limite, monto_solicitado: montoDeuda }
        });
      }

      const nuevoSaldo = saldoActual + montoDeuda;
      await tx.execute('UPDATE clientes SET saldo_deudor = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [nuevoSaldo, id]);
      // Insertar registro de auditoría en abonos_credito con monto negativo para trazabilidad
      await tx.execute(
        'INSERT INTO abonos_credito (cliente_id, monto_total_cop, notas) VALUES ($1, $2, $3)',
        [id, -montoDeuda, `[DEUDA MANUAL] ${notas || 'Sin notas'} - Registrada el ${new Date().toISOString()}`]
      );
      return { saldoActual, nuevoSaldo };
    });

    return res.status(201).json({
      mensaje: 'Deuda registrada con éxito.',
      saldo_anterior: resultado.saldoActual,
      monto_deuda: montoDeuda,
      nuevo_saldo: resultado.nuevoSaldo,
      notas: notas || ''
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message, ...(error.extra || {}) });
    }
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
    let authSuccess = false;
    for (const admin of admins) {
      if (admin.password_hash && await bcrypt.compare(String(admin_password), admin.password_hash)) {
        authSuccess = true;
        break;
      }
    }

    if (!authSuccess) {
      return res.status(401).json({ error: 'Contraseña de administrador incorrecta.' });
    }

    const isPg = db.isPostgres();
    await db.transaction(async (tx) => {
      const abonoRes = await tx.query(`SELECT cliente_id, monto_total_cop FROM abonos_credito WHERE id = $1${isPg ? ' FOR UPDATE' : ''}`, [id]);
      if (abonoRes.length === 0) {
        throw Object.assign(new Error('Abono no encontrado.'), { status: 404 });
      }
      const { cliente_id, monto_total_cop } = abonoRes[0];

      // Devolver saldo al cliente (relativo, para no pisar otros movimientos)
      await tx.execute(
        'UPDATE clientes SET saldo_deudor = saldo_deudor + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [parseFloat(monto_total_cop) || 0, cliente_id]
      );

      // Revertir la tesorería: el trigger trg_tesoreria_abono_in sumó `monto_original`
      // de cada pago a su cuenta al registrar el abono.
      const pagosAbono = await tx.query('SELECT metodo_pago, monto_original FROM pagos_abonos WHERE abono_id = $1', [id]);
      for (const p of pagosAbono) {
        await tx.execute(
          'UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE nombre = $2',
          [parseFloat(p.monto_original) || 0, p.metodo_pago]
        );
      }

      // Eliminar desglose y cabecera
      await tx.execute('DELETE FROM pagos_abonos WHERE abono_id = $1', [id]);
      await tx.execute('DELETE FROM abonos_credito WHERE id = $1', [id]);
    });

    return res.json({ mensaje: 'Abono eliminado con éxito y saldo revertido.' });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Error al eliminar abono:', error);
    return res.status(500).json({ error: 'Error al eliminar abono.' });
  }
}

