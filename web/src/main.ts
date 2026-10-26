// IGNIS · app web del ciudadano. Pantallas con rutas en el "#" de la URL.
import './estilos.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { I } from './iconos';
import {
  activarAvisos, asegurarSesion, comprimir, enviarReporte, estadoAvisos, historicoPublico, incidentesPublicos, misReportes,
  registrarServiceWorker,
  type Estado, type MiReporte, type Respuesta, type Tipo,
} from './api';
import { riesgoHoy } from './riesgo';
import { prepararSonido, sonarEnviado } from './sonido';
import { PRIVACIDAD, TERMINOS } from './legal';

const BASE = import.meta.env.BASE_URL;
const app = document.getElementById('app')!;

// ---------------------------------------------------------------- textos
const TIPOS: { id: Tipo; nombre: string; icono: () => string }[] = [
  { id: 'forestal', nombre: 'Forestal', icono: () => I.arbol(24) },
  { id: 'pastizal', nombre: 'Pastizal', icono: () => I.pasto(24) },
  { id: 'quema_esquilmo', nombre: 'Quema de esquilmo', icono: () => I.campo(24) },
  { id: 'quema_basura', nombre: 'Quema de basura', icono: () => I.basura(24) },
];
const NOMBRE_TIPO: Record<Tipo, string> = {
  forestal: 'Incendio forestal', pastizal: 'Incendio de pastizal',
  quema_esquilmo: 'Quema de esquilmo', quema_basura: 'Quema de basura',
};
const ESTADO: Record<Estado, { txt: string; cls: string }> = {
  nuevo: { txt: 'Enviado', cls: 'p-gris' },
  recibido: { txt: 'Recibido', cls: 'p-rojo' },
  en_camino: { txt: 'Brigada en camino', cls: 'p-ambar' },
  controlado: { txt: 'Controlado', cls: 'p-verde' },
  extinguido: { txt: 'Extinguido', cls: 'p-verde' },
  falso: { txt: 'Descartado', cls: 'p-gris' },
};
const PASOS: { estado: Estado; txt: string }[] = [
  { estado: 'nuevo', txt: 'Enviado' },
  { estado: 'recibido', txt: 'Recibido por la autoridad' },
  { estado: 'en_camino', txt: 'Brigada en camino' },
  { estado: 'controlado', txt: 'Controlado' },
  { estado: 'extinguido', txt: 'Extinguido' },
];

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hora = (f: string) => new Date(f).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------- estado
const borrador = {
  fotos: [] as { blob: Blob; url: string }[],
  tipo: 'forestal' as Tipo,
  lat: 0, lon: 0, precision: 0, tieneUbicacion: false,
  comentario: '', nombre: '',
};
let ultimo: (Respuesta & { reporte_id?: string; enviado_en: number }) | null = null;
let mapa: L.Map | null = null;
let sondeo: number | undefined;

function limpiar() {
  if (mapa) { mapa.remove(); mapa = null; }
  if (sondeo) { clearInterval(sondeo); sondeo = undefined; }
}

// ---------------------------------------------------------------- piezas
const nav = (activo: string) => `
<nav class="nav" aria-label="Navegación principal">
  ${[['inicio', 'Inicio', I.inicio], ['mapa', 'Mapa', I.mapa], ['mis', 'Mis reportes', I.lista], ['info', 'Info', I.info]]
    .map(([id, txt, ic]) => `<a href="#/${id}" class="${activo === id ? 'on' : ''}" ${activo === id ? 'aria-current="page"' : ''}>${(ic as () => string)()}<span>${txt}</span></a>`).join('')}
</nav>`;

const cabeceraPaso = (titulo: string, paso: number, atras: string) => `
<header class="paso">
  <div class="fila">
    <a class="redondo" href="${atras}" aria-label="${paso === 1 ? 'Cancelar reporte' : 'Volver'}">${paso === 1 ? I.cerrar(20) : I.atras(20)}</a>
    <h1>${titulo}</h1>
    <span class="cuenta">${paso} de 2</span>
  </div>
  <div class="barra" role="img" aria-label="Paso ${paso} de 2"><i class="on"></i><i class="${paso === 2 ? 'on' : ''}"></i></div>
</header>`;

