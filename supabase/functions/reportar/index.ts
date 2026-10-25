// Recibe un reporte ciudadano desde la app (multipart/form-data) y dispara las alertas.
// Requiere la sesión anónima del ciudadano (Authorization: Bearer <jwt>).
import { db } from '../_shared/servicios.ts';
import { actualizarAlertas, enviarAlertas } from '../_shared/alerta.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const TIPOS = ['forestal', 'pastizal', 'quema_esquilmo', 'quema_basura'];
const MIME = ['image/jpeg', 'image/webp', 'image/png'];
const MAX_BYTES = 3 * 1024 * 1024;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'metodo' }, 405);

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: sesion } = await db.auth.getUser(jwt);
  const usuario = sesion?.user;
  if (!usuario) return json({ error: 'sesion' }, 401);

  let f: FormData;
  try { f = await req.formData(); } catch { return json({ error: 'formato' }, 400); }

  const tipo = String(f.get('tipo') ?? '');
  const lat = Number(f.get('lat'));
  const lon = Number(f.get('lon'));
  if (!TIPOS.includes(tipo) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: 'datos' }, 400);
  }

  // Fotos: máximo 3, cada una ≤ 3 MB, solo imágenes.
  const fotos = f.getAll('fotos').filter((x): x is File => x instanceof File).slice(0, 3);
  const rutas: string[] = [];
  for (const foto of fotos) {
    if (!MIME.includes(foto.type) || foto.size > MAX_BYTES) return json({ error: 'foto' }, 400);
    const ext = foto.type === 'image/png' ? 'png' : foto.type === 'image/webp' ? 'webp' : 'jpg';
    const ruta = `${usuario.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from('fotos').upload(ruta, foto, { contentType: foto.type });
    if (error) { console.error('subir foto', error.message); return json({ error: 'foto' }, 500); }
    rutas.push(ruta);
  }

  const texto = (k: string) => (f.get(k) ? String(f.get(k)).slice(0, 500) : null);
  const { data: r, error } = await db.rpc('registrar_reporte', {
    p_autor: usuario.id, p_tipo: tipo, p_lat: lat, p_lon: lon,
    p_precision_m: f.get('precision') ? Number(f.get('precision')) : null,
    p_comentario: texto('comentario'), p_nombre: texto('nombre'), p_telefono: texto('telefono'),
    p_fotos: rutas,
  });
  if (error) {
    const limite = error.message === 'limite_reportes';
    return json({ error: limite ? 'limite' : 'servidor' }, limite ? 429 : 500);
  }

  if (r.es_nuevo) await enviarAlertas(r.incidente_id, fotos[0]);
  else await actualizarAlertas(r.incidente_id);

  return json({
    folio: r.folio,
    incidente_id: r.incidente_id,
    estado: r.estado,
    municipio: r.municipio,
    agrupado: !r.es_nuevo,
    instituciones: (r.instituciones ?? []).map((i: { nombre: string }) => i.nombre),
  });
});
