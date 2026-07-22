// ==========================================
// Barra Fit 360 - POS Application Logic
// Sistema Integral: POS + Inventario + Crédito + Reportes
// ==========================================

// Helper: Fecha local Venezuela (UTC-4) como string YYYY-MM-DD
function localDateStr() {
  const now = new Date();
  const local = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

// 1. ESTADO DE LA APLICACIÓN
const STATE = {
  // Catálogo (Fallback en caso de que el backend esté offline)
  products: [],
  categories: [
    { id: 'todos', nombre: 'Todos', icon: 'layout-grid' },
    { id: 'Batidos', nombre: 'Batidos', icon: 'cup-soda' },
    { id: 'Nevera', nombre: 'Nevera', icon: 'refrigerator' },
    { id: 'Extras', nombre: 'Extras', icon: 'plus-circle' },
    { id: 'Meriendas', nombre: 'Meriendas', icon: 'cookie' }
  ],
  cart: [],
  currentCategory: 'todos',
  searchQuery: '',
  tasas: (function() {
    const today = localDateStr();
    try {
      const saved = JSON.parse(localStorage.getItem('barrafit_tasas'));
      if (saved && saved.date === today && saved.rates) return saved.rates;
    } catch(e) {}
    return { USD: '', VES: '' };
  })(),
  apiOnline: false,
  currentView: 'pos',
  insumos: [],
  clientes: [],
  selectedClientId: null
};

// 2. ELEMENTOS DEL DOM
const DOM = {
  // Sidebar
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  navItems: document.querySelectorAll('.nav-item'),
  sidebarApiStatus: document.getElementById('sidebar-api-status'),
  sidebarTime: document.getElementById('sidebar-time'),
  viewTitle: document.getElementById('view-title'),

  // Catálogo POS
  categoriesContainer: document.getElementById('categories-container'),
  productsGrid: document.getElementById('products-grid'),
  searchInput: document.getElementById('search-input'),
  cartItemsContainer: document.getElementById('cart-items-container'),
  emptyCartView: document.getElementById('empty-cart-view'),
  cartCount: document.getElementById('cart-count'),
  summarySubtotal: document.getElementById('summary-subtotal'),
  summaryTotalCop: document.getElementById('summary-total-cop'),
  summaryTotalUsd: document.getElementById('summary-total-usd'),
  summaryTotalVes: document.getElementById('summary-total-ves'),
  btnMixto: document.getElementById('btn-mixto'),
  btnCreditoDirecto: document.getElementById('btn-credito-directo'),
  btnCortesiaDirecto: document.getElementById('btn-cortesia-directo'),
  
  // Modal de Pago
  paymentModal: document.getElementById('payment-modal'),
  btnClosePayment: document.getElementById('btn-close-payment'),
  btnConfirmPayment: document.getElementById('btn-confirm-payment'),
  modalTotalSale: document.getElementById('modal-total-sale'),
  modalTotalPaid: document.getElementById('modal-total-paid'),
  paymentStatusBox: document.getElementById('payment-status-box'),
  statusBoxIcon: document.getElementById('status-box-icon'),
  statusBoxTitle: document.getElementById('status-box-title'),
  statusBoxDesc: document.getElementById('status-box-desc'),
  statusBoxValue: document.getElementById('status-box-value'),
  rateUsd: document.getElementById('rate-usd'),
  rateVes: document.getElementById('rate-ves'),
  saleNotes: document.getElementById('sale-notes'),
  payInputs: document.querySelectorAll('.payment-input'),
  refInputs: document.querySelectorAll('.ref-input'),
  
  // Modal Crédito
  creditModal: document.getElementById('credit-modal'),
  btnOpenCreditModal: document.getElementById('btn-open-credit-modal'),
  btnCloseCreditModal: document.getElementById('btn-close-credit-modal'),
  btnCancelCredit: document.getElementById('btn-cancel-credit'),
  btnConfirmCredit: document.getElementById('btn-confirm-credit'),
  creditSummaryText: document.getElementById('credit-summary-text'),
  
  // Modal Recibo
  receiptModal: document.getElementById('receipt-modal'),
  receiptId: document.getElementById('receipt-id'),
  receiptDate: document.getElementById('receipt-date'),
  receiptItemsList: document.getElementById('receipt-items-list'),
  receiptTotal: document.getElementById('receipt-total'),
  receiptPaid: document.getElementById('receipt-paid'),
  receiptChange: document.getElementById('receipt-change'),
  receiptChangeRow: document.getElementById('receipt-change-row'),
  receiptPaymentsList: document.getElementById('receipt-payments-list'),
  receiptAlertsContainer: document.getElementById('receipt-alerts-container'),
  btnNewSale: document.getElementById('btn-new-sale'),
  
  // Modal Genérico
  genericModal: document.getElementById('generic-modal'),
  genericModalTitle: document.getElementById('generic-modal-title'),
  genericModalBody: document.getElementById('generic-modal-body'),
  btnCloseGeneric: document.getElementById('btn-close-generic'),
  btnCancelGeneric: document.getElementById('btn-cancel-generic'),
  btnSubmitGeneric: document.getElementById('btn-submit-generic'),
  
  // Estado Servidor
  apiStatusBadge: document.getElementById('api-status-badge'),
  liveTime: document.getElementById('live-time')
};

// 3. INICIALIZACIÓN
document.addEventListener('DOMContentLoaded', () => {
  renderCategories();
  renderProducts();
  
  if (DOM.rateUsd) DOM.rateUsd.value = STATE.tasas.USD;
  if (DOM.rateVes) DOM.rateVes.value = STATE.tasas.VES;
  
  checkApiHealth();
  updateTime();
  setInterval(updateTime, 1000);
  setInterval(checkApiHealth, 15000);

  // ⭐ Inicializar sistema de turnos
  initTurnoSystem();

  // Búsqueda en catálogo POS
  DOM.searchInput.addEventListener('input', (e) => {
    STATE.searchQuery = e.target.value;
    renderProducts();
  });

  // ⭐ Mobile Sidebar Toggle Logic
  if (DOM.sidebarToggle) {
    DOM.sidebarToggle.addEventListener('click', () => {
      DOM.sidebar.classList.toggle('open');
      const overlay = document.getElementById('sidebar-overlay');
      if (overlay) overlay.classList.toggle('open');
    });
  }

  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) {
    overlay.addEventListener('click', () => {
      DOM.sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  // Cerrar sidebar al hacer clic en un item de navegación en móvil
  DOM.navItems.forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 1024) {
        DOM.sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
      }
    });
  });

  if(DOM.btnMixto) {
    DOM.btnMixto.addEventListener('click', () => {
      STATE.directCredit = false;
      openPaymentModal();
    });
  }
  
  if(DOM.btnCreditoDirecto) {
    DOM.btnCreditoDirecto.addEventListener('click', () => {
      STATE.directCredit = true;
      DOM.payInputs.forEach(i => { if(i.id !== 'pay-credito') i.value = '' });
      document.getElementById('pay-credito').value = calculateCartTotal();
      DOM.creditModal.classList.add('open');
      populateCreditClientSelector();
    });
  }

  if(DOM.btnCortesiaDirecto) {
    DOM.btnCortesiaDirecto.addEventListener('click', () => {
      if (confirm('¿Estás seguro de registrar esta venta como CORTESÍA? (Ingreso de $0)')) {
        STATE.isCortesia = true;
        DOM.payInputs.forEach(input => input.value = '');
        submitPayment();
        STATE.isCortesia = false; // Reset after submit
      }
    });
  }

  // Modales secundarios;
  DOM.btnClosePayment.addEventListener('click', closePaymentModal);
  DOM.btnConfirmPayment.addEventListener('click', submitPayment);
  DOM.btnNewSale.addEventListener('click', resetSale);

  // Crédito Modal
  if (DOM.btnOpenCreditModal) {
    DOM.btnOpenCreditModal.addEventListener('click', () => {
      DOM.creditModal.classList.add('open');
      populateCreditClientSelector();
    });
  }
  
  function populateCreditClientSelector() {
    const sel = document.getElementById('credit-client-selector');
    if (!sel) return;
    let html = '<option value="">-- Seleccione un cliente --</option>';
    STATE.clientes.forEach(c => {
      const saldo = parseFloat(c.saldo_deudor) || 0;
      const saldoTxt = saldo > 0 ? ' (Deuda: $' + saldo.toLocaleString() + ')' : '';
      html += '<option value="' + c.id + '">' + c.nombre + ' — ' + c.identificacion + saldoTxt + '</option>';
    });
    html += '<option value="__new__">\u27A5 Crear Nuevo Cliente</option>';
    sel.innerHTML = html;
    sel.value = '';
    const newFields = document.getElementById('new-client-fields');
    const infoBox = document.getElementById('credit-client-info');
    if (newFields) newFields.style.display = 'none';
    if (infoBox) infoBox.style.display = 'none';
    document.getElementById('new-client-name').value = '';
    document.getElementById('new-client-id').value = '';
    document.getElementById('new-client-phone').value = '';
  }

  document.getElementById('credit-client-selector')?.addEventListener('change', function(e) {
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
        infoText.innerHTML = '<span style="color:var(--success)">✅ <strong>' + cliente.nombre + '</strong> — Saldo: $' + saldo.toLocaleString() + ' | Límite: $' + limite.toLocaleString() + '</span>';
      }
    } else {
      newFields.style.display = 'none';
      infoBox.style.display = 'none';
    }
  });

  const closeCreditSubModal = () => {
    DOM.creditModal.classList.remove('open');
  };


  if (DOM.btnCloseCreditModal) DOM.btnCloseCreditModal.addEventListener('click', closeCreditSubModal);
  
  if (DOM.btnCancelCredit) {
    DOM.btnCancelCredit.addEventListener('click', () => {
      document.getElementById('pay-credito').value = '';
      document.getElementById('new-client-name').value = '';
      document.getElementById('new-client-id').value = '';
      document.getElementById('new-client-phone').value = '';
      const sel = document.getElementById('credit-client-selector');
      if (sel) sel.value = '';
      document.getElementById('new-client-fields').style.display = 'none';
      document.getElementById('credit-client-info').style.display = 'none';
      DOM.creditSummaryText.textContent = 'No se ha registrado crédito.';
      DOM.creditSummaryText.style.color = 'var(--color-muted)';
      recalculatePayments();
      closeCreditSubModal();
    });
  }

  if (DOM.btnConfirmCredit) {
    DOM.btnConfirmCredit.addEventListener('click', () => {
      const amt = parseFloat(document.getElementById('pay-credito').value) || 0;
      
      if (STATE.directCredit) {
        closeCreditSubModal();
        submitPayment();
        return;
      }

      if (amt > 0) {
        DOM.creditSummaryText.textContent = `$${amt.toLocaleString()} COP configurados.`;
        DOM.creditSummaryText.style.color = 'var(--success)';
      } else {
        DOM.creditSummaryText.textContent = 'No se ha registrado crédito.';
        DOM.creditSummaryText.style.color = 'var(--color-muted)';
      }
      recalculatePayments();
      closeCreditSubModal();
    });
  }

  // Tasas de cambio
  function saveTasasToStorage() {
    const today = localDateStr();
    localStorage.setItem('barrafit_tasas', JSON.stringify({ date: today, rates: STATE.tasas }));
  }

  DOM.rateUsd.addEventListener('input', (e) => {
    STATE.tasas.USD = parseFloat(e.target.value) || 1;
    saveTasasToStorage();
    recalculatePayments();
    renderCart();
  });
  DOM.rateVes.addEventListener('input', (e) => {
    STATE.tasas.VES = parseFloat(e.target.value) || 1;
    saveTasasToStorage();
    recalculatePayments();
    renderCart();
  });

  // Pago Rápido (One-click checkout)
  document.querySelectorAll('.quick-pay-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      quickPay(e.target.dataset.method, e.target.dataset.currency);
    });
  });

  // Inputs de pago
  DOM.payInputs.forEach(input => {
    input.addEventListener('input', recalculatePayments);
  });

  // Navegación SPA
  DOM.navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });

  // Switch de Cortesía
  const chkCortesia = document.getElementById('chk-cortesia');
  if (chkCortesia) {
    chkCortesia.addEventListener('change', (e) => {
      const isCortesia = e.target.checked;
      const inputsPanel = document.getElementById('modal-payment-inputs');
      if (isCortesia) {
        inputsPanel.style.display = 'none';
        DOM.modalTotalPaid.textContent = '$0 COP (Cortesía)';
        DOM.btnConfirmPayment.disabled = false;
        DOM.paymentStatusBox.className = 'payment-status-box status-sufficient';
        DOM.statusBoxIcon.setAttribute('data-lucide', 'check-circle-2');
        DOM.statusBoxTitle.textContent = 'Cortesía Activa';
        DOM.statusBoxDesc.textContent = 'El cliente no paga nada.';
        DOM.statusBoxValue.textContent = 'Costo registrado en Base de Datos';
      } else {
        inputsPanel.style.display = 'block';
        recalculatePayments();
      }
      lucide.createIcons();
    });
  }

  // Caja tabs
  document.querySelectorAll('[data-caja-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.cajaTab;
      document.querySelectorAll('[data-caja-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.caja-panel').forEach(p => p.style.display = 'none');
      document.getElementById(`caja-${target}`).style.display = 'block';
    });
  });

  document.getElementById('btn-add-gasto')?.addEventListener('click', showAddGastoModal);

  // Modal genérico
  DOM.btnCloseGeneric.addEventListener('click', closeGenericModal);
  DOM.btnCancelGeneric.addEventListener('click', closeGenericModal);

  // Inventario tabs
  document.querySelectorAll('[data-inv-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.invTab;
      document.querySelectorAll('[data-inv-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.inv-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`inv-${target}`).classList.add('active');
      
      if (target === 'orden') {
        window.loadOrdenCompra();
      }
    });
  });

  // Reportes tabs
  document.querySelectorAll('[data-report-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.reportTab;
      document.querySelectorAll('[data-report-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`report-${target}`).classList.add('active');
    });
  });

  // Botones de módulos
  document.getElementById('btn-add-insumo')?.addEventListener('click', showAddInsumoModal);

  // Búsqueda en tabla de Insumos
  const searchInsumosInput = document.getElementById('search-insumos-input');
  if (searchInsumosInput) {
    searchInsumosInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const filtered = (STATE._allInsumos || STATE.insumos).filter(ins =>
        ins.nombre.toLowerCase().includes(query)
      );
      renderInsumosTable(filtered);
    });
  }

  // Selector de ordenamiento de Insumos
  const sortInsumosSelect = document.getElementById('sort-insumos-select');
  if (sortInsumosSelect) {
    sortInsumosSelect.addEventListener('change', () => {
      const source = (STATE._allInsumos || STATE.insumos);
      const searchVal = document.getElementById('search-insumos-input')?.value?.toLowerCase() || '';
      const filtered = searchVal ? source.filter(ins => ins.nombre.toLowerCase().includes(searchVal)) : source;
      renderInsumosTable(filtered);
    });
  }
  document.getElementById('btn-add-merma')?.addEventListener('click', showAddMermaModal);
  document.getElementById('btn-add-producto')?.addEventListener('click', showAddProductoModal);
  document.getElementById('btn-add-cliente')?.addEventListener('click', showAddClienteModal);
  document.getElementById('btn-close-detail')?.addEventListener('click', () => {
    document.getElementById('client-detail-panel').style.display = 'none';
  });

  // Reportes
  document.getElementById('report-date').value = localDateStr();
  document.getElementById('btn-load-cierre')?.addEventListener('click', loadCierreDiario);
  document.getElementById('btn-load-semanal')?.addEventListener('click', loadCierreSemanal);
  document.getElementById('btn-load-historial')?.addEventListener('click', loadHistorial);

  // Establecer fecha hoy en campos
  const today = localDateStr();
  document.getElementById('hist-desde').value = today;
  document.getElementById('hist-hasta').value = today;
});

// ============================================
// NAVEGACIÓN SPA
// ============================================
function switchView(viewName) {
  STATE.currentView = viewName;

  // Actualizar nav items
  DOM.navItems.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Mostrar panel correspondiente
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`view-${viewName}`).classList.add('active');

  // Actualizar título
  const titles = {
    pos: 'Punto de Venta',
    inventario: 'Inventario & Productos',
    credito: 'Cuentas por Cobrar',
    reportes: 'Reportes & Cierres',
    caja: 'Caja y Gastos',
    tesoreria: 'Tesorería y Flujo de Caja'
  };
  DOM.viewTitle.textContent = titles[viewName] || viewName;

  // Cargar datos del módulo
  if (viewName === 'inventario') loadInventarioData();
  if (viewName === 'credito') loadClientesData();
  if (viewName === 'reportes') loadCierreDiario();
  if (viewName === 'caja') loadCajaData();
  if (viewName === 'tesoreria') loadTesoreriaData();
  if (viewName === 'usuarios') loadUsuariosData();

  // Cerrar sidebar en móvil
  DOM.sidebar.classList.remove('open');

  lucide.createIcons();
}

// ============================================
// 4. FUNCIONES DE RENDERIZADO POS
// ============================================

function renderCategories() {
  DOM.categoriesContainer.innerHTML = '';
  STATE.categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `category-tab ${STATE.currentCategory === cat.id ? 'active' : ''}`;
    btn.innerHTML = `<i data-lucide="${cat.icon}"></i> ${cat.nombre}`;
    btn.addEventListener('click', () => {
      STATE.currentCategory = cat.id;
      renderCategories();
      renderProducts();
    });
    DOM.categoriesContainer.appendChild(btn);
  });
  lucide.createIcons();
}

