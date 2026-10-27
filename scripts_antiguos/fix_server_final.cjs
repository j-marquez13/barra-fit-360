const fs = require('fs');

let content = fs.readFileSync('c:/360fi sistema/server.js', 'utf8');

// The original file had the routes grouped correctly.
// Let's remove lines 36 to 43 and move the middlewares and health check and fix-timezone to the top.

const parts = content.split('// ============================================');
// parts[0] is the top of the file up to the first comment block.
// But wait, the middlewares were moved inside the routes!

// I will just use regex to remove the duplicated blocks.
content = content.replace(/app\.delete\('\/api\/insumos\/:id', deleteInsumo\);\s+app\.post\('\/api\/insumos\/:id\/restock', restockInsumo\);\s+app\.get\('\/api\/mermas', getMermas\);\s+app\.post\('\/api\/mermas', createMerma\);\s+app\.get\('\/api\/inventario\/valorizacion', getValorizacionInventario\);\s+app\.get\('\/api\/inventario\/orden-compra', getOrdenCompra\);\s+/g, '');

// Now I will find the middlewares and endpoint and remove them from the bottom
const middlewareStr = `// Middleware para parsear JSON
app.use(express.json());

// Servir archivos estáticos del frontend
app.use(express.static('public'));

// Ruta principal para verificar salud del servidor
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'Barra Fit 360 Backend', timestamp: new Date() });
});

app.get('/api/fix-timezone', async (req, res) => {
  try {
    const isPg = !!(process.env.DATABASE_URL || process.env.PGHOST);
    if (isPg) {
      await db.execute("UPDATE insumos SET created_at = created_at - interval '4 hours', updated_at = updated_at - interval '4 hours'");
      await db.execute("UPDATE mermas SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE productos SET created_at = created_at - interval '4 hours', updated_at = updated_at - interval '4 hours'");
      await db.execute("UPDATE clientes SET created_at = created_at - interval '4 hours', updated_at = updated_at - interval '4 hours'");
      await db.execute("UPDATE ventas SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE pagos_ventas SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE abonos_credito SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE pagos_abonos SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE gastos SET fecha = fecha - interval '4 hours'");
      await db.execute("UPDATE sesiones_caja SET fecha_apertura = fecha_apertura - interval '4 hours'");
      await db.execute("UPDATE sesiones_caja SET fecha_cierre = fecha_cierre - interval '4 hours' WHERE fecha_cierre IS NOT NULL");
      res.json({ success: true, message: 'Fechas arregladas en PostgreSQL (Railway)' });
    } else {
      await db.execute("UPDATE insumos SET created_at = datetime(created_at, '-4 hours'), updated_at = datetime(updated_at, '-4 hours')");
      await db.execute("UPDATE mermas SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE productos SET created_at = datetime(created_at, '-4 hours'), updated_at = datetime(updated_at, '-4 hours')");
      await db.execute("UPDATE clientes SET created_at = datetime(created_at, '-4 hours'), updated_at = datetime(updated_at, '-4 hours')");
      await db.execute("UPDATE ventas SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE pagos_ventas SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE abonos_credito SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE pagos_abonos SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE gastos SET fecha = datetime(fecha, '-4 hours')");
      await db.execute("UPDATE sesiones_caja SET fecha_apertura = datetime(fecha_apertura, '-4 hours')");
      await db.execute("UPDATE sesiones_caja SET fecha_cierre = datetime(fecha_cierre, '-4 hours') WHERE fecha_cierre IS NOT NULL");
      res.json({ success: true, message: 'Fechas arregladas en SQLite local' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
`;

content = content.replace(middlewareStr, '');

// Now I will add it back at the right place: right after const PORT = ...;
content = content.replace('const PORT = process.env.PORT || 3000;\n', 'const PORT = process.env.PORT || 3000;\n\n' + middlewareStr + '\n');

// And I'll add back the ones that were removed by the regex accidentally
const routesToAddBack = `
app.delete('/api/insumos/:id', deleteInsumo);
app.post('/api/insumos/:id/restock', restockInsumo);

app.get('/api/mermas', getMermas);
app.post('/api/mermas', createMerma);

app.get('/api/inventario/valorizacion', getValorizacionInventario);
app.get('/api/inventario/orden-compra', getOrdenCompra);
`;

content = content.replace('app.put(\'/api/insumos/:id\', updateInsumo);\n', 'app.put(\'/api/insumos/:id\', updateInsumo);\n' + routesToAddBack);

fs.writeFileSync('c:/360fi sistema/server.js', content);
console.log('Fixed server.js');
