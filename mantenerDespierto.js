/**
 * Mantiene el servidor despierto en Render SOLO en horario laboral.
 *
 * En el plan gratuito, Render duerme el servicio tras 15 minutos sin visitas, y la
 * primera visita tarda ~1 minuto en despertarlo (y WhatsApp se desconecta).
 * - Dentro del horario (por defecto 06:30–22:30, hora de Venezuela) el servidor se
 *   visita a sí mismo cada 10 minutos por su dirección pública, para que no se duerma.
 * - Fuera del horario no hace nada, y Render lo duerme solo.
 * - Un servidor dormido no puede despertarse a sí mismo: para eso está la tarea de
 *   GitHub Actions .github/workflows/despertar-render.yml (6:25 y 6:40 am).
 *
 * Solo actúa en Render (usa la variable RENDER_EXTERNAL_URL que Render define sola).
 * Se puede cambiar el horario con HORARIO_INICIO y HORARIO_FIN (formato HH:MM).
 */

const INTERVALO_MS = 10 * 60 * 1000;

function minutosDe(hhmm, defecto) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return defecto;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Minutos transcurridos del día en hora de Venezuela (UTC-4, sin horario de verano)
function minutosAhoraVenezuela() {
  const ahora = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return ahora.getUTCHours() * 60 + ahora.getUTCMinutes();
}

export function enHorarioLaboral(minutos = minutosAhoraVenezuela()) {
  const inicio = minutosDe(process.env.HORARIO_INICIO, 6 * 60 + 30);
  const fin = minutosDe(process.env.HORARIO_FIN, 22 * 60 + 30);
  return minutos >= inicio && minutos < fin;
}

export function iniciarMantenerDespierto() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url) return; // fuera de Render (local, pruebas): no hace falta

  const visitar = async () => {
    if (!enHorarioLaboral()) return;
    try {
      await fetch(`${url.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(30000) });
    } catch (e) {
      console.warn('Visita para mantener despierto falló:', e.message);
    }
  };
  setInterval(visitar, INTERVALO_MS);
  console.log(`⏰ Mantener despierto: activo de ${process.env.HORARIO_INICIO || '06:30'} a ${process.env.HORARIO_FIN || '22:30'} (hora de Venezuela).`);
}