function aviso(txt: string) {
  const t = document.createElement('div');
  t.className = 'toast'; t.role = 'status'; t.textContent = txt;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

const TEXTO_AVISOS: Record<string, string> = {
  apagados: 'Activa los avisos y te diremos cuando la autoridad reciba tu reporte y cuando el incendio se apague.',
  bloqueados: 'Los avisos están bloqueados para este sitio. Actívalos en la configuración del navegador.',
  no_soportado: 'Este navegador no permite avisos. Consulta el estado en «Mis reportes».',
  instalar_ios: 'En iPhone: toca Compartir y luego «Agregar a inicio». Abre IGNIS desde ese ícono para activar los avisos.',
};
function tarjetaAvisos(cajaId: string) {
  estadoAvisos().then((e) => {
    const caja = document.getElementById(cajaId);
    if (!caja || e === 'activos') return;
    caja.innerHTML = `<section class="tarjeta avisos"><div><b>Recibe avisos en tu teléfono</b><p>${TEXTO_AVISOS[e]}</p></div>
      ${e === 'apagados' ? '<button class="boton chico" id="btn-avisos">Activar avisos</button>' : ''}</section>`;
    document.getElementById('btn-avisos')?.addEventListener('click', async () => {
      try {
        const r = await activarAvisos();
        if (r === 'activos') { caja.innerHTML = ''; aviso('Listo: te avisaremos de cada cambio.'); } else tarjetaAvisos(cajaId);
      } catch { aviso('No se pudieron activar los avisos. Inténtalo de nuevo.'); }
    });
  }).catch(() => {});
}

// ---------------------------------------------------------------- pantallas
const CLAVE_BIENVENIDA = 'ignis-bienvenida';
function bienvenida() {
  app.innerHTML = `
  <main class="pantalla bienvenida">
    <span class="bv-region">Guanajuato</span>
    <div class="bv-centro">
      <img src="${BASE}icono.png" alt="" class="bv-icono">
      <img src="${BASE}wordmark.png" alt="IGNIS" class="bv-marca">
      <p>Reporte ciudadano de incendios forestales y de pastizal</p>
    </div>
    <div class="bv-pie">
      <button class="boton" id="comenzar" type="button">Comenzar</button>
      <div class="bv-credito"><img src="${BASE}geoug.png" alt=""><span>Desarrollado por <b>GEO UG Developers</b></span></div>
      <span class="bv-credito">Universidad de Guanajuato · GeoUG</span>
      <p class="legal">Al continuar aceptas los <a href="#/terminos">términos de uso</a> y el <a href="#/privacidad">aviso de privacidad</a>.</p>
    </div>
  </main>`;
  document.getElementById('comenzar')!.addEventListener('click', () => {
    try { localStorage.setItem(CLAVE_BIENVENIDA, '1'); } catch { /* */ }
    location.hash = '#/inicio'; if (location.hash === '#/inicio') ir();
  });
}
function vioBienvenida() { try { return localStorage.getItem(CLAVE_BIENVENIDA) === '1'; } catch { return true; } }

function inicio() {
  if (!vioBienvenida()) { bienvenida(); return; }
  app.innerHTML = `
  <main class="pantalla con-nav">
    <header class="cab">
      <img src="${BASE}wordmark.png" alt="IGNIS" class="logo">
      <span class="chip">${I.pin(16)} Guanajuato</span>
    </header>
    <h1 class="grande">¿Ves humo o fuego?</h1>
    <p class="sub">Repórtalo en segundos. Tu ubicación y la hora se agregan solas.</p>
    <a class="reportar" href="#/foto">
      <span class="ico"><img src="${BASE}icono_blanco.png" alt=""></span>
      <span><b>Reportar incendio</b><small>Foto · tipo · ubicación</small></span>
    </a>
    <section class="tarjeta riesgo" id="riesgo" aria-live="polite"><p class="tenue">Calculando riesgo de incendio…</p></section>
    <section class="tarjeta">
      <div class="fila-tit"><h2>Activos en la región</h2><a href="#/mapa">Ver mapa</a></div>
      <div id="activos" class="lista-mini"><p class="tenue">Cargando…</p></div>
    </section>
    <a class="emergencia" href="tel:911">${I.tel(18)} En emergencia llama al <b>911</b></a>
  </main>${nav('inicio')}`;
  incidentesPublicos().then((xs) => {
    const abiertos = xs.filter((x) => !['extinguido', 'falso'].includes(x.estado)).slice(0, 3);
    document.getElementById('activos')!.innerHTML = abiertos.length
      ? abiertos.map((x) => `<div class="mini"><b>${esc(NOMBRE_TIPO[x.tipo])}</b><span>${esc(x.municipio ?? 'Sin municipio')} · ${hora(x.creado_en)}</span><em class="pill ${ESTADO[x.estado].cls}">${ESTADO[x.estado].txt}</em></div>`).join('')
      : '<p class="tenue">No hay incendios activos reportados.</p>';
  }).catch(() => { document.getElementById('activos')!.innerHTML = '<p class="tenue">Sin conexión con el servidor.</p>'; });
  pintarRiesgo();
}

function pintarRiesgo() {
  riesgoHoy().then((r) => {
    const caja = document.getElementById('riesgo'); if (!caja) return;
    const barras = [1, 2, 3, 4, 5].map((i) => `<i class="${i <= r.nivel ? 'on' : ''}" style="height:${6 + i * 5}px"></i>`).join('');
    caja.className = `tarjeta riesgo n${r.nivel}`;
    caja.innerHTML = `
      <div class="riesgo-cab">
        <div><span class="tenue">Riesgo de incendio hoy · ${r.lugar}</span><b class="riesgo-nivel">${r.texto}</b></div>
        <div class="riesgo-barras" role="img" aria-label="Nivel ${r.nivel} de 5">${barras}</div>
      </div>
      <div class="riesgo-datos">
        <div><span>${I.viento(14)} Viento</span><b>${r.viento} km/h</b></div>
        <div><span>${I.gota(14)} Humedad</span><b>${r.humedad} %</b></div>
        <div><span>${I.termo(14)} Temp.</span><b>${r.temp} °C</b></div>
      </div>
      <p class="riesgo-nota">Estimación con el clima actual${r.lluvia3d ? ` y ${r.lluvia3d} mm de lluvia en 3 días` : ''}. No es un aviso oficial. Datos: Open-Meteo.</p>`;
  }).catch(() => { document.getElementById('riesgo')?.remove(); });
}

function foto() {
  const miniaturas = borrador.fotos.map((f, i) =>
    `<button class="mini-foto" data-quitar="${i}" aria-label="Quitar foto ${i + 1}"><img src="${f.url}" alt=""><span>${I.cerrar(14)}</span></button>`).join('');
  app.innerHTML = `
  <main class="pantalla">
    ${cabeceraPaso('Nuevo reporte', 1, '#/inicio')}
    <label class="visor ${borrador.fotos.length ? 'con-foto' : ''}">
      ${borrador.fotos.length ? `<img src="${borrador.fotos.at(-1)!.url}" alt="Foto del incendio">` : `<span class="vacio">${I.camara(40)}<b>Toca para tomar una foto</b><small>Encuadra el humo o las llamas</small></span>`}
      <input id="camara" type="file" accept="image/*" capture="environment" hidden>
    </label>
    <div class="fila-fotos">
      ${miniaturas}
      ${borrador.fotos.length < 3 ? `<label class="mini-foto agregar" aria-label="Agregar foto desde la galería">${I.galeria(20)}<input id="galeria" type="file" accept="image/*" hidden></label>` : ''}
      <span class="tenue">${borrador.fotos.length} de 3 fotos</span>
    </div>
    <h2>¿Qué tipo de incendio es?</h2>
    <div class="tipos">
      ${TIPOS.map((t) => `<button class="tipo ${borrador.tipo === t.id ? 'on' : ''}" data-tipo="${t.id}" aria-pressed="${borrador.tipo === t.id}">${t.icono()}<span>${t.nombre}</span></button>`).join('')}
    </div>
    <div class="pie"><a class="boton ${borrador.fotos.length ? '' : 'apagado'}" href="#/ubicacion" id="seguir">Continuar ${I.flecha(20)}</a></div>
  </main>`;
  const agregar = async (input: HTMLInputElement | null) => {
    const f = input?.files?.[0];
    if (!f) return;
    try {
      const blob = await comprimir(f);
      borrador.fotos.push({ blob, url: URL.createObjectURL(blob) });
      foto();
    } catch { aviso('No se pudo leer la foto. Intenta con otra.'); }
  };
  (['camara', 'galeria'] as const).forEach((id) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.addEventListener('change', () => agregar(el));
  });
  app.querySelectorAll<HTMLButtonElement>('[data-tipo]').forEach((b) =>
    b.addEventListener('click', () => { borrador.tipo = b.dataset.tipo as Tipo; foto(); }));
  app.querySelectorAll<HTMLButtonElement>('[data-quitar]').forEach((b) =>
    b.addEventListener('click', () => { borrador.fotos.splice(Number(b.dataset.quitar), 1); foto(); }));
  document.getElementById('seguir')!.addEventListener('click', (e) => {
    if (!borrador.fotos.length) { e.preventDefault(); aviso('Agrega al menos una foto del incendio.'); }
  });
}

