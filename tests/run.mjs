// Ejecutor de pruebas: `npm test`
// Levanta el servidor con una base SQLite NUEVA en una carpeta temporal, corre las pruebas
// en orden y apaga el servidor. Nunca usa PostgreSQL/Neon: se eliminan DATABASE_URL y PG*
// del entorno para que las pruebas no puedan tocar la base de producción.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'barrafit-test-'));
const PORT = String(40000 + Math.floor(Math.random() * 10000));
const BASE = `http://localhost:${PORT}`;
const PRUEBAS = ['flujos.test.mjs', 'cierre.test.mjs'];

const env = { ...process.env, DB_PATH: path.join(tmp, 'prueba.sqlite'), PORT, AUTH_SECRET: 'secreto-de-prueba' };
for (const k of Object.keys(env)) {
  if (k === 'DATABASE_URL' || k.startsWith('PG')) delete env[k];
}

const servidor = spawn(process.execPath, ['server.js'], { cwd: raiz, env, stdio: ['ignore', 'pipe', 'pipe'] });
let logServidor = '';
servidor.stdout.on('data', d => { logServidor += d; });
servidor.stderr.on('data', d => { logServidor += d; });

function correr(archivo) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(raiz, 'tests', archivo), BASE], { stdio: 'inherit' });
    p.on('exit', code => resolve(code));
  });
}

let codigo = 1;
try {
  let listo = false;
  for (let i = 0; i < 60 && !listo; i++) {
    try { listo = (await fetch(`${BASE}/api/health`)).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!listo) throw new Error('El servidor de prueba no arrancó:\n' + logServidor);

  codigo = 0;
  for (const archivo of PRUEBAS) {
    console.log(`\n######## ${archivo} ########`);
    if (await correr(archivo) !== 0) codigo = 1;
  }
} catch (e) {
  console.error(e.message);
} finally {
  servidor.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* el archivo puede seguir en uso */ }
}

console.log(codigo === 0 ? '\n✅ TODAS LAS PRUEBAS PASARON' : '\n❌ HAY PRUEBAS FALLIDAS');
process.exit(codigo);
