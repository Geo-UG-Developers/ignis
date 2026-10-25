// Conexiones del servidor: base de datos (service_role) y API de Telegram.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const API = `https://api.telegram.org/bot${TOKEN}`;

/** Llama un método de Telegram con JSON. */
export async function tg(metodo: string, cuerpo: Record<string, unknown>) {
  const r = await fetch(`${API}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json();
  if (!j.ok) console.error(`telegram ${metodo}`, j.description);
  return j;
}

/** Envía una foto (bytes) con texto y botones. */
export async function tgFoto(chatId: number, foto: Blob, caption: string, teclado: unknown) {
  const f = new FormData();
  f.append('chat_id', String(chatId));
  f.append('photo', foto, 'reporte.jpg');
  f.append('caption', caption);
  f.append('parse_mode', 'HTML');
  f.append('reply_markup', JSON.stringify(teclado));
  const r = await fetch(`${API}/sendPhoto`, { method: 'POST', body: f });
  const j = await r.json();
  if (!j.ok) console.error('telegram sendPhoto', j.description);
  return j;
}

/** Secreto del webhook derivado del token del bot (no hace falta otro secreto). */
export async function secretoWebhook(): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ignis-webhook:${TOKEN}`));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
