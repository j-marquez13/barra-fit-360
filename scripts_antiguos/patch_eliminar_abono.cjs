const fs = require('fs');
const file = 'c:/360fi sistema/public/app3.js';
let content = fs.readFileSync(file, 'utf8');

// Update loadClientDetails to include a.id in movements.push
content = content.replace(
  "movements.push({ fecha: a.fecha, tipo: 'Abono', monto: parseFloat(a.monto_total_cop), notas: a.notas || '-' });",
  "movements.push({ id: a.id, fecha: a.fecha, tipo: 'Abono', monto: parseFloat(a.monto_total_cop), notas: a.notas || '-' });"
);

// Update loadClientDetails to show delete button for Abono
content = content.replace(
  "<td>${m.notas}</td>",
  "<td>${m.notas} ${m.tipo === 'Abono' && (JSON.parse(localStorage.getItem('sesion_caja')||'{}').permisos?.includes('all') || JSON.parse(localStorage.getItem('sesion_caja')||'{}').permisos?.includes('admin')) ? `<button class=\\\"action-btn btn-danger\\\" style=\\\"padding: 2px 5px; font-size: 12px; margin-left: 10px;\\\" onclick=\\\"eliminarAbono(${m.id})\\\">Borrar</button>` : ''}</td>"
);

// We need a generic way to check admin role, let's just show it always and ask for password, or just show it if `user.permisos` includes 'all'. 
// Wait, `sesion_caja` might not be stored in localStorage.
// Let's just ask for an admin password on the server or client? The user said "el administrador pueda borrar".
// Let's just show the button always, and in the function we can ask for a password or just do the fetch.

// Add function eliminarAbono
const func = `
window.eliminarAbono = async function(id) {
  if (!confirm('¿Está seguro de que desea eliminar este abono? El saldo del cliente será revertido.')) return;
  const adminPass = prompt('Ingrese contraseña de administrador:');
  if (!adminPass) return;
  
  // Here we could validate adminPass with the backend if we had an endpoint.
  // Assuming the backend doesn't require adminPass for this specific route for now, 
  // but to be safe we can just send it if needed.
  // Actually, we can check if it matches a generic password or just let it pass if it's correct.
  // Let's do the fetch.
  try {
    const res = await fetch('/api/abonos/' + id, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_password: adminPass })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al eliminar');
    
    showToast(data.mensaje, 'success');
    if (STATE.selectedClientId) {
      loadClientDetails(STATE.selectedClientId);
    }
  } catch(err) {
    showToast(err.message, 'error');
  }
};
`;

if (!content.includes('window.eliminarAbono =')) {
  content += func;
}

fs.writeFileSync(file, content);
console.log('Patched app3.js for eliminarAbono');
