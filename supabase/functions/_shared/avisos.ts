// Avisos al ciudadano por web push. Las llaves (VAPID) las genera el propio
// servidor la primera vez y las guarda en config_privada: no hay secretos que copiar.
import webpush from 'npm:web-push@3.6.7';
import { db } from './servicios.ts';
import { ETIQUETA_TIPO, type Estado } from './mensajes.ts';

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const desdeB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

interface Llaves { publica: string; privada: string }

export async function llavesVapid(): Promise<Llaves> {
  const { data } = await db.from('config_privada').select('valor').eq('clave', 'vapid').maybeSingle();
  if (data) return data.valor as Llaves;
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  const llaves = { publica: b64u(new Uint8Array([4, ...desdeB64u(jwk.x!), ...desdeB64u(jwk.y!)])), privada: jwk.d! };
  // Si otra llamada se adelantó, se queda la primera.
  await db.from('config_privada').upsert({ clave: 'vapid', valor: llaves }, { onConflict: 'clave', ignoreDuplicates: true });
  const { data: final } = await db.from('config_privada').select('valor').eq('clave', 'vapid').single();
  return final!.valor as Llaves;
}

const TEXTO: Record<Exclude<Estado, 'nuevo'>, (inst: string) => { titulo: string; cuerpo: string }> = {
  recibido: (i) => ({ titulo: 'Tu reporte fue recibido', cuerpo: `${i} ya tiene tu reporte.` }),
  en_camino: () => ({ titulo: 'Brigada en camino', cuerpo: 'Una brigada va hacia el incendio que reportaste. Si es seguro, aléjate del humo.' }),
  controlado: () => ({ titulo: 'Incendio controlado', cuerpo: 'El incendio que reportaste ya está controlado.' }),
  extinguido: () => ({ titulo: 'Incendio extinguido', cuerpo: 'El incendio que reportaste se apagó. Gracias por avisar.' }),
  falso: () => ({ titulo: 'Reporte cerrado', cuerpo: 'La institución lo marcó como duplicado o no confirmado.' }),
};

interface Pendiente {
  evento_id: number; incidente_id: string; estado: Estado; folio: string; tipo: string;
  municipio: string | null; institucion: string | null; suscripciones: string[];
}

/** Envía los avisos que ya toca mandar (los cierres esperan los 2 minutos de "deshacer"). */
export async function enviarAvisos(): Promise<number> {
  const { data, error } = await db.rpc('avisos_pendientes');
  if (error) { console.error('avisos_pendientes', error.message); return 0; }
  const pendientes = (data ?? []) as Pendiente[];
  if (!pendientes.length) return 0;
  const llaves = await llavesVapid();
  webpush.setVapidDetails('mailto:geougdevelopers@gmail.com', llaves.publica, llaves.privada);
  let enviados = 0;
  for (const p of pendientes) {
    if (p.estado === 'nuevo') continue;
    const t = TEXTO[p.estado](p.institucion ?? 'La autoridad');
    const carga = JSON.stringify({
      titulo: t.titulo,
      cuerpo: `${t.cuerpo} ${ETIQUETA_TIPO[p.tipo] ?? ''}${p.municipio ? ` · ${p.municipio}` : ''} · folio ${p.folio}`,
      url: '#/mis', etiqueta: p.incidente_id,
    });
    for (const s of p.suscripciones) {
      try {
        const sub = JSON.parse(s);
        const req = webpush.generateRequestDetails(sub, carga, { TTL: 86400, urgency: 'high' });
        const r = await fetch(req.endpoint, { method: 'POST', headers: req.headers as Record<string, string>, body: req.body });
        if (r.status === 404 || r.status === 410) await db.rpc('quitar_suscripcion', { p_token: s });
        else if (r.ok) enviados++;
        else console.error('push', r.status, await r.text());
      } catch (e) {
        console.error('push error', e);
      }
    }
  }
  await db.rpc('marcar_avisados', { p_ids: pendientes.map((p) => p.evento_id) });
  return enviados;
}
