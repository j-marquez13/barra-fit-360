const fs = require('fs');
let app3 = fs.readFileSync('public/app3.js', 'utf8');

// 1. Add logic to populate credit-client-selector when credit modal opens
// Find where creditModal opens and add population logic
const openCreditTarget = `DOM.creditModal.classList.add('open');
    });
  }
  
  const closeCreditSubModal = () => {`;

const openCreditReplace = `DOM.creditModal.classList.add('open');
      populateCreditClientSelector();
    });
  }
  
  const closeCreditSubModal = () => {`;

app3 = app3.replace(openCreditTarget, openCreditReplace);

// Also for the direct credit button
const directCreditTarget = `      DOM.creditModal.classList.add('open');
    });
  }

  if(DOM.btnCortesiaDirecto)`;

const directCreditReplace = `      DOM.creditModal.classList.add('open');
      populateCreditClientSelector();
    });
  }

  if(DOM.btnCortesiaDirecto)`;

app3 = app3.replace(directCreditTarget, directCreditReplace);

// 2. Add the populateCreditClientSelector function + change event handler
// Add right before the closeCreditSubModal function
const beforeClose = `  const closeCreditSubModal = () => {
    DOM.creditModal.classList.remove('open');
  };`;

const afterClose = `  function populateCreditClientSelector() {
    const sel = document.getElementById('credit-client-selector');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Seleccione un cliente --</option>' +
      STATE.clientes.map(c => {
        const saldo = parseFloat(c.saldo_deudor) || 0;
        const saldoTxt = saldo > 0 ? ' (Deuda: $' + saldo.toLocaleString() + ')' : '';
        return '<option value="' + c.id + '">' + c.nombre + ' — ' + c.identificacion + saldoTxt + '</option>';
      }).join('') +
      '<option value="__new__">➕ Crear Nuevo Cliente</option>';
    sel.value = '';
    document.getElementById('new-client-fields').style.display = 'none';
    document.getElementById('credit-client-info').style.display = 'none';
    document.getElementById('new-client-name').value = '';
    document.getElementById('new-client-id').value = '';
    document.getElementById('new-client-phone').value = '';
  }

  document.getElementById('credit-client-selector')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const newFields = document.getElementById('new-client-fields');
    const infoBox = document.getElementById('credit-client-info');
    const infoText = document.getElementById('credit-client-info-text');
    
    if (val === '__new__') {
      newFields.style.display = 'flex';
      infoBox.style.display = 'none';
    } else if (val) {
      newFields.style.display = 'none';
      const cliente = STATE.clientes.find(c => c.id == val);
      if (cliente) {
        const saldo = parseFloat(cliente.saldo_deudor) || 0;
        const limite = parseFloat(cliente.limite_credito) || 0;
        infoBox.style.display = 'block';
        infoText.innerHTML = '✅ <strong>' + cliente.nombre + '</strong> — Saldo: $' + saldo.toLocaleString() + ' | Límite: $' + limite.toLocaleString();
      }
    } else {
      newFields.style.display = 'none';
      infoBox.style.display = 'none';
    }
  });

  const closeCreditSubModal = () => {
    DOM.creditModal.classList.remove('open');
  };`;

app3 = app3.replace(beforeClose, afterClose);

// 3. Update the cancel credit button to also reset the selector
app3 = app3.replace(
  `      document.getElementById('new-client-name').value = '';
      document.getElementById('new-client-id').value = '';
      document.getElementById('new-client-phone').value = '';`,
  `      document.getElementById('new-client-name').value = '';
      document.getElementById('new-client-id').value = '';
      document.getElementById('new-client-phone').value = '';
      const sel = document.getElementById('credit-client-selector');
      if (sel) sel.value = '';
      document.getElementById('new-client-fields').style.display = 'none';
      document.getElementById('credit-client-info').style.display = 'none';`
);

// 4. Update submitPayment to use selected client from dropdown
const oldCreditValidation = `  let clienteId = null;
  if (isCredito) {
    const newName = document.getElementById('new-client-name')?.value.trim();
    const newId = document.getElementById('new-client-id')?.value.trim();
    const newPhone = document.getElementById('new-client-phone')?.value.trim();

    if (!newName || !newId) {
      alert('Debe ingresar Nombre y Cédula del cliente para registrar una venta a Crédito.');
      DOM.btnConfirmPayment.disabled = false;
      DOM.btnConfirmPayment.innerHTML = \`<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>\`;
      lucide.createIcons();
      return;
    }

    const existingClient = STATE.clientes.find(c => c.identificacion === newId);
    if (existingClient) {
      clienteId = existingClient.id;
    } else {
      try {
        const resClient = await fetch('/api/clientes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: newName,
            identificacion: newId,
            telefono: newPhone || '',
            limite_credito: 0
          })
        });
        const dataClient = await resClient.json();
        if (resClient.status === 201) {
          clienteId = dataClient.cliente.id;
          STATE.clientes.push(dataClient.cliente);
        } else {
          alert(\`Error al registrar cliente: \${dataClient.error}\`);
          DOM.btnConfirmPayment.disabled = false;
          DOM.btnConfirmPayment.innerHTML = \`<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>\`;
          lucide.createIcons();
          return;
        }
      } catch (err) {
        console.error(err);
        alert('Error de conexión al registrar cliente.');
        DOM.btnConfirmPayment.disabled = false;
        DOM.btnConfirmPayment.innerHTML = \`<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>\`;
        lucide.createIcons();
        return;
      }
    }
  }`;

const newCreditValidation = `  let clienteId = null;
  if (isCredito) {
    const selectorVal = document.getElementById('credit-client-selector')?.value;
    
    if (selectorVal && selectorVal !== '__new__') {
      // Cliente existente seleccionado
      clienteId = parseInt(selectorVal);
    } else {
      // Nuevo cliente
      const newName = document.getElementById('new-client-name')?.value.trim();
      const newId = document.getElementById('new-client-id')?.value.trim();
      const newPhone = document.getElementById('new-client-phone')?.value.trim();

      if (!newName || !newId) {
        alert('Debe seleccionar un cliente existente o crear uno nuevo (Nombre y Cédula obligatorios).');
        DOM.btnConfirmPayment.disabled = false;
        DOM.btnConfirmPayment.innerHTML = \`<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>\`;
        lucide.createIcons();
        return;
      }

      const existingClient = STATE.clientes.find(c => c.identificacion === newId);
      if (existingClient) {
        clienteId = existingClient.id;
      } else {
        try {
          const resClient = await fetch('/api/clientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nombre: newName,
              identificacion: newId,
              telefono: newPhone || '',
              limite_credito: 0
            })
          });
          const dataClient = await resClient.json();
          if (resClient.status === 201) {
            clienteId = dataClient.cliente.id;
            STATE.clientes.push(dataClient.cliente);
          } else {
            alert(\`Error al registrar cliente: \${dataClient.error}\`);
            DOM.btnConfirmPayment.disabled = false;
            DOM.btnConfirmPayment.innerHTML = \`<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>\`;
            lucide.createIcons();
            return;
          }
        } catch (err) {
          console.error(err);
          alert('Error de conexión al registrar cliente.');
          DOM.btnConfirmPayment.disabled = false;
          DOM.btnConfirmPayment.innerHTML = \`<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>\`;
          lucide.createIcons();
          return;
        }
      }
    }
  }`;

app3 = app3.replace(oldCreditValidation, newCreditValidation);

fs.writeFileSync('public/app3.js', app3);
console.log('Done! Credit modal now has client selector + create new option.');