function renderProducts() {
  DOM.productsGrid.innerHTML = '';

  const filtered = STATE.products.filter(p => {
    const matchCategory = STATE.currentCategory === 'todos' || p.categoria === STATE.currentCategory;
    const matchSearch = p.nombre.toLowerCase().includes(STATE.searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  if (filtered.length === 0) {
    DOM.productsGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-muted);">
        No se encontraron productos en esta categoría.
      </div>
    `;
    return;
  }

  filtered.forEach(p => {
    const stock = p.stock !== undefined ? p.stock : (p.stock_disponible || 0);
    const card = document.createElement('div');
    const isDisabled = stock <= 0 && !p.es_batido;
    card.className = `product-card ${isDisabled ? 'card-disabled' : ''}`;
    
    let stockClass = 'stock-good';
    let stockText = `${stock} disp`;
    if (p.es_batido) {
      stockClass = 'stock-good';
      stockText = 'Preparable';
    } else if (stock <= 0) {
      stockClass = 'stock-out';
      stockText = 'Agotado';
    } else if (stock <= 10) {
      stockClass = 'stock-low';
      stockText = 'Bajo Stock';
    }

    card.innerHTML = `
      <div class="card-header">
        <span class="category-tag">${p.categoria}</span>
        <span class="stock-pill ${stockClass}">${stockText}</span>
      </div>
      <div>
        <h3>${p.nombre}</h3>
      </div>
      <div class="card-footer">
        <div class="price-box">
          <span class="price-label">Precio</span>
          <span class="price-val">$${Number(p.precio_venta).toLocaleString()}</span>
          <span class="production-cost">Costo: $${Number(p.costo_produccion).toLocaleString()}</span>
        </div>
        <button class="add-btn" ${isDisabled ? 'disabled' : ''}>
          <i data-lucide="plus"></i>
        </button>
      </div>
    `;

    if (!isDisabled) {
      card.addEventListener('click', () => addToCart(p.id));
    }

    DOM.productsGrid.appendChild(card);
  });
  lucide.createIcons();
}

function renderCart() {
  DOM.cartItemsContainer.innerHTML = '';
  
  if (STATE.cart.length === 0) {
    DOM.emptyCartView.style.display = 'flex';
    DOM.cartItemsContainer.appendChild(DOM.emptyCartView);
    DOM.cartCount.textContent = '0 items';
    DOM.summarySubtotal.textContent = '$0 COP';
    if(DOM.summaryTotalCop) DOM.summaryTotalCop.textContent = '$0 COP';
    if(DOM.summaryTotalUsd) DOM.summaryTotalUsd.textContent = '$0.00';
    if(DOM.summaryTotalVes) DOM.summaryTotalVes.textContent = 'Bs 0.00';
    if(DOM.btnMixto) DOM.btnMixto.disabled = true;
    if(DOM.btnCreditoDirecto) DOM.btnCreditoDirecto.disabled = true;
    if(DOM.btnCortesiaDirecto) DOM.btnCortesiaDirecto.disabled = true;
    document.querySelectorAll('.quick-pay-btn').forEach(b => b.disabled = true);
    return;
  }

  DOM.emptyCartView.style.display = 'none';
  let totalItems = 0;
  let totalCop = 0;

  STATE.cart.forEach((item, index) => {
    const prod = STATE.products.find(p => p.id === item.producto_id);
    if (!prod) return;

    totalItems += item.cantidad;
    let extrasSubtotal = 0;
    let extrasHtml = '';
    if (item.extras && item.extras.length > 0) {
      item.extras.forEach((ext, idx) => {
        const extraCosto = parseFloat(ext.precio_adicional) || 0;
        extrasSubtotal += extraCosto * ext.cantidad;
        extrasHtml += `<div class="cart-extra-item" style="font-size:0.8rem; color:var(--text-color); margin-left:10px;">
          + ${ext.nombre} (x${ext.cantidad}) $${extraCosto.toLocaleString()}
          <button style="background:none; border:none; color:var(--danger); cursor:pointer; margin-left:5px;" onclick="event.stopPropagation(); removeExtra(${index}, ${idx})"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
        </div>`;
      });
    }

    const subtotal = (Number(prod.precio_venta) * item.cantidad) + extrasSubtotal;
    totalCop += subtotal;

    const div = document.createElement('div');
    div.className = 'cart-item';
    div.style.flexDirection = 'column';
    div.style.alignItems = 'stretch';
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
        <div class="item-details">
          <h4>${prod.nombre}${item.notas ? `<br><small style="color:var(--color-muted);font-weight:normal;font-size:0.85rem;">${item.notas}</small>` : ''}</h4>
          <span class="price">$${Number(prod.precio_venta).toLocaleString()} x ${item.cantidad}</span>
        </div>
        <div class="quantity-controls">
          <button class="qty-btn" onclick="event.stopPropagation(); changeQty(${index}, -1)"><i data-lucide="minus"></i></button>
          <span class="qty-val">${item.cantidad}</span>
          <button class="qty-btn" onclick="event.stopPropagation(); changeQty(${index}, 1)"><i data-lucide="plus"></i></button>
        </div>
        <div class="item-total">$${subtotal.toLocaleString()}</div>
        <button class="remove-item-btn" onclick="event.stopPropagation(); removeFromCart(${index})"><i data-lucide="trash-2"></i></button>
      </div>
      ${extrasHtml}
    `;

    DOM.cartItemsContainer.appendChild(div);
  });

  const tasaUsd = STATE.tasas.USD || 4000;
  const tasaVes = STATE.tasas.VES || 100;
  const totalUsd = totalCop / tasaUsd;
  const totalVes = totalCop / tasaVes;

  DOM.cartCount.textContent = `${totalItems} items`;
  DOM.summarySubtotal.textContent = `$${totalCop.toLocaleString()} COP`;
  if(DOM.summaryTotalCop) DOM.summaryTotalCop.textContent = `$${totalCop.toLocaleString()} COP`;
  if(DOM.summaryTotalUsd) DOM.summaryTotalUsd.textContent = `$${totalUsd.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  if(DOM.summaryTotalVes) DOM.summaryTotalVes.textContent = `Bs ${totalVes.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  
  if(DOM.btnMixto) DOM.btnMixto.disabled = false;
  if(DOM.btnCreditoDirecto) DOM.btnCreditoDirecto.disabled = false;
  if(DOM.btnCortesiaDirecto) DOM.btnCortesiaDirecto.disabled = false;
  document.querySelectorAll('.quick-pay-btn').forEach(b => b.disabled = false);
  lucide.createIcons();
}

async function quickPay(method, currency) {
  if (STATE.cart.length === 0) return;
  const totalCop = calculateCartTotal();
  if (totalCop <= 0) return;

  if (!STATE.tasas.USD || !STATE.tasas.VES || STATE.tasas.USD <= 0 || STATE.tasas.VES <= 0) {
    alert('Por favor, establezca las tasas de cambio de USD y VES del día (presionando "Cobrar" -> Configurar Tasa) antes de cobrar.');
    return;
  }

  const tasaUsd = STATE.tasas.USD || 0;
  const tasaVes = STATE.tasas.VES || 0;
  
  let montoOriginal = totalCop;
  if (currency === 'USD') montoOriginal = totalCop / tasaUsd;
  if (currency === 'VES') montoOriginal = totalCop / tasaVes;

  const payload = {
    items: STATE.cart,
    pagos: [{
      metodo_pago: method,
      moneda: currency,
      monto_original: montoOriginal,
      referencia: ''
    }],
    tasas: STATE.tasas,
    cliente_id: null,
    notas: 'Pago rápido'
  };

  try {
    const response = await fetch('/api/ventas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Error al procesar el pago rápido');
    }
    
    const resData = await response.json();
    STATE.cart = [];
    renderCart();
    await loadProductsFromAPI();
    
    // Mostrar ticket
    document.getElementById('receipt-id').textContent = `#${String(resData.ventaId).padStart(5, '0')}`;
    document.getElementById('receipt-date').textContent = new Date().toLocaleString();
    
    let itemsHtml = '';
    payload.items.forEach(item => {
      const p = STATE.products.find(x => x.id === item.producto_id);
      if (p) {
        itemsHtml += `<div class="ticket-row text-sm">
          <span>${item.cantidad}x ${p.nombre}</span>
          <span>$${(p.precio_venta * item.cantidad).toLocaleString()}</span>
        </div>`;
      }
    });
    document.getElementById('receipt-items-list').innerHTML = itemsHtml;
    document.getElementById('receipt-total').textContent = `$${totalCop.toLocaleString()} COP`;
    document.getElementById('receipt-paid').textContent = `$${totalCop.toLocaleString()} COP`;
    document.getElementById('receipt-change-row').style.display = 'none';
    
    document.getElementById('receipt-payments-list').innerHTML = `<div class="ticket-row text-sm">
      <span>${method} (${currency})</span>
      <span>${currency === 'COP' ? '$' : ''}${montoOriginal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} ${currency !== 'COP' ? currency : ''}</span>
    </div>`;
    
    DOM.receiptModal.classList.add('open');
    showToast('¡Pago registrado con éxito!', 'success');
  } catch (error) {
    showToast(error.message, 'danger');
  }
}

// 5. CONTROLADORES DEL CARRITO
function addToCart(productId) {
  const prod = STATE.products.find(p => p.id === productId);
  const stock = prod ? (prod.stock !== undefined ? prod.stock : (prod.stock_disponible || 0)) : 0;
  if (!prod || (!prod.es_batido && stock <= 0)) return;

  if (prod.es_batido) {
    if (typeof openGenericModal === 'function') {
      const batidoInsumos = STATE.insumos.filter(ins => ins.es_para_batidos);
      const checkboxesHtml = `
        <table class="inventory-table" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <thead>
            <tr>
              <th style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: center;">Sel.</th>
              <th style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: left;">Ingrediente</th>
              <th style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: left;">Tipo</th>
            </tr>
          </thead>
          <tbody>
            ${batidoInsumos.map(ins => {
              const esBase = ins.es_base_liquida ? 1 : 0;
              const cantSola = parseFloat(ins.cantidad_sola) || 0;
              const cantComb = parseFloat(ins.cantidad_combinada) || 0;
              const esSabor = ins.es_sabor_batido ? 1 : 0;
              let tipoStr = `<span class="badge" style="background:var(--card-bg-light); color:var(--color-text); font-size:0.7rem; padding:2px 6px;">Extra</span>`;
              if (esBase) tipoStr = `<span class="badge" style="background:var(--cyan-neon); color:black; font-size:0.7rem; padding:2px 6px;">Líquido</span>`;
              else if (esSabor) tipoStr = `<span class="badge" style="background:#ff4d4d; color:white; font-size:0.7rem; padding:2px 6px;">Fruta/Sabor</span>`;
              
              return `
                <tr style="border-bottom: 1px solid var(--border-color);">
                  <td style="padding: 8px; text-align: center;">
                    <input type="checkbox" class="batido-extra-cb" 
                      data-id="${ins.id}" data-nombre="${ins.nombre}"
                      data-es-base="${esBase}"
                      data-es-sabor="${ins.es_sabor_batido ? 1 : 0}"
                      data-cantidad-sola="${cantSola}"
                      data-cantidad-combinada="${cantComb}"
                      style="width:18px;height:18px; cursor:pointer;">
                  </td>
                  <td style="padding: 8px;">
                    <label style="cursor:pointer; display:block; width:100%; height:100%;" onclick="this.previousElementSibling ? this.previousElementSibling.click() : this.parentElement.previousElementSibling.querySelector('input').click()">
                      <strong>${ins.nombre}</strong>
                    </label>
                  </td>
                  <td style="padding: 8px;">
                    ${tipoStr}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
      
      openGenericModal(`Opciones para ${prod.nombre}`, `
        <div class="form-group" style="margin-bottom: 15px;">
          <label style="font-weight: 600; color: var(--color-muted); font-size: 0.85rem; margin-bottom: 10px; display: block;">Selecciona lo que lleva el vaso:</label>
          <div style="max-height: 250px; overflow-y: auto; background: var(--bg-app); border: 1px solid var(--border-glass); border-radius: 6px;">
            ${batidoInsumos.length > 0 ? checkboxesHtml : '<p style="color:var(--color-muted); font-size:0.9rem; padding: 15px;">No hay ingredientes para batidos. Ve a Inventario y edita tus insumos marcando "Disponible como opción para Batidos".</p>'}
          </div>
        </div>
      `, () => {
        const extras = [];
        const checkedCbs = document.querySelectorAll('.batido-extra-cb:checked');
        const basesSeleccionadas = [...checkedCbs].filter(cb => cb.dataset.esBase === '1');
        const saboresSeleccionados = [...checkedCbs].filter(cb => cb.dataset.esSabor === '1');
        const combinacionLiquidos = basesSeleccionadas.length > 1;
        const combinacionSabores = saboresSeleccionados.length > 1;

        checkedCbs.forEach(cb => {
          const esBase = cb.dataset.esBase === '1';
          const esSabor = cb.dataset.esSabor === '1';
          let cantidad = 1; // default para insumos normales
          
          if (esBase || esSabor) {
            const isCombinado = (esBase && combinacionLiquidos) || (esSabor && combinacionSabores);
            cantidad = isCombinado
              ? parseFloat(cb.dataset.cantidadCombinada) || 1
              : parseFloat(cb.dataset.cantidadSola) || 1;
          }

          extras.push({
            insumo_id: parseInt(cb.dataset.id),
            nombre: cb.dataset.nombre,
            cantidad: cantidad, 
            precio_adicional: 0
          });
        });

        STATE.cart.push({ 
          producto_id: productId, 
          cantidad: 1, 
          extras: extras 
        });
        
        renderCart();
        closeGenericModal();
      });
      return;
    }
  }

  const existing = STATE.cart.find(item => item.producto_id === productId && (!item.extras || item.extras.length === 0));
  if (existing) {
    if (existing.cantidad < stock) {
      existing.cantidad++;
    } else {
      showToast(`Stock máximo: ${stock} unidades`, 'warning');
    }
  } else {
    STATE.cart.push({ producto_id: productId, cantidad: 1 });
  }
  renderCart();
}

window.changeQty = function(index, delta) {
  const item = STATE.cart[index];
  if (!item) return;
  const prod = STATE.products.find(p => p.id === item.producto_id);
  if (!prod) return;
  const stock = prod.stock !== undefined ? prod.stock : (prod.stock_disponible || 999);

  const newQty = item.cantidad + delta;
  if (newQty <= 0) {
    removeFromCart(index);
  } else if (newQty <= stock) {
    item.cantidad = newQty;
    renderCart();
  } else {
    showToast(`Solo hay ${stock} unidades disponibles.`, 'warning');
  }
};

window.removeFromCart = function(index) {
  STATE.cart.splice(index, 1);
  renderCart();
};

function openPaymentModal() {
  const totalCop = calculateCartTotal();
  DOM.modalTotalSale.textContent = `$${totalCop.toLocaleString()} COP`;
  DOM.payInputs.forEach(i => i.value = '');
  DOM.refInputs.forEach(i => i.value = '');
  DOM.saleNotes.value = '';
  DOM.rateUsd.value = STATE.tasas.USD;
  DOM.rateVes.value = STATE.tasas.VES;
  
  // Cargar clientes en el selector
  const clientSelector = document.getElementById('sale-client');
  if (clientSelector) {
    clientSelector.innerHTML = '<option value="">Seleccione un cliente...</option>' + 
      STATE.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  }
  
  const chkCortesia = document.getElementById('chk-cortesia');
  if (chkCortesia) {
    chkCortesia.checked = false;
    document.getElementById('modal-payment-inputs').style.display = 'block';
  }
  
  // Botón "Pasar Todo a Crédito"
  const btnTodoCredito = document.getElementById('btn-cobrar-todo-credito');
  if (btnTodoCredito) {
    btnTodoCredito.onclick = () => {
      DOM.payInputs.forEach(i => { if(i.id !== 'pay-credito') i.value = '' });
      document.getElementById('pay-credito').value = totalCop;
      recalculatePayments();
    };
  }
  
  recalculatePayments();
  DOM.paymentModal.classList.add('open');
}

function closePaymentModal() {
  DOM.paymentModal.classList.remove('open');
}

function calculateCartTotal() {
  return STATE.cart.reduce((sum, item) => {
    const prod = STATE.products.find(p => p.id === item.producto_id);
    return sum + (prod ? Number(prod.precio_venta) * item.cantidad : 0);
  }, 0);
}

function recalculatePayments() {
  const chkCortesia = document.getElementById('chk-cortesia');
  if (chkCortesia && chkCortesia.checked) return; // Si es cortesía, omitir cálculo

  const totalVentaCop = calculateCartTotal();
  let totalPagadoCop = 0;

  const rateUsd = parseFloat(DOM.rateUsd.value) || 1;
  const rateVes = parseFloat(DOM.rateVes.value) || 1;

  const conversions = [
    { inputId: 'pay-cop-cash', rate: 1.0, calcId: null },
    { inputId: 'pay-cop-bank', rate: 1.0, calcId: null },
    { inputId: 'pay-usd-cash', rate: rateUsd, calcId: 'calc-usd-cash' },
    { inputId: 'pay-usd-zelle', rate: rateUsd, calcId: 'calc-usd-zelle' },
    { inputId: 'pay-ves-movil', rate: rateVes, calcId: 'calc-ves-movil' },
    { inputId: 'pay-binance', rate: rateUsd, calcId: 'calc-binance' },
    { inputId: 'pay-credito', rate: 1.0, calcId: null }
  ];

  conversions.forEach(c => {
    const inputEl = document.getElementById(c.inputId);
    const val = parseFloat(inputEl.value) || 0;
    const baseVal = val * c.rate;
    totalPagadoCop += baseVal;
    if (c.calcId) {
      const calcEl = document.getElementById(c.calcId);
      calcEl.textContent = val > 0 ? `= $${baseVal.toLocaleString(undefined, {maximumFractionDigits: 0})} COP` : '= $0 COP';
    }
  });

  DOM.modalTotalPaid.textContent = `$${totalPagadoCop.toLocaleString(undefined, {maximumFractionDigits: 0})} COP`;

  const diff = totalPagadoCop - totalVentaCop;

  if (totalPagadoCop === 0) {
    DOM.paymentStatusBox.className = 'payment-status-box status-insufficient';
    DOM.statusBoxIcon.setAttribute('data-lucide', 'info');
    DOM.statusBoxTitle.textContent = 'Esperando Pago...';
    DOM.statusBoxDesc.textContent = 'Ingresa los montos por los métodos elegidos.';
    DOM.statusBoxValue.textContent = `$${totalVentaCop.toLocaleString()} COP`;
    DOM.btnConfirmPayment.disabled = true;
  } else if (diff < -10.0) {
    DOM.paymentStatusBox.className = 'payment-status-box status-insufficient';
    DOM.statusBoxIcon.setAttribute('data-lucide', 'alert-triangle');
    DOM.statusBoxTitle.textContent = 'Monto Insuficiente';
    DOM.statusBoxDesc.textContent = 'Aún falta saldo para cubrir la venta.';
    DOM.statusBoxValue.textContent = `Faltan: $${Math.abs(diff).toLocaleString(undefined, {maximumFractionDigits: 0})} COP`;
    DOM.btnConfirmPayment.disabled = true;
  } else {
    DOM.paymentStatusBox.className = 'payment-status-box status-sufficient';
    DOM.statusBoxIcon.setAttribute('data-lucide', 'check-circle-2');
    DOM.statusBoxTitle.textContent = 'Pago Completado';
    if (diff > 0.1) {
      const changeUsd = diff / rateUsd;
      DOM.statusBoxDesc.textContent = 'Entregar vuelto al cliente:';
      DOM.statusBoxValue.innerHTML = `$${diff.toLocaleString(undefined, {maximumFractionDigits: 0})} COP <span style="font-size:0.85rem; display:block; opacity:0.8;">(o $${changeUsd.toFixed(2)} USD)</span>`;
    } else {
      DOM.statusBoxDesc.textContent = 'Monto exacto recibido.';
      DOM.statusBoxValue.textContent = '$0 COP (Cambio)';
    }
    DOM.btnConfirmPayment.disabled = false;
  }
  lucide.createIcons();
}

// 7. ENVÍO DE PAGO
async function submitPayment() {
  DOM.btnConfirmPayment.disabled = true;
  DOM.btnConfirmPayment.innerHTML = `<span class="spinner"></span> Procesando...`;

  const rateUsd = parseFloat(DOM.rateUsd.value) || 0;
  const rateVes = parseFloat(DOM.rateVes.value) || 0;

  if (rateUsd <= 0 || rateVes <= 0) {
    alert('Por favor, establezca la tasa de cambio de USD y VES del día antes de continuar.');
    DOM.btnConfirmPayment.disabled = false;
    DOM.btnConfirmPayment.innerHTML = `<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>`;
    lucide.createIcons();
    return;
  }

  const pagos = [];
  const inputMappings = [
    { inputId: 'pay-cop-cash', metodo: 'Efectivo COP', moneda: 'COP', refId: null },
    { inputId: 'pay-cop-bank', metodo: 'Bancolombia', moneda: 'COP', refId: 'ref-cop-bank' },
    { inputId: 'pay-usd-cash', metodo: 'Efectivo USD', moneda: 'USD', refId: null },
    { inputId: 'pay-usd-zelle', metodo: 'Zelle', moneda: 'USD', refId: 'ref-usd-zelle' },
    { inputId: 'pay-ves-movil', metodo: 'Pago Móvil', moneda: 'VES', refId: 'ref-ves-movil' },
    { inputId: 'pay-binance', metodo: 'Binance', moneda: 'USD', refId: 'ref-binance' },
    { inputId: 'pay-credito', metodo: 'Crédito', moneda: 'COP', refId: null }
  ];

  inputMappings.forEach(m => {
    const inputVal = parseFloat(document.getElementById(m.inputId).value) || 0;
    if (inputVal > 0) {
      const refVal = m.refId ? document.getElementById(m.refId).value : null;
      pagos.push({
        metodo_pago: m.metodo,
        moneda: m.moneda,
        monto_original: inputVal,
        referencia: refVal
      });
    }
  });

  const chkCortesia = document.getElementById('chk-cortesia');
  const isCortesia = STATE.isCortesia || (chkCortesia && chkCortesia.checked);
  const isCredito = pagos.some(p => p.metodo_pago === 'Crédito');
  
  let clienteId = null;
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
        DOM.btnConfirmPayment.innerHTML = `<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>`;
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
            alert(`Error al registrar cliente: ${dataClient.error}`);
            DOM.btnConfirmPayment.disabled = false;
            DOM.btnConfirmPayment.innerHTML = `<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>`;
            lucide.createIcons();
            return;
          }
        } catch (err) {
          console.error(err);
          alert('Error de conexión al registrar cliente.');
          DOM.btnConfirmPayment.disabled = false;
          DOM.btnConfirmPayment.innerHTML = `<i data-lucide="check-circle-2"></i><span>Confirmar Venta</span>`;
          lucide.createIcons();
          return;
        }
      }
    }
  }

  const payload = {
    items: STATE.cart,
    pagos: isCortesia ? [] : pagos,
    tasas: { USD: rateUsd, VES: rateVes },
    tipo_transaccion: isCortesia ? 'Cortesia' : 'Venta',
    notas: DOM.saleNotes.value || (isCortesia ? 'Cortesía' : 'Venta desde Terminal POS'),
    cliente_id: clienteId
  };

  if (STATE.apiOnline) {
    try {
      const res = await fetch('/api/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.status === 201) {
        showReceipt(data);
        // Recargar productos del servidor
        await loadProductsFromAPI();
      } else {
        showToast(`Error: ${data.error}`, 'danger');
        recalculatePayments();
      }
    } catch (err) {
      console.error(err);
      showToast('Error de conexión. Procesando en modo local.', 'warning');
      simulateCheckout(payload);
    }
  } else {
    setTimeout(() => simulateCheckout(payload), 800);
  }
}

