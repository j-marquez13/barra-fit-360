const fs = require('fs');

let content = fs.readFileSync('public/app3.js', 'utf8');

const target1 = `      const copTotal = (arqueo.ingresos_moneda.COP || 0);
      const copEfectivo = (arqueo.ingresos_detalle.COP?.['Efectivo COP'] || 0);
      const copCredito = (arqueo.ingresos_detalle.COP?.['Crédito'] || 0);
      const copBancos = copTotal - copEfectivo - copCredito;
      const gastosCop = arqueo.total_gastos_cop || 0;
      const copCajaNeto = fondoBase + copEfectivo - gastosCop; // Efectivo físico esperado

      const usdTotal = (arqueo.ingresos_moneda.USD || 0);
      const usdEfectivo = (arqueo.ingresos_detalle.USD?.['Efectivo USD'] || 0);
      const usdZelle = (arqueo.ingresos_detalle.USD?.['Zelle'] || 0);
      const usdBinance = (arqueo.ingresos_detalle.USD?.['Binance'] || 0);
      const fondoBaseUsd = parseFloat(data.sesion.fondo_inicial_usd) || 0;
      const usdCajaNeto = fondoBaseUsd + usdEfectivo;

      const vesTotal = (arqueo.ingresos_moneda.VES || 0);`;

const replacement1 = `      const ventasDetalle = arqueo.ventas_detalle || arqueo.ingresos_detalle || {};
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
      const vesAbono = (abonosMoneda.VES || 0);`;

content = content.replace(target1, replacement1);

const target2 = `            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Efectivo:</span> <span style="color:var(--success)">+$$\{copEfectivo.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--danger);"><span>Gastos (Efvo):</span> <span>-$\${gastosCop.toLocaleString()}</span></div>`;

const replacement2 = `            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Efectivo:</span> <span style="color:var(--success)">+$$\{copEfectivoVenta.toLocaleString()}</span></div>
            \${copEfectivoAbono > 0 ? \`<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Deudas Cobradas (Efvo):</span> <span style="color:var(--success)">+$$\{copEfectivoAbono.toLocaleString()}</span></div>\` : ''}
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--danger);"><span>Gastos (Efvo):</span> <span>-$\${gastosCop.toLocaleString()}</span></div>`;

content = content.replace(target2, replacement2);

const target3 = `            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Efectivo:</span> <span style="color:#32c8ff">+$$\{usdEfectivo.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--text-dim);"><span>(No restan gastos)</span></div>
            <hr style="border-color:rgba(255,255,255,0.1); margin: 10px 0;">
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:18px; color:var(--text-bright);"><span>Físico a entregar:</span> <span>$$\{usdCajaNeto.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:10px; color:var(--text-dim);"><span>Zelle (Digital):</span> <span>$$\{usdZelle.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:5px; color:var(--text-dim);"><span>Binance (Digital):</span> <span>$$\{usdBinance.toLocaleString()}</span></div>`;

const replacement3 = `            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Efectivo:</span> <span style="color:#32c8ff">+$$\{usdEfectivoVenta.toLocaleString()}</span></div>
            \${usdEfectivoAbono > 0 ? \`<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Deudas Cobradas (Efvo):</span> <span style="color:#32c8ff">+$$\{usdEfectivoAbono.toLocaleString()}</span></div>\` : ''}
            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px; color:var(--text-dim);"><span>(No restan gastos)</span></div>
            <hr style="border-color:rgba(255,255,255,0.1); margin: 10px 0;">
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:18px; color:var(--text-bright);"><span>Físico a entregar:</span> <span>$$\{usdCajaNeto.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:10px; color:var(--text-dim);"><span>Zelle (Digital):</span> <span>$$\{usdZelleTotal.toLocaleString()}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:5px; color:var(--text-dim);"><span>Binance (Digital):</span> <span>$$\{usdBinanceTotal.toLocaleString()}</span></div>`;

content = content.replace(target3, replacement3);

const target4 = `            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Pago Móvil:</span> <span style="color:#ff9632">+Bs.$$\{vesTotal.toLocaleString()}</span></div>`;

const replacement4 = `            <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Ventas Pago Móvil:</span> <span style="color:#ff9632">+Bs.$$\{vesVenta.toLocaleString()}</span></div>
            \${vesAbono > 0 ? \`<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;"><span>Deudas Cobradas (PM):</span> <span style="color:#ff9632">+Bs.$$\{vesAbono.toLocaleString()}</span></div>\` : ''}`;

content = content.replace(target4, replacement4);

fs.writeFileSync('public/app3.js', content);