function ubicacion() {
  if (!borrador.fotos.length) { location.hash = '#/foto'; return; }
  app.innerHTML = `
  <main class="pantalla">
    ${cabeceraPaso('¿Dónde es?', 2, '#/foto')}
    <div class="mapa-caja"><div id="mapa"></div><span class="etiqueta">Toca el mapa o arrastra el pin</span>
      <button class="redondo gps" id="gps" aria-label="Usar mi ubicación actual">${I.gps(20)}</button></div>
    <div class="tarjeta fila-ubic">${I.pin(20)}<div><b id="ubic-tit">Buscando tu ubicación…</b><span id="ubic-sub" class="tenue">Permite el acceso a la ubicación</span></div></div>
    <label class="campo"><span>Comentario <span class="tenue">(opcional)</span></span>
      <textarea id="comentario" maxlength="500" placeholder="Ej. el humo viene del cerro, cerca de la carretera">${esc(borrador.comentario)}</textarea></label>
    <label class="campo"><span>Tu nombre <span class="tenue">(opcional)</span></span>
      <input id="nombre" maxlength="120" placeholder="Puedes reportar de forma anónima" value="${esc(borrador.nombre)}"></label>
    <div class="pie"><button class="boton" id="enviar">${I.enviar(20)} Enviar reporte</button>
      <p class="legal">Tus datos se usan solo para atender el incendio. <a href="#/privacidad">Aviso de privacidad</a></p></div>
  </main>`;
  const centro: L.LatLngTuple = borrador.tieneUbicacion ? [borrador.lat, borrador.lon] : [21.0190, -101.2574];
  mapa = L.map('mapa', { zoomControl: false, attributionControl: true }).setView(centro, borrador.tieneUbicacion ? 15 : 12);
  mapa.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  const icono = L.divIcon({ className: 'pin-ignis', html: '<span></span>', iconSize: [34, 44], iconAnchor: [17, 42] });
  const pin = L.marker(centro, { draggable: true, icon: icono }).addTo(mapa);
  const pintar = (manual: boolean) => {
    document.getElementById('ubic-tit')!.textContent = manual ? 'Ubicación ajustada a mano' : 'Ubicación de tu teléfono';
    document.getElementById('ubic-sub')!.textContent =
      `${borrador.lat.toFixed(5)}, ${borrador.lon.toFixed(5)}${borrador.precision && !manual ? ` · GPS ±${Math.round(borrador.precision)} m` : ''}`;
  };
  const fijar = (p: L.LatLng) => {
    Object.assign(borrador, { lat: p.lat, lon: p.lng, tieneUbicacion: true, precision: 0 });
    pintar(true);
  };
  pin.on('dragend', () => fijar(pin.getLatLng()));
  // Tocar el mapa coloca el pin en ese punto.
  mapa.on('click', (e: L.LeafletMouseEvent) => { pin.setLatLng(e.latlng); fijar(e.latlng); });
  const pedirGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      Object.assign(borrador, { lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy, tieneUbicacion: true });
      pin.setLatLng([borrador.lat, borrador.lon]);
      mapa?.setView([borrador.lat, borrador.lon], 16);
      pintar(false);
    }, () => {
      document.getElementById('ubic-tit')!.textContent = 'No pudimos obtener tu ubicación';
      document.getElementById('ubic-sub')!.textContent = 'Toca el mapa en el lugar del incendio';
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  };
  if (borrador.tieneUbicacion) pintar(!borrador.precision); else pedirGps();
  document.getElementById('gps')!.addEventListener('click', pedirGps);
  document.getElementById('comentario')!.addEventListener('input', (e) => { borrador.comentario = (e.target as HTMLTextAreaElement).value; });
  document.getElementById('nombre')!.addEventListener('input', (e) => { borrador.nombre = (e.target as HTMLInputElement).value; });

  const boton = document.getElementById('enviar') as HTMLButtonElement;
  boton.addEventListener('click', async () => {
    if (!borrador.tieneUbicacion) { aviso('Toca el mapa en el lugar del incendio o activa tu ubicación.'); return; }
    boton.disabled = true; boton.textContent = 'Enviando…';
    prepararSonido();
    try {
      const r = await enviarReporte({
        tipo: borrador.tipo, lat: borrador.lat, lon: borrador.lon, precision: borrador.precision,
        comentario: borrador.comentario.trim(), nombre: borrador.nombre.trim(), fotos: borrador.fotos.map((f) => f.blob),
      });
      ultimo = { ...r, enviado_en: Date.now() };
      borrador.fotos.forEach((f) => URL.revokeObjectURL(f.url));
      Object.assign(borrador, { fotos: [], comentario: '', tieneUbicacion: false, precision: 0 });
      sonarEnviado();
      location.hash = '#/enviado';
    } catch (e) {
      const m = (e as Error).message;
      aviso(m === 'limite' ? 'Enviaste muchos reportes en poco tiempo. Espera un momento.'
        : 'No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.');
      boton.disabled = false; boton.innerHTML = `${I.enviar(20)} Enviar reporte`;
    }
  });
}