function simulateCheckout(payload) {
  const transactionId = `LOCAL-${Math.floor(100000 + Math.random() * 900000)}`;
  const totalVentaCop = calculateCartTotal();
  const rateUsd = payload.tasas.USD;

  let totalPagadoCop = 0;
  const pagosProcesados = payload.pagos.map(p => {
    let rate = 1.0;
    if (p.moneda === 'USD') rate = payload.tasas.USD;
    else if (p.moneda === 'VES') rate = payload.tasas.VES;
    const base = p.monto_original * rate;
    totalPagadoCop += base;
    return { ...p, tasa_cambio: rate, monto_base: base };
  });

  const cambioCop = totalPagadoCop - totalVentaCop;
  const cambioUsd = cambioCop > 0 ? cambioCop / rateUsd : 0;

  const advertencias = [];
  payload.items.forEach(item => {
    const prod = STATE.products.find(p => p.id === item.producto_id);
    if (prod) {
      const stockKey = prod.stock !== undefined ? 'stock' : 'stock_disponible';
      prod[stockKey] = Math.max(0, (prod[stockKey] || 0) - item.cantidad);
      if (prod[stockKey] === 0) {
        advertencias.push(`'${prod.nombre}' se ha agotado.`);
      } else if (prod[stockKey] < 10) {
        advertencias.push(`Bajo stock de '${prod.nombre}'. Remanente: ${prod[stockKey]}`);
      }
    }
  });

  renderProducts();

  const mockResponseData = {
    mensaje: 'Venta simulada (Modo Offline).',
    venta_id: transactionId,
    resumen: {
      total_venta_cop: totalVentaCop,
      total_pagado_cop: totalPagadoCop,
      cambio_cop: cambioCop,
      cambio_usd: parseFloat(cambioUsd.toFixed(2))
    },
    detalles: STATE.cart.map(item => {
      const prod = STATE.products.find(p => p.id === item.producto_id);
      return {
        producto_id: item.producto_id,
        nombre: prod.nombre,
        cantidad: item.cantidad,
        precio_unitario: Number(prod.precio_venta),
        subtotal: Number(prod.precio_venta) * item.cantidad
      };
    }),
    pagos: pagosProcesados,
    advertencias: advertencias.length > 0 ? advertencias : null
  };

  showReceipt(mockResponseData);
}

// 8. MOSTRAR RECIBO Y REINICIAR
function showReceipt(data) {
  closePaymentModal();

  DOM.receiptId.textContent = `#${data.venta_id}`;
  DOM.receiptDate.textContent = new Date().toLocaleString('es-ES');
  
  DOM.receiptItemsList.innerHTML = '';
  data.detalles.forEach(item => {
    const row = document.createElement('div');
    row.className = 'ticket-row';
    row.innerHTML = `
      <span>${item.nombre} x ${item.cantidad}</span>
      <span>$${item.subtotal.toLocaleString()}</span>
    `;
    DOM.receiptItemsList.appendChild(row);
  });

  DOM.receiptTotal.textContent = `$${data.resumen.total_venta_cop.toLocaleString()} COP`;
  DOM.receiptPaid.textContent = `$${data.resumen.total_pagado_cop.toLocaleString()} COP`;
  
  if (data.resumen.cambio_cop > 0.1) {
    DOM.receiptChangeRow.style.display = 'flex';
    DOM.receiptChange.innerHTML = `$${data.resumen.cambio_cop.toLocaleString()} COP <span style="font-size:0.7rem; color:var(--color-muted); font-weight:normal;">(o $${data.resumen.cambio_usd.toFixed(2)} USD)</span>`;
  } else {
    DOM.receiptChangeRow.style.display = 'none';
  }

  DOM.receiptPaymentsList.innerHTML = '';
  data.pagos.forEach(p => {
    const row = document.createElement('div');
    row.className = 'ticket-row text-muted';
    const refText = p.referencia ? ` (Ref: ${p.referencia})` : '';
    row.innerHTML = `
      <span>${p.metodo_pago}${refText}</span>
      <span>${p.moneda} ${p.monto_original.toLocaleString()} (= $${p.monto_base.toLocaleString()} COP)</span>
    `;
    DOM.receiptPaymentsList.appendChild(row);
  });

  DOM.receiptAlertsContainer.innerHTML = '';
  if (data.advertencias && data.advertencias.length > 0) {
    data.advertencias.forEach(adv => {
      const div = document.createElement('div');
      div.className = 'alert-item alert-warning';
      div.innerHTML = `<i data-lucide="alert-triangle"></i> <span>${adv}</span>`;
      DOM.receiptAlertsContainer.appendChild(div);
    });
  }
  lucide.createIcons();
  DOM.receiptModal.classList.add('open');
}

function resetSale() {
  STATE.cart = [];
  renderCart();
  DOM.receiptModal.classList.remove('open');
}

// ============================================
// 9. MÓDULO INVENTARIO
// ============================================

async function loadInventarioData() {
  try {
    const [insumosRes, mermasRes, productosRes, valRes] = await Promise.all([
      fetch('/api/insumos').then(r => { if (!r.ok) throw new Error(); return r.json() }),
      fetch('/api/mermas').then(r => { if (!r.ok) throw new Error(); return r.json() }),
      fetch('/api/productos').then(r => { if (!r.ok) throw new Error(); return r.json() }),
      fetch('/api/inventario/valorizacion').then(r => { if (!r.ok) return {}; return r.json() })
    ]);
    STATE.insumos = insumosRes;
    STATE.products = productosRes.productos.map(p => ({
        id: p.id,
        nombre: p.nombre,
        precio_venta: parseFloat(p.precio_venta),
        costo_produccion: parseFloat(p.costo_produccion),
        categoria: p.categoria || 'General',
        stock: p.stock_disponible || 0,
        stock_disponible: p.stock_disponible || 0,
        es_batido: p.es_batido ? 1 : 0
    }));
    
    const valActual = document.getElementById('val-actual');
    const valRepos = document.getElementById('val-reposicion');
    const valIdeal = document.getElementById('val-ideal');
    if (valActual && valRes.Actual !== undefined) valActual.textContent = `$${valRes.Actual.toLocaleString()}`;
    if (valRepos && valRes.Reposición !== undefined) {
      const reposVal = valRes.Reposición;
      if (reposVal < 0) {
        // Excedente: el stock actual supera al fijo en general
        valRepos.textContent = `-$${Math.abs(reposVal).toLocaleString()}`;
        valRepos.style.color = 'var(--success)';
        const sub = valRepos.closest('.kpi-data')?.querySelector('.kpi-sub');
        if (sub) sub.textContent = 'Excedente a favor (sobra stock)';
      } else {
        valRepos.textContent = `$${reposVal.toLocaleString()}`;
        valRepos.style.color = 'var(--warning)';
        const sub = valRepos.closest('.kpi-data')?.querySelector('.kpi-sub');
        if (sub) sub.textContent = 'Para llegar al stock fijo';
      }
    }
    if (valIdeal && valRes['Stock Fijo'] !== undefined) valIdeal.textContent = `$${valRes['Stock Fijo'].toLocaleString()}`;

    STATE._allInsumos = insumosRes;
    renderInsumosTable(insumosRes);
    // Reaplicar filtro de búsqueda si hay texto en el input
    const searchInsInput = document.getElementById('search-insumos-input');
    if (searchInsInput && searchInsInput.value.trim()) {
      const query = searchInsInput.value.toLowerCase();
      const filtered = insumosRes.filter(ins => ins.nombre.toLowerCase().includes(query));
      renderInsumosTable(filtered);
    }
    renderMermasTable(mermasRes);
    renderProductosTable(productosRes.productos || []);
  } catch (err) {
    console.error('Error cargando inventario:', err);
    showOfflineMessage('tbody-insumos', 10);
    showOfflineMessage('tbody-mermas', 5);
    showOfflineMessage('tbody-productos', 8);
  }
}

