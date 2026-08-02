const fs = require('fs');

let c = fs.readFileSync('c:/360fi sistema/public/app3.js', 'utf8');
c = c.replace(/<input type="number"/g, '<input type="number" step="any"');
c = c.replace(/\.toLocaleString\(\)/g, '.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })');
fs.writeFileSync('c:/360fi sistema/public/app3.js', c);

let h = fs.readFileSync('c:/360fi sistema/public/index.html', 'utf8');
h = h.replace(/id="rate-usd" min="1"/g, 'id="rate-usd" min="1" step="any"');
h = h.replace(/id="rate-ves" min="0\.1" step="0\.1"/g, 'id="rate-ves" min="0.1" step="any"');
fs.writeFileSync('c:/360fi sistema/public/index.html', h);

console.log('Fixed');