function lineaTiempo(r: MiReporte | null, estadoBase: Estado) {
  const estado = r?.estado ?? estadoBase;
  const alcanzado = (e: Estado) => PASOS.findIndex((p) => p.estado === e) <= PASOS.findIndex((p) => p.estado === estado);
  const cuando = (e: Estado) => r?.eventos.find((x) => x.estado === e);
  if (estado === 'falso') return '<p class="tenue">La institución marcó este reporte como falso o duplicado.</p>';
  return `<ol class="linea">${PASOS.map((p, i) => {
    const ok = alcanzado(p.estado);
    const actual = p.estado === estado && estado !== 'extinguido';
    const ev = cuando(p.estado);
    return `<li class="${ok ? 'ok' : ''} ${actual ? 'actual' : ''}"><i>${ok && !actual ? I.check(13) : ''}</i><div><b>${p.txt}</b>${ev ? `<span>${hora(ev.en)}${ev.institucion && i > 0 ? ` · ${esc(ev.institucion)}` : ''}</span>` : ''}</div></li>`;
  }).join('')}</ol>`;
}

function enviado() {
  if (!ultimo) { location.hash = '#/mis'; return; }
  const u = ultimo;
  app.innerHTML = `
  <main class="pantalla">
    <header class="cab"><span></span><a class="redondo" href="#/inicio" aria-label="Cerrar">${I.cerrar(20)}</a></header>
    <div class="exito">${I.check(30)}</div>
    <h1 class="grande">¡Reporte enviado!</h1>
    <p class="sub">${u.agrupado ? 'Otras personas ya habían reportado este incendio; tu reporte se sumó al mismo caso.' : 'Gracias. Ya llegó a las autoridades de tu zona.'} Esta pantalla se actualiza sola.</p>
    <span class="folio">Folio ${esc(u.folio)}</span>
    <section class="tarjeta"><span class="tenue">Se notificó a</span>
      <div class="chips">${u.instituciones.length ? u.instituciones.map((n) => `<span>${esc(n)}</span>`).join('') : '<span>Aún no hay institución registrada para esta zona</span>'}</div></section>
    <div id="caja-avisos"></div>
    <section class="tarjeta"><h2>Seguimiento</h2><div id="linea">${lineaTiempo(null, u.estado)}</div></section>
    <a class="emergencia ambar" href="tel:911">${I.tel(18)} Aléjate del humo. Emergencias: <b>911</b></a>
    <div class="pie dos"><a class="boton claro" href="#/mis">Mis reportes</a><a class="boton negro" href="#/inicio">Listo</a></div>
  </main>`;
  const actualizar = async () => {
    try {
      const xs = await misReportes();
      const r = xs.find((x) => x.folio === u.folio) ?? null;
      const caja = document.getElementById('linea');
      if (caja && r) caja.innerHTML = lineaTiempo(r, u.estado);
    } catch { /* se reintenta en el siguiente ciclo */ }
  };
  tarjetaAvisos('caja-avisos');
  actualizar();
  sondeo = window.setInterval(actualizar, 5000);
}