window.loadOrdenCompra = async function() {
  const tbody = document.getElementById('tbody-orden');
  const valTotal = document.getElementById('val-total-orden');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="6" class="loading-cell"><i data-lucide="loader" class="spin"></i> Calculando orden...</td></tr>';
  lucide.createIcons();
  
  try {
    const res = await fetch('/api/inventario/orden-compra');
    if (!res.ok) throw new Error('Error al generar la orden');
    const data = await res.json();
    
    valTotal.textContent = (data.total_orden_cop < 0 ? '-$' + Math.abs(data.total_orden_cop).toLocaleString() : '$' + data.total_orden_cop.toLocaleString());
    if (data.total_orden_cop < 0) {
      valTotal.style.color = 'var(--success)';
    } else {
      valTotal.style.color = '';
    }
    
    if (data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading-cell" style="color:var(--success);">¡Tu inventario está en los niveles óptimos! No necesitas comprar nada.</td></tr>';
      return;
    }
    
    // Separar: primero los que faltan (por_comprar > 0), luego los excedentes (por_comprar < 0)
    const faltantes = data.items.filter(i => i.por_comprar > 0);
    const excedentes = data.items.filter(i => i.por_comprar < 0);
    const sorted = [...faltantes, ...excedentes];
    
    tbody.innerHTML = sorted.map(item => {
      const esSobrante = item.por_comprar < 0;
      const colorCantidad = esSobrante ? 'var(--success)' : 'var(--warning)';
      const colorCosto = esSobrante ? 'var(--success)' : 'var(--success)';
      const etiqueta = esSobrante ? 'Sobra ' + Math.abs(item.por_comprar) : item.por_comprar;
      const costTxt = esSobrante 
        ? '-$' + Math.abs(item.reposicion_cop).toLocaleString()
        : '$' + item.reposicion_cop.toLocaleString();
      return `
      <tr style="${esSobrante ? 'opacity:0.75;' : ''}">
        <td><strong>${item.nombre}</strong></td>
        <td>${item.stock_actual} ${item.unidad_medida}</td>
        <td>${item.stock_fijo} ${item.unidad_medida}</td>
        <td style="color:${colorCantidad}; font-weight:bold;">${etiqueta} ${item.unidad_medida}</td>
        <td>$${item.costo_unitario.toLocaleString()}</td>
        <td style="color:${colorCosto}; font-weight:bold;">${costTxt}</td>
      </tr>
    `}).join('');
    
  } catch (err) {
    console.error('Error cargando orden de compra:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell" style="color:var(--danger);">Error al generar la orden. Inténtalo de nuevo.</td></tr>';
  }
}

function renderInsumosTable(insumos) {
  const tbody = document.getElementById('tbody-insumos');
  if (!insumos || insumos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="loading-cell">No hay insumos registrados.</td></tr>';
    return;
  }
  // Ordenar según el selector
  const sortVal = document.getElementById('sort-insumos-select')?.value || 'nombre-asc';
  const sortFn = (a, b) => {
    switch (sortVal) {
      case 'nombre-asc': return a.nombre.localeCompare(b.nombre);
      case 'nombre-desc': return b.nombre.localeCompare(a.nombre);
      case 'stock-asc': return (parseFloat(a.stock_actual)||0) - (parseFloat(b.stock_actual)||0);
      case 'stock-desc': return (parseFloat(b.stock_actual)||0) - (parseFloat(a.stock_actual)||0);
      case 'costo-asc': return (parseFloat(a.costo_unitario)||0) - (parseFloat(b.costo_unitario)||0);
      case 'costo-desc': return (parseFloat(b.costo_unitario)||0) - (parseFloat(a.costo_unitario)||0);
      case 'valor-fijo-asc': return ((parseFloat(a.stock_fijo)||0)*(parseFloat(a.costo_unitario)||0)) - ((parseFloat(b.stock_fijo)||0)*(parseFloat(b.costo_unitario)||0));
      case 'valor-fijo-desc': return ((parseFloat(b.stock_fijo)||0)*(parseFloat(b.costo_unitario)||0)) - ((parseFloat(a.stock_fijo)||0)*(parseFloat(a.costo_unitario)||0));
      default: return a.nombre.localeCompare(b.nombre);
    }
  };
  // Los de valor fijo 0 van de últimos
  const conValor = insumos.filter(i => ((parseFloat(i.stock_fijo)||0) * (parseFloat(i.costo_unitario)||0)) > 0);
  const sinValor = insumos.filter(i => ((parseFloat(i.stock_fijo)||0) * (parseFloat(i.costo_unitario)||0)) === 0);
  const sorted = [...conValor].sort(sortFn).concat([...sinValor].sort(sortFn));
  tbody.innerHTML = sorted.map(ins => {
    const stock = parseFloat(ins.stock_actual);
    const min = parseFloat(ins.stock_minimo);
    const stockFijo = parseFloat(ins.stock_fijo) || 0;
    const costoUnit = parseFloat(ins.costo_unitario) || 0;
    const valorFijo = stockFijo * costoUnit;
    let statusClass = 'status-ok', statusText = 'OK';
    if (stock <= 0) { statusClass = 'status-critical'; statusText = 'Agotado'; }
    else if (stock <= min) { statusClass = 'status-warn'; statusText = 'Bajo'; }

    return `
      <tr>
        <td>${ins.id}</td>
        <td><strong>${ins.nombre}</strong></td>
        <td>${ins.unidad_medida}</td>
        <td class="font-outfit">${stock.toLocaleString()}</td>
        <td>${min.toLocaleString()}</td>
        <td>${stockFijo.toLocaleString()}</td>
        <td>$${costoUnit.toLocaleString()}</td>
        <td style="color:var(--accent-cyan); font-weight:bold;">$${valorFijo.toLocaleString()}</td>
        <td><span class="status-pill ${statusClass}">${statusText}</span></td>
        <td>
          <div class="table-actions">
            <button class="table-btn btn-edit" onclick="showEditInsumoModal(${ins.id})">Editar</button>
            <button class="table-btn btn-restock" onclick="showRestockModal(${ins.id}, '${ins.nombre}')">+ Stock</button>
            <button class="table-btn btn-danger" onclick="deleteInsumo(${ins.id})" style="background:var(--danger); color:white; border:none;">Eliminar</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderMermasTable(mermas) {
  const tbody = document.getElementById('tbody-mermas');
  if (!mermas || mermas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No hay mermas registradas.</td></tr>';
    return;
  }
  tbody.innerHTML = mermas.map(m => `
    <tr>
      <td>${new Date(m.fecha).toLocaleString('es-ES')}</td>
      <td><strong>${m.insumo_nombre}</strong></td>
      <td>${parseFloat(m.cantidad).toLocaleString()}</td>
      <td>${m.unidad_medida}</td>
      <td>${m.motivo}</td>
    </tr>
  `).join('');
}

function renderProductosTable(productos) {
  const tbody = document.getElementById('tbody-productos');
  if (!productos || productos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No hay productos registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = productos.map(p => {
    const costo = parseFloat(p.costo_produccion);
    const precio = parseFloat(p.precio_venta);
    const margen = precio > 0 ? (((precio - costo) / precio) * 100).toFixed(0) : 0;
    const stock = p.stock_disponible || 0;
    let stockClass = 'status-ok';
    if (stock <= 0) stockClass = 'status-critical';
    else if (stock <= 10) stockClass = 'status-warn';

    return `
      <tr>
        <td>${p.id}</td>
        <td><strong>${p.nombre}</strong></td>
        <td>${p.categoria}</td>
        <td>$${costo.toLocaleString()}</td>
        <td>$${precio.toLocaleString()}</td>
        <td><span class="text-success">${margen}%</span></td>
        <td><span class="status-pill ${stockClass}">${stock}</span></td>
        <td>
          <div class="table-actions">
            <button class="table-btn btn-edit" onclick="showEditProductoModal(${p.id})">Editar</button>
            <button class="table-btn btn-danger" onclick="deleteProducto(${p.id})" style="background:var(--danger); color:white; border:none;">Eliminar</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Funciones para Modal de Productos y Recetas
window.showAddProductoModal = function() {
  DOM.genericModalTitle.innerHTML = '<i data-lucide="tag"></i> Nuevo Producto (con Receta)';
  
  let insumosOptions = STATE.insumos.map(i => `<option value="${i.id}">${i.nombre} (${i.unidad_medida})</option>`).join('');
  
  DOM.genericModalBody.innerHTML = `
    <div class="form-group">
      <label>Nombre del Producto</label>
      <input type="text" id="prod-nombre" placeholder="Ej: Batido de Proteína">
    </div>
    <div class="form-group">
      <label>Categoría</label>
      <select id="prod-categoria">
        ${STATE.categories.filter(c => c.id !== 'todos').map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Precio de Venta (COP)</label>
      <input type="number" id="prod-precio" value="0" min="0">
    </div>
    <div class="form-group" style="margin-top: 10px;">
      <label>Costo de Producción (Manual)</label>
      <input type="number" id="prod-costo" value="0" min="0">
      <small style="color:var(--text-muted); font-size:12px;">Para calcular desde la receta, déjalo en 0.</small>
    </div>
    <div class="form-group" style="margin-top: 10px;">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="prod-es-batido" style="width:18px;height:18px;"> 
        <strong>Pedir Ingredientes al Vender (Opciones de Batido)</strong>
      </label>
    </div>
    
    <div class="receta-section" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color);">
      <h4>Ingredientes (Receta)</h4>
      <div id="receta-items" style="margin-bottom: 10px;"></div>
      <button type="button" class="action-btn secondary" id="btn-add-receta-row" style="font-size: 12px; padding: 5px 10px;">
        <i data-lucide="plus"></i> Añadir Insumo
      </button>
    </div>
  `;
  
  lucide.createIcons();
  
  const addRowBtn = document.getElementById('btn-add-receta-row');
  const recetaItems = document.getElementById('receta-items');
  
  addRowBtn.addEventListener('click', () => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.marginBottom = '10px';
    row.className = 'receta-row';
    row.innerHTML = `
      <select class="receta-insumo" style="flex: 2;">${insumosOptions}</select>
      <input type="number" class="receta-cantidad" placeholder="Cant." style="flex: 1;" min="0.1" step="0.1">
      <button type="button" class="action-btn" onclick="this.parentElement.remove()" style="background:var(--danger); border:none; padding:5px 10px;"><i data-lucide="trash-2"></i></button>
    `;
    recetaItems.appendChild(row);
    lucide.createIcons();
  });
  
  DOM.btnSubmitGeneric.onclick = async () => {
    const nombre = document.getElementById('prod-nombre').value;
    const categoria = document.getElementById('prod-categoria').value;
    const precio_venta = document.getElementById('prod-precio').value;
    const es_batido = document.getElementById('prod-es-batido').checked;
    
    const rows = document.querySelectorAll('.receta-row');
    const receta = [];
    let costo_produccion_calc = 0;
    
    rows.forEach(row => {
      const ins_id = row.querySelector('.receta-insumo').value;
      const cant = parseFloat(row.querySelector('.receta-cantidad').value) || 0;
      if (cant > 0) {
        receta.push({ insumo_id: parseInt(ins_id), cantidad: cant });
        const insObj = STATE.insumos.find(i => i.id == ins_id);
        if (insObj) {
          costo_produccion_calc += cant * parseFloat(insObj.costo_unitario);
        }
      }
    });

    let costo_manual = parseFloat(document.getElementById('prod-costo').value) || 0;
    let costo_produccion = costo_manual > 0 ? costo_manual : costo_produccion_calc;

    try {
      const res = await fetch('/api/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, categoria, precio_venta, costo_produccion, receta, es_batido })
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Error desconocido');
      }
      closeGenericModal();
      await loadInventarioData();
      renderProducts();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };
  
  DOM.genericModal.classList.add('open');
};

window.showEditProductoModal = async function(prod_id) {
  const prod = STATE.products.find(p => p.id === prod_id);
  if (!prod) return;

  DOM.genericModalTitle.innerHTML = `<i data-lucide="edit"></i> Editar Producto: ${prod.nombre}`;
  
  let insumosOptions = STATE.insumos.map(i => `<option value="${i.id}">${i.nombre} (${i.unidad_medida})</option>`).join('');
  
  DOM.genericModalBody.innerHTML = `
    <div class="form-group">
      <label>Nombre del Producto</label>
      <input type="text" id="edit-prod-nombre" value="${prod.nombre}">
    </div>
    <div class="form-group">
      <label>Categoría</label>
      <select id="edit-prod-categoria">
        ${STATE.categories.filter(c => c.id !== 'todos').map(c => `<option value="${c.id}" ${c.nombre === prod.categoria ? 'selected' : ''}>${c.nombre}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Precio de Venta (COP)</label>
      <input type="number" id="edit-prod-precio" value="${prod.precio_venta}">
    </div>
    <div class="form-group" style="margin-top: 10px;">
      <label>Costo de Producción (Manual)</label>
      <input type="number" id="edit-prod-costo" value="${prod.costo_produccion}">
      <small style="color:var(--text-muted); font-size:12px;">Para calcular desde la receta, déjalo en 0.</small>
    </div>
    <div class="form-group" style="margin-top: 10px;">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="edit-prod-es-batido" style="width:18px;height:18px;" ${prod.es_batido ? 'checked' : ''}> 
        <strong>Pedir Ingredientes al Vender (Opciones de Batido)</strong>
      </label>
    </div>
    
    <div class="receta-section" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color);">
      <h4>Ingredientes (Receta)</h4>
      <div id="edit-receta-items" style="margin-bottom: 10px;">
        <div class="loading-cell">Cargando receta...</div>
      </div>
      <button type="button" class="action-btn secondary" id="btn-edit-add-receta-row" style="font-size: 12px; padding: 5px 10px;">
        <i data-lucide="plus"></i> Añadir Insumo
      </button>
    </div>
  `;
  lucide.createIcons();
  
  DOM.genericModal.classList.add('open');

  const recetaItems = document.getElementById('edit-receta-items');
  const addRowBtn = document.getElementById('btn-edit-add-receta-row');

  // Cargar receta actual
  try {
    const recetaRes = await fetch(`/api/productos/${prod_id}/receta`);
    const recetaActual = await recetaRes.json();
    recetaItems.innerHTML = '';
    
    if (recetaActual.length === 0) {
      recetaItems.innerHTML = '<p class="text-muted" style="font-size:12px;">Sin receta configurada. (Stock no vinculado a inventario)</p>';
    }

    recetaActual.forEach(item => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.marginBottom = '10px';
      row.className = 'receta-row';
      row.innerHTML = `
        <select class="receta-insumo" style="flex: 2;">
          ${STATE.insumos.map(i => `<option value="${i.id}" ${i.id === item.insumo_id ? 'selected' : ''}>${i.nombre} (${i.unidad_medida})</option>`).join('')}
        </select>
        <input type="number" class="receta-cantidad" value="${item.cantidad}" placeholder="Cant." style="flex: 1;" min="0.1" step="0.1">
        <button type="button" class="action-btn" onclick="this.parentElement.remove()" style="background:var(--danger); border:none; padding:5px 10px;"><i data-lucide="trash-2"></i></button>
      `;
      recetaItems.appendChild(row);
    });
    lucide.createIcons();
  } catch (err) {
    recetaItems.innerHTML = '<p class="text-danger">Error cargando receta</p>';
  }

  addRowBtn.addEventListener('click', () => {
    const p = recetaItems.querySelector('.text-muted');
    if (p) p.remove();
    
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.marginBottom = '10px';
    row.className = 'receta-row';
    row.innerHTML = `
      <select class="receta-insumo" style="flex: 2;">${insumosOptions}</select>
      <input type="number" class="receta-cantidad" placeholder="Cant." style="flex: 1;" min="0.1" step="0.1">
      <button type="button" class="action-btn" onclick="this.parentElement.remove()" style="background:var(--danger); border:none; padding:5px 10px;"><i data-lucide="trash-2"></i></button>
    `;
    recetaItems.appendChild(row);
    lucide.createIcons();
  });

  DOM.btnSubmitGeneric.onclick = async () => {
    const nombre = document.getElementById('edit-prod-nombre').value;
    const categoria = document.getElementById('edit-prod-categoria').value;
    const precio_venta = document.getElementById('edit-prod-precio').value;
    const es_batido = document.getElementById('edit-prod-es-batido').checked;
    
    const rows = document.querySelectorAll('#edit-receta-items .receta-row');
    const receta = [];
    let costo_produccion_calc = 0;
    
    rows.forEach(row => {
      const ins_id = row.querySelector('.receta-insumo').value;
      const cant = parseFloat(row.querySelector('.receta-cantidad').value) || 0;
      if (cant > 0) {
        receta.push({ insumo_id: parseInt(ins_id), cantidad: cant });
        const insObj = STATE.insumos.find(i => i.id == ins_id);
        if (insObj) {
          costo_produccion_calc += cant * parseFloat(insObj.costo_unitario);
        }
      }
    });

    let costo_manual = parseFloat(document.getElementById('edit-prod-costo').value) || 0;
    let costo_produccion = costo_manual > 0 ? costo_manual : costo_produccion_calc;


    try {
      const res = await fetch(`/api/productos/${prod_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, categoria, precio_venta, costo_produccion, receta, es_batido, activo: 1 })
      });
      if (!res.ok) throw new Error('Error al actualizar');
      
      closeGenericModal();
      await loadInventarioData();
      renderProducts();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };
};

// ============================================
// 10. MÓDULO CRÉDITO
// ============================================

async function loadClientesData() {
  try {
    const clientes = await fetch('/api/clientes').then(r => { if (!r.ok) throw new Error(); return r.json() });
    STATE.clientes = clientes;
    renderClientesTable(clientes);
  } catch (err) {
    console.error('Error cargando clientes:', err);
    showOfflineMessage('tbody-clientes', 8);
  }
}

