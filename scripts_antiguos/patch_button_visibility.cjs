const fs = require('fs');
const file = 'c:/360fi sistema/public/app3.js';
let content = fs.readFileSync(file, 'utf8');

const targetStr = "<td>${m.notas} ${m.tipo === 'Abono' && (JSON.parse(localStorage.getItem('sesion_caja')||'{}').permisos?.includes('all') || JSON.parse(localStorage.getItem('sesion_caja')||'{}').permisos?.includes('admin')) ? `<button class=\\\"action-btn btn-danger\\\" style=\\\"padding: 2px 5px; font-size: 12px; margin-left: 10px;\\\" onclick=\\\"eliminarAbono(${m.id})\\\">Borrar</button>` : ''}</td>";
const replaceStr = "<td>${m.notas} ${m.tipo === 'Abono' ? `<button class=\\\"action-btn btn-danger\\\" style=\\\"padding: 2px 5px; font-size: 12px; margin-left: 10px;\\\" onclick=\\\"eliminarAbono(${m.id})\\\">Borrar</button>` : ''}</td>";

content = content.replace(targetStr, replaceStr);

fs.writeFileSync(file, content);
console.log('Patched app3.js to always show Borrar button on abonos');
