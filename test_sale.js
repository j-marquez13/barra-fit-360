
async function testSale() {
  const payload = {
    items: [
      {
        producto_id: 1, 
        cantidad: 1,
        extras: [
          {
            insumo_id: 3, 
            nombre: "Leche Entera",
            cantidad: 0.5,
            precio_adicional: 0
          },
          {
            insumo_id: 2, 
            nombre: "Yogurt",
            cantidad: 1,
            precio_adicional: 0
          }
        ]
      }
    ],
    pagos: [
      {
        metodo_pago: "Efectivo COP",
        moneda: "COP",
        monto_original: 50000,
        referencia: null
      }
    ],
    tasas: { USD: 4000, VES: 100 },
    tipo_transaccion: "Venta",
    notas: "Test",
    cliente_id: null
  };

  try {
    const res = await fetch('http://localhost:3000/api/ventas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Response:", data);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

testSale();
