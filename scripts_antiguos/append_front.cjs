const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'public', 'app3.js');

const code = `
window.deleteProducto = async function(id) {
  if(!confirm('¿Estás seguro de eliminar este producto?')) return;
  try {
    const res = await fetch('/api/productos/' + id, { method: 'DELETE' });
    const data = await res.json();
    if(res.ok) {
      showToast(data.mensaje, 'success');
      loadInventarioData();
    } else {
      showToast(data.error, 'danger');
    }
  } catch(e) {
    showToast('Error de red', 'danger');
  }
};

window.deleteInsumo = async function(id) {
  if(!confirm('¿Estás seguro de eliminar este insumo?')) return;
  try {
    const res = await fetch('/api/insumos/' + id, { method: 'DELETE' });
    const data = await res.json();
    if(res.ok) {
      showToast(data.mensaje, 'success');
      loadInventarioData();
    } else {
      showToast(data.error, 'danger');
    }
  } catch(e) {
    showToast('Error de red', 'danger');
  }
};
`;
fs.appendFileSync(p, code);
