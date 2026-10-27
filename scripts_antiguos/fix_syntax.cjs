const fs = require('fs');
['public/app3.js', 'controllers/cashierController.js'].forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/\\\`/g, '\`');
  fs.writeFileSync(file, content);
});
console.log('Fixed syntax errors');
