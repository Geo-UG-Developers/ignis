-- IGNIS 2.0 · Lógica de negocio en la base de datos
-- Las reglas viven aquí (no en la app) para que nadie pueda saltárselas.

-- Parámetros de agrupación de duplicados.
create or replace function cfg_radio_agrupacion_m() returns int language sql immutable as $$ select 1000 $$;
create or replace function cfg_ventana_agrupacion() returns interval language sql immutable as $$ select interval '6 hours' $$;
create or replace function cfg_max_reportes_hora() returns int language sql immutable as $$ select 5 $$;

-- Orden de los estados (para impedir retrocesos).
create or replace function orden_estado(e estado_incidente) returns int language sql immutable as $$
  select case e
    when 'nuevo' then 0 when 'recibido' then 1 when 'en_camino' then 2
    when 'controlado' then 3 when 'extinguido' then 4 when 'falso' then 4 end
$$;

-- ---------------------------------------------------------------
-- registrar_reporte: guarda un reporte, lo agrupa con un incidente
-- cercano o crea uno nuevo, y decide qué instituciones se notifican.
-- Solo la llama la función del servidor (service_role).
-- ---------------------------------------------------------------
create or replace function registrar_reporte(
  p_autor       uuid,
  p_tipo        tipo_incendio,
  p_lat         double precision,
  p_lon         double precision,
  p_precision_m real default null,
  p_comentario  text default null,
  p_nombre      text default null,
  p_telefono    text default null,
  p_fotos       text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_punto       geometry(Point, 4326);
  v_region      text;
  v_municipio   text;
  v_incidente   incidentes%rowtype;
  v_es_nuevo    boolean := false;
  v_reporte_id  uuid;
  v_recientes   int;
begin
  if p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'coordenadas_invalidas' using errcode = '22023';
  end if;

  select count(*) into v_recientes
  from reportes where autor = p_autor and creado_en > now() - interval '1 hour';
  if v_recientes >= cfg_max_reportes_hora() then
    raise exception 'limite_reportes' using errcode = 'P0001';
  end if;

  v_punto := st_setsrid(st_makepoint(p_lon, p_lat), 4326);

  select j.region_id, j.nombre into v_region, v_municipio
  from jurisdicciones j
  where j.tipo = 'municipio' and st_intersects(j.geom, v_punto)
  limit 1;

  -- ¿Hay un incidente abierto cerca y reciente? -> es el mismo incendio.
  select i.* into v_incidente
  from incidentes i
  where i.estado not in ('extinguido', 'falso')
    and i.creado_en > now() - cfg_ventana_agrupacion()
    and st_dwithin(i.ubicacion::geography, v_punto::geography, cfg_radio_agrupacion_m())
  order by st_distance(i.ubicacion::geography, v_punto::geography)
  limit 1
  for update;

  if not found then
    v_es_nuevo := true;
    insert into incidentes (folio, region_id, tipo, ubicacion, municipio)
    values (
      'IG-' || coalesce(v_region, 'XX') || '-' || to_char(now(), 'YY') || lpad(nextval('folio_seq')::text, 5, '0'),
      v_region, p_tipo, v_punto, v_municipio
    )
    returning * into v_incidente;

    -- Todas las instituciones de todas las jurisdicciones que tocan el punto
    -- (municipio + ANP + zonas especiales).
    insert into incidente_institucion (incidente_id, institucion_id)
    select distinct v_incidente.id, ji.institucion_id
    from jurisdicciones j
    join jurisdiccion_institucion ji on ji.jurisdiccion_id = j.id
    join instituciones ins on ins.id = ji.institucion_id and ins.activa
    where st_intersects(j.geom, v_punto);

    insert into eventos_estado (incidente_id, estado, canal) values (v_incidente.id, 'nuevo', 'sistema');
  else
    update incidentes
      set num_reportes = num_reportes + 1, actualizado_en = now()
      where id = v_incidente.id
      returning * into v_incidente;
  end if;

  insert into reportes (incidente_id, autor, tipo, ubicacion, precision_m, comentario, nombre, telefono, fotos)
  values (v_incidente.id, p_autor, p_tipo, v_punto, p_precision_m,
          nullif(trim(p_comentario), ''), nullif(trim(p_nombre), ''), nullif(trim(p_telefono), ''),
          coalesce(p_fotos, '{}'))
  returning id into v_reporte_id;

  return jsonb_build_object(
    'reporte_id', v_reporte_id,
    'incidente_id', v_incidente.id,
    'folio', v_incidente.folio,
    'es_nuevo', v_es_nuevo,
    'estado', v_incidente.estado,
    'num_reportes', v_incidente.num_reportes,
    'region_id', v_incidente.region_id,
    'municipio', v_incidente.municipio,
    'instituciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ins.id, 'nombre', ins.nombre, 'telegram_chat_id', ins.telegram_chat_id,
        'telegram_message_id', ii.telegram_message_id, 'correo', ins.correo))
      from incidente_institucion ii join instituciones ins on ins.id = ii.institucion_id
      where ii.incidente_id = v_incidente.id), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------