function mis() {
  app.innerHTML = `
  <main class="pantalla con-nav">
    <h1 class="grande">Mis reportes</h1>
    <p class="sub">Sigue en qué va cada reporte que enviaste desde este teléfono.</p>
    <div id="caja-avisos"></div>
    <div id="mis" class="lista"><p class="tenue">Cargando…</p></div>
    <a class="boton linea-roja" href="#/foto">${I.mas(18)} Nuevo reporte</a>
  </main>${nav('mis')}`;
  const pintar = async () => {
    try {
      const xs = await misReportes();
      const caja = document.getElementById('mis');
      if (!caja) return;
      caja.innerHTML = xs.length ? xs.map((x) => `
        <article class="tarjeta reporte"><div><b>${esc(NOMBRE_TIPO[x.tipo])}</b><span class="tenue">${esc(x.municipio ?? 'Fuera de cobertura')} · ${hora(x.creado_en)}</span>
        <span class="tenue">Folio ${esc(x.folio)}</span></div><em class="pill ${ESTADO[x.estado].cls}">${ESTADO[x.estado].txt}</em></article>`).join('')
        : '<p class="tenue">Todavía no has enviado reportes.</p>';
    } catch { const c = document.getElementById('mis'); if (c) c.innerHTML = '<p class="tenue">Sin conexión con el servidor.</p>'; }
  };
  tarjetaAvisos('caja-avisos');
  pintar();
  sondeo = window.setInterval(pintar, 8000);
}

