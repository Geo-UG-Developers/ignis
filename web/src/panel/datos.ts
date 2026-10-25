// Datos del panel institucional. Sesión propia (correo y contraseña), separada
// de la sesión anónima de la app ciudadana.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, type Estado, type PuntoHistorico, type Tipo } from '../api';

export const dbp = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ignis-panel' },
});

export interface Yo {
  institucion_id: string; institucion: string; tipo: string; region: string; es_admin: boolean; municipios: string[];
}
export interface Incidente {
  id: string; folio: string; tipo: Tipo; estado: Estado; municipio: string | null; lat: number; lon: number;
  num_reportes: number; confirmado_satelite: boolean; creado_en: string; actualizado_en: string;
  es_respaldo: boolean; minutos_sin_confirmar: number | null; ultimo_actor: string | null;
}
export interface Detalle {
  id: string; folio: string; tipo: Tipo; estado: Estado; municipio: string | null; lat: number; lon: number;
  num_reportes: number; creado_en: string; puede_deshacer: boolean;
  reportes: { creado_en: string; tipo: Tipo; comentario: string | null; nombre: string | null; telefono: string | null;
              fotos: string[]; precision_m: number | null; lat: number; lon: number }[];
  eventos: { estado: Estado; actor: string | null; canal: string; institucion: string | null; en: string }[];
  instituciones: { nombre: string; es_respaldo: boolean }[];
}
export interface Estadisticas {
  total: number; activos: number; falsos: number;
  mediana_min_recibido: number | null; mediana_min_control: number | null;
  por_mes: { mes: string; total: number }[]; por_tipo: Partial<Record<Tipo, number>>;
}

const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await dbp.rpc(fn, args);
  if (error) throw error;
  return data as T;
};

export const yo = () => rpc<Yo | null>('panel_yo');
export const incidentes = (desde: Date) => rpc<Incidente[]>('panel_incidentes', { p_desde: desde.toISOString() });
export const detalle = (id: string) => rpc<Detalle | null>('panel_detalle', { p_incidente: id });
export const estadisticas = (desde: Date) => rpc<Estadisticas | null>('panel_estadisticas', { p_desde: desde.toISOString() });
export const historicoResumen = () => rpc<{ anio: number; tipo: Tipo; total: number }[]>('panel_historico_resumen');

export async function historico(): Promise<PuntoHistorico[]> {
  const todos: PuntoHistorico[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await dbp.rpc('historico_publico', {}).range(i, i + 999);
    if (error) throw error;
    todos.push(...(data as PuntoHistorico[]));
    if (data.length < 1000) return todos;
  }
}

/** Enlaces temporales (10 min) para ver fotos privadas. */
export async function urlsFotos(rutas: string[]): Promise<string[]> {
  if (!rutas.length) return [];
  const { data, error } = await dbp.storage.from('fotos').createSignedUrls(rutas, 600);
  if (error) return [];
  return data.map((d) => d.signedUrl).filter(Boolean) as string[];
}

/** Cambiar estado o deshacer, pasando por el servidor (aplica las reglas y avisa a Telegram). */
export async function accion(cuerpo: { accion: 'estado' | 'deshacer'; incidente: string; estado?: Estado }) {
  const { data } = await dbp.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/panel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session?.access_token}`, apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'servidor');
}
