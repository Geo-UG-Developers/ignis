-- Piloto: instituciones de PRUEBA. telegram_chat_id se llena cuando el bot
-- se agrega al grupo (el bot responde /vincular con el id del chat).
insert into instituciones (id, region_id, nombre, tipo, correo, minutos_escalamiento) values
  ('00000000-0000-4000-a000-000000000001', 'GTO', 'Bomberos Guanajuato (pruebas)', 'bomberos', null, 10),
  ('00000000-0000-4000-a000-000000000002', 'GTO', 'Protección Civil Guanajuato (pruebas)', 'proteccion_civil', null, 10)
on conflict (id) do nothing;

-- Si Bomberos no confirma a tiempo, se escala a Protección Civil.
update instituciones set respaldo_id = '00000000-0000-4000-a000-000000000002'
where id = '00000000-0000-4000-a000-000000000001';

-- Bomberos atiende el municipio de Guanajuato (CVEGEO 11015).
insert into jurisdiccion_institucion (jurisdiccion_id, institucion_id)
select j.id, '00000000-0000-4000-a000-000000000001'
from jurisdicciones j where j.tipo = 'municipio' and j.clave = '11015'
on conflict do nothing;
