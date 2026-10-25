// IGNIS · Tablero de guardia: pantalla para la estación (TV o laptop) con alarma sonora
// mientras haya reportes sin confirmar, contador de minutos y mapa en vivo.
import L from 'leaflet';
import { accion, incidentes, type Incidente } from './datos';
import { COLOR_TIPO, NOMBRE_TIPO } from './graficas';

const BASE = import.meta.env.BASE_URL;
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hora = (f: string) => new Date(f).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
const minutos = (f: string) => Math.max(0, Math.floor((Date.now() - new Date(f).getTime()) / 60000));
const ESTADO: Record<string, [string, string]> = {
  nuevo: ['Sin confirmar', 'p-rojo'], recibido: ['Recibido', 'p-naranja'], en_camino: ['En camino', 'p-ambar'],
  controlado: ['Controlado', 'p-verde'], extinguido: ['Extinguido', 'p-verde'], falso: ['Falso', 'p-gris'],
};
const CIERRE = (e: string) => e === 'controlado' || e === 'extinguido' || e === 'falso';

const alarma = {
  ctx: null as AudioContext | null, timer: undefined as number | undefined, silencioHasta: 0,
  activar() { try { this.ctx ??= new AudioContext(); void this.ctx.resume(); } catch { this.ctx = null; } },
  sonar() {
    if (!this.ctx || Date.now() < this.silencioHasta) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(880, t0 + i * .5); o.frequency.linearRampToValueAtTime(660, t0 + i * .5 + .4);
      g.gain.setValueAtTime(.0001, t0 + i * .5); g.gain.exponentialRampToValueAtTime(.25, t0 + i * .5 + .03); g.gain.exponentialRampToValueAtTime(.0001, t0 + i * .5 + .42);
      o.connect(g).connect(this.ctx.destination); o.start(t0 + i * .5); o.stop(t0 + i * .5 + .45);
    }
  },
  iniciar() { if (this.timer) return; this.sonar(); this.timer = window.setInterval(() => this.sonar(), 5000); },
  parar() { if (this.timer) { clearInterval(this.timer); this.timer = undefined; } },
};

