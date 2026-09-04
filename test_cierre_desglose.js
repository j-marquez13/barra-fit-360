import * as db from './db.js';
import { initializeDatabase } from './initDb.js';
import { abrirCaja, cerrarCaja } from './controllers/cashierController.js';
import { processSale } from './controllers/salesController.js';

/**
 * Prueba automática del desglose de cierre (guardado por método/moneda).
 * Usa la base de datos indicada en DB_PATH (aislada, no toca la real).
 */

const TASAS = { USD: 4000, VES: 100 };

function mockRes() {
  const o = {};
  o.status = (code) => {
    o._status = code;
    return { json: (d) => { o._data = d; } };
  };
  o.json = (d) => { o._data = d; o._status = o._status || 200; return o; };
  return o;
}

async function main() {
  console.log('🏁 Iniciando prueba del desglose de cierre...\n');
  await initializeDatabase();

  // 1. Producto de prueba
  await db.execute("INSERT INTO productos (nombre, categoria, costo_produccion, precio_venta, activo) VALUES ('Batido Test', 'Batidos', 1000, 2000, 1)");
  const prod = await db.query('SELECT id FROM productos WHERE nombre = $1', ['Batido Test']);
  const prodId = prod[0].id;

  // 2. Usuario de prueba
  const usr = await db.query('SELECT id FROM usuarios ORDER BY id LIMIT 1');
  const userId = usr[0].id;

  // 3. Abrir caja
  const resAbrir = mockRes();
  await abrirCaja({ body: { usuario_id: userId, fondo_inicial_cop: 50000, fondo_inicial_usd: 10, turno: 'Mañana', nombre_cajero: 'Cajero Test' } }, resAbrir);
  console.log(`   Apertura de caja → status ${resAbrir._status}`);
  if (resAbrir._status >= 400) throw new Error('Fallo al abrir caja: ' + JSON.stringify(resAbrir._data));

  // 4. Ventas con distintos métodos de pago
  const ventas = [
    { metodo: 'Efectivo COP', moneda: 'COP', monto: 2000 },
    { metodo: 'Zelle', moneda: 'USD', monto: 0.5 },
    { metodo: 'Pago Móvil', moneda: 'VES', monto: 20 },
    { metodo: 'Binance', moneda: 'USD', monto: 0.5 },
    { metodo: 'Efectivo USD', moneda: 'USD', monto: 0.5 },
    { metodo: 'Bancolombia', moneda: 'COP', monto: 2000 },
  ];
  for (const v of ventas) {
    const r = mockRes();
    await processSale({ body: {
      items: [{ producto_id: prodId, cantidad: 1 }],
      pagos: [{ metodo_pago: v.metodo, moneda: v.moneda, monto_original: v.monto, referencia: null }],
      tasas: TASAS,
      notas: 'prueba desglose'
    } }, r);
    if (r._status >= 400) console.log(`   ⚠️ Venta ${v.metodo} devolvió status ${r._status}:`, JSON.stringify(r._data));
    else console.log(`   ✅ Venta registrada: ${v.metodo} (${v.monto} ${v.moneda})`);
  }

  // 5. Cerrar caja con el desglose declarado
  const resCerrar = mockRes();
  await cerrarCaja({ body: {
    monto_declarado_cop: 12000,
    declarado_pago_movil: 20,
    declarado_zelle: 0.5,
    declarado_binance: 0.5,
    declarado_efectivo_pesos: 2000,
    declarado_bancolombia: 2000,
    declarado_efectivo_usd: 0.5,
    tasas: TASAS
  } }, resCerrar);
  console.log(`\n   Cierre de caja → status ${resCerrar._status}`);
  if (resCerrar._status >= 400) throw new Error('Fallo al cerrar caja: ' + JSON.stringify(resCerrar._data));

  // 6. Verificar lo guardado en la base de datos
  const ses = await db.query("SELECT * FROM sesiones_caja WHERE estado = 'Cerrada' ORDER BY id DESC LIMIT 1");
  const s = ses[0];

  const esperados = [
    ['declarado_pago_movil', s.declarado_pago_movil, 20],
    ['declarado_zelle', s.declarado_zelle, 0.5],
    ['declarado_binance', s.declarado_binance, 0.5],
    ['declarado_efectivo_pesos', s.declarado_efectivo_pesos, 2000],
    ['declarado_bancolombia', s.declarado_bancolombia, 2000],
    ['declarado_efectivo_usd', s.declarado_efectivo_usd, 0.5],
    ['declarado_cop', s.declarado_cop, 12000],
  ];

  let ok = true;
  console.log('\n📋 Verificación del desglose guardado:');
  for (const [campo, valor, esperado] of esperados) {
    const pass = Math.abs(parseFloat(valor) - esperado) < 0.001;
    console.log(`   ${pass ? '✅' : '❌'} ${campo} = ${valor} (esperado ${esperado})`);
    if (!pass) ok = false;
  }

  // 7. Verificar que el resumen devuelto incluya el desglose
  const resumen = resCerrar._data?.resumen || {};
  const camposResumen = ['declarado_pago_movil', 'declarado_zelle', 'declarado_binance', 'declarado_efectivo_pesos', 'declarado_bancolombia', 'declarado_efectivo_usd'];
  console.log('\n📋 Verificación del resumen devuelto por /api/caja/cerrar:');
  for (const campo of camposResumen) {
    const presente = resumen[campo] !== undefined;
    console.log(`   ${presente ? '✅' : '❌'} resumen.${campo} = ${resumen[campo]}`);
    if (!presente) ok = false;
  }

  console.log('\n' + (ok ? '🎉 PRUEBA EXITOSA: el desglose del cierre se guarda y devuelve correctamente.' : '❌ PRUEBA FALLÓ'));
  return ok;
}

main()
  .then(async (ok) => { await db.close(); process.exit(ok ? 0 : 1); })
  .catch(async (e) => { console.error('❌ Error:', e); try { await db.close(); } catch (_) {} process.exit(1); });
