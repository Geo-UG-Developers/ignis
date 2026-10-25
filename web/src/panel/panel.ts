// IGNIS · panel web para bomberos, Protección Civil y coordinación.
import './panel.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { I } from '../iconos';
import type { Estado, Tipo } from '../api';
import { accion, dbp, detalle, estadisticas, historico, historicoResumen, incidentes, urlsFotos, yo,
  type Detalle, type Incidente, type Yo } from './datos';
import { activarTips, apiladas, barras, COLOR_TIPO, leyendaTipos, NOMBRE_TIPO, ORDEN_TIPOS } from './graficas';

const BASE = import.meta.env.BASE_URL;
const raiz = document.getElementById('panel')!;
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fecha = (f: string) => new Date(f).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fechaCorta = (f: string) => new Date(f).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });

const ESTADO: Record<Estado, { txt: string; cls: string }> = {
  nuevo: { txt: 'Sin confirmar', cls: 'p-rojo' }, recibido: { txt: 'Recibido', cls: 'p-naranja' },
  en_camino: { txt: 'En camino', cls: 'p-ambar' }, controlado: { txt: 'Controlado', cls: 'p-verde' },
  extinguido: { txt: 'Extinguido', cls: 'p-verde' }, falso: { txt: 'Falso o duplicado', cls: 'p-gris' },
};
const SIGUIENTE: Estado[] = ['recibido', 'en_camino', 'controlado', 'extinguido'];
const CIERRE = (e: Estado) => e === 'controlado' || e === 'extinguido' || e === 'falso';
const ERRORES: Record<string, string> = {
  solo_admin: 'Solo un administrador de la institución puede cerrar un incendio.',
  transicion_invalida: 'Ese estado ya se había marcado.', incidente_cerrado: 'Este incendio ya está cerrado.',
  tiempo_vencido: 'Ya pasaron 2 minutos; ese cambio ya no se puede deshacer.', sin_permiso: 'No tienes permiso para este incendio.',
};

let mio: Yo | null = null;
let seleccion: string | null = null;
let mapa: L.Map | null = null;
let ciclo: number | undefined;

function aviso(txt: string, error = false) {
  const t = document.createElement('div');
  t.className = `toast ${error ? 'error' : ''}`; t.setAttribute('role', 'status'); t.textContent = txt;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4500);
}
function limpiar() {
  const tip = document.getElementById('tip-g'); if (tip) tip.style.opacity = '0';
  if (mapa) { mapa.remove(); mapa = null; }
  if (ciclo) { clearInterval(ciclo); ciclo = undefined; }
}
const capaBase = (m: L.Map) => {
  m.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
};

// ---------------------------------------------------------------- acceso
function pantallaAcceso(mensaje = '') {
  limpiar();
  raiz.innerHTML = `
  <main class="acceso">
    <form class="caja-acceso" id="form">
      <img src="${BASE}icono.png" alt="" class="icono"><img src="${BASE}wordmark.png" alt="IGNIS" class="marca">
      <h1>Panel institucional</h1>
      <p class="tenue">Para bomberos, Protección Civil y coordinación.</p>
      <label>Correo<input type="email" id="correo" autocomplete="username" required></label>
      <label>Contraseña<input type="password" id="clave" autocomplete="current-password" required></label>
      ${mensaje ? `<p class="error-txt" role="alert">${esc(mensaje)}</p>` : ''}
      <button class="btn primario" type="submit">Entrar</button>
      <p class="tenue chica">La cuenta la da de alta el administrador del proyecto IGNIS.</p>
    </form>
  </main>`;
  document.getElementById('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const correo = (document.getElementById('correo') as HTMLInputElement).value.trim();
    const clave = (document.getElementById('clave') as HTMLInputElement).value;
    const { error } = await dbp.auth.signInWithPassword({ email: correo, password: clave });
    if (error) return pantallaAcceso('Correo o contraseña incorrectos.');
    iniciar();
  });
}

async function iniciar() {
  const { data } = await dbp.auth.getSession();
  if (!data.session || data.session.user.is_anonymous) return pantallaAcceso();
  try { mio = await yo(); } catch { mio = null; }
  if (!mio) {
    raiz.innerHTML = `<main class="acceso"><div class="caja-acceso"><h1>Cuenta sin institución</h1>
      <p class="tenue">Tu cuenta (${esc(data.session.user.email)}) todavía no está ligada a una institución. Pide al administrador del proyecto que te agregue.</p>
      <button class="btn" id="salir">Salir</button></div></main>`;
    document.getElementById('salir')!.addEventListener('click', salir);
    return;
  }
  ir();
}
async function salir() { await dbp.auth.signOut(); pantallaAcceso(); }

