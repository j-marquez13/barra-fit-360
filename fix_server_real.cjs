const fs = require('fs');

let content = fs.readFileSync('c:/360fi sistema/server.js', 'utf8');

const target = 'const PORT = process.env.PORT || 3000;';

const middlewareToAdd = `

// Middleware para parsear JSON
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

if (!content.includes('/api/fix-timezone')) {
  content = content.replace(target, target + middlewareToAdd);
  fs.writeFileSync('c:/360fi sistema/server.js', content);
  console.log('Added missing routes back to server.js');
}
