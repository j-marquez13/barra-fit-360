const STATE = {
  products: [{ id: 1, nombre: 'batido2', es_batido: 1 }],
  insumos: [{ id: 1, nombre: 'Leche', es_para_batidos: 1, es_base_liquida: 1, cantidad_sola: 1, cantidad_combinada: 0.5, unidad_medida: 'porcion' }]
};
function openGenericModal(title, html) {
  console.log("Modal opened successfully");
}
function addToCart(productId) {
  const prod = STATE.products.find(p => p.id === productId);
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
              const tipoStr = esBase ? `<span class="badge" style="background:var(--cyan-neon); color:black; font-size:0.7rem; padding:2px 6px;">Líquido</span>` : `<span class="badge" style="background:var(--card-bg-light); color:var(--color-text); font-size:0.7rem; padding:2px 6px;">Extra</span>`;
              
              return `
                <tr style="border-bottom: 1px solid var(--border-color);">
                  <td style="padding: 8px; text-align: center;">
                    <input type="checkbox" class="batido-extra-cb" 
                      data-id="${ins.id}" data-nombre="${ins.nombre}"
                      data-es-base="${esBase}"
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
      `, () => { console.log("saved"); });
    }
  }
}
addToCart(1);
