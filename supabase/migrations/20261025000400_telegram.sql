-- IGNIS 2.0 · Vinculación de grupos de Telegram con instituciones.
-- Cada institución tiene un código secreto. Un administrador escribe en el
-- grupo:  /vincular CODIGO  y desde entonces ese grupo recibe sus alertas.

alter table instituciones
  add column codigo_vinculo text unique
  default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

update instituciones
  set codigo_vinculo = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  where codigo_vinculo is null;

-- Solo la usa la función del bot (service_role).
create or replace function vincular_chat(p_codigo text, p_chat_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inst instituciones%rowtype;
begin
  update instituciones set telegram_chat_id = null where telegram_chat_id = p_chat_id;
  update instituciones set telegram_chat_id = p_chat_id
    where codigo_vinculo = upper(trim(p_codigo)) and activa
    returning * into v_inst;
  if not found then
    raise exception 'codigo_invalido' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_inst.id, 'nombre', v_inst.nombre);
end;
$$;

revoke execute on function vincular_chat(text, bigint) from public, anon, authenticated;

-- Todo lo que el bot necesita para (re)dibujar la alerta de un incidente.
create or replace function datos_alerta(p_incidente uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'incidente_id', i.id, 'folio', i.folio, 'tipo', i.tipo, 'municipio', i.municipio,
    'lat', round(st_y(i.ubicacion)::numeric, 5), 'lon', round(st_x(i.ubicacion)::numeric, 5),
    'num_reportes', i.num_reportes, 'estado', i.estado,
    'comentario', (select r.comentario from reportes r where r.incidente_id = i.id and r.comentario is not null
                   order by r.creado_en limit 1),
    'fotos', coalesce((select jsonb_agg(f) from (select unnest(r.fotos) f from reportes r
                       where r.incidente_id = i.id order by r.creado_en limit 3) x), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('estado', e.estado, 'actor', e.actor, 'en', e.creado_en)
                           order by e.creado_en)
                           from eventos_estado e where e.incidente_id = i.id and e.estado <> 'nuevo'), '[]'::jsonb),
    'telegram', coalesce((select jsonb_agg(jsonb_build_object('chat_id', ins.telegram_chat_id,
                           'message_id', ii.telegram_message_id, 'institucion_id', ins.id))
                          from incidente_institucion ii join instituciones ins on ins.id = ii.institucion_id
                          where ii.incidente_id = i.id and ins.telegram_chat_id is not null), '[]'::jsonb)
  )
  from incidentes i where i.id = p_incidente
$$;
revoke execute on function datos_alerta(uuid) from public, anon, authenticated;

-- Permitir también PNG en las fotos (algunos navegadores lo usan).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png']
    where id = 'fotos';
  end if;
end $$;
