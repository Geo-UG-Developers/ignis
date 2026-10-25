// Riesgo de incendio estimado con el clima actual (Open-Meteo: gratis, sin llave).
// Es una ORIENTACIÓN para la ciudadanía, no el índice oficial de CONAFOR/SMN.
export interface Riesgo {
  nivel: 1 | 2 | 3 | 4 | 5; texto: string;
  viento: number; humedad: number; temp: number; lluvia3d: number; lugar: 'tu zona' | 'Guanajuato';
}
const TEXTOS = ['', 'Bajo', 'Moderado', 'Alto', 'Muy alto', 'Extremo'] as const;
const CENTRO = { lat: 21.019, lon: -101.257 }; // Guanajuato capital
const CLAVE = 'ignis-riesgo';

/** Puntos por condición: aire seco, viento, calor; la lluvia reciente los baja. */
export function calcularNivel(humedad: number, viento: number, temp: number, lluvia3d: number): Riesgo['nivel'] {
  let p = 0;
  p += humedad < 15 ? 3 : humedad < 25 ? 2 : humedad < 40 ? 1 : 0;
  p += viento > 40 ? 3 : viento > 25 ? 2 : viento > 15 ? 1 : 0;
  p += temp > 32 ? 2 : temp > 26 ? 1 : 0;
  p -= lluvia3d > 10 ? 3 : lluvia3d > 2 ? 1 : 0;
  return (p <= 1 ? 1 : p <= 3 ? 2 : p === 4 ? 3 : p <= 6 ? 4 : 5) as Riesgo['nivel'];
}

async function posicion(): Promise<{ lat: number; lon: number; propia: boolean }> {
  // Solo usa el GPS si la persona ya dio permiso; no pedimos permiso solo para el clima.
  try {
    const st = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (st?.state === 'granted') {
      const p = await new Promise<GeolocationPosition>((ok, mal) =>
        navigator.geolocation.getCurrentPosition(ok, mal, { timeout: 5000, maximumAge: 30 * 60_000 }));
      return { lat: p.coords.latitude, lon: p.coords.longitude, propia: true };
    }
  } catch { /* sin permiso o sin GPS */ }
  return { ...CENTRO, propia: false };
}

export async function riesgoHoy(): Promise<Riesgo> {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
    if (c && Date.now() - c.t < 30 * 60_000) return c.r;
  } catch { /* sin almacenamiento */ }
  const pos = await posicion();
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: pos.lat.toFixed(2), longitude: pos.lon.toFixed(2), // ~1 km: no mandamos la ubicación exacta
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m',
    daily: 'precipitation_sum', past_days: '3', forecast_days: '1', timezone: 'auto',
  }).toString();
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error('clima');
  const d = await r.json();
  const lluvia3d = (d.daily?.precipitation_sum ?? []).reduce((a: number, b: number | null) => a + (b ?? 0), 0);
  const humedad = d.current.relative_humidity_2m, viento = d.current.wind_speed_10m, temp = d.current.temperature_2m;
  const nivel = calcularNivel(humedad, viento, temp, lluvia3d);
  const res: Riesgo = { nivel, texto: TEXTOS[nivel], viento: Math.round(viento), humedad: Math.round(humedad),
    temp: Math.round(temp), lluvia3d: Math.round(lluvia3d), lugar: pos.propia ? 'tu zona' : 'Guanajuato' };
  try { localStorage.setItem(CLAVE, JSON.stringify({ t: Date.now(), r: res })); } catch { /* */ }
  return res;
}
