-- IGNIS 2.0 · Avisos al ciudadano (web push), escalamiento automático y panel web.

-- ---------------------------------------------------------------
-- Configuración privada del servidor (llaves de avisos). Nadie fuera
-- del servidor (service_role) puede leerla.
-- ---------------------------------------------------------------
create table if not exists config_privada (
  clave  text primary key,
  valor  jsonb not null,
  creado_en timestamptz not null default now()
);
alter table config_privada enable row level security;
revoke all on config_privada from anon, authenticated;

-- Avisos pendientes: cada cambio de estado se avisa una sola vez.
alter table eventos_estado add column if not exists avisado_en timestamptz;

-- Eventos listos para avisar al ciudadano: los cierres esperan el plazo de deshacer.
create or replace function avisos_pendientes()
returns table (evento_id bigint, incidente_id uuid, estado estado_incidente, folio text, tipo tipo_incendio,
               municipio text, institucion text, suscripciones jsonb)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.id, e.incidente_id, e.estado, i.folio, i.tipo, i.municipio, ins.nombre,
         coalesce((select jsonb_agg(distinct d.token) from reportes r join dispositivos_push d on d.autor = r.autor
                   where r.incidente_id = e.incidente_id), '[]'::jsonb)
  from eventos_estado e
  join incidentes i on i.id = e.incidente_id
  left join instituciones ins on ins.id = e.institucion_id
  where e.avisado_en is null and e.estado <> 'nuevo'
    and e.creado_en > now() - interval '1 day'
    and (not es_cierre(e.estado) or e.creado_en < now() - make_interval(mins => cfg_minutos_deshacer()))
    -- Solo el evento vigente: si ya hay uno posterior, no se avisa el viejo.
    and not exists (select 1 from eventos_estado x where x.incidente_id = e.incidente_id
                    and (x.creado_en, x.id) > (e.creado_en, e.id))
  order by e.creado_en
  limit 200
$$;
revoke execute on function avisos_pendientes() from public, anon, authenticated;

create or replace function marcar_avisados(p_ids bigint[]) returns void
language sql security definer set search_path = public, extensions as $$
  update eventos_estado set avisado_en = now() where id = any(p_ids) and avisado_en is null
$$;
revoke execute on function marcar_avisados(bigint[]) from public, anon, authenticated;

-- Quitar suscripciones que el navegador ya no acepta (410/404).
create or replace function quitar_suscripcion(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from dispositivos_push where token = p_token
$$;
revoke execute on function quitar_suscripcion(text) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Panel web: el personal entra con correo y contraseña. Su cuenta
-- está ligada a una institución en miembros_panel.
-- ---------------------------------------------------------------
create or replace function panel_yo()
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('institucion_id', i.id, 'institucion', i.nombre, 'tipo', i.tipo,
                            'region', r.nombre, 'es_admin', m.es_admin,
                            'municipios', coalesce((select jsonb_agg(distinct j.nombre)
                                                    from jurisdiccion_institucion ji join jurisdicciones j on j.id = ji.jurisdiccion_id
                                                    where ji.institucion_id = i.id), '[]'::jsonb))
  from miembros_panel m join instituciones i on i.id = m.institucion_id join regiones r on r.id = i.region_id
  where m.user_id = auth.uid()
$$;

-- Incidentes de la institución (activos o todos desde una fecha).
create or replace function panel_incidentes(p_desde timestamptz default now() - interval '30 days')
returns table (id uuid, folio text, tipo tipo_incendio, estado estado_incidente, municipio text,
               lat double precision, lon double precision, num_reportes int, confirmado_satelite boolean,
               creado_en timestamptz, actualizado_en timestamptz, es_respaldo boolean,
               minutos_sin_confirmar int, ultimo_actor text)
language sql stable security definer set search_path = public, extensions as $$
  select i.id, i.folio, i.tipo, i.estado, i.municipio,
         st_y(i.ubicacion), st_x(i.ubicacion), i.num_reportes, i.confirmado_satelite,
         i.creado_en, i.actualizado_en, ii.es_respaldo,
         case when i.estado = 'nuevo' then floor(extract(epoch from now() - i.creado_en) / 60)::int end,
         (select e.actor from eventos_estado e where e.incidente_id = i.id and e.actor is not null
          order by e.creado_en desc limit 1)
  from incidentes i
  join incidente_institucion ii on ii.incidente_id = i.id and ii.institucion_id = mi_institucion()
  where i.creado_en >= p_desde or i.estado not in ('extinguido', 'falso')
  order by (i.estado = 'nuevo') desc, i.creado_en desc
  limit 1000
$$;

-- Detalle completo de un incidente (con datos de contacto, solo para su institución).
create or replace function panel_detalle(p_incidente uuid)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', i.id, 'folio', i.folio, 'tipo', i.tipo, 'estado', i.estado, 'municipio', i.municipio,
    'lat', st_y(i.ubicacion), 'lon', st_x(i.ubicacion), 'num_reportes', i.num_reportes,
    'creado_en', i.creado_en, 'puede_deshacer', puede_deshacer(i.id),
    'reportes', coalesce((select jsonb_agg(jsonb_build_object(
        'creado_en', r.creado_en, 'tipo', r.tipo, 'comentario', r.comentario, 'nombre', r.nombre,
        'telefono', r.telefono, 'fotos', r.fotos, 'precision_m', r.precision_m,
        'lat', st_y(r.ubicacion), 'lon', st_x(r.ubicacion)) order by r.creado_en)
      from reportes r where r.incidente_id = i.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('estado', e.estado, 'actor', e.actor, 'canal', e.canal,
        'institucion', ins.nombre, 'en', e.creado_en) order by e.creado_en, e.id)
      from eventos_estado e left join instituciones ins on ins.id = e.institucion_id
      where e.incidente_id = i.id), '[]'::jsonb),
    'instituciones', coalesce((select jsonb_agg(jsonb_build_object('nombre', ins.nombre, 'es_respaldo', ii.es_respaldo))
      from incidente_institucion ii join instituciones ins on ins.id = ii.institucion_id
      where ii.incidente_id = i.id), '[]'::jsonb))
  from incidentes i
  where i.id = p_incidente
    and exists (select 1 from incidente_institucion ii where ii.incidente_id = i.id and ii.institucion_id = mi_institucion())
