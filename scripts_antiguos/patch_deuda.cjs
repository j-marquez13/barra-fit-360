const fs = require('fs');

// ============================================
// 1. ADD BACKEND ROUTE: POST /api/clientes/:id/deuda
// ============================================
let credit = fs.readFileSync('controllers/creditController.js', 'utf8');

const newFunction = `

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
`;

credit = credit.trimEnd() + '\n' + newFunction;
fs.writeFileSync('controllers/creditController.js', credit);

// ============================================
// 2. ADD ROUTE TO server.js
// ============================================
let server = fs.readFileSync('server.js', 'utf8');

// Update import
server = server.replace(
  "import { createClient, getClients, getClientDetails, processAbono } from './controllers/creditController.js';",
  "import { createClient, getClients, getClientDetails, processAbono, registrarDeuda } from './controllers/creditController.js';"
);

// Add route after /api/abonos
server = server.replace(
  "app.post('/api/abonos', processAbono);",
  "app.post('/api/abonos', processAbono);\napp.post('/api/clientes/:id/deuda', registrarDeuda);"
);

fs.writeFileSync('server.js', server);

// ============================================
// 3. UPDATE FRONTEND: add "Registrar Deuda" button per row + modal
// ============================================
let app3 = fs.readFileSync('public/app3.js', 'utf8');

// A. Add "Registrar Deuda" button to client table rows
app3 = app3.replace(
  `          <button class="table-btn btn-detail" onclick="loadClientDetail(\${c.id})">Ver</button>`,
  `          <button class="table-btn btn-detail" onclick="loadClientDetail(\${c.id})">Ver</button>
            <button class="table-btn" style="background:var(--warning); color:#000;" onclick="showRegistrarDeudaModal(\${c.id}, '\${c.nombre.replace(/'/g, "\\\\'")}', \${parseFloat(c.saldo_deudor)}, \${parseFloat(c.limite_credito)})">+ Deuda</button>`
);

// B. Add "Registrar Deuda" button in client detail panel next to "Registrar Abono"
app3 = app3.replace(
  `    document.getElementById('btn-registrar-abono').onclick = () => showAbonoModal(clientId, data.cliente.nombre, saldo);`,
  `    document.getElementById('btn-registrar-abono').onclick = () => showAbonoModal(clientId, data.cliente.nombre, saldo);
    document.getElementById('btn-registrar-deuda').onclick = () => showRegistrarDeudaModal(clientId, data.cliente.nombre, saldo, limite);`
);

// C. Add the showRegistrarDeudaModal function after showAbonoModal
const deudaModalFunction = `

window.showRegistrarDeudaModal = function(clientId, clientName, saldoActual, limiteCredito) {
  const disponible = Math.max(0, limiteCredito - saldoActual);
  openGenericModal(\`Registrar Deuda — \${clientName}\`, \`
    <div class="alert-item alert-warning" style="margin-bottom:8px;">
      <i data-lucide="info"></i>
      <span>Saldo deudor actual: <strong>$\${saldoActual.toLocaleString()} COP</strong> | Límite: <strong>$\${limiteCredito.toLocaleString()}</strong> | Disponible: <strong>$\${disponible.toLocaleString()}</strong></span>
    </div>
    <div class="form-group"><label>Monto de la Deuda (COP)</label><input type="number" id="inp-deuda-monto" placeholder="0" min="0.01" step="0.01"></div>
    <div class="form-group"><label>Notas / Concepto</label><input type="text" id="inp-deuda-notas" placeholder="Ej: Consumo pendiente, préstamo, etc."></div>
  \`, async () => {
    const monto = parseFloat(document.getElementById('inp-deuda-monto').value);
    const notas = document.getElementById('inp-deuda-notas').value;
    if (!monto || monto <= 0) { showToast('Ingresa un monto válido', 'danger'); return; }
    try {
      const res = await fetch(\`/api/clientes/\${clientId}/deuda\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto, notas })
      });
      const data = await res.json();
      if (res.status === 201) {
        showToast(data.mensaje + \` Nuevo saldo: $\${data.nuevo_saldo.toLocaleString()}\`, 'success');
        closeGenericModal();
        loadClientesData();
        if (STATE.selectedClientId === clientId) loadClientDetail(clientId);
      } else {
        showToast(data.error, 'danger');
      }
    } catch (err) {
      showToast('Error de conexión', 'danger');
    }
  });
};
`;

// Insert after showAbonoModal closing brace
const abonoModalEnd = app3.indexOf("function showAbonoModal(clientId, clientName, saldoActual)");
const nextFuncAfterAbono = app3.indexOf("\nfunction ", abonoModalEnd + 10);
if (nextFuncAfterAbono > 0) {
  app3 = app3.slice(0, nextFuncAfterAbono) + deudaModalFunction + app3.slice(nextFuncAfterAbono);
} else {
  // fallback: append before last lines
  app3 = app3 + deudaModalFunction;
}

fs.writeFileSync('public/app3.js', app3);

// ============================================
// 4. UPDATE HTML: add "Registrar Deuda" button in detail panel
// ============================================
let html = fs.readFileSync('public/index.html', 'utf8');

html = html.replace(
  `              <button class="action-btn" id="btn-registrar-abono">
                <i data-lucide="banknote"></i> Registrar Abono
              </button>`,
  `              <button class="action-btn" id="btn-registrar-abono">
                <i data-lucide="banknote"></i> Registrar Abono
              </button>
              <button class="action-btn" id="btn-registrar-deuda" style="background:var(--warning); color:#000;">
                <i data-lucide="file-plus"></i> Registrar Deuda
              </button>`
);

fs.writeFileSync('public/index.html', html);

console.log('Done! Backend route + frontend UI for registrar deuda added.');
