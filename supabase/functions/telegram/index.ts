// Webhook del bot de Telegram: comandos (/id, /vincular, /ayuda) y botones de estado.
import { db, secretoWebhook, tg } from '../_shared/servicios.ts';
import { ETIQUETA_ESTADO, leerBoton, leerComando } from '../_shared/mensajes.ts';
import { actualizarAlertas } from '../_shared/alerta.ts';

const AYUDA = [
  '<b>IGNIS · alertas de incendios</b>',
  'Este bot avisa a las instituciones cuando la ciudadanía reporta un incendio.',
  '',
  '/id · muestra el número de este chat',
  '/vincular CÓDIGO · conecta este grupo con una institución (solo administradores)',
].join('\n');

const ERRORES: Record<string, string> = {
  transicion_invalida: 'Ese estado ya se había marcado.',
  incidente_cerrado: 'Este incendio ya está cerrado.',
  sin_permiso: 'Este grupo no atiende ese incendio.',
};

Deno.serve(async (req) => {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== await secretoWebhook()) {
    return new Response('no autorizado', { status: 401 });
  }
  const u = await req.json().catch(() => ({}));
  try {
    if (u.message) await mensaje(u.message);
    else if (u.callback_query) await boton(u.callback_query);
  } catch (e) {
    console.error('webhook', e);
  }
  return new Response('ok');   // Siempre 200: Telegram reintenta si no.
});

// deno-lint-ignore no-explicit-any
async function mensaje(m: any) {
  const c = leerComando(m.text);
  if (!c) return;
  const chat = m.chat.id;
  const responder = (text: string) => tg('sendMessage', { chat_id: chat, text, parse_mode: 'HTML' });

  if (c.comando === 'id') {
    return responder(`El número de este chat es <code>${chat}</code>`);
  }
  if (c.comando === 'start' || c.comando === 'ayuda' || c.comando === 'help') {
    return responder(AYUDA);
  }
  if (c.comando === 'vincular') {
    if (m.chat.type === 'private') return responder('Usa /vincular dentro del grupo de la institución.');
    const miembro = await tg('getChatMember', { chat_id: chat, user_id: m.from.id });
    if (!['creator', 'administrator'].includes(miembro.result?.status)) {
      return responder('Solo un administrador del grupo puede vincularlo.');
    }
    if (!c.arg) return responder('Escribe el código: /vincular CÓDIGO');
    const { data, error } = await db.rpc('vincular_chat', { p_codigo: c.arg, p_chat_id: chat });
    if (error) return responder('Código no válido. Revísalo en la tabla de instituciones.');
    return responder(`Listo: este grupo recibirá las alertas de <b>${data.nombre}</b>.`);
  }
}

// deno-lint-ignore no-explicit-any
async function boton(q: any) {
  const b = leerBoton(q.data);
  const contestar = (text: string) => tg('answerCallbackQuery', { callback_query_id: q.id, text });
  if (!b) return contestar('Botón no reconocido.');

  const chat = q.message?.chat?.id;
  const { data: inst } = await db.from('instituciones').select('id').eq('telegram_chat_id', chat).maybeSingle();
  if (!inst) return contestar('Este grupo no está vinculado a ninguna institución.');

  const actor = [q.from.first_name, q.from.last_name ? `${q.from.last_name[0]}.` : ''].join(' ').trim();
  const { error } = await db.rpc('cambiar_estado', {
    p_incidente: b.incidenteId, p_estado: b.estado, p_institucion: inst.id, p_actor: actor, p_canal: 'telegram',
  });
  if (error) return contestar(ERRORES[error.message] ?? 'No se pudo cambiar el estado.');

  await contestar(`Marcado: ${ETIQUETA_ESTADO[b.estado]}`);
  await actualizarAlertas(b.incidenteId);
  // Las notificaciones push al ciudadano se agregan cuando la app tenga su registro de dispositivos.
}
