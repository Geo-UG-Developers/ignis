// Se ejecuta cada minuto (pg_cron): escalamiento de reportes sin confirmar y avisos pendientes.
// No requiere secreto: solo procesa lo que ya venció, así que llamarla de más no hace nada.
import { db, tg } from '../_shared/servicios.ts';
import { enviarAlertas } from '../_shared/alerta.ts';
import { enviarAvisos } from '../_shared/avisos.ts';

interface Fila { incidente_id: string; folio: string; institucion_id: string; telegram_chat_id: number | null; es_respaldo: boolean }

Deno.serve(async () => {
  const resultado = { escalados: 0, avisos: 0 };
  try {
    const { data, error } = await db.rpc('escalar_pendientes');
    if (error) throw error;
    const filas = (data ?? []) as Fila[];
    for (const incidenteId of new Set(filas.map((f) => f.incidente_id))) {
      const deEste = filas.filter((f) => f.incidente_id === incidenteId);
      const respaldos = deEste.filter((f) => f.es_respaldo);
      // 1) La institución de respaldo recibe la alerta completa, con foto.
      if (respaldos.length) await enviarAlertas(incidenteId, await primeraFoto(incidenteId));
      // 2) A las originales se les recuerda, respondiendo a su alerta.
      const nombres = respaldos.length ? await nombresDe(respaldos.map((r) => r.institucion_id)) : '';
      for (const f of deEste.filter((x) => !x.es_respaldo && x.telegram_chat_id)) {
        const { data: v } = await db.from('incidente_institucion').select('telegram_message_id')
          .eq('incidente_id', incidenteId).eq('institucion_id', f.institucion_id).maybeSingle();
        await tg('sendMessage', {
          chat_id: f.telegram_chat_id, parse_mode: 'HTML', reply_to_message_id: v?.telegram_message_id ?? undefined,
          text: `<b>Sin confirmar.</b> Este reporte (folio ${f.folio}) lleva más de 10 minutos sin que nadie toque «Recibido».` +
            (nombres ? `\nSe avisó también a: <b>${nombres}</b>.` : ''),
        });
      }
      resultado.escalados++;
    }
  } catch (e) {
    console.error('escalamiento', e);
  }
  try {
    resultado.avisos = await enviarAvisos();
  } catch (e) {
    console.error('avisos', e);
  }
  return Response.json(resultado);
});

async function primeraFoto(incidenteId: string): Promise<Blob | undefined> {
  const { data } = await db.from('reportes').select('fotos').eq('incidente_id', incidenteId)
    .order('creado_en').limit(1).maybeSingle();
  const ruta = data?.fotos?.[0];
  if (!ruta) return undefined;
  const { data: archivo } = await db.storage.from('fotos').download(ruta);
  return archivo ?? undefined;
}

async function nombresDe(ids: string[]): Promise<string> {
  const { data } = await db.from('instituciones').select('nombre').in('id', ids);
  return (data ?? []).map((x: { nombre: string }) => x.nombre).join(', ');
}
