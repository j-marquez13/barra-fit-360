const fs = require('fs');

const mediaQueries = `

/* ============================================ */
/* 9. RESPONSIVE / MOBILE DESIGN                */
/* ============================================ */
@media (max-width: 768px) {
  /* Mostrar botón de menú */
  .sidebar-toggle {
    display: flex;
  }
  
  /* Ajustar header */
  .app-header {
    padding: 0 10px;
    height: 50px;
  }
  
  .view-title {
    font-size: 1rem;
  }
  
  .status-area .badge .status-text,
  .status-area .date-time {
    display: none; /* Ocultar texto para ganar espacio */
  }

  .status-area .badge {
    padding: 6px;
    border-radius: 50%;
  }

  /* Sidebar off-canvas */
  .sidebar {
    position: fixed;
    top: 0;
    left: -280px; /* Oculto inicialmente */
    width: 260px;
    height: 100vh;
    box-shadow: 4px 0 20px rgba(0,0,0,0.5);
    transition: left 0.3s ease;
  }

  .sidebar.open {
    left: 0;
  }

  /* Overlay para el menú */
  .sidebar-overlay {
    display: none;
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(2px);
    z-index: 15;
  }
  .sidebar-overlay.open {
    display: block;
  }

  /* Punto de Venta: Apilar Catálogo y Carrito */
  .app-body {
    flex-direction: column;
    overflow-y: auto; /* Scroll general */
  }

  .catalog-section {
    flex: none;
    height: auto;
    min-height: 50vh;
    border-right: none;
    border-bottom: 2px solid var(--border-glass);
  }

  .cart-section {
    width: 100%;
    flex: none;
    min-height: 50vh;
    max-height: none;
  }

  /* Modales a tamaño completo */
  .modal-content {
    width: 95%;
    max-height: 90vh;
    padding: 20px;
  }

  .payment-input-group {
    flex-direction: column;
    gap: 15px;
  }
  
  .payment-input-group > span.method-badge {
    position: static;
    display: inline-block;
    margin-bottom: 5px;
    background: transparent;
    padding: 0;
  }

  .form-group {
    width: 100%;
  }

  /* Tablas responsivas */
  .table-container {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  table.data-table {
    min-width: 600px;
  }
  
  /* Ajuste de KPI cards */
  .dashboard-kpis {
    grid-template-columns: 1fr;
  }
}
`;

fs.appendFileSync('public/index.css', mediaQueries);
console.log('Appended media queries to index.css');
