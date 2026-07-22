const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'public', 'app3.js');
let code = fs.readFileSync(p, 'utf-8');

// Replace standard success toast followed by loadInventarioData() to also renderProducts() if it doesn't already
// For line 3125 & 3141
code = code.replace(/showToast\(data\.mensaje,\s*'success'\);\s*loadInventarioData\(\);/g, "showToast(data.mensaje, 'success');\n      await loadInventarioData();\n      renderProducts();");

// Replace standard edit modals where we call loadInventarioData() then renderProducts()
code = code.replace(/closeGenericModal\(\);\s*loadInventarioData\(\);\s*renderProducts\(\);/g, "closeGenericModal();\n      await loadInventarioData();\n      renderProducts();");

// Replace line 1894, 1922, 1966, 2675 which don't have renderProducts() but should
code = code.replace(/closeGenericModal\(\);\s*loadInventarioData\(\);/g, "closeGenericModal();\n        await loadInventarioData();\n        renderProducts();");

fs.writeFileSync(p, code);
