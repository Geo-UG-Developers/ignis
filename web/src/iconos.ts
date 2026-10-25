// Íconos de línea (24×24). Decorativos: aria-hidden.
const s = (d: string, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const I = {
  inicio: (n?: number) => s('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', n),
  mapa: (n?: number) => s('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>', n),
  lista: (n?: number) => s('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>', n),
  info: (n?: number) => s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', n),
  pin: (n?: number) => s('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', n),
  cerrar: (n?: number) => s('<path d="M6 6l12 12M18 6 6 18"/>', n),
  atras: (n?: number) => s('<path d="m15 6-6 6 6 6"/>', n),
  flecha: (n?: number) => s('<path d="M5 12h14M13 6l6 6-6 6"/>', n),
  camara: (n?: number) => s('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>', n),
  galeria: (n?: number) => s('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>', n),
  mas: (n?: number) => s('<path d="M12 5v14M5 12h14"/>', n),
  enviar: (n?: number) => s('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>', n),
  check: (n?: number) => s('<path d="m5 12 5 5 9-10"/>', n),
  gps: (n?: number) => s('<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="2"/>', n),
  tel: (n?: number) => s('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', n),
  chevron: (n?: number) => s('<path d="m9 6 6 6-6 6"/>', n),
  arbol: (n?: number) => s('<path d="M12 3 6 11h3l-4 6h14l-4-6h3z"/><path d="M12 17v4"/>', n),
  pasto: (n?: number) => s('<path d="M4 20c1-5 2-8 4-11M10 20c0-5 1-9 2-13M14 20c0-4 1-7 3-10M20 20c-1-4-2-6-4-8"/><path d="M2 20h20"/>', n),
  campo: (n?: number) => s('<path d="M3 20h18"/><path d="M6 20v-5M10 20v-7M14 20v-5M18 20v-7"/><path d="M12 9c-1.5-1.2-1.5-3 0-5 1.5 2 1.5 3.8 0 5z"/>', n),
  basura: (n?: number) => s('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M12 11c-1 1-1.5 2-1 3.2.3.8 1 1.3 1 2.3.8-.5 2-1.6 1.6-3.2-.2-.9-1-1.5-1.6-2.3z"/>', n),
  viento: (n?: number) => s('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>', n),
  gota: (n?: number) => s('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>', n),
  termo: (n?: number) => s('<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>', n),
  nube: (n?: number) => s('<path d="M7 18a4 4 0 0 1-.6-8 6 6 0 0 1 11.6 1.5A3.5 3.5 0 0 1 17.5 18z"/><path d="M12 15v-4M10 13l2-2 2 2"/>', n),
};