function renderClientesTable(clientes) {
  const tbody = document.getElementById('tbody-clientes');
  if (!clientes || clientes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No hay clientes registrados. Usa el botón "Nuevo Cliente" para crear uno.</td></tr>';
    return;
  }
  tbody.innerHTML = clientes.map(c => {
    const saldo = parseFloat(c.saldo_deudor);
    const limite = parseFloat(c.limite_credito);
    let statusClass = 'status-ok', statusText = 'Al día';
    if (saldo > 0 && saldo >= limite) { statusClass = 'status-critical'; statusText = 'Límite'; }
    else if (saldo > 0) { statusClass = 'status-warn'; statusText = 'Con deuda'; }

    return `
      <tr>
        <td>${c.id}</td>
        <td><strong>${c.nombre}</strong></td>
        <td>${c.identificacion}</td>
        <td>${c.telefono || '-'}</td>
        <td>$${limite.toLocaleString()}</td>
        <td class="font-outfit">$${saldo.toLocaleString()}</td>
        <td><span class="status-pill ${statusClass}">${statusText}</span></td>
        <td>
          <div class="table-actions">
            <button class="table-btn btn-detail" onclick="loadClientDetail(${c.id})">Ver</button>
            <button class="table-btn" style="background:var(--warning); color:#000;" onclick="showRegistrarDeudaModal(${c.id}, '${c.nombre.replace(/'/g, "\\'")}', ${parseFloat(c.saldo_deudor)}, ${parseFloat(c.limite_credito)})">+ Deuda</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.loadClientDetail = async function(clientId) {
  if (!STATE.apiOnline) return;
  try {
    const data = await fetch(`/api/clientes/${clientId}`).then(r => r.json());
    STATE.selectedClientId = clientId;
    
    const panel = document.getElementById('client-detail-panel');
    panel.style.display = 'flex';
    
    document.getElementById('detail-client-name').textContent = `${data.cliente.nombre} — Detalle de Cuenta`;
    
    const saldo = parseFloat(data.cliente.saldo_deudor);
    const limite = parseFloat(data.cliente.limite_credito);
    
    document.getElementById('client-stats').innerHTML = `
      <div class="stat-card">
        <span class="stat-label">Saldo Deudor</span>
        <span class="stat-value" style="color: ${saldo > 0 ? 'var(--danger)' : 'var(--success)'}">$${saldo.toLocaleString()}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Límite Crédito</span>
        <span class="stat-value">$${limite.toLocaleString()}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Disponible</span>
        <span class="stat-value" style="color: var(--cyan-neon)">$${Math.max(0, limite - saldo).toLocaleString()}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Compras Registradas</span>
        <span class="stat-value">${data.compras ? data.compras.length : 0}</span>
      </div>
    `;

    // Historial
    const tbody = document.getElementById('tbody-client-history');
    const movements = [];
    if (data.compras) {
      data.compras.forEach(v => {
        movements.push({ fecha: v.fecha, tipo: 'Compra', monto: parseFloat(v.total), notas: v.notas || '-' });
      });
    }
    if (data.abonos) {
      data.abonos.forEach(a => {
        movements.push({ id: a.id, fecha: a.fecha, tipo: 'Abono', monto: parseFloat(a.monto_total_cop), notas: a.notas || '-' });
      });
    }
    movements.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    if (movements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="loading-cell">Sin movimientos registrados.</td></tr>';
    } else {
      tbody.innerHTML = movements.map(m => `
        <tr>
          <td>${new Date(m.fecha).toLocaleString('es-ES')}</td>
          <td><span class="status-pill ${m.tipo === 'Abono' ? 'status-ok' : 'status-warn'}">${m.tipo}</span></td>
          <td class="font-outfit">${m.tipo === 'Abono' ? '-' : ''}$${m.monto.toLocaleString()}</td>
          <td>${m.notas} ${m.tipo === 'Abono' ? `<button class="action-btn btn-danger" style="padding: 2px 5px; font-size: 12px; margin-left: 10px;" onclick="eliminarAbono(${m.id})">Borrar</button>` : ''}</td>
        </tr>
      `).join('');
    }

    // Botón registrar abono
    document.getElementById('btn-registrar-abono').onclick = () => showAbonoModal(clientId, data.cliente.nombre, saldo);
    document.getElementById('btn-registrar-deuda').onclick = () => showRegistrarDeudaModal(clientId, data.cliente.nombre, saldo, limite);

  } catch (err) {
    console.error('Error cargando detalle:', err);
  }
};

document.getElementById('btn-close-detail')?.addEventListener('click', () => {
  document.getElementById('client-detail-panel').style.display = 'none';
  STATE.selectedClientId = null;
});

// ============================================
// 11. MÓDULO REPORTES
// ============================================

async function loadCierreDiario() {
  if (!STATE.apiOnline) return;
  const fecha = document.getElementById('report-date').value;
  try {
    const data = await fetch(`/api/reportes/cierre-diario?fecha=${fecha}`).then(r => r.json());
    
    document.getElementById('kpi-ventas').textContent = `${data.resumen.ingresos_totales_cop.toLocaleString()}`;
    document.getElementById('kpi-transacciones').textContent = `${data.resumen.total_transacciones} transacciones`;
    if (document.getElementById('kpi-cobranza')) {
      document.getElementById('kpi-cobranza').textContent = `${data.resumen.cobranza_deudas_cop.toLocaleString()}`;
      document.getElementById('kpi-flujo-caja').textContent = `Flujo Total: ${data.resumen.flujo_caja_ingresos.toLocaleString()}`;
    }
    
    document.getElementById('kpi-costo').textContent = `$${data.resumen.costo_produccion.toLocaleString()}`;
    document.getElementById('kpi-costo-cortesias').textContent = `+ Cortesías: $${data.resumen.costo_cortesias.toLocaleString()}`;
    
    document.getElementById('kpi-gastos').textContent = `$${data.resumen.gastos_operacionales.toLocaleString()}`;
    document.getElementById('kpi-diferencial').textContent = `Dif. Cambiario: ${data.resumen.diferencial_cambiario > 0 ? '+' : ''}$${data.resumen.diferencial_cambiario.toLocaleString()}`;
    
    document.getElementById('kpi-utilidad').textContent = `$${data.resumen.utilidad_neta.toLocaleString()}`;
    
    const isProfit = data.resumen.utilidad_neta >= 0;
    document.getElementById('kpi-utilidad').style.color = isProfit ? 'var(--success)' : 'var(--danger)';
    document.getElementById('kpi-margen').textContent = isProfit ? 'Ganancia' : 'Pérdida';

    // Desglose pagos
    const tbodyPagos = document.getElementById('tbody-pagos-diario');
    if (data.desglose_pagos.length === 0) {
      tbodyPagos.innerHTML = '<tr><td colspan="5" class="loading-cell">Sin pagos registrados para esta fecha.</td></tr>';
    } else {
      tbodyPagos.innerHTML = data.desglose_pagos.map(p => `
        <tr>
          <td><strong>${p.metodo_pago}</strong></td>
          <td>${p.moneda}</td>
          <td>${p.cantidad_pagos}</td>
          <td>${parseFloat(p.total_original).toLocaleString()}</td>
          <td class="font-outfit">$${parseFloat(p.total_cop).toLocaleString()}</td>
        </tr>
      `).join('');
    }

    // Desglose de Gastos Operativos
    const gastosSection = document.getElementById('section-gastos-desglose');
    const tbodyGastos = document.getElementById('tbody-gastos-diario');
    if (data.desglose_gastos && data.desglose_gastos.length > 0) {
      // Render the table rows
      tbodyGastos.innerHTML = data.desglose_gastos.map(g => {
        const hora = new Date(g.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const catLabel = g.categoria === 'REPOSICION' ? '📦 Reposición (Stock)' 
                       : g.categoria === 'NOMINA' ? '👤 Nómina' 
                       : '💸 Gasto General';
        const catClass = g.categoria === 'REPOSICION' ? 'color:var(--warning)' 
                       : g.categoria === 'NOMINA' ? 'color:var(--info)' 
                       : 'color:var(--danger)';
        return `
          <tr>
            <td>${hora}</td>
            <td><span style="${catClass}; font-weight:600;">${catLabel}</span></td>
            <td>${g.descripcion || '—'}</td>
            <td>${g.moneda} ${parseFloat(g.monto).toLocaleString()}</td>
            <td>${g.metodo_pago || '—'}</td>
            <td class="font-outfit" style="color:var(--danger)">-$${parseFloat(g.monto_cop).toLocaleString()}</td>
          </tr>
        `;
      }).join('');
      
      // Update KPI sub-text to show count
      document.getElementById('kpi-diferencial').textContent = `${data.desglose_gastos.length} gasto(s) | Dif. Cambiario: ${data.resumen.diferencial_cambiario > 0 ? '+' : ''}$${data.resumen.diferencial_cambiario.toLocaleString()}`;
    } else {
      tbodyGastos.innerHTML = '<tr><td colspan="6" class="loading-cell">Sin gastos registrados para esta fecha.</td></tr>';
      gastosSection.style.display = 'none';
    }

    // Click handler for KPI card to toggle gastos desglose
    const kpiCardGastos = document.getElementById('kpi-card-gastos');
    // Remove old handler to avoid stacking
    const newKpiCard = kpiCardGastos.cloneNode(true);
    kpiCardGastos.parentNode.replaceChild(newKpiCard, kpiCardGastos);
    newKpiCard.addEventListener('click', () => {
      const section = document.getElementById('section-gastos-desglose');
      const isVisible = section.style.display !== 'none';
      section.style.display = isVisible ? 'none' : 'flex';
      // Animate the chevron icon
      const chevron = newKpiCard.querySelector('[data-lucide="chevron-down"], [data-lucide="chevron-up"]');
      if (chevron) {
        chevron.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
        chevron.style.transition = 'transform 0.3s ease';
      }
    });

    // Productos vendidos
    const tbodyProd = document.getElementById('tbody-productos-diario');
    if (data.productos_vendidos.length === 0) {
      tbodyProd.innerHTML = '<tr><td colspan="6" class="loading-cell">Sin productos vendidos.</td></tr>';
    } else {
      tbodyProd.innerHTML = data.productos_vendidos.map(p => {
        const ingreso = parseFloat(p.ingreso_total);
        const costo = parseFloat(p.costo_total);
        return `
          <tr>
            <td><strong>${p.nombre}</strong></td>
            <td>${p.categoria}</td>
            <td>${parseFloat(p.unidades_vendidas)}</td>
            <td class="font-outfit">$${ingreso.toLocaleString()}</td>
            <td>$${costo.toLocaleString()}</td>
            <td class="text-success font-outfit">$${(ingreso - costo).toLocaleString()}</td>
          </tr>
        `;
      }).join('');
    }

    // Alertas inventario
    const alertSection = document.getElementById('section-alertas-inv');
    const alertList = document.getElementById('alertas-inv-list');
    if (data.alertas_inventario.length > 0) {
      alertSection.style.display = 'flex';
      alertList.innerHTML = data.alertas_inventario.map(a => `
        <div class="alert-item alert-danger">
          <i data-lucide="alert-triangle"></i>
          <span><strong>${a.nombre}</strong>: Stock ${parseFloat(a.stock_actual)} ${a.unidad_medida} (mínimo: ${parseFloat(a.stock_minimo)})</span>
        </div>
      `).join('');
    } else {
      alertSection.style.display = 'none';
    }

    lucide.createIcons();
  } catch (err) {
    console.error('Error cargando cierre diario:', err);
  }
}

async function loadCierreSemanal() {
  if (!STATE.apiOnline) return;
  try {
    const data = await fetch('/api/reportes/cierre-semanal').then(r => r.json());

    const ingresos = data.resumen.ingresos_totales_cop || 0;
    const utilidad = data.resumen.utilidad_neta || 0;
    const margen = ingresos > 0 ? Math.round((utilidad / ingresos) * 100) : 0;

    document.getElementById('kpi-ventas-sem').textContent = `$${ingresos.toLocaleString()}`;
    document.getElementById('kpi-trans-sem').textContent = `${data.resumen.total_transacciones} transacciones`;
    document.getElementById('kpi-utilidad-sem').textContent = `$${utilidad.toLocaleString()}`;
    document.getElementById('kpi-margen-sem').textContent = `Margen: ${margen}%`;
    document.getElementById('kpi-utilidad-sem').style.color = utilidad >= 0 ? 'var(--success)' : 'var(--danger)';

    // Chart de barras
    const chartContainer = document.getElementById('chart-ventas-semana');
    if (data.ventas_por_dia.length > 0) {
      const maxVal = Math.max(...data.ventas_por_dia.map(d => parseFloat(d.total_cop) || 0));
      chartContainer.innerHTML = data.ventas_por_dia.map(d => {
        const val = parseFloat(d.total_cop) || 0;
        const height = maxVal > 0 ? Math.max(4, (val / maxVal) * 100) : 4;
        const dayName = new Date(d.dia + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short' });
        return `
          <div class="chart-bar-item">
            <span class="chart-bar-value">$${(val / 1000).toFixed(0)}k</span>
            <div class="chart-bar" style="height: ${height}%"></div>
            <span class="chart-bar-label">${dayName}</span>
          </div>
        `;
      }).join('');
    } else {
      chartContainer.innerHTML = '<div style="text-align:center; color:var(--color-muted); padding:40px; width:100%;">Sin datos para la semana.</div>';
    }

    // Top productos
    const tbody = document.getElementById('tbody-productos-semanal');
    if (data.productos_vendidos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Sin ventas esta semana.</td></tr>';
    } else {
      tbody.innerHTML = data.productos_vendidos.map(p => `
        <tr>
          <td><strong>${p.nombre}</strong></td>
          <td>${p.categoria}</td>
          <td>${parseFloat(p.unidades_vendidas)}</td>
          <td class="font-outfit">$${parseFloat(p.ingreso_total).toLocaleString()}</td>
          <td>$${parseFloat(p.costo_total).toLocaleString()}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Error cargando cierre semanal:', err);
  }
}

async function loadHistorial() {
  if (!STATE.apiOnline) return;
  const desde = document.getElementById('hist-desde').value;
  const hasta = document.getElementById('hist-hasta').value;
  try {
    const data = await fetch(`/api/reportes/ventas?desde=${desde}&hasta=${hasta}`).then(r => r.json());
    const tbody = document.getElementById('tbody-historial');
    
    if (!data.ventas || data.ventas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">Sin ventas en el rango seleccionado.</td></tr>';
      return;
    }

    tbody.innerHTML = data.ventas.map(v => {
      const prods = v.detalles ? v.detalles.map(d => `${d.producto} x${d.cantidad}`).join(', ') : '-';
      const metodos = v.pagos ? v.pagos.map(p => p.metodo_pago).join(', ') : '-';
      const isAnulada = v.tipo_transaccion === 'Anulada';
      const rowClass = isAnulada ? 'style="opacity:0.6; background-color:rgba(255,0,0,0.05);"' : '';
      const actionBtn = isAnulada 
        ? '<span class="text-danger" style="font-size:0.8rem; font-weight:bold;">ANULADA</span>' 
        : `<button class="btn btn-sm btn-outline-danger" style="display:flex; align-items:center; gap:5px; padding: 4px 8px; font-size: 0.8rem;" onclick="window.showAnularVentaModal(${v.id})" title="Anular Venta"><i data-lucide="x-circle" style="width:14px; height:14px;"></i> Anular</button>`;
        
      return `
        <tr ${rowClass}>
          <td>#${v.id}</td>
          <td>${new Date(v.fecha).toLocaleString('es-ES')}</td>
          <td class="font-outfit">$${parseFloat(v.total).toLocaleString()}</td>
          <td>${prods}</td>
          <td>${metodos}</td>
          <td>${v.notas || '-'}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    }).join('');
    lucide.createIcons();
  } catch (err) {
    console.error('Error cargando historial:', err);
  }
}

window.showAnularVentaModal = function(ventaId) {
  const formHtml = `
    <div style="text-align:center; margin-bottom: 20px;">
      <i data-lucide="alert-triangle" style="width:48px; height:48px; color:var(--danger); margin-bottom:10px;"></i>
      <h3 style="color:var(--danger); margin-bottom:10px;">¡Atención! Acción Irreversible</h3>
      <p style="font-size:0.9rem; color:var(--text-muted);">
        Estás a punto de anular la venta <strong>#${ventaId}</strong>.<br>
        Esto devolverá el inventario y revertirá los pagos en caja y crédito.
      </p>
    </div>
    <div class="form-group">
      <label>Contraseña de Administrador</label>
      <input type="password" id="admin-anular-pass" class="form-control" placeholder="Ingrese su contraseña" autocomplete="new-password">
    </div>
  `;
  
  openGenericModal('Anular Venta', formHtml, () => window.confirmarAnulacion(ventaId));
};

window.confirmarAnulacion = async function(ventaId) {
  const passInput = document.getElementById('admin-anular-pass');
  const password = passInput.value;
  
  if (!password) {
    showToast('Debe ingresar la contraseña de administrador.', 'warning');
    return;
  }
  
  DOM.btnSubmitGeneric.disabled = true;
  DOM.btnSubmitGeneric.innerHTML = '<i class="lucide-loader"></i> Anulando...';
  
  try {
    const res = await fetch(`/api/ventas/${ventaId}/anular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_password: password })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      showToast(data.mensaje, 'success');
      closeGenericModal();
      loadHistorial(); // Recargar la tabla
    } else {
      showToast(data.error || 'Error al anular la venta', 'danger');
    }
  } catch (err) {
    console.error(err);
    showToast('Error de conexión con el servidor', 'danger');
  } finally {
    DOM.btnSubmitGeneric.disabled = false;
    DOM.btnSubmitGeneric.innerHTML = 'Guardar'; // Restaura el texto original del botón
  }
}

// ============================================
// 12. MODALES CRUD (Genérico)
// ============================================

function openGenericModal(title, formHtml, onSubmit) {
  DOM.genericModalTitle.textContent = title;
  DOM.genericModalBody.innerHTML = formHtml;
  DOM.btnSubmitGeneric.onclick = onSubmit;
  DOM.genericModal.classList.add('open');
  lucide.createIcons();
}

function closeGenericModal() {
  DOM.genericModal.classList.remove('open');
}

function showAddInsumoModal() {
  openGenericModal('Agregar Insumo', `
    <div class="form-group"><label>Nombre</label><input type="text" id="inp-ins-nombre" placeholder="Ej: Proteína Whey Vainilla"></div>
    <div class="form-group"><label>Unidad de Medida</label><input type="text" id="inp-ins-unidad" placeholder="Ej: scoop, gr, ml, unidad"></div>
    <div class="rates-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
      <div class="form-group"><label>Stock Inicial</label><input type="number" id="inp-ins-stock" placeholder="0" min="0"></div>
      <div class="form-group"><label>Stock Mínimo</label><input type="number" id="inp-ins-minimo" placeholder="0" min="0"></div>
    </div>
    <div class="rates-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
      <div class="form-group"><label>Stock Fijo (Meta)</label><input type="number" id="inp-ins-fijo" placeholder="0" min="0"></div>
      <div class="form-group"><label>Costo Unitario (COP)</label><input type="number" id="inp-ins-costo" placeholder="0" min="0"></div>
    </div>
    <div class="form-group" style="margin-top: 10px;">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="inp-ins-batido" style="width:18px;height:18px;" onchange="document.getElementById('base-liquida-section-add').style.display = this.checked ? 'block' : 'none'"> 
        <strong>Disponible como opción para Batidos</strong>
      </label>
    </div>
    <div id="base-liquida-section-add" style="display:none; margin-top:10px; padding:12px; background:rgba(0,242,254,0.05); border:1px solid rgba(0,242,254,0.2); border-radius:8px;">
      <div class="form-group" style="margin-bottom:10px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="inp-ins-base-liquida" style="width:18px;height:18px;" onchange="document.getElementById('cantidades-base-add').style.display = (this.checked || document.getElementById('inp-ins-sabor-batido').checked) ? 'grid' : 'none'"> 
          <strong>🥛 Es Líquido/Base (Leche, Yogurt, Agua)</strong>
        </label>
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="inp-ins-sabor-batido" style="width:18px;height:18px;" onchange="document.getElementById('cantidades-base-add').style.display = (this.checked || document.getElementById('inp-ins-base-liquida').checked) ? 'grid' : 'none'"> 
          <strong>🍓 Es Sabor/Fruta (Fresa, Cambur, etc.)</strong>
        </label>
      </div>

      <div id="cantidades-base-add" style="display:none; grid-template-columns: 1fr 1fr; gap:10px;">
        <div class="form-group">
          <label>Cantidad Sola</label>
          <input type="number" id="inp-ins-cant-sola" placeholder="Ej: 1 o 150" min="0" step="any">
        </div>
        <div class="form-group">
          <label>Cantidad Combinada</label>
          <input type="number" id="inp-ins-cant-comb" placeholder="Ej: 0.5 o 75" min="0" step="any">
        </div>
      </div>
    </div>
  `, async () => {
    const payload = {
      nombre: document.getElementById('inp-ins-nombre').value,
      unidad_medida: document.getElementById('inp-ins-unidad').value,
      stock_actual: document.getElementById('inp-ins-stock').value,
      stock_minimo: document.getElementById('inp-ins-minimo').value,
      stock_fijo: document.getElementById('inp-ins-fijo').value,
      costo_unitario: document.getElementById('inp-ins-costo').value,
      es_para_batidos: document.getElementById('inp-ins-batido').checked,
      es_base_liquida: document.getElementById('inp-ins-base-liquida').checked,
      es_sabor_batido: document.getElementById('inp-ins-sabor-batido').checked,
      cantidad_sola: document.getElementById('inp-ins-cant-sola').value,
      cantidad_combinada: document.getElementById('inp-ins-cant-comb').value
    };
    try {
      const res = await fetch('/api/insumos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.status === 201) {
        showToast(data.mensaje, 'success');
        closeGenericModal();
        await loadInventarioData();
        renderProducts();
      } else {
        showToast(data.error, 'danger');
      }
    } catch (err) {
      showToast('Error de conexión', 'danger');
    }
  });
}

function showAddMermaModal() {
  const insOptions = STATE.insumos.map(i => `<option value="${i.id}">${i.nombre} (${i.stock_actual} ${i.unidad_medida})</option>`).join('');
  openGenericModal('Registrar Merma', `
    <div class="form-group"><label>Insumo</label><select id="inp-merma-insumo">${insOptions}</select></div>
    <div class="form-group"><label>Cantidad Perdida</label><input type="number" id="inp-merma-cantidad" placeholder="0" min="0.01" step="0.01"></div>
    <div class="form-group"><label>Motivo</label><input type="text" id="inp-merma-motivo" placeholder="Ej: Vencimiento, derrame, rotura"></div>
  `, async () => {
    const payload = {
      insumo_id: parseInt(document.getElementById('inp-merma-insumo').value),
      cantidad: document.getElementById('inp-merma-cantidad').value,
      motivo: document.getElementById('inp-merma-motivo').value
    };
    try {
      const res = await fetch('/api/mermas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.status === 201) {
        showToast(data.mensaje, 'success');
        closeGenericModal();
        await loadInventarioData();
        renderProducts();
      } else {
        showToast(data.error, 'danger');
      }
    } catch (err) {
      showToast('Error de conexión', 'danger');
    }
  });
}