// ---------------------------------------------------------------- estructura
const SECCIONES = [
  { id: 'activos', txt: 'Reportes activos', ic: () => I.pin(18) },
  { id: 'historial', txt: 'Historial', ic: () => I.lista(18) },
  { id: 'estadisticas', txt: 'Estadísticas', ic: () => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>` },
  { id: 'mapa', txt: 'Mapa histórico', ic: () => I.mapa(18) },
];
function marco(activa: string, titulo: string, sub: string, contenido: string, acciones = '') {
  raiz.innerHTML = `
  <div class="marco">
    <aside class="lateral">
      <a class="logo" href="#activos"><img src="${BASE}icono_blanco.png" alt=""><span><b>IGNIS</b><small>Panel institucional</small></span></a>
      <nav aria-label="Secciones">${SECCIONES.map((s) => `<a href="#${s.id}" class="${s.id === activa ? 'on' : ''}" ${s.id === activa ? 'aria-current="page"' : ''}>${s.ic()}<span>${s.txt}</span><em id="n-${s.id}"></em></a>`).join('')}</nav>
      <div class="pie-lateral"><b>${esc(mio!.institucion)}</b><span>${esc(mio!.municipios.join(', ') || mio!.region)}</span>
        <span>${mio!.es_admin ? 'Administrador · puede cerrar incendios' : 'Integrante'}</span>
        <button class="enlace" id="salir">Salir</button></div>
    </aside>
    <main class="contenido">
      <header class="cabecera"><div><h1>${titulo}</h1><p class="tenue">${sub}</p></div><div class="acciones">${acciones}</div></header>
      ${contenido}
    </main>
  </div>`;
  document.getElementById('salir')!.addEventListener('click', salir);
}

// ---------------------------------------------------------------- activos
async function vistaActivos() {
  marco('activos', 'Reportes activos', 'Se actualiza solo cada 15 segundos', `
    <section class="kpis" id="kpis"></section>
    <section class="tres">
      <div class="col-lista" id="lista"><p class="tenue">Cargando…</p></div>
      <div class="col-mapa"><div id="mapa"></div></div>
      <div class="col-detalle" id="detalle"><div class="vacio-detalle">${I.pin(28)}<p>Elige un reporte de la lista o del mapa para ver fotos, datos y cambiar su estado.</p></div></div>
    </section>`);
  mapa = L.map('mapa', { zoomControl: true }).setView([20.95, -101.25], 10);
  capaBase(mapa);
  const capa = L.layerGroup().addTo(mapa);
  let primera = true;
  const pintar = async () => {
    let xs: Incidente[];
    try { xs = await incidentes(new Date(Date.now() - 24 * 3600e3)); } catch { return aviso('Sin conexión con el servidor.', true); }
    const activos = xs.filter((x) => !['extinguido', 'falso'].includes(x.estado));
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const k = (txt: string, v: number, cls = '') => `<div class="kpi ${cls}"><span>${txt}</span><b>${v}</b></div>`;
    document.getElementById('kpis')!.innerHTML =
      k('Sin confirmar', xs.filter((x) => x.estado === 'nuevo').length, 'rojo') +
      k('En camino', xs.filter((x) => x.estado === 'en_camino').length) +
      k('Activos', activos.length) +
      k('Controlados o extinguidos hoy', xs.filter((x) => ['controlado', 'extinguido'].includes(x.estado) && new Date(x.actualizado_en) >= hoy).length, 'verde');
    const n = document.getElementById('n-activos'); if (n) n.textContent = activos.length ? String(activos.length) : '';
    const lista = document.getElementById('lista');
    if (!lista) return;
    lista.innerHTML = xs.length ? xs.map((x) => `
      <button class="tarjeta-inc ${x.id === seleccion ? 'sel' : ''} ${x.estado === 'nuevo' ? 'urgente' : ''}" data-id="${x.id}">
        <span class="punto" style="background:${COLOR_TIPO[x.tipo]}"></span>
        <span class="cuerpo"><b>${esc(NOMBRE_TIPO[x.tipo])}</b><span>${esc(x.municipio ?? 'Sin municipio')} · ${fecha(x.creado_en)}</span>
        <span>${x.num_reportes} ${x.num_reportes === 1 ? 'reporte' : 'reportes'} · ${esc(x.folio)}${x.es_respaldo ? ' · <b>por escalamiento</b>' : ''}</span></span>
        <em class="pill ${ESTADO[x.estado].cls}">${ESTADO[x.estado].txt}${x.minutos_sin_confirmar != null ? ` · ${x.minutos_sin_confirmar} min` : ''}</em>
      </button>`).join('') : '<p class="tenue">No hay reportes en las últimas 24 horas.</p>';
    lista.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => b.addEventListener('click', () => elegir(b.dataset.id!)));
    capa.clearLayers();
    for (const x of xs) {
      const abierto = !['controlado', 'extinguido', 'falso'].includes(x.estado);
      L.circleMarker([x.lat, x.lon], { radius: 8 + Math.min(x.num_reportes, 6), color: '#fff', weight: 3,
        fillColor: x.estado === 'nuevo' ? '#B91C1C' : abierto ? '#E2611D' : '#1F7A3A', fillOpacity: 1 })
        .bindTooltip(`${NOMBRE_TIPO[x.tipo]} · ${ESTADO[x.estado].txt}`).on('click', () => elegir(x.id)).addTo(capa);
    }
    if (primera && xs.length) { mapa!.fitBounds(L.latLngBounds(xs.map((x) => [x.lat, x.lon])).pad(0.3), { maxZoom: 13 }); primera = false; }
    if (seleccion) pintarDetalle(seleccion, false);
  };
  const elegir = (id: string) => { seleccion = id; pintar(); pintarDetalle(id, true); };
  await pintar();
  ciclo = window.setInterval(pintar, 15000);
}

let confirmando: Estado | null = null;
async function pintarDetalle(id: string, centrar: boolean) {
  const caja = document.getElementById('detalle');
  if (!caja) return;
  let d: Detalle | null;
  try { d = await detalle(id); } catch { return; }
  if (!d || !document.getElementById('detalle')) return;
  if (centrar) mapa?.setView([d.lat, d.lon], 14);
  const fotos = await urlsFotos(d.reportes.flatMap((r) => r.fotos).slice(0, 6));
  const abiertos = SIGUIENTE.slice(SIGUIENTE.indexOf(d.estado as Estado) + 1);
  const botones = d.estado === 'extinguido' || d.estado === 'falso' ? [] : [...(d.estado === 'nuevo' ? SIGUIENTE : abiertos), 'falso' as Estado];
  caja.innerHTML = `
    <div class="det-cab"><span class="pill ${ESTADO[d.estado].cls}">${ESTADO[d.estado].txt}</span><span class="tenue">${esc(d.folio)}</span></div>
    <h2>${esc(NOMBRE_TIPO[d.tipo])}</h2>
    <p class="tenue">${esc(d.municipio ?? 'Sin municipio')} · ${d.num_reportes} ${d.num_reportes === 1 ? 'reporte ciudadano' : 'reportes ciudadanos'}</p>
    ${fotos.length ? `<div class="fotos">${fotos.map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Foto del reporte"></a>`).join('')}</div>` : '<p class="tenue">Sin fotos.</p>'}
    <dl class="datos">
      <dt>Primer reporte</dt><dd>${fecha(d.creado_en)}</dd>
      <dt>Coordenadas</dt><dd>${d.lat.toFixed(5)}, ${d.lon.toFixed(5)} · <a href="https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lon}" target="_blank" rel="noopener">Ruta</a></dd>
      <dt>Notificadas</dt><dd>${d.instituciones.map((i) => esc(i.nombre) + (i.es_respaldo ? ' (respaldo)' : '')).join(', ')}</dd>
    </dl>
    ${confirmando ? `<div class="confirmar" role="alert"><p>¿Confirmas que este incendio está <b>${ESTADO[confirmando].txt.toUpperCase()}</b>?</p>
      <div><button class="btn primario" id="si">Sí, confirmar</button><button class="btn" id="no">Cancelar</button></div></div>` :
      botones.length ? `<h3>Cambiar estado</h3><div class="botones">${botones.map((e) =>
        `<button class="btn ${e === 'falso' ? 'tenue-btn ancho' : ''}" data-estado="${e}" ${CIERRE(e) && !mio!.es_admin ? 'disabled title="Solo administradores"' : ''}>${ESTADO[e].txt === 'Sin confirmar' ? '' : ESTADO[e].txt}</button>`).join('')}</div>` : ''}
    ${d.puede_deshacer ? '<button class="btn ancho" id="deshacer">Deshacer último cambio (2 min)</button>' : ''}
    <h3>Línea de tiempo</h3>
    <ol class="linea-t">${d.eventos.map((e) => `<li><b>${ESTADO[e.estado].txt === 'Sin confirmar' ? 'Reporte recibido en el sistema' : ESTADO[e.estado].txt}</b>
      <span>${fecha(e.en)}${e.actor ? ` · ${esc(e.actor)}` : ''}${e.canal !== 'sistema' ? ` · vía ${e.canal}` : ''}</span></li>`).join('')}</ol>
    <h3>Reportes ciudadanos</h3>
    ${d.reportes.map((r) => `<div class="rep"><span class="tenue">${fecha(r.creado_en)} · ${esc(NOMBRE_TIPO[r.tipo])}${r.precision_m ? ` · GPS ±${Math.round(r.precision_m)} m` : ''}</span>
      ${r.comentario ? `<p>«${esc(r.comentario)}»</p>` : ''}
      <span class="tenue">${r.nombre ? esc(r.nombre) : 'Anónimo'}${r.telefono ? ` · ${esc(r.telefono)}` : ''}</span></div>`).join('')}`;
  const hacer = async (cuerpo: Parameters<typeof accion>[0]) => {
    try { await accion(cuerpo); aviso('Listo. También se actualizó el grupo de Telegram.'); }
    catch (e) { aviso(ERRORES[(e as Error).message] ?? 'No se pudo guardar el cambio.', true); }
    confirmando = null; pintarDetalle(id, false);
  };
  caja.querySelectorAll<HTMLButtonElement>('[data-estado]').forEach((b) => b.addEventListener('click', () => {
    const e = b.dataset.estado as Estado;
    if (CIERRE(e)) { confirmando = e; pintarDetalle(id, false); } else hacer({ accion: 'estado', incidente: id, estado: e });
  }));
  document.getElementById('si')?.addEventListener('click', () => hacer({ accion: 'estado', incidente: id, estado: confirmando! }));
  document.getElementById('no')?.addEventListener('click', () => { confirmando = null; pintarDetalle(id, false); });
  document.getElementById('deshacer')?.addEventListener('click', () => hacer({ accion: 'deshacer', incidente: id }));
}

