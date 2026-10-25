// Gráficas en SVG con aviso al pasar el cursor. Colores validados para daltonismo
// (verificador de paleta: todas las pruebas pasan; el naranja lleva etiquetas y tabla).
import type { Tipo } from '../api';

export const COLOR_TIPO: Record<Tipo, string> = {
  forestal: '#1F7A3A', pastizal: '#E8913A', quema_esquilmo: '#3B5BA9', quema_basura: '#C2457A',
};
export const NOMBRE_TIPO: Record<Tipo, string> = {
  forestal: 'Forestal', pastizal: 'Pastizal', quema_esquilmo: 'Quema de esquilmo', quema_basura: 'Quema de basura',
};
export const ORDEN_TIPOS: Tipo[] = ['forestal', 'pastizal', 'quema_esquilmo', 'quema_basura'];

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Escala "bonita" para el eje Y. */
function escala(max: number) {
  if (max <= 0) return { tope: 5, paso: 1 };
  const bruto = max / 4;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto)!;
  return { tope: Math.ceil(max / paso) * paso, paso };
}

function ejes(ancho: number, alto: number, m: { i: number; d: number; a: number; b: number }, tope: number, paso: number) {
  const y = (v: number) => m.a + (alto - m.a - m.b) * (1 - v / tope);
  let s = '';
  for (let v = 0; v <= tope; v += paso) {
    s += `<line x1="${m.i}" x2="${ancho - m.d}" y1="${y(v)}" y2="${y(v)}" class="g-rejilla"/>`;
    s += `<text x="${m.i - 8}" y="${y(v) + 4}" text-anchor="end" class="g-eje">${v}</text>`;
  }
  return { s, y };
}

/** Barras de una sola serie (por ejemplo, reportes por mes). */
export function barras(datos: { etiqueta: string; valor: number; detalle?: string }[], color = '#C8352A') {
  const ancho = 720, alto = 240, m = { i: 40, d: 12, a: 12, b: 34 };
  const { tope, paso } = escala(Math.max(...datos.map((d) => d.valor), 0));
  const { s, y } = ejes(ancho, alto, m, tope, paso);
  const ab = (ancho - m.i - m.d) / Math.max(datos.length, 1);
  const w = Math.max(4, Math.min(36, ab - 6));
  const cada = Math.ceil(datos.length / 12);
  const marcas = datos.map((d, i) => {
    const x = m.i + ab * i + (ab - w) / 2, h = y(0) - y(d.valor);
    const r = Math.min(4, w / 2, h);
    const barra = h > 0
      ? `<path d="M${x},${y(0)}V${y(d.valor) + r}q0,-${r} ${r},-${r}h${w - 2 * r}q${r},0 ${r},${r}V${y(0)}Z" fill="${color}"/>` : '';
    return `<g class="g-objetivo" data-tip="${esc(`<b>${d.etiqueta}</b><br>${d.valor} ${d.detalle ?? ''}`)}">
      <rect x="${m.i + ab * i}" y="${m.a}" width="${ab}" height="${alto - m.a - m.b}" fill="transparent"/>${barra}
      ${i % cada === 0 ? `<text x="${x + w / 2}" y="${alto - 12}" text-anchor="middle" class="g-eje">${esc(d.etiqueta)}</text>` : ''}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${ancho} ${alto}" class="grafica" role="img" aria-label="Gráfica de barras">${s}${marcas}
    <line x1="${m.i}" x2="${ancho - m.d}" y1="${y(0)}" y2="${y(0)}" class="g-base"/></svg>`;
}

/** Barras apiladas por tipo de incendio (por ejemplo, histórico por año). */
export function apiladas(grupos: { etiqueta: string; valores: Partial<Record<Tipo, number>> }[]) {
  const ancho = 720, alto = 260, m = { i: 44, d: 12, a: 12, b: 34 };
  const total = (g: (typeof grupos)[number]) => ORDEN_TIPOS.reduce((a, t) => a + (g.valores[t] ?? 0), 0);
  const { tope, paso } = escala(Math.max(...grupos.map(total), 0));
  const { s, y } = ejes(ancho, alto, m, tope, paso);
  const ab = (ancho - m.i - m.d) / Math.max(grupos.length, 1);
  const w = Math.min(64, ab - 18);
  const marcas = grupos.map((g, i) => {
    const x = m.i + ab * i + (ab - w) / 2;
    let acumulado = 0;
    const presentes = ORDEN_TIPOS.filter((t) => (g.valores[t] ?? 0) > 0);
    const segmentos = presentes.map((t, k) => {
      const v = g.valores[t]!;
      const y1 = y(acumulado), y2 = y(acumulado + v);
      acumulado += v;
      const alto_ = Math.max(0, y1 - y2 - (k < presentes.length - 1 ? 2 : 0));   // 2 px de separación
      const ultimo = k === presentes.length - 1, r = ultimo ? Math.min(4, alto_) : 0;
      const yTop = y1 - alto_;
      return r
        ? `<path d="M${x},${y1}V${yTop + r}q0,-${r} ${r},-${r}h${w - 2 * r}q${r},0 ${r},${r}V${y1}Z" fill="${COLOR_TIPO[t]}"/>`
        : `<rect x="${x}" y="${yTop}" width="${w}" height="${alto_}" fill="${COLOR_TIPO[t]}"/>`;
    }).join('');
    const tip = `<b>${g.etiqueta}</b> · ${total(g)} reportes<br>` +
      ORDEN_TIPOS.filter((t) => g.valores[t]).map((t) => `<i style="background:${COLOR_TIPO[t]}"></i>${NOMBRE_TIPO[t]}: ${g.valores[t]}`).join('<br>');
    return `<g class="g-objetivo" data-tip="${esc(tip)}">
      <rect x="${m.i + ab * i}" y="${m.a}" width="${ab}" height="${alto - m.a - m.b}" fill="transparent"/>${segmentos}
      <text x="${x + w / 2}" y="${y(total(g)) - 6}" text-anchor="middle" class="g-valor">${total(g)}</text>
      <text x="${x + w / 2}" y="${alto - 12}" text-anchor="middle" class="g-eje">${esc(g.etiqueta)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${ancho} ${alto}" class="grafica" role="img" aria-label="Barras apiladas por tipo">${s}${marcas}
    <line x1="${m.i}" x2="${ancho - m.d}" y1="${y(0)}" y2="${y(0)}" class="g-base"/></svg>`;
}

export function leyendaTipos(tipos: Tipo[] = ORDEN_TIPOS) {
  return `<div class="leyenda-g">${tipos.map((t) => `<span><i style="background:${COLOR_TIPO[t]}"></i>${NOMBRE_TIPO[t]}</span>`).join('')}</div>`;
}

/** Activa los avisos al pasar el cursor sobre cualquier [data-tip] dentro de `raiz`. */
export function activarTips(raiz: HTMLElement) {
  let tip = document.getElementById('tip-g');
  if (!tip) { tip = document.createElement('div'); tip.id = 'tip-g'; tip.className = 'tip-g'; document.body.appendChild(tip); }
  const t = tip;
  raiz.querySelectorAll<SVGGElement>('[data-tip]').forEach((g) => {
    g.addEventListener('mousemove', (e) => {
      t.innerHTML = g.dataset.tip!; t.style.opacity = '1';
      const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8);
      t.style.transform = `translate(${x}px, ${e.clientY - t.offsetHeight - 12}px)`;
      g.classList.add('activo');
    });
    g.addEventListener('mouseleave', () => { t.style.opacity = '0'; g.classList.remove('activo'); });
  });
}