window.showRestockModal = function(insumoId, nombre) {
  openGenericModal(`Reabastecer: ${nombre}`, `
    <div class="form-group"><label>Cantidad a Agregar</label><input type="number" id="inp-restock-qty" placeholder="0" min="0.01" step="0.01"></div>
    <div class="form-group"><label>Nuevo Costo Unitario (opcional)</label><input type="number" id="inp-restock-costo" placeholder="Dejar vacío para mantener el actual" min="0"></div>
    <div class="form-group" style="margin-top: 15px; border-top: 1px solid var(--border-color); padding-top: 15px;">
      <label>Método de Pago (Opcional - Para Flujo de Caja)</label>
      <select id="inp-restock-metodo">
        <option value="">-- No Registrar Gasto --</option>
        <option value="Efectivo COP">Efectivo COP</option>
        <option value="Efectivo USD">Efectivo USD</option>
        <option value="Bancolombia">Bancolombia</option>
        <option value="Zelle">Zelle</option>
        <option value="Pago Móvil">Pago Móvil</option>
        <option value="Binance">Binance</option>
      </select>
    </div>
    <div class="rates-grid" id="restock-currency-group" style="display:none; grid-template-columns: 1fr 1fr; gap:10px;">
      <div class="form-group"><label>Moneda</label><select id="inp-restock-moneda"><option value="COP">COP</option><option value="USD">USD</option><option value="VES">VES</option></select></div>
      <div class="form-group"><label>Tasa de Cambio</label><input type="number" id="inp-restock-tasa" value="1" step="0.1" min="0.1"></div>
    </div>
  `, async () => {
    const payload = {
      cantidad: document.getElementById('inp-restock-qty').value,
      costo_unitario: document.getElementById('inp-restock-costo').value || undefined,
      metodo_pago: document.getElementById('inp-restock-metodo').value,
      moneda: document.getElementById('inp-restock-moneda').value,
      tasa_cambio: document.getElementById('inp-restock-tasa').value
    };
    try {
      const res = await fetch(`/api/insumos/${insumoId}/restock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.ok) {
        showToast(data.mensaje, 'success');
        closeGenericModal();
        await loadInventarioData();
        renderProducts();
      } else {
        showToast(data.error, 'danger');
      }
    } catch (err) {
      showToast('Error de conexión', 'danger');
    }
  });

  setTimeout(() => {
    const selMetodo = document.getElementById('inp-restock-metodo');
    if (selMetodo) {
      selMetodo.addEventListener('change', (e) => {
        const grp = document.getElementById('restock-currency-group');
        grp.style.display = e.target.value !== "" ? 'grid' : 'none';
      });
    }
    const selMoneda = document.getElementById('inp-restock-moneda');
    if (selMoneda) {
      selMoneda.addEventListener('change', (e) => {
        const t = document.getElementById('inp-restock-tasa');
        if (e.target.value === 'COP') t.value = 1;
        else if (e.target.value === 'USD') t.value = STATE.tasas.USD;
        else if (e.target.value === 'VES') t.value = STATE.tasas.VES;
      });
    }
  }, 100);
};

// ============================================
// 11. MÓDULO TESORERÍA
// ============================================

async function loadTesoreriaData() {
  if (!STATE.apiOnline) return;
  try {
    const res = await fetch('/api/tesoreria/saldos');
    const data = await res.json();
    const grid = document.getElementById('tesoreria-saldos-grid');
    if (!data || data.length === 0) {
      grid.innerHTML = '<div class="kpi-card"><div class="kpi-value">Sin cuentas.</div></div>';
      return;
    }
    
    // Almacenar bancos para los selects del modal de transferencia
    STATE.bancos = data;

    grid.innerHTML = data.map(cta => {
      let icon = 'dollar-sign';
      if (cta.nombre.toLowerCase().includes('zelle')) icon = 'banknote';
      if (cta.nombre.toLowerCase().includes('binance')) icon = 'bitcoin';
      return `
        <div class="kpi-card">
          <div class="kpi-icon"><i data-lucide="${icon}"></i></div>
          <div class="kpi-label">${cta.nombre} (${cta.moneda})</div>
          <div class="kpi-value">${parseFloat(cta.saldo).toLocaleString(undefined, {minimumFractionDigits: 2})} ${cta.moneda}</div>
        </div>
      `;
    }).join('');
    lucide.createIcons();
  } catch (err) {
    console.error('Error cargando tesorería:', err);
  }
}

window.showTransferenciaModal = function() {
  const options = STATE.bancos ? STATE.bancos.map(b => `<option value="${b.nombre}">${b.nombre} (${b.moneda})</option>`).join('') : '';
  openGenericModal('Transferencia Interna', `
    <div class="form-group">
      <label>Cuenta de Origen (Sale el dinero)</label>
      <select id="trans-origen">${options}</select>
    </div>
    <div class="form-group">
      <label>Cuenta de Destino (Entra el dinero)</label>
      <select id="trans-destino">${options}</select>
    </div>
    <div class="rates-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
      <div class="form-group">
        <label>Monto a transferir (Moneda Origen)</label>
        <input type="number" id="trans-monto" min="0" step="0.01">
      </div>
      <div class="form-group">
        <label>Tasa de Cambio Aplicada</label>
        <input type="number" id="trans-tasa" value="1" min="0" step="0.01">
      </div>
    </div>
    <div class="form-group">
      <label>Motivo / Descripción</label>
      <input type="text" id="trans-motivo" placeholder="Ej. Compra de divisas">
    </div>
  `, async () => {
    const payload = {
      cuenta_origen: document.getElementById('trans-origen').value,
      cuenta_destino: document.getElementById('trans-destino').value,
      monto_origen: parseFloat(document.getElementById('trans-monto').value) || 0,
      tasa_cambio: parseFloat(document.getElementById('trans-tasa').value) || 1,
      motivo: document.getElementById('trans-motivo').value
    };
    try {
      const res = await fetch('/api/tesoreria/transferir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.mensaje, 'success');
        closeGenericModal();
        loadTesoreriaData();
      } else {
        showToast(data.error, 'danger');
      }
    } catch (e) {
      showToast('Error de conexión', 'danger');
    }
  });
};

// ============================================
// RESET TOTAL DEL SISTEMA
// ============================================
window.resetSistemaCompleto = async function() {
  // Primera confirmación
  const confirmar1 = confirm(
    '⚠️ ATENCIÓN: Vas a RESETEAR TODO el sistema.\n\n' +
    '• Stock de insumos → 0\n' +
    '• Todas las ventas serán ELIMINADAS\n' +
    '• Todas las cuentas por cobrar serán ELIMINADAS\n' +
    '• Gastos, mermas y sesiones de caja serán ELIMINADOS\n' +
    '• Saldos bancarios → 0\n\n' +
    '¿Estás seguro de continuar?'
  );
  if (!confirmar1) return;

  // Segunda confirmación: escribir "RESET TOTAL"
  const texto = prompt(
    '🔴 CONFIRMACIÓN FINAL\n\n' +
    'Para proceder, escribe exactamente:\n\nRESET TOTAL'
  );
  if (texto !== 'RESET TOTAL') {
    showToast('Reset cancelado. No escribiste "RESET TOTAL".', 'warning');
    return;
  }

  // Deshabilitar el botón mientras se procesa
  const btn = document.getElementById('btn-reset-sistema');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" style="width:18px;height:18px;"></i> Procesando Reset...';
    lucide.createIcons();
  }

  try {
    const res = await fetch('/api/reset-sistema', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmacion: 'RESET TOTAL' })
    });
    const data = await res.json();

    if (res.ok) {
      showToast('✅ ' + data.mensaje, 'success');
      // Recargar datos de todas las vistas
      if (typeof loadTesoreriaData === 'function') loadTesoreriaData();
      if (typeof loadCajaData === 'function') loadCajaData();
      if (typeof loadInventarioData === 'function') loadInventarioData();
      if (typeof loadClientesData === 'function') loadClientesData();
      if (typeof fetchProducts === 'function') fetchProducts();
    } else {
      showToast('❌ ' + (data.error || 'Error al resetear'), 'danger');
    }
  } catch (err) {
    showToast('❌ Error de conexión: ' + err.message, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="trash-2" style="width:18px;height:18px;"></i> Resetear Todo el Sistema';
      lucide.createIcons();
    }
  }
};

// ============================================
// MODIFICADORES (EXTRAS) EN POS
// ============================================
window.showAddExtraModal = function(index) {
  const item = STATE.cart[index];
  if (!item) return;
  const prod = STATE.products.find(p => p.id === item.producto_id);
  if (!prod) return;
  
  const options = STATE.insumos.map(ins => `<option value="${ins.id}" data-nombre="${ins.nombre}">${ins.nombre} (${ins.unidad_medida})</option>`).join('');
  
  openGenericModal(`Añadir Extra a ${prod.nombre}`, `
    <div class="form-group">
      <label>Insumo Adicional</label>
      <select id="extra-insumo">${options}</select>
    </div>
    <div class="rates-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
      <div class="form-group">
        <label>Cantidad (Ej: 1 scoop, 0.5 lt)</label>
        <input type="number" id="extra-cantidad" value="1" min="0.01" step="0.01">
      </div>
      <div class="form-group">
        <label>Precio Adicional (a cobrar) COP</label>
        <input type="number" id="extra-precio" value="0" min="0" step="100">
      </div>
    </div>
  `, async () => {
    const sel = document.getElementById('extra-insumo');
    const insumo_id = parseInt(sel.value);
    const nombre = sel.options[sel.selectedIndex].dataset.nombre;
    const cantidad = parseFloat(document.getElementById('extra-cantidad').value) || 1;
    const precio_adicional = parseFloat(document.getElementById('extra-precio').value) || 0;

    const cartItem = STATE.cart[index];
    if (cartItem) {
      if (!cartItem.extras) cartItem.extras = [];
      cartItem.extras.push({ insumo_id, nombre, cantidad, precio_adicional });
      renderCart();
      closeGenericModal();
    }
  });
};

window.removeExtra = function(index, extraIndex) {
  const cartItem = STATE.cart[index];
  if (cartItem && cartItem.extras) {
    cartItem.extras.splice(extraIndex, 1);
    renderCart();
  }
};

function showAddClienteModal() {
  openGenericModal('Nuevo Cliente', `
    <div class="form-group"><label>Nombre Completo</label><input type="text" id="inp-cli-nombre" placeholder="Ej: Juan Pérez"></div>
    <div class="form-group"><label>Identificación</label><input type="text" id="inp-cli-id" placeholder="Ej: V-12345678"></div>
    <div class="form-group"><label>Teléfono</label><input type="text" id="inp-cli-tel" placeholder="Ej: +57 300 123 4567"></div>
    <div class="form-group"><label>Límite de Crédito (COP)</label><input type="number" id="inp-cli-limite" placeholder="0" min="0"></div>
  `, async () => {
    const payload = {
      nombre: document.getElementById('inp-cli-nombre').value,
      identificacion: document.getElementById('inp-cli-id').value,
      telefono: document.getElementById('inp-cli-tel').value,
      limite_credito: document.getElementById('inp-cli-limite').value
    };
    try {
      const res = await fetch('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.status === 201) {
        showToast(data.mensaje, 'success');
        closeGenericModal();
        loadClientesData();
      } else {
        showToast(data.error, 'danger');
      }
    } catch (err) {
      showToast('Error de conexión', 'danger');
    }
  });
}

function showAbonoModal(clientId, clientName, saldoActual) {
  openGenericModal(`Registrar Abono — ${clientName}`, `
    <div class="alert-item alert-warning" style="margin-bottom:8px;">
      <i data-lucide="info"></i>
      <span>Saldo deudor actual: <strong>$${saldoActual.toLocaleString()} COP</strong></span>
    </div>
    <div class="form-group"><label>Método de Pago</label>
      <select id="inp-abono-metodo">
        <option value="Efectivo COP">Efectivo COP</option>
        <option value="Bancolombia">Bancolombia</option>
        <option value="Efectivo USD">Efectivo USD</option>
        <option value="Zelle">Zelle</option>
        <option value="Pago Móvil">Pago Móvil (VES)</option>
        <option value="Binance">Binance</option>
      </select>
    </div>
    <div class="form-group"><label>Monto a Abonar</label><input type="number" id="inp-abono-monto" placeholder="0" min="0.01" step="0.01"></div>
    <div class="form-group"><label>Referencia (opcional)</label><input type="text" id="inp-abono-ref" placeholder="Ref. transacción"></div>
    <div class="form-group"><label>Notas</label><input type="text" id="inp-abono-notas" placeholder="Ej: Abono parcial"></div>
  `, async () => {
    
    const methodEl = document.getElementById('inp-abono-metodo').value;
    let autoMoneda = 'COP';
    if (methodEl === 'Efectivo USD' || methodEl === 'Zelle' || methodEl === 'Binance') autoMoneda = 'USD';
    if (methodEl === 'Pago Móvil') autoMoneda = 'VES';
    
    const payload = {
      cliente_id: clientId,
      pagos: [{
        metodo_pago: methodEl,
        moneda: autoMoneda,
        monto_original: parseFloat(document.getElementById('inp-abono-monto').value),
        referencia: document.getElementById('inp-abono-ref').value
      }],
      tasas: STATE.tasas,
      notas: document.getElementById('inp-abono-notas').value
    };
    try {
      const res = await fetch('/api/abonos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.status === 201) {
        showToast(data.mensaje, 'success');
        closeGenericModal();
        loadClientesData();
        loadClientDetail(clientId);
      } else {
        showToast(data.error, 'danger');
      }
    } catch (err) {
      showToast('Error de conexión', 'danger');
    }
  });
}

// ============================================
// 13. FUNCIONES AUXILIARES
// ============================================

async function loadProductsFromAPI() {
  try {
    const [data, insumosRes] = await Promise.all([
      fetch('/api/productos').then(r => r.json()),
      fetch('/api/insumos').then(r => r.ok ? r.json() : [])
    ]);
    
    if (insumosRes && insumosRes.length > 0) {
      STATE.insumos = insumosRes;
      STATE._allInsumos = insumosRes;
    }
    
    if (data.productos) {
      STATE.products = data.productos.map(p => ({
        id: p.id,
        nombre: p.nombre,
        precio_venta: parseFloat(p.precio_venta),
        costo_produccion: parseFloat(p.costo_produccion),
        categoria: p.categoria || 'General',
        stock: p.stock_disponible || 0,
        stock_disponible: p.stock_disponible || 0,
        es_batido: p.es_batido ? 1 : 0
      }));

      // Actualizar categorías dinámicamente
      const cats = [...new Set(STATE.products.map(p => p.categoria))];
      STATE.categories = [
        { id: 'todos', nombre: 'Todos', icon: 'layout-grid' },
        ...cats.map(c => ({
          id: c,
          nombre: c,
          icon: getCategoryIcon(c)
        }))
      ];

      renderCategories();
      renderProducts();
    }
  } catch (err) {
    console.error('Error al cargar productos desde API:', err);
  }
}


window.showRegistrarDeudaModal = function(clientId, clientName, saldoActual, limiteCredito) {
  const disponible = Math.max(0, limiteCredito - saldoActual);
  openGenericModal(`Registrar Deuda — ${clientName}`, `
    <div class="alert-item alert-warning" style="margin-bottom:8px;">
      <i data-lucide="info"></i>
      <span>Saldo deudor actual: <strong>$${saldoActual.toLocaleString()} COP</strong> | Límite: <strong>$${limiteCredito.toLocaleString()}</strong> | Disponible: <strong>$${disponible.toLocaleString()}</strong></span>
    </div>
    <div class="form-group"><label>Monto de la Deuda (COP)</label><input type="number" id="inp-deuda-monto" placeholder="0" min="0.01" step="0.01"></div>
    <div class="form-group"><label>Notas / Concepto</label><input type="text" id="inp-deuda-notas" placeholder="Ej: Consumo pendiente, préstamo, etc."></div>
  `, async () => {
    const monto = parseFloat(document.getElementById('inp-deuda-monto').value);
    const notas = document.getElementById('inp-deuda-notas').value;
    if (!monto || monto <= 0) { showToast('Ingresa un monto válido', 'danger'); return; }
    try {
      const res = await fetch(`/api/clientes/${clientId}/deuda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto, notas })
      });
      const data = await res.json();
      if (res.status === 201) {
        showToast(data.mensaje + ` Nuevo saldo: $${data.nuevo_saldo.toLocaleString()}`, 'success');
        closeGenericModal();
        loadClientesData();
        if (STATE.selectedClientId === clientId) loadClientDetail(clientId);
      } else {
        showToast(data.error, 'danger');
      }
    } catch (err) {
      showToast('Error de conexión', 'danger');
    }
  });
};

function getCategoryIcon(category) {
  const icons = {
    'Batidos': 'cup-soda',
    'Nevera': 'refrigerator',
    'Extras': 'plus-circle',
    'Meriendas': 'cookie',
    'General': 'tag'
  };
  return icons[category] || 'tag';
}

async function checkApiHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.status === 'ok') {
      STATE.apiOnline = true;
      DOM.apiStatusBadge.className = 'badge badge-online';
      DOM.apiStatusBadge.innerHTML = '<i data-lucide="wifi"></i><span class="status-text">Conectado</span>';
      
      DOM.sidebarApiStatus.className = 'sidebar-status online';
      DOM.sidebarApiStatus.innerHTML = '<i data-lucide="wifi"></i><span>Servidor Online</span>';

      // Cargar productos del servidor al conectar por primera vez
      if (!STATE._productsLoaded) {
        STATE._productsLoaded = true;
        await loadProductsFromAPI();
      }
    }
  } catch (err) {
    STATE.apiOnline = false;
    DOM.apiStatusBadge.className = 'badge badge-offline';
    DOM.apiStatusBadge.innerHTML = '<i data-lucide="wifi-off"></i><span class="status-text">Modo Local</span>';
    
    DOM.sidebarApiStatus.className = 'sidebar-status offline';
    DOM.sidebarApiStatus.innerHTML = '<i data-lucide="wifi-off"></i><span>Modo Local</span>';
  }
  lucide.createIcons();
}

function updateTime() {
  const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  const timeStr = new Date().toLocaleDateString('es-ES', options);
  DOM.liveTime.textContent = timeStr;
  DOM.sidebarTime.textContent = timeStr;
}

function showOfflineMessage(tbodyId, cols) {
  document.getElementById(tbodyId).innerHTML = `<tr><td colspan="${cols}" class="loading-cell">⚠️ Servidor desconectado. Inicia el servidor con <code>node server.js</code> para ver datos.</td></tr>`;
}

