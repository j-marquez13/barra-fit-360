const fs = require('fs');
const file = 'c:/360fi sistema/public/app3.js';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Pago Móvil:</span> <span style="color:#ff9632">+Bs.\${vesTotal.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--text-dim);"><span>(100% Digital)</span></div>`;

const replaceStr = `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Pago Móvil:</span> <span style="color:#ff9632">+Bs.\${vesVenta.toLocaleString()}</span></div>
            \${vesAbono > 0 ? \`<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Deudas Cobradas:</span> <span style="color:#ff9632">+Bs.\${vesAbono.toLocaleString()}</span></div>\` : ''}
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--text-dim);"><span>(100% Digital)</span></div>`;

content = content.replace(targetStr, replaceStr);

fs.writeFileSync(file, content);
console.log('Patched app3.js for Cierre Caja VES');