-- cambiar_estado: una institución vinculada al incidente avanza su estado.
-- Devuelve a quién avisar (autores de los reportes).
-- ---------------------------------------------------------------
create or replace function cambiar_estado(
  p_incidente   uuid,
  p_estado      estado_incidente,
  p_institucion uuid,
  p_actor       text,
  p_canal       canal_evento
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inc incidentes%rowtype;
begin
  select * into v_inc from incidentes where id = p_incidente for update;
  if not found then
    raise exception 'incidente_no_existe' using errcode = 'P0002';
  end if;

  if not exists (select 1 from incidente_institucion
                 where incidente_id = p_incidente and institucion_id = p_institucion) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;

  if v_inc.estado in ('extinguido', 'falso') then
    raise exception 'incidente_cerrado' using errcode = 'P0001';
  end if;

  if p_estado = 'nuevo' or orden_estado(p_estado) <= orden_estado(v_inc.estado) then
    raise exception 'transicion_invalida' using errcode = 'P0001';
  end if;

  update incidentes set estado = p_estado, actualizado_en = now()
  where id = p_incidente returning * into v_inc;

  insert into eventos_estado (incidente_id, estado, institucion_id, actor, canal)
  values (p_incidente, p_estado, p_institucion, left(p_actor, 120), p_canal);

  return jsonb_build_object(
    'incidente_id', v_inc.id,
    'folio', v_inc.folio,
    'estado', v_inc.estado,
    'tipo', v_inc.tipo,
    'municipio', v_inc.municipio,
    'institucion', (select nombre from instituciones where id = p_institucion),
    'tokens_push', coalesce((
      select jsonb_agg(distinct d.token)
      from reportes r join dispositivos_push d on d.autor = r.autor
      where r.incidente_id = p_incidente), '[]'::jsonb),
    'telegram', coalesce((
      select jsonb_agg(jsonb_build_object('chat_id', ins.telegram_chat_id, 'message_id', ii.telegram_message_id))
      from incidente_institucion ii join instituciones ins on ins.id = ii.institucion_id
      where ii.incidente_id = p_incidente and ins.telegram_chat_id is not null), '[]'::jsonb)
  );
end;
$$;

-- Versión para el panel web: la institución sale de la sesión del usuario.
create or replace function cambiar_estado_panel(p_incidente uuid, p_estado estado_incidente)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst uuid;
begin
  select m.institucion_id into v_inst from miembros_panel m where m.user_id = auth.uid();
  if v_inst is null then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  return cambiar_estado(p_incidente, p_estado, v_inst,
                        coalesce(auth.jwt() ->> 'email', 'panel'), 'panel');
end;
$$;

-- ---------------------------------------------------------------
-- escalar_pendientes: incidentes que nadie confirmó a tiempo.
-- Los marca como escalados, vincula la institución de respaldo y
-- devuelve a quién volver a avisar. La llama una tarea cada minuto.
-- ---------------------------------------------------------------
create or replace function escalar_pendientes()
returns table (incidente_id uuid, folio text, institucion_id uuid, telegram_chat_id bigint, correo text, es_respaldo boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with vencidos as (
    select i.id
    from incidentes i
    where i.estado = 'nuevo'
      and i.escalado_en is null
      and i.creado_en < now() - make_interval(mins => coalesce((
            select min(ins.minutos_escalamiento)
            from incidente_institucion ii join instituciones ins on ins.id = ii.institucion_id
            where ii.incidente_id = i.id), 10))
    for update skip locked
  ),
  marcados as (
    update incidentes i set escalado_en = now()
    from vencidos v where i.id = v.id
    returning i.id, i.folio
  ),
  respaldos as (
    insert into incidente_institucion (incidente_id, institucion_id, es_respaldo)
    select distinct m.id, ins.respaldo_id, true
    from marcados m
    join incidente_institucion ii on ii.incidente_id = m.id
    join instituciones ins on ins.id = ii.institucion_id
    where ins.respaldo_id is not null
    on conflict do nothing
    returning incidente_institucion.incidente_id, incidente_institucion.institucion_id
  )
  -- Respaldos nuevos + recordatorio a los originales.
  select m.id, m.folio, ins.id, ins.telegram_chat_id, ins.correo, true
  from respaldos r join marcados m on m.id = r.incidente_id join instituciones ins on ins.id = r.institucion_id
  union all
  select m.id, m.folio, ins.id, ins.telegram_chat_id, ins.correo, false
  from marcados m
  join incidente_institucion ii on ii.incidente_id = m.id and not ii.es_respaldo
  join instituciones ins on ins.id = ii.institucion_id;
end;
$$;

-- ---------------------------------------------------------------
-- Consultas para la app del ciudadano.
-- ---------------------------------------------------------------
-- Mis reportes (usuario anónimo actual).
create or replace function mis_reportes()
returns table (reporte_id uuid, folio text, tipo tipo_incendio, municipio text,
               estado estado_incidente, creado_en timestamptz, eventos jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, i.folio, r.tipo, i.municipio, i.estado, r.creado_en,
         coalesce((select jsonb_agg(jsonb_build_object('estado', e.estado, 'en', e.creado_en,
                                   'institucion', ins.nombre) order by e.creado_en)
                   from eventos_estado e left join instituciones ins on ins.id = e.institucion_id
                   where e.incidente_id = i.id), '[]'::jsonb)
  from reportes r join incidentes i on i.id = r.incidente_id
  where r.autor = auth.uid()
  order by r.creado_en desc
  limit 50
$$;

-- Mapa público: incidentes de las últimas 48 h, sin datos personales.
-- La ubicación se redondea a ~100 m.
create or replace function incidentes_publicos(p_region text default null)
returns table (id uuid, tipo tipo_incendio, estado estado_incidente, lat double precision,
               lon double precision, municipio text, num_reportes int,
               confirmado_satelite boolean, creado_en timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.tipo, i.estado,
         round(st_y(i.ubicacion)::numeric, 3)::double precision,
         round(st_x(i.ubicacion)::numeric, 3)::double precision,
         i.municipio, i.num_reportes, i.confirmado_satelite, i.creado_en
  from incidentes i
  where i.creado_en > now() - interval '48 hours'
    and i.estado <> 'falso'
    and (p_region is null or i.region_id = p_region)
  order by i.creado_en desc
  limit 500
$$;

-- Registrar o actualizar el token push del dispositivo actual.
create or replace function registrar_push(p_token text, p_plataforma text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into dispositivos_push (autor, token, plataforma)
  values (auth.uid(), p_token, p_plataforma)
  on conflict (autor) do update set token = excluded.token, plataforma = excluded.plataforma,
                                    actualizado_en = now()
$$;