// Toast notification sencilla
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 9999;
    padding: 12px 20px; border-radius: 10px; font-size: 0.82rem; font-weight: 600;
    max-width: 360px; animation: slideIn 0.3s ease; font-family: var(--font-sans);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  `;
  
  const colors = {
    success: 'background: rgba(0, 230, 118, 0.15); border: 1px solid rgba(0, 230, 118, 0.4); color: #00e676;',
    warning: 'background: rgba(255, 179, 0, 0.15); border: 1px solid rgba(255, 179, 0, 0.4); color: #ffb300;',
    danger: 'background: rgba(255, 23, 68, 0.15); border: 1px solid rgba(255, 23, 68, 0.4); color: #ff5252;',
    info: 'background: rgba(0, 242, 254, 0.15); border: 1px solid rgba(0, 242, 254, 0.4); color: #00f2fe;'
  };
  
  toast.style.cssText += colors[type] || colors.info;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================
// 12. MÓDULO CAJA Y GASTOS
// ============================================

async function loadCajaData() {
  if (!STATE.apiOnline) {
    document.getElementById('arqueo-estado-container').innerHTML = '<div class="loading-cell">Modo Local. Conecta al servidor para usar la Caja.</div>';
    return;
  }
  try {
    const res = await fetch('/api/caja/estado');
    const data = await res.json();
    const container = document.getElementById('arqueo-estado-container');

    if (data.abierta) {
      currentSessionId = data.sesion.id;
      const turno = data.sesion.turno || 'Mañana';
      const cajero = data.sesion.nombre_cajero || data.sesion.usuario_nombre || 'Cajero';
      const emoji = turno === 'Tarde' ? '🌆' : '🌅';
      
      const fondoBase = parseFloat(data.sesion.fondo_inicial_cop) || 0;
      const arqueo = data.arqueo || { ingresos_moneda: {}, ingresos_detalle: {}, total_gastos_cop: 0 };
      
      const ventasDetalle = arqueo.ventas_detalle || arqueo.ingresos_detalle || {};
      const abonosDetalle = arqueo.abonos_detalle || {};
      const ventasMoneda = arqueo.ventas_moneda || arqueo.ingresos_moneda || {};
      const abonosMoneda = arqueo.abonos_moneda || {};

      const copTotal = (arqueo.ingresos_moneda.COP || 0);
      const copEfectivoVenta = (ventasDetalle.COP?.['Efectivo COP'] || 0);
      const copEfectivoAbono = (abonosDetalle.COP?.['Efectivo COP'] || 0);
      const copCredito = (ventasDetalle.COP?.['Crédito'] || 0);
      const copBancos = copTotal - copEfectivoVenta - copEfectivoAbono - copCredito;
      const gastosCop = arqueo.total_gastos_cop || 0;
      const copCajaNeto = fondoBase + copEfectivoVenta + copEfectivoAbono - gastosCop; 

      const usdTotal = (arqueo.ingresos_moneda.USD || 0);
      const usdEfectivoVenta = (ventasDetalle.USD?.['Efectivo USD'] || 0);
      const usdEfectivoAbono = (abonosDetalle.USD?.['Efectivo USD'] || 0);
      const usdZelleVenta = (ventasDetalle.USD?.['Zelle'] || 0);
      const usdZelleAbono = (abonosDetalle.USD?.['Zelle'] || 0);
      const usdBinanceVenta = (ventasDetalle.USD?.['Binance'] || 0);
      const usdBinanceAbono = (abonosDetalle.USD?.['Binance'] || 0);
      
      const usdZelleTotal = (arqueo.ingresos_detalle.USD?.['Zelle'] || 0);
      const usdBinanceTotal = (arqueo.ingresos_detalle.USD?.['Binance'] || 0);
      
      const fondoBaseUsd = parseFloat(data.sesion.fondo_inicial_usd) || 0;
      const usdCajaNeto = fondoBaseUsd + usdEfectivoVenta + usdEfectivoAbono;

      const vesTotal = (arqueo.ingresos_moneda.VES || 0);
      const vesVenta = (ventasMoneda.VES || 0);
      const vesAbono = (abonosMoneda.VES || 0);

      container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; background: rgba(0, 230, 118, 0.05); border: 1px solid var(--accent-green); padding:15px; border-radius:12px; margin-bottom:20px;">
          <div>
            <span style="font-size:14px; color:var(--text-dim)">Estado: <strong>Caja Abierta</strong></span><br>
            <span style="font-size:18px; font-weight:bold;">${emoji} Turno ${turno} — ${cajero}</span>
          </div>
          <button class="action-btn btn-danger" onclick="cerrarTurnoActual()">
            <i data-lucide="square"></i> Cerrar Caja
          </button>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; margin-bottom:20px;">
          
          <!-- Tarjeta COP -->
          <div class="kpi-card" style="background: linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(0,255,200,0.05) 100%); border-top: 3px solid var(--success); display:block; padding: 20px; transition: transform 0.2s ease;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
              <h3 style="margin:0; color:var(--success);">🇨🇴 COP (Pesos)</h3>
              <i data-lucide="coins" style="color:var(--success)"></i>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Base Inicial (Efvo):</span> <span style="color:var(--success)">+$${fondoBase.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Efectivo:</span> <span style="color:var(--success)">+${copEfectivoVenta.toLocaleString()}</span></div>
            ${copEfectivoAbono > 0 ? `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Deudas Cobradas (Efvo):</span> <span style="color:var(--success)">+${copEfectivoAbono.toLocaleString()}</span></div>` : ''}
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--danger);"><span>Gastos (Efvo):</span> <span>-${gastosCop.toLocaleString()}</span></div>
            <hr style="border-color:rgba(255,255,255,0.1); margin: 10px 0;">
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:18px; color:var(--text-bright);"><span>Físico a entregar:</span> <span>$${copCajaNeto.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:10px; color:var(--text-dim);"><span>Bancos/Nequi (Digital):</span> <span>$${copBancos.toLocaleString()}</span></div>
          </div>

          <!-- Tarjeta USD -->
          <div class="kpi-card" style="background: linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(50,200,255,0.05) 100%); border-top: 3px solid #32c8ff; display:block; padding: 20px; transition: transform 0.2s ease;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
              <h3 style="margin:0; color:#32c8ff;">🇺🇸 USD (Dólares)</h3>
              <i data-lucide="dollar-sign" style="color:#32c8ff"></i>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Base Inicial (Efvo):</span> <span style="color:#32c8ff">+$${fondoBaseUsd.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Efectivo:</span> <span style="color:#32c8ff">+${usdEfectivoVenta.toLocaleString()}</span></div>
            ${usdEfectivoAbono > 0 ? `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Deudas Cobradas (Efvo):</span> <span style="color:#32c8ff">+${usdEfectivoAbono.toLocaleString()}</span></div>` : ''}
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--text-dim);"><span>(No restan gastos)</span></div>
            <hr style="border-color:rgba(255,255,255,0.1); margin: 10px 0;">
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:18px; color:var(--text-bright);"><span>Físico a entregar:</span> <span>${usdCajaNeto.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:10px; color:var(--text-dim);"><span>Zelle (Digital):</span> <span>${usdZelleTotal.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:5px; color:var(--text-dim);"><span>Binance (Digital):</span> <span>${usdBinanceTotal.toLocaleString()}</span></div>
          </div>

          <!-- Tarjeta VES -->
          <div class="kpi-card" style="background: linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,150,50,0.05) 100%); border-top: 3px solid #ff9632; display:block; padding: 20px; transition: transform 0.2s ease;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
              <h3 style="margin:0; color:#ff9632;">🇻🇪 VES (Bolívares)</h3>
              <i data-lucide="smartphone" style="color:#ff9632"></i>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Pago Móvil:</span> <span style="color:#ff9632">+Bs.${vesVenta.toLocaleString()}</span></div>
            ${vesAbono > 0 ? `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Deudas Cobradas:</span> <span style="color:#ff9632">+Bs.${vesAbono.toLocaleString()}</span></div>` : ''}
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--text-dim);"><span>(100% Digital)</span></div>
            <hr style="border-color:rgba(255,255,255,0.1); margin: 10px 0;">
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:18px; color:var(--text-bright);"><span>Total Pago Móvil:</span> <span>Bs.${vesTotal.toLocaleString()}</span></div>
          </div>

        </div>
      `;
    } else {
      currentSessionId = null;
      container.innerHTML = `
        <div class="kpi-card" style="background: rgba(255, 68, 68, 0.05); border: 1px solid var(--danger); margin-bottom:15px;">
          <div class="kpi-icon"><i data-lucide="lock"></i></div>
          <div class="kpi-data">
            <span class="kpi-label">Estado</span>
            <span class="kpi-value text-danger">Caja Cerrada</span>
            <span class="kpi-sub">No hay un turno activo en este momento.</span>
          </div>
        </div>
        <button class="action-btn btn-success" style="width:100%; margin-top:10px;" onclick="showTurnoScreen()">
          <i data-lucide="play"></i> Abrir Nuevo Turno
        </button>
      `;
    }
    
    lucide.createIcons();
    // Cargar también los gastos
    loadGastos();
  } catch (err) {
    console.error('Error cargando estado de caja', err);
  }
}

function cerrarTurnoActual() {
  DOM.genericModalTitle.innerHTML = '<i data-lucide="square"></i> Cerrar Caja';
  DOM.genericModalBody.innerHTML = `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
      <div class="form-group">
        <label>Bs Digital / Pago Móvil (VES)</label>
        <input type="number" id="caja-dec-bs" value="0" min="0" step="any">
      </div>
      <div class="form-group">
        <label>Zelle (USD)</label>
        <input type="number" id="caja-dec-zelle" value="0" min="0" step="any">
      </div>
      <div class="form-group">
        <label>Binance (USD)</label>
        <input type="number" id="caja-dec-binance" value="0" min="0" step="any">
      </div>
      <div class="form-group">
        <label>Pesos Efectivo (COP)</label>
        <input type="number" id="caja-dec-pesos" value="0" min="0" step="any">
      </div>
      <div class="form-group" style="grid-column: 1 / -1;">
        <label>Bancolombia (COP)</label>
        <input type="number" id="caja-dec-bancolombia" value="0" min="0" step="any">
      </div>
    </div>
    <div class="payment-status-box status-warn" style="margin-top:10px;">
      <div class="status-header">
        <i data-lucide="alert-triangle"></i>
        <span>Atención</span>
      </div>
      <p>Una vez cerrada la caja, el sistema cerrará la sesión y regresará a la pantalla de selección de turno.</p>
    </div>
  `;
  lucide.createIcons();
  
  DOM.btnSubmitGeneric.onclick = async () => {
    try {
      const dec_bs = parseFloat(document.getElementById('caja-dec-bs').value) || 0;
      const dec_zelle = parseFloat(document.getElementById('caja-dec-zelle').value) || 0;
      const dec_binance = parseFloat(document.getElementById('caja-dec-binance').value) || 0;
      const dec_pesos = parseFloat(document.getElementById('caja-dec-pesos').value) || 0;
      const dec_bancolombia = parseFloat(document.getElementById('caja-dec-bancolombia').value) || 0;

      const rateUsd = STATE.tasas.USD || 1;
      const rateVes = STATE.tasas.VES || 1;
      
      const monto_declarado_cop = dec_pesos + dec_bancolombia + (dec_zelle * rateUsd) + (dec_binance * rateUsd) + (dec_bs * rateVes);

      const res = await fetch('/api/caja/cerrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          monto_declarado_cop,
          declarado_efectivo_bs: dec_bs,
          declarado_zelle: dec_zelle,
          declarado_binance: dec_binance,
          declarado_efectivo_pesos: dec_pesos,
          declarado_bancolombia: dec_bancolombia
        })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      closeGenericModal();
      
      // Mostrar resumen de cierre
      showToast(`✅ Caja cerrada. Ventas: $${d.resumen.total_ventas.toLocaleString()} COP | Gastos: $${d.resumen.total_gastos.toLocaleString()} COP | Diferencia: $${d.resumen.diferencia.toLocaleString()} COP`, 'success');
      
      // Regresar a pantalla de turno luego de 2 segundos
      setTimeout(() => showTurnoScreen(), 2000);
      
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };
  DOM.genericModal.classList.add('open');
}


