// Textos y botones de los mensajes de Telegram. Funciones puras (sin red),
// así se pueden probar sin servidor.

export type Estado = 'nuevo' | 'recibido' | 'en_camino' | 'controlado' | 'extinguido' | 'falso';

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  nuevo: 'Nuevo · sin confirmar',
  recibido: 'Recibido',
  en_camino: 'En camino',
  controlado: 'Controlado',
  extinguido: 'Extinguido',
  falso: 'Falso o duplicado',
};

export const ETIQUETA_TIPO: Record<string, string> = {
  forestal: 'Incendio forestal',
  pastizal: 'Incendio de pastizal',
  quema_esquilmo: 'Quema de esquilmo',
  quema_basura: 'Quema de basura',
};

const ORDEN: Estado[] = ['nuevo', 'recibido', 'en_camino', 'controlado', 'extinguido'];

export function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Botones que se muestran según el estado actual (solo hacia adelante). */
export function teclado(incidenteId: string, estado: Estado) {
  if (estado === 'extinguido' || estado === 'falso') return { inline_keyboard: [] };
  const siguientes = ORDEN.slice(ORDEN.indexOf(estado) + 1);
  const boton = (e: Estado) => ({ text: ETIQUETA_ESTADO[e], callback_data: `e|${incidenteId}|${e}` });
  const filas: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < siguientes.length; i += 2) filas.push(siguientes.slice(i, i + 2).map(boton));
  filas.push([boton('falso')]);
  return { inline_keyboard: filas };
}

/** Lee el dato de un botón. Devuelve null si no es nuestro. */
export function leerBoton(data: string | undefined): { incidenteId: string; estado: Estado } | null {
  if (!data) return null;
  const m = /^e\|([0-9a-f-]{36})\|(recibido|en_camino|controlado|extinguido|falso)$/.exec(data);
  return m ? { incidenteId: m[1], estado: m[2] as Estado } : null;
}

export interface DatosAlerta {
  folio: string;
  tipo: string;
  municipio: string | null;
  lat: number;
  lon: number;
  num_reportes: number;
  comentario?: string | null;
  estado: Estado;
  historial?: { estado: Estado; actor: string | null; hora: string }[];
}

/** Texto de la alerta (formato HTML de Telegram, máx. 1024 caracteres en fotos). */
export function textoAlerta(d: DatosAlerta): string {
  const lineas = [
    d.estado === 'nuevo' ? '<b>NUEVO REPORTE</b>' : `<b>Estado: ${ETIQUETA_ESTADO[d.estado]}</b>`,
    `<b>${escapar(ETIQUETA_TIPO[d.tipo] ?? d.tipo)}</b> · ${escapar(d.municipio ?? 'Fuera de cobertura')}`,
    `${d.num_reportes} ${d.num_reportes === 1 ? 'reporte' : 'reportes'} · folio ${escapar(d.folio)}`,
  ];
  if (d.comentario) lineas.push(`«${escapar(d.comentario.slice(0, 200))}»`);
  lineas.push(`<a href="https://www.google.com/maps/dir/?api=1&amp;destination=${d.lat},${d.lon}">Abrir ruta en Google Maps</a>`);
  for (const h of d.historial ?? []) {
    lineas.push(`· ${ETIQUETA_ESTADO[h.estado]}${h.actor ? ` por ${escapar(h.actor)}` : ''} · ${escapar(h.hora)}`);
  }
  return lineas.join('\n').slice(0, 1024);
}

/** Comando de un mensaje de texto, sin la mención al bot: "/vincular@ignis_bot X" -> ["vincular", "X"]. */
export function leerComando(texto: string | undefined): { comando: string; arg: string } | null {
  if (!texto) return null;
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i.exec(texto.trim());
  return m ? { comando: m[1].toLowerCase(), arg: (m[2] ?? '').trim() } : null;
}

/** Hora local de México para los mensajes. */
export function horaMx(fecha: Date | string): string {
  return new Date(fecha).toLocaleTimeString('es-MX', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City',
  });
}
