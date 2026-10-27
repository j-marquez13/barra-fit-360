const fs = require('fs');

let content = fs.readFileSync('c:/360fi sistema/server.js', 'utf8');

// The file got messed up. Let's find the imports block and extract it.
const importsEnd = content.indexOf('const app = express();');
const imports = content.slice(0, importsEnd);

// Find the rest of the routes, starting from the first route or app.use
// We know all routes start with app.get, app.post, app.put, app.delete, app.use
// Let's just grab the endpoints carefully.
// Actually, it's safer to just fetch the original file from the backup if it exists, or just manually fix it.
// Let's just fix it manually by moving `app.use(express.json());` and `app.use(express.static('public'));`
// to right after `const PORT = process.env.PORT || 3000;`

content = content.replace('// Middleware para parsear JSON\\napp.use(express.json());', '');
content = content.replace('// Servir archivos estáticos del frontend\\napp.use(express.static(\\'public\\'));', '');

const target = 'const PORT = process.env.PORT || 3000;';
const replaceStr = target + '\\n\\n// Middleware para parsear JSON\\napp.use(express.json());\\n\\n// Servir archivos estáticos del frontend\\napp.use(express.static(\\'public\\'));';

content = content.replace(target, replaceStr);

fs.writeFileSync('c:/360fi sistema/server.js', content);
console.log('Fixed server.js middleware order');