async function loadGastos() {
  if (!STATE.apiOnline) return;
  try {
    const res = await fetch('/api/gastos');
    const data = await res.json();
    const tbody = document.getElementById('tbody-gastos');
    if (!data.gastos || data.gastos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No hay gastos registrados hoy.</td></tr>';
      return;
    }
    tbody.innerHTML = data.gastos.map(g => `
      <tr>
        <td>${new Date(g.fecha).toLocaleString()}</td>
        <td><span class="category-tag">${g.categoria}</span></td>
        <td>${g.descripcion}</td>
        <td>${g.moneda} ${parseFloat(g.monto).toLocaleString()}</td>
        <td>${parseFloat(g.tasa_cambio)}</td>
        <td class="font-outfit" style="color:var(--danger)">-$${parseFloat(g.monto_cop).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error cargando gastos', err);
  }
}

function showAddGastoModal() {
  openGenericModal('Registrar Gasto Operacional', `
    <div class="form-group">
      <label>Categoría</label>
      <select id="gasto-categoria">
        <option value="NOMINA">Nómina / Pago Empleados</option>
        <option value="GASTOS">Gasto General</option>
        <option value="REPOSICION">Reposición Extra</option>
      </select>
    </div>
    <div class="form-group">
      <label>Descripción</label>
      <input type="text" id="gasto-descripcion" placeholder="Ej. Pago Juan, Artículos Limpieza">
    </div>
    <div class="rates-grid" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px;">
      <div class="form-group">
        <label>Moneda</label>
        <select id="gasto-moneda">
          <option value="COP">COP</option>
          <option value="USD">USD</option>
          <option value="VES">VES</option>
        </select>
      </div>
      <div class="form-group">
        <label>Monto</label>
        <input type="number" id="gasto-monto" value="0" min="0">
      </div>
      <div class="form-group">
        <label>Tasa Aplicada</label>
        <input type="number" id="gasto-tasa" value="1" min="0.1" step="0.1">
      </div>
    </div>
    <div class="form-group" style="margin-top:10px;">
      <label>Método de Pago (Cuenta Bancaria)</label>
      <select id="gasto-metodo">
        <option value="Efectivo COP">Efectivo COP</option>
        <option value="Efectivo USD">Efectivo USD</option>
        <option value="Bancolombia">Bancolombia</option>
        <option value="Zelle">Zelle</option>
        <option value="Pago Móvil">Pago Móvil</option>
        <option value="Binance">Binance</option>
      </select>
    </div>
    <p style="font-size:0.8rem; color:var(--color-muted); margin-top:5px;">Si es COP, la tasa es 1.</p>
  `, async () => {
    const payload = {
      categoria: document.getElementById('gasto-categoria').value,
      descripcion: document.getElementById('gasto-descripcion').value,
      monto: parseFloat(document.getElementById('gasto-monto').value) || 0,
      moneda: document.getElementById('gasto-moneda').value,
      tasa_cambio: parseFloat(document.getElementById('gasto-tasa').value) || 1,
      metodo_pago: document.getElementById('gasto-metodo').value
    };
    try {
      const res = await fetch('/api/gastos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if(res.ok) { showToast('Gasto registrado', 'success'); loadGastos(); closeGenericModal(); }
      else { const d = await res.json(); showToast(d.error || 'Error', 'danger'); }
    } catch(e) { console.error(e); }
  });
  
  // Logic to auto-fill Tasa when changing currency
  document.getElementById('gasto-moneda').addEventListener('change', (e) => {
    const t = document.getElementById('gasto-tasa');
    if (e.target.value === 'COP') t.value = 1;
    else if (e.target.value === 'USD') t.value = STATE.tasas.USD;
    else if (e.target.value === 'VES') t.value = STATE.tasas.VES;
  });
}

// CSS animation para toast
const style = document.createElement('style');
style.textContent = `@keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
document.head.appendChild(style);

function showEditInsumoModal(id) {
  const ins = STATE.insumos.find(i => i.id === id);
  if (!ins) return;
  const esBaseLiquida = ins.es_base_liquida ? true : false;
  const esBatido = ins.es_para_batidos ? true : false;
  openGenericModal(`Editar Insumo: ${ins.nombre}`, `
    <div class="form-group">
      <label>Nombre del Insumo</label>
      <input type="text" id="edit-ins-nombre" value="${ins.nombre}">
    </div>
    <div class="form-group">
      <label>Unidad de Medida</label>
      <input type="text" id="edit-ins-unidad" value="${ins.unidad_medida}">
    </div>
    <div class="rates-grid" style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:10px;">
      <div class="form-group">
        <label>Stock Actual</label>
        <input type="number" id="edit-ins-actual" value="${ins.stock_actual}" min="0" step="any">
      </div>
      <div class="form-group">
        <label>Stock Mínimo</label>
        <input type="number" id="edit-ins-min" value="${ins.stock_minimo}" min="0" step="any">
      </div>
      <div class="form-group">
        <label>Stock Fijo</label>
        <input type="number" id="edit-ins-fijo" value="${ins.stock_fijo}" min="0" step="any">
      </div>
      <div class="form-group">
        <label>Costo Unit.</label>
        <input type="number" id="edit-ins-costo" value="${ins.costo_unitario}" min="0" step="any">
      </div>
    </div>
    <div class="form-group" style="margin-top: 10px;">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="edit-ins-batido" style="width:18px;height:18px;" ${esBatido ? 'checked' : ''} onchange="document.getElementById('base-liquida-section-edit').style.display = this.checked ? 'block' : 'none'"> 
        <strong>Disponible como opción para Batidos</strong>
      </label>
    </div>
    <div id="base-liquida-section-edit" style="display:${esBatido ? 'block' : 'none'}; margin-top:10px; padding:12px; background:rgba(0,242,254,0.05); border:1px solid rgba(0,242,254,0.2); border-radius:8px;">
      <div class="form-group" style="margin-bottom:10px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="edit-ins-base-liquida" style="width:18px;height:18px;" ${esBaseLiquida ? 'checked' : ''} onchange="document.getElementById('cantidades-base-edit').style.display = (this.checked || document.getElementById('edit-ins-sabor-batido').checked) ? 'grid' : 'none'"> 
          <strong>🥛 Es Líquido/Base (Leche, Yogurt, Agua)</strong>
        </label>
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="edit-ins-sabor-batido" style="width:18px;height:18px;" ${ins.es_sabor_batido ? 'checked' : ''} onchange="document.getElementById('cantidades-base-edit').style.display = (this.checked || document.getElementById('edit-ins-base-liquida').checked) ? 'grid' : 'none'"> 
          <strong>🍓 Es Sabor/Fruta (Fresa, Cambur, etc.)</strong>
        </label>
      </div>

      <div id="cantidades-base-edit" style="display:${(esBaseLiquida || ins.es_sabor_batido) ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap:10px;">
        <div class="form-group">
          <label>Cantidad Sola</label>
          <input type="number" id="edit-ins-cant-sola" value="${parseFloat(ins.cantidad_sola) || 0}" min="0" step="any">
        </div>
        <div class="form-group">
          <label>Cantidad Combinada</label>
          <input type="number" id="edit-ins-cant-comb" value="${parseFloat(ins.cantidad_combinada) || 0}" min="0" step="any">
        </div>
      </div>
    </div>
  `, async () => {
    const payload = {
      nombre: document.getElementById('edit-ins-nombre').value,
      unidad_medida: document.getElementById('edit-ins-unidad').value,
      stock_actual: parseFloat(document.getElementById('edit-ins-actual').value) || 0,
      stock_minimo: parseFloat(document.getElementById('edit-ins-min').value) || 0,
      stock_fijo: parseFloat(document.getElementById('edit-ins-fijo').value) || 0,
      costo_unitario: parseFloat(document.getElementById('edit-ins-costo').value) || 0,
      es_para_batidos: document.getElementById('edit-ins-batido').checked,
      es_base_liquida: document.getElementById('edit-ins-base-liquida').checked,
      es_sabor_batido: document.getElementById('edit-ins-sabor-batido').checked,
      cantidad_sola: parseFloat(document.getElementById('edit-ins-cant-sola').value) || 0,
      cantidad_combinada: parseFloat(document.getElementById('edit-ins-cant-comb').value) || 0
    };
    try {
      const res = await fetch(`/api/insumos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if(res.ok) {
        showToast('Insumo actualizado exitosamente', 'success');
        closeGenericModal();
        await loadInventarioData();
        renderProducts();
      } else {
        showToast(data.error || 'Error al actualizar', 'danger');
      }
    } catch(e) { console.error(e); }
  });
}

// ============================================
// 11. MÓDULO CAJA Y GASTOS
// ============================================

let currentSessionId = null;

// Old duplicate code removed


// ============================================
// 12. SISTEMA DE TURNOS / ACCESO
// ============================================

const TURNO_STATE = {
  usuarios: [],
  sesionActiva: null
};

/**
 * Punto de entrada: verifica si hay sesión activa.
 * Si la hay, oculta la pantalla de turno y entra directo.
 * Si no, muestra la pantalla de selección.
 */
async function initTurnoSystem() {
  const turnoScreen = document.getElementById('turno-screen');
  
  try {
    const res = await fetch('/api/caja/estado');
    const data = await res.json();
    
    if (data.abierta) {
      // Hay sesión activa: reanudar sin pedir turno
      TURNO_STATE.sesionActiva = data.sesion;
      const banner = document.getElementById('session-resume-banner');
      if (banner) banner.style.display = 'block';
      
      // Breve pausa para mostrar el mensaje de reanudación
      setTimeout(() => {
        hideTurnoScreen(data.sesion);
      }, 1200);
    } else {
      // Sin sesión: mostrar pantalla de turno
      await loadTurnoUsuarios();
      setupTurnoForm();
    }
  } catch (err) {
    // Si el servidor no está disponible, mostrar pantalla de turno de todas formas
    console.warn('No se pudo verificar estado de caja:', err);
    await loadTurnoUsuarios();
    setupTurnoForm();
  }
}

/**
 * Carga los usuarios de la BD y los muestra en el select de cajero.
 */
async function loadTurnoUsuarios() {
  const select = document.getElementById('turno-cajero-select');
  try {
    const res = await fetch('/api/usuarios');
    const usuarios = await res.json();
    TURNO_STATE.usuarios = usuarios;
    
    select.innerHTML = '';
    
    // Usuarios existentes
    usuarios.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.nombre} (${u.turno})`;
      opt.dataset.turno = u.turno;
      select.appendChild(opt);
    });
    
    // Seleccionar el primero real si existe
    if (usuarios.length > 0) {
      select.value = usuarios[0].id;
      syncTurnoRadioFromUser(usuarios[0].turno);
    }
  } catch (err) {
    select.innerHTML = '<option value="">Error cargando usuarios</option>';
  }
}

/**
 * Sincroniza el selector visual de turno cuando se elige un usuario
 */
function syncTurnoRadioFromUser(turno) {
  const radioManana = document.getElementById('radio-manana');
  const radioTarde = document.getElementById('radio-tarde');
  if (turno === 'Tarde') {
    radioTarde.checked = true;
    radioManana.checked = false;
  } else {
    radioManana.checked = true;
    radioTarde.checked = false;
  }
}

/**
 * Configura todos los listeners del formulario de turno (con contraseña)
 */
function setupTurnoForm() {
  const select = document.getElementById('turno-cajero-select');
  const passField = document.getElementById('turno-pass-field');
  const passInput = document.getElementById('turno-password');
  const btnIniciar = document.getElementById('btn-iniciar-turno');

  // Cuando cambia el cajero seleccionado
  select?.addEventListener('change', () => {
    const val = select.value;
    if (passField) passField.style.display = 'block';
    // Limpiar contraseña al cambiar de usuario
    if (passInput) { passInput.value = ''; passInput.classList.remove('input-error'); }
    // Sincronizar turno visual
    const user = TURNO_STATE.usuarios.find(u => String(u.id) === val);
    if (user) syncTurnoRadioFromUser(user.turno);
  });

  // Botón iniciar turno
  btnIniciar?.addEventListener('click', iniciarTurno);

  // Enter en campo de contraseña también inicia turno
  passInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') iniciarTurno();
  });

  // Botones ojo (ver/ocultar contraseña)
  document.querySelectorAll('.pass-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.innerHTML = isPassword
        ? '<i data-lucide="eye-off"></i>'
        : '<i data-lucide="eye"></i>';
      lucide.createIcons();
      input.focus();
    });
  });

  lucide.createIcons();
}

/**
 * Procesa el inicio de turno con validación de contraseña
 */
async function iniciarTurno() {
  const btnIniciar = document.getElementById('btn-iniciar-turno');
  const errorEl = document.getElementById('turno-error');
  const select = document.getElementById('turno-cajero-select');
  const fondoInput = document.getElementById('turno-fondo');
  const passInput = document.getElementById('turno-password');
  const turnoSeleccionado = document.querySelector('input[name="turno-sel"]:checked')?.value || 'Mañana';

  errorEl.classList.remove('visible');
  if (passInput) passInput.classList.remove('input-error');
  btnIniciar.disabled = true;
  btnIniciar.innerHTML = '<i data-lucide="loader"></i> Verificando...';
  lucide.createIcons();

  try {
    let usuarioId;
    let nombreCajero;

    // ── CAJERO EXISTENTE — validar contraseña ─────────
    usuarioId = parseInt(select.value);
    const user = TURNO_STATE.usuarios.find(u => u.id === usuarioId);
    nombreCajero = user?.nombre || 'Cajero';

    const password = passInput?.value || '';
    if (!password) {
      // Hacer shake en el campo de contraseña
      if (passInput) {
        passInput.classList.add('input-error');
        const wrap = passInput.closest('.pass-input-wrap') || passInput.parentElement;
        wrap.classList.add('shake-anim');
        setTimeout(() => wrap.classList.remove('shake-anim'), 600);
        passInput.focus();
      }
      throw new Error('Por favor ingresa tu contraseña.');
    }

    // Llamar al endpoint de login
    const resLogin = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario_id: usuarioId, password })
    });
    const dataLogin = await resLogin.json();

    if (!resLogin.ok) {
      // Contraseña incorrecta → shake + error
      if (passInput) {
        passInput.classList.add('input-error');
        passInput.value = '';
        const wrap = passInput.closest('.pass-input-wrap') || passInput.parentElement;
        wrap.classList.add('shake-anim');
        setTimeout(() => wrap.classList.remove('shake-anim'), 600);
        passInput.focus();
      }
      throw new Error(dataLogin.error || 'Contraseña incorrecta');
    }

    // ── ABRIR SESIÓN DE CAJA ──────────────────────────
    const fondo = parseFloat(fondoInput.value) || 0;
    const fondoUsdInput = document.getElementById('turno-fondo-usd');
    const fondoUsd = fondoUsdInput ? (parseFloat(fondoUsdInput.value) || 0) : 0;
    
    const resCaja = await fetch('/api/caja/abrir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario_id: usuarioId,
        fondo_inicial_cop: fondo,
        fondo_inicial_usd: fondoUsd,
        turno: turnoSeleccionado,
        nombre_cajero: nombreCajero
      })
    });
    const dataCaja = await resCaja.json();
    if (!resCaja.ok) throw new Error(dataCaja.error || 'Error al abrir caja');

    TURNO_STATE.sesionActiva = dataCaja.sesion;
    hideTurnoScreen(dataCaja.sesion);
    showToast(`✅ Bienvenido/a ${nombreCajero}! Turno ${turnoSeleccionado} iniciado.`, 'success');

  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add('visible');
    btnIniciar.disabled = false;
    btnIniciar.innerHTML = '<i data-lucide="play-circle"></i> Iniciar Turno';
    lucide.createIcons();
  }
}

/**
 * Oculta la pantalla de turno y entra a la app mostrando la info del turno activo
 */
function hideTurnoScreen(sesion) {
  const turnoScreen = document.getElementById('turno-screen');
  const turno = sesion?.turno || 'Mañana';
  const cajero = sesion?.nombre_cajero || sesion?.usuario_nombre || 'Cajero';

  // Actualizar badge del header
  const headerBadge = document.getElementById('header-turno-badge');
  if (headerBadge) {
    const emoji = turno === 'Tarde' ? '🌆' : '🌅';
    const cls = turno === 'Tarde' ? 'badge-tarde' : 'badge-manana';
    headerBadge.innerHTML = `<span class="turno-badge ${cls}">${emoji} ${turno} — ${cajero}</span>`;
    headerBadge.style.display = 'inline-block';
  }

  // Actualizar info en sidebar
  const sidebarInfo = document.getElementById('sidebar-turno-info');
  const stName = document.getElementById('st-cajero-name');
  const stTurno = document.getElementById('st-turno-label');
  if (sidebarInfo) {
    stName.textContent = cajero;
    stTurno.textContent = `Turno ${turno}`;
    sidebarInfo.style.display = 'block';
  }

  // Ocultar menús según permisos
  let permisos = ['pos', 'caja'];
  if (sesion && sesion.permisos) {
    try {
      permisos = typeof sesion.permisos === 'string' ? JSON.parse(sesion.permisos) : sesion.permisos;
    } catch(e) {}
  }
  
  DOM.navItems.forEach(btn => {
    const view = btn.dataset.view;
    if (permisos.includes('all') || permisos.includes(view)) {
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
  });

  // Animar salida de la pantalla de turno
  turnoScreen.classList.add('hiding');
  setTimeout(() => {
    turnoScreen.style.display = 'none';
  }, 400);
  // También cargar datos de caja por si se navega allí
  loadCajaData();
}

/**
 * Muestra la pantalla de turno (cuando se cierra el turno)
 */
async function showTurnoScreen() {
  const turnoScreen = document.getElementById('turno-screen');

  // Ocultar badge de turno
  const headerBadge = document.getElementById('header-turno-badge');
  if (headerBadge) headerBadge.style.display = 'none';

  const sidebarInfo = document.getElementById('sidebar-turno-info');
  if (sidebarInfo) sidebarInfo.style.display = 'none';

  // Limpiar estado
  TURNO_STATE.sesionActiva = null;
  document.getElementById('turno-fondo').value = '0';
  document.getElementById('turno-error').classList.remove('visible');
  document.getElementById('session-resume-banner').style.display = 'none';

  // Limpiar contraseña

  // Recargar usuarios
  await loadTurnoUsuarios();

  // Mostrar pantalla
  turnoScreen.classList.remove('hiding');
  turnoScreen.style.display = 'flex';
  lucide.createIcons();
}

// ============================================
// 14. GESTIÓN DE USUARIOS (ADMIN)
// ============================================

async function loadUsuariosData() {
  try {
    const res = await fetch('/api/usuarios');
    if (!res.ok) throw new Error('Error al cargar usuarios');
    const usuarios = await res.json();
    
    const tbody = document.getElementById('tabla-usuarios');
    tbody.innerHTML = '';
    
    usuarios.forEach(u => {
      let pArray = [];
      try { pArray = typeof u.permisos === 'string' ? JSON.parse(u.permisos) : u.permisos; } catch(e){}
      const pText = pArray.includes('all') ? 'Acceso Total (Admin)' : pArray.join(', ');
      
      tbody.innerHTML += `
        <tr>
          <td>${u.nombre}</td>
          <td><span class="badge ${u.rol === 'Administrador' ? 'badge-tarde' : 'badge-manana'}">${u.rol}</span></td>
          <td>${u.turno}</td>
          <td style="font-size:12px; color:var(--text-muted);">${pText.toUpperCase()}</td>
          <td style="text-align:right;">
            <button class="action-btn" onclick="showEditarUsuarioModal(${u.id}, '${u.nombre}', '${u.turno}', '${encodeURIComponent(JSON.stringify(pArray))}')">
              <i data-lucide="edit"></i> Editar
            </button>
          </td>
        </tr>
      `;
    });
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    showToast('Error cargando usuarios', 'error');
  }
}

window.showEditarUsuarioModal = function(id = null, nombre = '', turno = 'Mañana', permisosStr = '[]') {
  let pArray = [];
  try { pArray = JSON.parse(decodeURIComponent(permisosStr)); } catch(e){}
  
  const isAll = pArray.includes('all');
  
  const formHtml = `
    <div class="form-group">
      <label>Nombre del Cajero/Usuario</label>
      <input type="text" id="edit-usr-nombre" value="${nombre}" required>
    </div>
    <div class="form-group">
      <label>Turno Asignado</label>
      <select id="edit-usr-turno">
        <option value="Mañana" ${turno === 'Mañana' ? 'selected' : ''}>Mañana</option>
        <option value="Tarde" ${turno === 'Tarde' ? 'selected' : ''}>Tarde</option>
        <option value="Completo" ${turno === 'Completo' ? 'selected' : ''}>Día Completo</option>
      </select>
    </div>
    <div class="form-group">
      <label>Contraseña ${id ? '(Dejar vacío para no cambiar)' : '(Por defecto 1234)'}</label>
      <input type="password" id="edit-usr-pass" placeholder="${id ? '***' : '1234'}">
    </div>
    <div class="form-group">
      <label>Permisos de Acceso</label>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
        <label><input type="checkbox" class="chk-permiso" value="pos" ${pArray.includes('pos') || isAll ? 'checked' : ''}> Punto de Venta</label>
        <label><input type="checkbox" class="chk-permiso" value="inventario" ${pArray.includes('inventario') || isAll ? 'checked' : ''}> Inventario</label>
        <label><input type="checkbox" class="chk-permiso" value="credito" ${pArray.includes('credito') || isAll ? 'checked' : ''}> Cuentas x Cobrar</label>
        <label><input type="checkbox" class="chk-permiso" value="reportes" ${pArray.includes('reportes') || isAll ? 'checked' : ''}> Reportes</label>
        <label><input type="checkbox" class="chk-permiso" value="caja" ${pArray.includes('caja') || isAll ? 'checked' : ''}> Caja y Gastos</label>
        <label><input type="checkbox" class="chk-permiso" value="tesoreria" ${pArray.includes('tesoreria') || isAll ? 'checked' : ''}> Tesorería</label>
        <label><input type="checkbox" class="chk-permiso" value="all" ${isAll ? 'checked' : ''}> <b>Acceso Total (Admin)</b></label>
      </div>
    </div>
  `;

  openGenericModal(id ? 'Editar Usuario' : 'Nuevo Usuario', formHtml, async () => {
    const n_nombre = document.getElementById('edit-usr-nombre').value;
    const n_turno = document.getElementById('edit-usr-turno').value;
    const n_pass = document.getElementById('edit-usr-pass').value;
    
    const checkboxes = document.querySelectorAll('.chk-permiso:checked');
    let n_permisos = Array.from(checkboxes).map(c => c.value);
    
    // Si marcan Acceso Total, simplificamos
    if (n_permisos.includes('all')) n_permisos = ['all'];

    const payload = {
      nombre: n_nombre,
      turno: n_turno,
      permisos: n_permisos
    };
    if (n_pass) payload.password = n_pass;

    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? '/api/usuarios/' + id : '/api/usuarios';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      
      showToast('Usuario guardado correctamente', 'success');
      closeGenericModal();
      loadUsuariosData();
    } catch(e) {
      alert('Error: ' + e.message);
    }
  });
};

window.deleteProducto = async function(id) {
  if(!confirm('¿Estás seguro de eliminar este producto?')) return;
  try {
    const res = await fetch('/api/productos/' + id, { method: 'DELETE' });
    const data = await res.json();
    if(res.ok) {
      showToast(data.mensaje, 'success');
      await loadInventarioData();
      renderProducts();
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
      await loadInventarioData();
      renderProducts();
    } else {
      showToast(data.error, 'danger');
    }
  } catch(e) {
    showToast('Error de red', 'danger');
  }
};
window.eliminarAbono = async function(id) {
  if (!confirm('¿Está seguro de que desea eliminar este abono? El saldo del cliente será revertido.')) return;
  const adminPass = prompt('Ingrese contraseña de administrador:');
  if (!adminPass) return;
  
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
      loadClientDetail(STATE.selectedClientId);
    }
  } catch(err) {
    showToast(err.message, 'error');
  }
};
