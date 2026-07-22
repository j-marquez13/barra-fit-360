import * as db from './db.js';
import { processSale } from './controllers/salesController.js';

async function run() {
  const req = {
    body: {
      items: [
        { producto_id: 1, cantidad: 1 }
      ],
      pagos: [
        { metodo_pago: 'Efectivo COP', moneda: 'COP', monto_original: 1000.0, referencia: null },
        { metodo_pago: 'Efectivo USD', moneda: 'USD', monto_original: 0.25, referencia: null }
      ],
      tasas: { USD: 4000, VES: 100 },
      notas: 'Prueba mixto'
    }
  };

  let s = 0;
  let d = null;
  const res = {
    status: (code) => {
      s = code;
      return { json: (data) => { d = data; } };
    }
  };

  try {
    // Insert a product for testing
    await processSale(req, res);
    console.log("Status:", s);
    console.log("Data:", JSON.stringify(d, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    db.close();
  }
}

run();