let anioHistorico = 0;   // 0 = capa apagada; 1 = todos los años
function mapaVista() {
  const anios = [2021, 2022, 2023, 2024, 2025];
  app.innerHTML = `
  <main class="pantalla sin-relleno con-nav">
    <div id="mapa" class="mapa-completo"></div>
    <div class="panel-mapa">
      <div class="leyenda"><span><i class="c-rojo"></i>Activo</span><span><i class="c-verde"></i>Controlado o extinguido</span>
        ${anioHistorico ? '<span><i class="c-hist"></i>Histórico (reportes 2021–2025)</span>' : ''}</div>
      <div class="filtros" role="group" aria-label="Capa histórica">
        <button data-anio="0" class="${anioHistorico === 0 ? 'on' : ''}">Solo actuales</button>
        <button data-anio="1" class="${anioHistorico === 1 ? 'on' : ''}">Histórico</button>
        ${anioHistorico ? anios.map((a) => `<button data-anio="${a}" class="${anioHistorico === a ? 'on' : ''}">${a}</button>`).join('') : ''}
      </div>
    </div>
  </main>${nav('mapa')}`;
  app.querySelectorAll<HTMLButtonElement>('[data-anio]').forEach((b) => b.addEventListener('click', () => {
    anioHistorico = Number(b.dataset.anio); limpiar(); mapaVista();
  }));
  mapa = L.map('mapa', { zoomControl: false }).setView([20.85, -101.1], 8);
  mapa.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  if (anioHistorico) {
    const [desde, hasta] = anioHistorico === 1 ? [2021, 2100] : [anioHistorico, anioHistorico];
    historicoPublico(desde, hasta).then((xs) => {
      const capa = L.layerGroup().addTo(mapa!);
      for (const x of xs.filter((p) => p.confiable)) {
        L.circleMarker([x.lat, x.lon], { radius: 4, stroke: false, fillColor: '#E2611D', fillOpacity: 0.55 })
          .bindPopup(`<b>${esc(NOMBRE_TIPO[x.tipo])}</b><br>${esc(x.municipio ?? '')} · ${x.mes}/${x.anio}`).addTo(capa);
      }
      aviso(`${xs.filter((p) => p.confiable).length} reportes históricos en el mapa`);
    }).catch(() => aviso('No se pudo cargar el histórico.'));
  }
  incidentesPublicos().then((xs) => {
    for (const x of xs) {
      const activo = !['controlado', 'extinguido'].includes(x.estado);
      L.circleMarker([x.lat, x.lon], {
        radius: 8 + Math.min(x.num_reportes, 6), color: '#fff', weight: 3,
        fillColor: activo ? '#C8352A' : '#00702A', fillOpacity: 1,
      }).addTo(mapa!).bindPopup(`<b>${esc(NOMBRE_TIPO[x.tipo])}</b><br>${esc(x.municipio ?? '')}<br>${ESTADO[x.estado].txt} · ${x.num_reportes} reporte(s)`);
    }
  }).catch(() => aviso('No se pudo cargar el mapa de incendios.'));
}

