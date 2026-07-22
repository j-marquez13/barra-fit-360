const fs = require('fs');

// --- Patch reportsController.js ---
let reports = fs.readFileSync('controllers/reportsController.js', 'utf8');

const target1 = `    // 2. Desglose por método de pago
    const pagosPorMetodo = await db.query(\`
      SELECT pv.metodo_pago, pv.moneda, COUNT(*) as cantidad_pagos,
             SUM(pv.monto_original) as total_original, SUM(pv.monto_base) as total_cop
      FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
      WHERE \${dateFilter} GROUP BY pv.metodo_pago, pv.moneda ORDER BY total_cop DESC
    \`, [fecha]);`;

const rep1 = `    // 2. Desglose por método de pago (Ventas + Abonos)
    const pagosPorMetodo = await db.query(\`
      SELECT metodo_pago, moneda, sum(cantidad_pagos) as cantidad_pagos, sum(total_original) as total_original, sum(total_cop) as total_cop
      FROM (
        SELECT pv.metodo_pago, pv.moneda, COUNT(*) as cantidad_pagos, SUM(pv.monto_original) as total_original, SUM(pv.monto_base) as total_cop
        FROM pagos_ventas pv JOIN ventas v ON pv.venta_id = v.id
        WHERE \${dateFilter} GROUP BY pv.metodo_pago, pv.moneda
        UNION ALL
        SELECT pa.metodo_pago, pa.moneda, COUNT(*) as cantidad_pagos, SUM(pa.monto_original) as total_original, SUM(pa.monto_base) as total_cop
        FROM pagos_abonos pa JOIN abonos_credito a ON pa.abono_id = a.id
        WHERE \${dateFilter.replace('v.fecha', 'a.fecha')} GROUP BY pa.metodo_pago, pa.moneda
      ) combined
      GROUP BY metodo_pago, moneda ORDER BY total_cop DESC
    \`, [fecha]);
    
    // 2.5 Cobranza de deudas
    const abonosResumen = await db.query(\`
      SELECT COALESCE(SUM(monto_total_cop), 0) as total_abonos
      FROM abonos_credito a
      WHERE \${dateFilter.replace('v.fecha', 'a.fecha')}
    \`, [fecha]);
    const totalAbonos = parseFloat(abonosResumen[0]?.total_abonos || 0);`;
reports = reports.replace(target1, rep1);

const target2 = `      resumen: {
        total_transacciones: parseInt(ventasResumen[0]?.total_transacciones || 0),
        ingresos_totales_cop: totalVentas,`;

const rep2 = `      resumen: {
        total_transacciones: parseInt(ventasResumen[0]?.total_transacciones || 0),
        ingresos_totales_cop: totalVentas,
        cobranza_deudas_cop: totalAbonos,
        flujo_caja_ingresos: totalVentas + totalAbonos,`;
reports = reports.replace(target2, rep2);

fs.writeFileSync('controllers/reportsController.js', reports);

// --- Patch app3.js ---
let app3 = fs.readFileSync('public/app3.js', 'utf8');

const target3 = `    document.getElementById('kpi-ventas').textContent = \`$$\{data.resumen.ingresos_totales_cop.toLocaleString()}\`;
    document.getElementById('kpi-transacciones').textContent = \`\${data.resumen.total_transacciones} transacciones\`;`;

const rep3 = `    document.getElementById('kpi-ventas').textContent = \`$$\{data.resumen.ingresos_totales_cop.toLocaleString()}\`;
    document.getElementById('kpi-transacciones').textContent = \`\${data.resumen.total_transacciones} transacciones\`;
    if (document.getElementById('kpi-cobranza')) {
      document.getElementById('kpi-cobranza').textContent = \`$$\{data.resumen.cobranza_deudas_cop.toLocaleString()}\`;
      document.getElementById('kpi-flujo-caja').textContent = \`Flujo Total: $$\{data.resumen.flujo_caja_ingresos.toLocaleString()}\`;
    }`;
app3 = app3.replace(target3, rep3);

fs.writeFileSync('public/app3.js', app3);

// --- Patch index.html ---
let html = fs.readFileSync('public/index.html', 'utf8');

const target4 = `              <div class="kpi-card kpi-ventas">
                <div class="kpi-icon"><i data-lucide="receipt"></i></div>
                <div class="kpi-data">
                  <span class="kpi-label">Ingresos Totales</span>
                  <span class="kpi-value" id="kpi-ventas">$0</span>
                  <span class="kpi-sub" id="kpi-transacciones">0 transacciones</span>
                </div>
              </div>`;

const rep4 = `              <div class="kpi-card kpi-ventas">
                <div class="kpi-icon"><i data-lucide="receipt"></i></div>
                <div class="kpi-data">
                  <span class="kpi-label">Ventas del Día</span>
                  <span class="kpi-value" id="kpi-ventas">$0</span>
                  <span class="kpi-sub" id="kpi-transacciones">0 transacciones</span>
                </div>
              </div>
              <div class="kpi-card kpi-ventas" style="border-left-color: #32c8ff;">
                <div class="kpi-icon"><i data-lucide="wallet"></i></div>
                <div class="kpi-data">
                  <span class="kpi-label">Deudas Cobradas</span>
                  <span class="kpi-value" id="kpi-cobranza">$0</span>
                  <span class="kpi-sub" id="kpi-flujo-caja">Flujo Total: $0</span>
                </div>
              </div>`;
html = html.replace(target4, rep4);

fs.writeFileSync('public/index.html', html);
console.log('Patch applied.');
