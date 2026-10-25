// Conexión con el servidor de IGNIS (Supabase).
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://omxujxhbvdkvnfrgtvqa.supabase.co';
// Clave pública: está hecha para ir dentro de la app. La seguridad la dan
// las reglas de la base de datos (RLS), no esta clave.
export const SUPABASE_KEY = 'sb_publishable_RkH0QIK-VSIDfxNWAuOA3w_txfuQL5M';

export const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ignis-sesion' },
});

export type Tipo = 'forestal' | 'pastizal' | 'quema_esquilmo' | 'quema_basura';
export type Estado = 'nuevo' | 'recibido' | 'en_camino' | 'controlado' | 'extinguido' | 'falso';

export interface MiReporte {
  reporte_id: string; folio: string; tipo: Tipo; municipio: string | null; estado: Estado; creado_en: string;
  eventos: { estado: Estado; en: string; institucion: string | null }[];
}

export interface IncidentePublico {
  id: string; tipo: Tipo; estado: Estado; lat: number; lon: number; municipio: string | null;
  num_reportes: number; confirmado_satelite: boolean; creado_en: string;
}

export interface Respuesta {
  folio: string; incidente_id: string; estado: Estado; municipio: string | null;
  agrupado: boolean; instituciones: string[];
}

/** Sesión anónima: el ciudadano no crea cuenta; el teléfono recibe un id propio. */
export async function asegurarSesion(): Promise<string> {
  const { data } = await db.auth.getSession();
  if (data.session) return data.session.access_token;
  const { data: nueva, error } = await db.auth.signInAnonymously();
  if (error || !nueva.session) throw new Error('sin_sesion');
  return nueva.session.access_token;
}

export async function enviarReporte(datos: {
  tipo: Tipo; lat: number; lon: number; precision?: number; comentario?: string; nombre?: string; fotos: Blob[];
}): Promise<Respuesta> {
  const token = await asegurarSesion();
  const f = new FormData();
  f.append('tipo', datos.tipo);
  f.append('lat', String(datos.lat));
  f.append('lon', String(datos.lon));
  if (datos.precision) f.append('precision', String(Math.round(datos.precision)));
  if (datos.comentario) f.append('comentario', datos.comentario);
  if (datos.nombre) f.append('nombre', datos.nombre);
  datos.fotos.forEach((b, i) => f.append('fotos', b, `foto${i + 1}.jpg`));
  const r = await fetch(`${SUPABASE_URL}/functions/v1/reportar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
    body: f,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'servidor');
  return j as Respuesta;
}

export async function misReportes(): Promise<MiReporte[]> {
  await asegurarSesion();
  const { data, error } = await db.rpc('mis_reportes');
  if (error) throw error;
  return (data ?? []) as MiReporte[];
}

export async function incidentesPublicos(): Promise<IncidentePublico[]> {
  const { data, error } = await db.rpc('incidentes_publicos', { p_region: null });
  if (error) throw error;
  return (data ?? []) as IncidentePublico[];
}

/** Reduce la foto a máx. 1600 px y JPEG ~80 % (las fotos de celular pesan 3–8 MB). */
export async function comprimir(archivo: File): Promise<Blob> {
  const img = await createImageBitmap(archivo);
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala);
  c.height = Math.round(img.height * escala);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.8));
}