// ---------------------------------------------------------------- historial
let filtro = { dias: 90, tipo: '', estado: '' };
async function vistaHistorial() {
  const op = (v: string | number, t: string, sel: unknown) => `<option value="${v}" ${String(sel) === String(v) ? 'selected' : ''}>${t}</option>`;
  marco('historial', 'Historial', 'Todos los incendios que atendió tu institución', `
    <section class="filtros-p">
      <label>Periodo<select id="f-dias">${op(30, 'Últimos 30 días', filtro.dias)}${op(90, 'Últimos 90 días', filtro.dias)}${op(365, 'Último año', filtro.dias)}${op(3650, 'Todo', filtro.dias)}</select></label>
      <label>Tipo<select id="f-tipo">${op('', 'Todos', filtro.tipo)}${ORDEN_TIPOS.map((t) => op(t, NOMBRE_TIPO[t], filtro.tipo)).join('')}</select></label>
      <label>Estado<select id="f-estado">${op('', 'Todos', filtro.estado)}${(Object.keys(ESTADO) as Estado[]).map((e) => op(e, ESTADO[e].txt, filtro.estado)).join('')}</select></label>
    </section>
    <section class="tabla-caja"><table><thead><tr><th>Fecha</th><th>Folio</th><th>Tipo</th><th>Municipio</th><th>Reportes</th><th>Estado</th><th>Último cambio por</th></tr></thead>
    <tbody id="filas"><tr><td colspan="7" class="tenue">Cargando…</td></tr></tbody></table></section>`,
    `<button class="btn" id="csv">${I.flecha(16)} Exportar CSV</button>`);
  ['dias', 'tipo', 'estado'].forEach((k) => document.getElementById(`f-${k}`)!.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    filtro = { ...filtro, [k]: k === 'dias' ? Number(v) : v }; vistaHistorial();
  }));
  const xs = (await incidentes(new Date(Date.now() - filtro.dias * 864e5)))
    .filter((x) => new Date(x.creado_en).getTime() >= Date.now() - filtro.dias * 864e5)
    .filter((x) => (!filtro.tipo || x.tipo === filtro.tipo) && (!filtro.estado || x.estado === filtro.estado));
  document.getElementById('filas')!.innerHTML = xs.length ? xs.map((x) => `<tr>
    <td>${fecha(x.creado_en)}</td><td>${esc(x.folio)}</td><td><i class="cuad" style="background:${COLOR_TIPO[x.tipo]}"></i>${esc(NOMBRE_TIPO[x.tipo])}</td>
    <td>${esc(x.municipio ?? '')}</td><td class="num">${x.num_reportes}</td><td><span class="pill ${ESTADO[x.estado].cls}">${ESTADO[x.estado].txt}</span></td>
    <td>${esc(x.ultimo_actor ?? '')}</td></tr>`).join('') : '<tr><td colspan="7" class="tenue">No hay incendios con esos filtros.</td></tr>';
  document.getElementById('csv')!.addEventListener('click', () => {
    const cab = ['fecha', 'folio', 'tipo', 'municipio', 'latitud', 'longitud', 'reportes', 'estado', 'ultimo_cambio_por'];
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = xs.map((x) => [x.creado_en, x.folio, NOMBRE_TIPO[x.tipo], x.municipio, x.lat.toFixed(6), x.lon.toFixed(6), x.num_reportes, ESTADO[x.estado].txt, x.ultimo_actor].map(q).join(','));
    const blob = new Blob(['﻿' + [cab.join(','), ...filas].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `ignis_historial_${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  });
}

// ---------------------------------------------------------------- estadísticas
async function vistaEstadisticas() {
  marco('estadisticas', 'Estadísticas', 'Últimos 12 meses de tu institución y el histórico 2021–2025 de la región', `
    <section class="kpis" id="kpis-e"><p class="tenue">Cargando…</p></section>
    <section class="dos">
      <article class="tarjeta-g"><h2>Reportes atendidos por mes</h2><p class="tenue">Incendios nuevos de tu institución, últimos 12 meses</p><div id="g-mes"></div></article>
      <article class="tarjeta-g"><h2>Por tipo de incendio</h2><p class="tenue">Últimos 12 meses</p><div id="g-tipo"></div></article>
    </section>
    <article class="tarjeta-g"><h2>Histórico de reportes ciudadanos por año</h2>
      <p class="tenue">IGNIS versión anterior, 2021–2025, solo ubicaciones confiables (1,158 reportes)</p>${leyendaTipos(['forestal', 'pastizal', 'quema_esquilmo'])}<div id="g-hist"></div>
      <details><summary>Ver como tabla</summary><div id="t-hist"></div></details></article>`);
  const [e, h] = await Promise.all([estadisticas(new Date(Date.now() - 365 * 864e5)), historicoResumen()]);
  const min = (v: number | null) => v == null ? '—' : v < 60 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`;
  document.getElementById('kpis-e')!.innerHTML = e ? `
    <div class="kpi"><span>Incendios atendidos</span><b>${e.total}</b></div>
    <div class="kpi"><span>Tiempo típico hasta «Recibido»</span><b>${min(e.mediana_min_recibido)}</b><small>mediana</small></div>
    <div class="kpi"><span>Tiempo típico hasta controlarlo</span><b>${min(e.mediana_min_control)}</b><small>mediana</small></div>
    <div class="kpi"><span>Falsos o duplicados</span><b>${e.falsos}</b></div>` : '';
  // Meses: los 12 últimos, con cero donde no hubo.
  const meses: { etiqueta: string; valor: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const clave = d.toISOString().slice(0, 7);
    meses.push({ etiqueta: d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''), valor: e?.por_mes.find((m) => m.mes === clave)?.total ?? 0 });
  }
  document.getElementById('g-mes')!.innerHTML = barras(meses.map((m) => ({ ...m, detalle: 'incendios' })));
  const tipos = ORDEN_TIPOS.filter((t) => (e?.por_tipo[t] ?? 0) > 0);
  const totalT = tipos.reduce((a, t) => a + (e!.por_tipo[t] ?? 0), 0);
  document.getElementById('g-tipo')!.innerHTML = tipos.length ? `<div class="barras-h">${tipos.map((t) => {
    const v = e!.por_tipo[t]!; return `<div class="fila-h" data-tip="${esc(`<b>${NOMBRE_TIPO[t]}</b><br>${v} incendios (${Math.round(v / totalT * 100)} %)`)}">
      <span>${NOMBRE_TIPO[t]}</span><div class="pista"><i style="width:${v / Math.max(...tipos.map((x) => e!.por_tipo[x]!)) * 100}%;background:${COLOR_TIPO[t]}"></i></div><b>${v}</b></div>`; }).join('')}</div>`
    : '<p class="tenue">Todavía no hay incendios en este periodo.</p>';
  const anios = [...new Set(h.map((x) => x.anio))].sort();
  const grupos = anios.map((a) => ({ etiqueta: String(a), valores: Object.fromEntries(h.filter((x) => x.anio === a).map((x) => [x.tipo, x.total])) as Partial<Record<Tipo, number>> }));
  document.getElementById('g-hist')!.innerHTML = apiladas(grupos);
  document.getElementById('t-hist')!.innerHTML = `<table><thead><tr><th>Año</th>${ORDEN_TIPOS.slice(0, 3).map((t) => `<th>${NOMBRE_TIPO[t]}</th>`).join('')}<th>Total</th></tr></thead><tbody>
    ${grupos.map((g) => `<tr><td>${g.etiqueta}</td>${ORDEN_TIPOS.slice(0, 3).map((t) => `<td class="num">${g.valores[t] ?? 0}</td>`).join('')}<td class="num"><b>${ORDEN_TIPOS.reduce((a, t) => a + (g.valores[t] ?? 0), 0)}</b></td></tr>`).join('')}</tbody></table>`;
  activarTips(document.querySelector('.contenido')!);
}

// ---------------------------------------------------------------- mapa histórico
let anioMapa = 0;
async function vistaMapa() {
  const anios = [2021, 2022, 2023, 2024, 2025];
  marco('mapa', 'Mapa histórico', 'Reportes 2021–2025 (versión anterior) y reportes nuevos de IGNIS 2.0', `
    <section class="filtros-p chips">
      <button data-a="0" class="${anioMapa === 0 ? 'on' : ''}">Todos los años</button>
      ${anios.map((a) => `<button data-a="${a}" class="${anioMapa === a ? 'on' : ''}">${a}</button>`).join('')}
      <span class="separa"></span>
      ${leyendaTipos(['forestal', 'pastizal', 'quema_esquilmo'])}<span class="leyenda-g"><span><i class="anillo"></i>Reporte nuevo (IGNIS 2.0)</span></span>
    </section>
    <div class="mapa-grande"><div id="mapa"></div></div>`);
  document.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => { anioMapa = Number(b.dataset.a); limpiar(); vistaMapa(); }));
  mapa = L.map('mapa').setView([20.85, -101.1], 9);
  capaBase(mapa);
  const [hist, nuevos] = await Promise.all([historico(), incidentes(new Date(Date.now() - 365 * 864e5))]);
  for (const p of hist.filter((x) => x.confiable && (!anioMapa || x.anio === anioMapa))) {
    L.circleMarker([p.lat, p.lon], { radius: 5, color: '#fff', weight: 1, fillColor: COLOR_TIPO[p.tipo], fillOpacity: 0.85 })
      .bindTooltip(`${NOMBRE_TIPO[p.tipo]} · ${p.municipio ?? ''} · ${p.mes}/${p.anio}`).addTo(mapa);
  }
  for (const x of nuevos.filter((n) => !anioMapa || new Date(n.creado_en).getFullYear() === anioMapa)) {
    L.circleMarker([x.lat, x.lon], { radius: 9, color: '#1C1917', weight: 3, fillColor: COLOR_TIPO[x.tipo], fillOpacity: 1 })
      .bindTooltip(`Nuevo · ${NOMBRE_TIPO[x.tipo]} · ${fechaCorta(x.creado_en)} · ${ESTADO[x.estado].txt}`).addTo(mapa);
  }
}

// ---------------------------------------------------------------- rutas
const VISTAS: Record<string, () => void> = { activos: vistaActivos, historial: vistaHistorial, estadisticas: vistaEstadisticas, mapa: vistaMapa };
function ir() {
  if (!mio) return;
  limpiar();
  (VISTAS[location.hash.slice(1)] ?? vistaActivos)();
}
window.addEventListener('hashchange', ir);
iniciar();