let wake: { release(): Promise<void> } | null = null;
const encender = async () => { try { wake = await (navigator as unknown as { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen'); } catch { /* */ } };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wake) encender(); });

/** Pinta el tablero; devuelve una función para limpiarlo al salir. */
export function vistaGuardia(raiz: HTMLElement, institucion: string, aviso: (t: string, e?: boolean) => void): () => void {
  document.body.classList.add('modo-guardia');
  raiz.innerHTML = `
  <div class="guardia">
    <header class="g-barra"><img src="${BASE}icono_blanco.png" alt="" class="g-logo">
      <div class="g-tit"><b>IGNIS · GUARDIA</b><span>${esc(institucion)} · <span id="g-red">Conectando…</span></span></div>
      <span class="g-reloj" id="g-reloj"></span>
      <button class="btn g-btn g-activar" id="g-activar">Activar tablero</button>
      <button class="btn g-btn" id="g-silencio" hidden>Silenciar 1 min</button>
      <button class="btn g-btn" id="g-pantalla">Pantalla completa</button>
      <a class="btn g-btn" href="#activos">Salir</a></header>
    <div class="g-cuerpo"><section class="g-lista" id="g-lista" aria-live="polite"></section><section class="g-mapa"><div id="g-mapa"></div></section></div>
    <footer class="g-pie" id="g-pie"></footer>
  </div>`;
  const $ = (id: string) => document.getElementById(id)!;
  const reloj = window.setInterval(() => { const e = document.getElementById('g-reloj'); if (e) e.textContent = new Date().toLocaleTimeString('es-MX'); }, 1000);
  const mapa = L.map('g-mapa').setView([21.019, -101.257], 11);
  mapa.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  const capa = L.layerGroup().addTo(mapa);
  let activado = false, primera = true;
  $('g-activar').addEventListener('click', () => {
    alarma.activar(); encender(); activado = true; $('g-activar').hidden = true; ($('g-silencio') as HTMLButtonElement).hidden = false;
    aviso('Tablero activo: sonará la alarma con cada reporte sin confirmar.'); cargar();
  });
  $('g-silencio').addEventListener('click', () => { alarma.silencioHasta = Date.now() + 60000; aviso('Alarma en silencio 1 minuto.'); });
  $('g-pantalla').addEventListener('click', () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); });

  const cargar = async () => {
    let xs: Incidente[];
    try { xs = await incidentes(new Date(Date.now() - 864e5)); }
    catch { const e = document.getElementById('g-red'); if (e) e.innerHTML = '<b class="sin-red">SIN CONEXIÓN</b>'; return; }
    const e = document.getElementById('g-red'); if (!e) return;
    e.textContent = `en línea · ${hora(new Date().toISOString())}`;
    const act = xs.filter((x) => !CIERRE(x.estado));
    const nuevos = act.filter((x) => x.estado === 'nuevo');
    if (nuevos.length && activado) alarma.iniciar(); else alarma.parar();
    document.title = nuevos.length ? `(${nuevos.length}) NUEVO · IGNIS` : 'IGNIS · Guardia';
    $('g-lista').innerHTML = act.length ? act.map((x) => {
      const m = minutos(x.creado_en), nivel = x.estado !== 'nuevo' ? '' : m >= 10 ? 'rojo' : m >= 5 ? 'ambar' : 'verde';
      return `<article class="g-tarjeta ${x.estado === 'nuevo' ? 'nuevo' : ''}" style="--c:${COLOR_TIPO[x.tipo]}">
        <div class="g-info"><b>${esc(NOMBRE_TIPO[x.tipo])}</b><span>${esc(x.municipio ?? 'Sin municipio')} · ${esc(x.folio)} · ${hora(x.creado_en)}</span>
          <span>${x.num_reportes} ${x.num_reportes === 1 ? 'reporte' : 'reportes'}${x.es_respaldo ? ' · llegó como respaldo' : ''}</span></div>
        <div class="g-der"><span class="g-min ${nivel}">${m} min</span><em class="pill ${ESTADO[x.estado][1]}">${ESTADO[x.estado][0]}</em>
          ${x.estado === 'nuevo' ? `<button class="btn g-ok" data-ok="${x.id}">Recibido</button>` : ''}</div></article>`;
    }).join('') : '<div class="g-vacio"><b>Sin incendios activos</b><span>La alarma sonará cuando llegue un reporte.</span></div>';
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    $('g-pie').innerHTML = `<span><b>${act.length}</b> activos</span><span><b>${nuevos.length}</b> sin confirmar</span>
      <span><b>${xs.filter((x) => CIERRE(x.estado) && new Date(x.actualizado_en) >= hoy).length}</b> cerrados hoy</span>`;
    capa.clearLayers();
    const pts: L.LatLngTuple[] = [];
    for (const x of act) { L.circleMarker([x.lat, x.lon], { radius: 11, color: '#fff', weight: 3, fillColor: COLOR_TIPO[x.tipo], fillOpacity: 1, className: x.estado === 'nuevo' ? 'parpadea' : '' }).addTo(capa).bindTooltip(`${NOMBRE_TIPO[x.tipo]} · ${x.folio}`); pts.push([x.lat, x.lon]); }
    if (pts.length && primera) { mapa.fitBounds(L.latLngBounds(pts).pad(.4), { maxZoom: 14 }); primera = false; }
    raiz.querySelectorAll<HTMLButtonElement>('[data-ok]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Marcando…';
      try { await accion({ accion: 'estado', incidente: b.dataset.ok!, estado: 'recibido' }); aviso('Marcado como recibido. Se avisó al ciudadano.'); }
      catch { aviso('No se pudo marcar.', true); }
      cargar();
    }));
  };
  cargar();
  const ciclo = window.setInterval(cargar, 10000);
  return () => { clearInterval(ciclo); clearInterval(reloj); alarma.parar(); mapa.remove(); document.body.classList.remove('modo-guardia'); };
}
