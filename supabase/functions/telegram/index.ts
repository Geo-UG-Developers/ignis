// Webhook del bot de Telegram: comandos (/id, /vincular, /ayuda) y botones de estado.
import { db, secretoWebhook, tg } from '../_shared/servicios.ts';
import { ES_CIERRE, ETIQUETA_ESTADO, ETIQUETA_TIPO, escapar, leerBoton, leerComando, tecladoConfirmar, type Estado } from '../_shared/mensajes.ts';
import { actualizarAlertas, datosAlerta } from '../_shared/alerta.ts';

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
  nada_que_deshacer: 'No hay cambios que deshacer.',
  tiempo_vencido: 'Ya pasaron 2 minutos; ese cambio ya no se puede deshacer.',
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
  const a = leerBoton(q.data);
  const contestar = (text: string, alerta = false) =>
    tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: alerta });
  if (!a) return contestar('Botón no reconocido.');

  const chat = q.message?.chat?.id;
  const { data: inst } = await db.from('instituciones').select('id').eq('telegram_chat_id', chat).maybeSingle();
  if (!inst) return contestar('Este grupo no está vinculado a ninguna institución.');

  const actor = [q.from.first_name, q.from.last_name ? `${q.from.last_name[0]}.` : ''].join(' ').trim();
  const esAdmin = async () => {
    const m = await tg('getChatMember', { chat_id: chat, user_id: q.from.id });
    return ['creator', 'administrator'].includes(m.result?.status);
  };
  const soloAdmin = 'Solo un administrador del grupo (jefe de turno) puede cerrar un incendio.';
  const borrarEste = () => tg('deleteMessage', { chat_id: chat, message_id: q.message.message_id });

  const aplicar = async (estado: Estado) => {
    const { error } = await db.rpc('cambiar_estado', {
      p_incidente: a.incidenteId, p_estado: estado, p_institucion: inst.id, p_actor: actor, p_canal: 'telegram',
    });
    if (error) return contestar(ERRORES[error.message] ?? 'No se pudo cambiar el estado.', true);
    await contestar(`Marcado: ${ETIQUETA_ESTADO[estado]}. Tienes 2 minutos para deshacerlo.`);
    await actualizarAlertas(a.incidenteId);
  };

  switch (a.tipo) {
    case 'cancelar':
      await borrarEste();
      return contestar('Cancelado. No se cambió nada.');

    case 'estado': {
      if (!ES_CIERRE(a.estado)) return aplicar(a.estado);
      if (!(await esAdmin())) return contestar(soloAdmin, true);
      // Cierre: se pide confirmación en un mensaje aparte.
      const d = await datosAlerta(a.incidenteId);
      const lugar = d ? `${ETIQUETA_TIPO[d.tipo] ?? d.tipo} · ${d.municipio ?? ''} · folio ${d.folio}` : '';
      await tg('sendMessage', {
        chat_id: chat, parse_mode: 'HTML', reply_to_message_id: q.message.message_id,
        text: `<b>${escapar(actor)}</b>, ¿confirmas que este incendio está <b>${ETIQUETA_ESTADO[a.estado].toUpperCase()}</b>?\n${escapar(lugar)}`,
        reply_markup: tecladoConfirmar(a.incidenteId, a.estado),
      });
      return contestar('Confirma en el mensaje de abajo.');
    }

    case 'confirmar':
      if (!(await esAdmin())) return contestar(soloAdmin, true);
      await borrarEste();
      return aplicar(a.estado);

    case 'deshacer': {
      const { data: inc } = await db.from('incidentes').select('estado').eq('id', a.incidenteId).maybeSingle();
      if (inc && ES_CIERRE(inc.estado) && !(await esAdmin())) return contestar(soloAdmin, true);
      const { data, error } = await db.rpc('deshacer_estado', {
        p_incidente: a.incidenteId, p_institucion: inst.id, p_actor: actor,
      });
      if (error) {
        await actualizarAlertas(a.incidenteId);   // quita el botón si ya venció
        return contestar(ERRORES[error.message] ?? 'No se pudo deshacer.', true);
      }
      await contestar(`Se deshizo «${ETIQUETA_ESTADO[data.deshecho as Estado]}». Estado actual: ${ETIQUETA_ESTADO[data.estado as Estado]}.`);
      return actualizarAlertas(a.incidenteId);
    }
  }
}
