# 📲 Recordatorios WhatsApp — Manual de uso (Fit 360)

## Qué hace
Lee los clientes con **deuda pendiente** (saldo_deudor > 0), convierte el monto en pesos a
**USD y Bs** usando las mismas 2 tasas del sistema, arma el mensaje de Fit 360 y lo envía por
WhatsApp de forma automática.

> El cálculo usa la **misma lógica del sistema**: `USD = pesos ÷ tasaUSD` y `Bs = pesos ÷ tasaVES`.

## Configuración inicial (una sola vez)
1. Entra a **Cuentas por Cobrar**.
2. Clic en **🔗 Iniciar sesión con WhatsApp**.
3. Escanea el QR con el **WhatsApp Business** de la empresa
   (Ajustes → Dispositivos vinculados → Vincular un dispositivo).
4. Verás **"✅ WhatsApp conectado correctamente"**. La sesión queda guardada en Neon.

> Ya no volverás a escanear, salvo que se desvincule el dispositivo.

## Uso diario
1. Carga las 2 tasas del día en el sistema (como siempre).
2. Entra a **Cuentas por Cobrar** → clic en **📲 Enviar recordatorios WhatsApp**.
3. Revisa la **vista previa** de todos los mensajes.
4. Confirma **"¿Enviar X mensajes?"**.
5. El sistema envía solo, con pausas aleatorias de 10–30 segundos.
6. Al final verás el resumen: **"X enviados, Y fallidos"**.

## Reglas / límites
- **Máximo 50 mensajes/día** (por seguridad anti-bloqueo). Configurable con
  la variable de entorno `WHATSAPP_LIMITE_DIARIO`.
- Solo se envían a clientes **con deuda y teléfono válido**. Los que no tienen teléfono
  se omiten y se avisan.
- Cuando un cliente paga y su saldo queda en 0, deja de recibir recordatorios automáticamente.
- Todo envío queda registrado en la tabla `whatsapp_logs` (auditoría).

## Si la sesión se cae
- El sistema muestra el banner **"⚠️ WhatsApp desconectado"** y reconecta solo usando
  la sesión guardada en Neon.
- Si no puede reconectar, haz clic en el botón de conectar y escanea el QR de nuevo.
- Al reiniciar/redeployar en Render, el sistema reconecta solo si la sesión sigue válida.

## Aviso importante
Esta automatización usa el método **no oficial** (Baileys). Respeta el límite de 50/día y las
pausas para minimizar riesgo de bloqueo. Si el número se bloquea, migra a la API oficial de Meta.
