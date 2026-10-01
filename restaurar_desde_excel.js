import pg from 'pg';
import fs from 'fs';

/**
 * Restaura costo_unitario y stock_fijo de los insumos en Neon usando el
 * inventario oficial del Excel (28-sep-2026), guardado en inventario_excel_sept28.json.
 *
 * Uso (desde la carpeta del proyecto):
 *   PowerShell:
 *     $env:DATABASE_URL = "postgres://..."
 *     node restaurar_desde_excel.js             # solo LISTAR comparación (no cambia nada)
 *     node restaurar_desde_excel.js --restore   # APLICAR costo_unitario y stock_fijo del Excel
 */

const { Pool } = pg;
const RESTORE = process.argv.includes('--restore');
const DATA_FILE = 'inventario_excel_sept28.json';

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Clave "núcleo": quita paréntesis y símbolos (sirve para nombres que cambian
// el peso del pote, ej. "(Pote vacio 33)" vs "(Pote vacio 42,2)").
function coreKey(s) {
  return normalize(s)
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ Falta DATABASE_URL. Ejecuta primero:');
    console.error('   $env:DATABASE_URL = "postgres://USUARIO:PASS@HOST/DB?sslmode=require"');
    console.error('Luego:');
    console.error('   node restaurar_desde_excel.js             (solo listar)');
    console.error('   node restaurar_desde_excel.js --restore   (aplicar)');
    process.exit(1);
  }

  const excel = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const excelByNorm = new Map();
  const excelByCore = new Map();
  for (const e of excel) {
    const norm = normalize(e.nombre);
    if (!excelByNorm.has(norm)) excelByNorm.set(norm, e);
    const core = coreKey(e.nombre);
    if (core && !excelByCore.has(core)) excelByCore.set(core, e);
  }
  console.log(`📄 Excel cargado: ${excel.length} insumos.\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT id, nombre, costo_unitario, stock_fijo, stock_actual FROM insumos ORDER BY id');

    const matched = [];
    const noMatchNeon = [];
    const usedExcel = new Set();

    for (const r of res.rows) {
      const norm = normalize(r.nombre);
      const core = coreKey(r.nombre);
      let e = excelByNorm.get(norm) || excelByCore.get(core);
      if (!e) {
        noMatchNeon.push({ id: r.id, nombre: (r.nombre || '').trim() });
        continue;
      }
      const eIdx = excel.indexOf(e);
      usedExcel.add(eIdx);
      const costoActual = num(r.costo_unitario);
      const fijoActual = num(r.stock_fijo);
      const actualActual = num(r.stock_actual);
      const costoExcel = num(e.costo);
      const fijoExcel = num(e.fijo);
      const actualExcel = num(e.actual);
      const difCosto = costoExcel != null && Math.abs(costoExcel - (costoActual || 0)) > 0.0001;
      const difFijo = fijoExcel != null && Math.abs(fijoExcel - (fijoActual || 0)) > 0.0001;
      const difActual = actualExcel != null && Math.abs(actualExcel - (actualActual || 0)) > 0.0001;
      matched.push({
        id: r.id,
        nombre: (r.nombre || '').trim(),
        excelNombre: e.nombre,
        costoActual, costoExcel, difCosto,
        fijoActual, fijoExcel, difFijo,
        actualActual, actualExcel, difActual
      });
    }

    const noMatchExcel = excel.filter((_, i) => !usedExcel.has(i));

    console.log('=== COMPARACIÓN (Neon vs Excel) ===');
    console.log('ID\tINSUMO (Neon)\tCOSTO\tFIJO\tACTUAL');
    for (const m of matched) {
      const costoStr = m.difCosto ? `${m.costoActual ?? '—'}→${m.costoExcel}` : `=${m.costoExcel}`;
      const fijoStr = m.difFijo ? `${m.fijoActual ?? '—'}→${m.fijoExcel}` : `=${m.fijoExcel}`;
      const actualStr = m.actualExcel == null ? '(sin dato)' : (m.difActual ? `${m.actualActual ?? '—'}→${m.actualExcel}` : `=${m.actualExcel}`);
      const flag = (m.difCosto || m.difFijo || m.difActual) ? ' ⚠' : '';
      console.log(`${m.id}\t${m.nombre}\t${costoStr}\t${fijoStr}\t${actualStr}${flag}`);
    }

    const cambiosCosto = matched.filter(m => m.difCosto).length;
    const cambiosFijo = matched.filter(m => m.difFijo).length;
    const cambiosActual = matched.filter(m => m.difActual).length;
    console.log(`\nMatched: ${matched.length} | Sin coincidencia en Neon: ${noMatchNeon.length} | Sin coincidencia en Excel: ${noMatchExcel.length}`);
    console.log(`Cambios de costo: ${cambiosCosto} | stock fijo: ${cambiosFijo} | stock actual: ${cambiosActual}`);

    if (noMatchNeon.length) {
      console.log('\n--- Insumos en Neon SIN coincidencia en el Excel ---');
      for (const n of noMatchNeon) console.log(`${n.id}\t${n.nombre}`);
    }
    if (noMatchExcel.length) {
      console.log('\n--- Insumos del Excel SIN coincidencia en Neon ---');
      for (const e of noMatchExcel) console.log(`${e.nombre}\tcosto=${e.costo}\tfijo=${e.fijo}\tactual=${e.actual ?? '—'}`);
    }

    if (RESTORE) {
      await client.query('BEGIN');
      let okCosto = 0, okFijo = 0, okActual = 0;
      for (const m of matched) {
        if (m.difCosto && m.costoExcel != null) {
          await client.query('UPDATE insumos SET costo_unitario = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [m.costoExcel, m.id]);
          okCosto++;
        }
        if (m.difFijo && m.fijoExcel != null) {
          await client.query('UPDATE insumos SET stock_fijo = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [m.fijoExcel, m.id]);
          okFijo++;
        }
        if (m.difActual && m.actualExcel != null) {
          await client.query('UPDATE insumos SET stock_actual = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [m.actualExcel, m.id]);
          okActual++;
        }
      }
      await client.query('COMMIT');
      console.log(`\n✅ Restaurados: ${okCosto} costos, ${okFijo} stock fijo, ${okActual} stock actual.`);
    } else {
      console.log('\nℹ️  Modo solo-lectura. Para aplicar: node restaurar_desde_excel.js --restore');
    }
  } catch (e) {
    if (RESTORE) await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