$$;

-- Estadísticas de la institución: tiempos de respuesta y conteos por mes y tipo.
create or replace function panel_estadisticas(p_desde timestamptz default now() - interval '365 days')
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with mios as (
    select i.* from incidentes i
    join incidente_institucion ii on ii.incidente_id = i.id and ii.institucion_id = mi_institucion()
    where i.creado_en >= p_desde
  ), tiempos as (
    select m.id,
      extract(epoch from (select min(e.creado_en) from eventos_estado e where e.incidente_id = m.id and e.estado = 'recibido') - m.creado_en) / 60 as min_recibido,
      extract(epoch from (select min(e.creado_en) from eventos_estado e where e.incidente_id = m.id and e.estado in ('controlado', 'extinguido')) - m.creado_en) / 60 as min_control
    from mios m
  )
  select jsonb_build_object(
    'total', (select count(*) from mios),
    'activos', (select count(*) from mios where estado not in ('extinguido', 'falso')),
    'falsos', (select count(*) from mios where estado = 'falso'),
    'mediana_min_recibido', (select round(percentile_cont(0.5) within group (order by min_recibido)::numeric, 1) from tiempos where min_recibido is not null),
    'mediana_min_control', (select round(percentile_cont(0.5) within group (order by min_control)::numeric, 1) from tiempos where min_control is not null),
    'por_mes', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'total', n) order by mes) from (
        select to_char(creado_en at time zone 'America/Mexico_City', 'YYYY-MM') mes, count(*) n
        from mios group by 1) s), '[]'::jsonb),
    'por_tipo', coalesce((select jsonb_object_agg(tipo, n) from (select tipo, count(*) n from mios group by tipo) s), '{}'::jsonb)
  )
  where mi_institucion() is not null
$$;

-- Histórico para el panel: el de los municipios de su región, por año y tipo.
create or replace function panel_historico_resumen()
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('anio', anio, 'tipo', tipo, 'total', n) order by anio, tipo), '[]'::jsonb) from (
    select extract(year from ocurrido_local)::int anio, tipo, count(*) n
    from incendios_historicos
    where not (calidad && array['punto_repetido', 'fuera_de_cobertura'])
    group by 1, 2) s
  where mi_institucion() is not null
$$;

grant execute on function panel_yo(), panel_incidentes(timestamptz), panel_detalle(uuid),
  panel_estadisticas(timestamptz), panel_historico_resumen() to authenticated;

-- Para que el panel pueda ver fotos con enlaces temporales: solo las de sus incidentes.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists panel_fotos on storage.objects';
    execute $p$
      create policy panel_fotos on storage.objects for select to authenticated
      using (bucket_id = 'fotos' and exists (
        select 1 from public.reportes r
        join public.incidente_institucion ii on ii.incidente_id = r.incidente_id
        where ii.institucion_id = public.mi_institucion() and storage.objects.name = any(r.fotos)))
    $p$;
  end if;
end $$;

-- ---------------------------------------------------------------
-- Tarea cada minuto: escalamiento y avisos pendientes (solo en Supabase).
-- La función "tareas" no necesita secreto: solo procesa lo que ya venció,
-- así que llamarla de más no causa nada.
-- ---------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    if exists (select 1 from cron.job where jobname = 'ignis-tareas') then
      perform cron.unschedule('ignis-tareas');
    end if;
    perform cron.schedule('ignis-tareas', '* * * * *', $cron$
      select net.http_post(
        url := 'https://omxujxhbvdkvnfrgtvqa.supabase.co/functions/v1/tareas',
        headers := '{"content-type": "application/json"}'::jsonb,
        body := '{}'::jsonb)
    $cron$);
  end if;
end $$;

-- Los cambios desde el panel pasan por la función del servidor "panel"
-- (aplica la regla de que solo administradores cierran y actualiza Telegram).
revoke execute on function cambiar_estado_panel(uuid, estado_incidente) from authenticated;
