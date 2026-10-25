// Entrega la llave pública para que el navegador se suscriba a los avisos.
import { llavesVapid } from '../_shared/avisos.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const { publica } = await llavesVapid();
  return Response.json({ publicKey: publica }, { headers: { ...CORS, 'cache-control': 'public, max-age=3600' } });
});
