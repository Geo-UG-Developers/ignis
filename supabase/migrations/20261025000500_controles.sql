-- IGNIS 2.0 · Controles contra errores en Telegram:
--  * Deshacer: el último cambio de una institución se puede revertir en 2 minutos.
--  * El ciudadano no ve un cierre (controlado/extinguido/falso) hasta que pasan
--    esos 2 minutos, para que una equivocación corregida no le llegue.

create or replace function cfg_minutos_deshacer() returns int language sql immutable as $$ select 2 $$;

create or replace function es_cierre(e estado_incidente) returns boolean language sql immutable as $$
  select e in ('controlado', 'extinguido', 'falso')
$$;

-- Revierte el último cambio de estado hecho por la institución, si fue hace < 2 min.
create or replace function deshacer_estado(p_incidente uuid, p_institucion uuid, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ultimo eventos_estado%rowtype;
  v_previo estado_incidente;
begin
  perform 1 from incidentes where id = p_incidente for update;
  if not found then raise exception 'incidente_no_existe' using errcode = 'P0002'; end if;

  select * into v_ultimo from eventos_estado
  where incidente_id = p_incidente and estado <> 'nuevo'
  order by creado_en desc, id desc limit 1;

  if not found then raise exception 'nada_que_deshacer' using errcode = 'P0001'; end if;
  if v_ultimo.institucion_id is distinct from p_institucion then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  if v_ultimo.creado_en < now() - make_interval(mins => cfg_minutos_deshacer()) then
    raise exception 'tiempo_vencido' using errcode = 'P0001';
  end if;

  delete from eventos_estado where id = v_ultimo.id;
  select estado into v_previo from eventos_estado
  where incidente_id = p_incidente order by creado_en desc, id desc limit 1;

  update incidentes set estado = coalesce(v_previo, 'nuevo'), actualizado_en = now() where id = p_incidente;

  return jsonb_build_object('deshecho', v_ultimo.estado, 'estado', coalesce(v_previo, 'nuevo'),
                            'por', left(p_actor, 120));
end;
$$;
revoke execute on function deshacer_estado(uuid, uuid, text) from public, anon, authenticated;

-- Estado que ve el ciudadano: los cierres aparecen hasta que vence el plazo de deshacer.
create or replace function mis_reportes()
returns table (reporte_id uuid, folio text, tipo tipo_incendio, municipio text,
               estado estado_incidente, creado_en timestamptz, eventos jsonb)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with visibles as (
    select e.*, ins.nombre as institucion
    from eventos_estado e left join instituciones ins on ins.id = e.institucion_id
    where not (es_cierre(e.estado) and e.creado_en > now() - make_interval(mins => cfg_minutos_deshacer()))
  )
  select r.id, i.folio, r.tipo, i.municipio,
         coalesce((select v.estado from visibles v where v.incidente_id = i.id
                   order by v.creado_en desc, v.id desc limit 1), 'nuevo'),
         r.creado_en,
         coalesce((select jsonb_agg(jsonb_build_object('estado', v.estado, 'en', v.creado_en,
                                   'institucion', v.institucion) order by v.creado_en)
                   from visibles v where v.incidente_id = i.id), '[]'::jsonb)
  from reportes r join incidentes i on i.id = r.incidente_id
  where r.autor = auth.uid()
  order by r.creado_en desc
  limit 50
$$;
grant execute on function mis_reportes() to authenticated;

-- datos_alerta también dice si el último cambio todavía se puede deshacer.
create or replace function puede_deshacer(p_incidente uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select e.creado_en > now() - make_interval(mins => cfg_minutos_deshacer())
                   from eventos_estado e where e.incidente_id = p_incidente and e.estado <> 'nuevo'
                   order by e.creado_en desc, e.id desc limit 1), false)
$$;
revoke execute on function puede_deshacer(uuid) from public, anon, authenticated;
