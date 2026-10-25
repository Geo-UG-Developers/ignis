// Enviar y actualizar alertas en los grupos de Telegram.
import { db, tg, tgFoto } from './servicios.ts';
import { horaMx, teclado, textoAlerta, type Estado } from './mensajes.ts';

interface Datos {
  incidente_id: string; folio: string; tipo: string; municipio: string | null;
  lat: number; lon: number; num_reportes: number; estado: Estado; comentario: string | null;
  fotos: string[];
  historial: { estado: Estado; actor: string | null; en: string }[];
  telegram: { chat_id: number; message_id: number | null; institucion_id: string }[];
}

export async function datosAlerta(incidenteId: string): Promise<Datos | null> {
  const { data, error } = await db.rpc('datos_alerta', { p_incidente: incidenteId });
  if (error) { console.error('datos_alerta', error.message); return null; }
  return data as Datos;
}

function texto(d: Datos) {
  return textoAlerta({
    ...d,
    historial: d.historial.map((h) => ({ estado: h.estado, actor: h.actor, hora: horaMx(h.en) })),
  });
}

/** Manda la alerta a los grupos que todavía no la tienen. */
export async function enviarAlertas(incidenteId: string, foto?: Blob) {
  const d = await datosAlerta(incidenteId);
  if (!d) return;
  for (const t of d.telegram.filter((x) => !x.message_id)) {
    const r = foto
      ? await tgFoto(t.chat_id, foto, texto(d), teclado(d.incidente_id, d.estado))
      : await tg('sendMessage', {
          chat_id: t.chat_id, text: texto(d), parse_mode: 'HTML',
          reply_markup: teclado(d.incidente_id, d.estado), disable_web_page_preview: true,
        });
    if (r.ok) {
      await db.from('incidente_institucion')
        .update({ telegram_message_id: r.result.message_id, notificado_en: new Date().toISOString() })
        .eq('incidente_id', d.incidente_id).eq('institucion_id', t.institucion_id);
    }
  }
}

/** Redibuja la alerta en todos los grupos (nuevo estado o más reportes). */
export async function actualizarAlertas(incidenteId: string) {
  const d = await datosAlerta(incidenteId);
  if (!d) return;
  const { data: deshacer } = await db.rpc('puede_deshacer', { p_incidente: incidenteId });
  for (const t of d.telegram.filter((x) => x.message_id)) {
    const base = { chat_id: t.chat_id, message_id: t.message_id, parse_mode: 'HTML',
                   reply_markup: teclado(d.incidente_id, d.estado, Boolean(deshacer)) };
    const r = await tg('editMessageCaption', { ...base, caption: texto(d) });
    if (!r.ok && /no caption|there is no caption/i.test(r.description ?? '')) {
      await tg('editMessageText', { ...base, text: texto(d), disable_web_page_preview: true });
    }
  }
}
