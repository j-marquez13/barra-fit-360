import * as db from './db.js';
import { processSale } from './controllers/salesController.js';
import { cierreDiario } from './controllers/reportsController.js';
import { estadoCaja } from './controllers/cashierController.js';

async function run() {
  const reqSale = {
    body: {
      items: [{ producto_id: 1, cantidad: 1 }],
      pagos: [
        { metodo_pago: 'Efectivo COP', moneda: 'COP', monto_original: 1000.0, referencia: null },
        { metodo_pago: 'Bancolombia', moneda: 'COP', monto_original: 1000.0, referencia: '123' }
      ],
      tasas: { USD: 4000, VES: 100 },
      notas: 'Prueba mixto COP y Banco'
    }
  };

  let saleData = null;
  const resSale = {
    status: () => resSale,
    json: (d) => { saleData = d; }
  };

  let reportData = null;
  const reqReport = { query: {} };
  const resReport = {
    status: () => resReport,
    json: (d) => { reportData = d; }
  };

  try {
    await db.execute('INSERT INTO productos (nombre, precio_venta) VALUES ("Test 2", 2000)');
    await processSale(reqSale, resSale);
    console.log("Venta procesada:", saleData.pagos);

    await cierreDiario(reqReport, resReport);
    console.log("\nCierre Diario Desglose:");
    console.log(reportData.desglose_pagos);
    
    console.log("\nCierre Diario Ventas:");
    console.log(reportData.ventas.find(v => v.id === saleData.venta_id));

  } catch(e) {
    console.error(e);
  } finally {
    db.close();
  }
}
run();
