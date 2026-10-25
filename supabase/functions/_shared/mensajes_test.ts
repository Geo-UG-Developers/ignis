import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert';
import { leerBoton, leerComando, teclado, tecladoConfirmar, textoAlerta } from './mensajes.ts';

const ID = '11111111-2222-4333-8444-555555555555';

Deno.test('botones avanzan solo hacia adelante', () => {
  const t = teclado(ID, 'recibido').inline_keyboard.flat().map((b) => b.text);
  assertEquals(t, ['En camino', 'Controlado', 'Extinguido', 'Falso o duplicado']);
  assertEquals(teclado(ID, 'extinguido').inline_keyboard, []);
  assertEquals(teclado(ID, 'extinguido', true).inline_keyboard.flat().map((b) => b.text), ['Deshacer último cambio']);
});

Deno.test('callback_data cabe en 64 bytes y se lee de vuelta', () => {
  for (const b of teclado(ID, 'nuevo').inline_keyboard.flat()) {
    assert(new TextEncoder().encode(b.callback_data).length <= 64, b.callback_data);
    assert(leerBoton(b.callback_data));
  }
  assertEquals(leerBoton(`e|${ID}|nuevo`), null);
  assertEquals(leerBoton(`u|${ID}`), { tipo: 'deshacer', incidenteId: ID });
  assertEquals(leerBoton(`c|${ID}|extinguido`), { tipo: 'confirmar', incidenteId: ID, estado: 'extinguido' });
  for (const b of [...teclado(ID, 'recibido', true).inline_keyboard.flat(), ...tecladoConfirmar(ID, 'en_camino').inline_keyboard.flat()]) {
    assert(new TextEncoder().encode(b.callback_data).length <= 64, b.callback_data);
    assert(leerBoton(b.callback_data), b.callback_data);
  }
  assertEquals(leerBoton('basura'), null);
});

Deno.test('comandos con y sin mención', () => {
  assertEquals(leerComando('/id'), { comando: 'id', arg: '' });
  assertEquals(leerComando('/vincular@ignis_pruebas_bot  ab12cd34 '), { comando: 'vincular', arg: 'ab12cd34' });
  assertEquals(leerComando('hola'), null);
});

Deno.test('texto de alerta escapa HTML y respeta el límite', () => {
  const t = textoAlerta({ folio: 'IG-GTO-2600001', tipo: 'forestal', municipio: 'Guanajuato', lat: 21.019,
    lon: -101.2574, num_reportes: 2, comentario: '<b>humo</b> & fuego', estado: 'nuevo' });
  assert(t.includes('&lt;b&gt;humo&lt;/b&gt; &amp; fuego'));
  assert(t.includes('2 reportes'));
  assert(t.length <= 1024);
});