function info() {
  app.innerHTML = `
  <main class="pantalla con-nav">
    <div class="acerca"><img src="${BASE}icono.png" alt="" class="icono-grande"><img src="${BASE}wordmark.png" alt="IGNIS" class="logo">
    <p class="sub centrado">Un proyecto de la Universidad de Guanajuato (GeoUG) para que la ciudadanía reporte incendios y las autoridades respondan más rápido.</p></div>
    <a class="emergencia fuerte" href="tel:911">${I.tel(20)} <span><b>Emergencia: llama al 911</b><small>IGNIS no sustituye al servicio de emergencias</small></span></a>
    <section class="tarjeta"><h2>Reporta de forma segura</h2>
      <ul class="puntos"><li>No te acerques al fuego para tomar la foto.</li><li>Aléjate del humo y ponte a salvo primero.</li><li>Si el fuego está cerca de casas, llama al 911.</li></ul></section>
    <p class="legal"><a href="#/privacidad">Aviso de privacidad</a> · <a href="#/terminos">Términos de uso</a></p>
    <p class="tenue centrado">Versión piloto · Guanajuato</p>
  </main>${nav('info')}`;
}
function legal(cual: 'privacidad' | 'terminos') {
  app.innerHTML = `<main class="pantalla">
    <header class="cab"><a class="redondo" href="#/info" aria-label="Volver">${I.atras(20)}</a><span></span></header>
    <article class="tarjeta legal-texto">${cual === 'privacidad' ? PRIVACIDAD : TERMINOS}</article>
    <p class="legal"><a href="#/${cual === 'privacidad' ? 'terminos' : 'privacidad'}">${cual === 'privacidad' ? 'Ver términos de uso' : 'Ver aviso de privacidad'}</a></p></main>`;
}

// ---------------------------------------------------------------- rutas
const RUTAS: Record<string, () => void> = { privacidad: () => legal('privacidad'), terminos: () => legal('terminos'), bienvenida, inicio, foto, ubicacion, enviado, mis, mapa: mapaVista, info };
function ir() {
  limpiar();
  const ruta = location.hash.replace(/^#\/?/, '') || 'inicio';
  (RUTAS[ruta] ?? inicio)();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', ir);
ir();
asegurarSesion().catch(() => aviso('No hay conexión con el servidor. Algunas funciones no estarán disponibles.'));
registrarServiceWorker();
