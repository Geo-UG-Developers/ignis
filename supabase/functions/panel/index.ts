// Acciones del panel web: cambiar estado y deshacer, con las mismas reglas que Telegram
// (solo administradores de la institución cierran) y actualizando los mensajes del grupo.
import { db } from '../_shared/servicios.ts';
import { ES_CIERRE, type Estado } from '../_shared/mensajes.ts';
import { actualizarAlertas } from '../_shared/alerta.ts';
import { enviarAvisos } from '../_shared/avisos.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const ESTADOS: Estado[] = ['recibido', 'en_camino', 'controlado', 'extinguido', 'falso'];
const json = (c: unknown, status = 200) => Response.json(c, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: s } = await db.auth.getUser(jwt);
  const usuario = s?.user;
  if (!usuario || usuario.is_anonymous) return json({ error: 'sesion' }, 401);

  const { data: miembro } = await db.from('miembros_panel').select('institucion_id, es_admin')
    .eq('user_id', usuario.id).maybeSingle();
  if (!miembro) return json({ error: 'sin_permiso' }, 403);

  const b = await req.json().catch(() => ({}));
  const actor = usuario.email ?? 'panel';
  if (b.accion === 'estado') {
    if (!ESTADOS.includes(b.estado)) return json({ error: 'datos' }, 400);
    if (ES_CIERRE(b.estado) && !miembro.es_admin) return json({ error: 'solo_admin' }, 403);
    const { error } = await db.rpc('cambiar_estado', {
      p_incidente: b.incidente, p_estado: b.estado, p_institucion: miembro.institucion_id, p_actor: actor, p_canal: 'panel',
    });
    if (error) return json({ error: error.message }, 409);
  } else if (b.accion === 'deshacer') {
    const { data: inc } = await db.from('incidentes').select('estado').eq('id', b.incidente).maybeSingle();
    if (inc && ES_CIERRE(inc.estado) && !miembro.es_admin) return json({ error: 'solo_admin' }, 403);
    const { error } = await db.rpc('deshacer_estado', { p_incidente: b.incidente, p_institucion: miembro.institucion_id, p_actor: actor });
    if (error) return json({ error: error.message }, 409);
  } else {
    return json({ error: 'accion' }, 400);
  }
  await actualizarAlertas(b.incidente);
  await enviarAvisos();
  return json({ ok: true });
});
