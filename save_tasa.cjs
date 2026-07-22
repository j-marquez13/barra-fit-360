const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'public', 'app3.js');
let code = fs.readFileSync(p, 'utf-8');

// Replace STATE initialization
code = code.replace(
  "tasas: { USD: 3600.00, VES: 5.00 },",
  "tasas: (function() {\n    const today = new Date().toISOString().split('T')[0];\n    try {\n      const saved = JSON.parse(localStorage.getItem('barrafit_tasas'));\n      if (saved && saved.date === today && saved.rates) return saved.rates;\n    } catch(e) {}\n    return { USD: 3600.00, VES: 5.00 };\n  })(),"
);

// Replace the event listeners to save to localStorage
const listenersOrig = `  // Tasas de cambio
  DOM.rateUsd.addEventListener('input', (e) => {
    STATE.tasas.USD = parseFloat(e.target.value) || 1;
    recalculatePayments();
  });
  DOM.rateVes.addEventListener('input', (e) => {
    STATE.tasas.VES = parseFloat(e.target.value) || 1;
    recalculatePayments();
  });`;

const listenersNew = `  // Tasas de cambio
  function saveTasasToStorage() {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem('barrafit_tasas', JSON.stringify({ date: today, rates: STATE.tasas }));
  }

  DOM.rateUsd.addEventListener('input', (e) => {
    STATE.tasas.USD = parseFloat(e.target.value) || 1;
    saveTasasToStorage();
    recalculatePayments();
  });
  DOM.rateVes.addEventListener('input', (e) => {
    STATE.tasas.VES = parseFloat(e.target.value) || 1;
    saveTasasToStorage();
    recalculatePayments();
  });`;

code = code.replace(listenersOrig, listenersNew);

fs.writeFileSync(p, code);
