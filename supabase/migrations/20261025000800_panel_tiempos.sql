-- IGNIS 2.0 · Panel: tiempos de respuesta por incidente (para el historial).
drop function if exists panel_incidentes(timestamptz);

create function panel_incidentes(p_desde timestamptz default now() - interval '30 days')
returns table (id uuid, folio text, tipo tipo_incendio, estado estado_incidente, municipio text,
               lat double precision, lon double precision, num_reportes int, confirmado_satelite boolean,
               creado_en timestamptz, actualizado_en timestamptz, es_respaldo boolean,
               minutos_sin_confirmar int, ultimo_actor text,
               min_a_recibido int, min_a_control int)
language sql stable security definer set search_path = public, extensions as $$
  select i.id, i.folio, i.tipo, i.estado, i.municipio,
         st_y(i.ubicacion), st_x(i.ubicacion), i.num_reportes, i.confirmado_satelite,
         i.creado_en, i.actualizado_en, ii.es_respaldo,
         case when i.estado = 'nuevo' then floor(extract(epoch from now() - i.creado_en) / 60)::int end,
         (select e.actor from eventos_estado e where e.incidente_id = i.id and e.actor is not null
          order by e.creado_en desc limit 1),
         (select round(extract(epoch from min(e.creado_en) - i.creado_en) / 60)::int
          from eventos_estado e where e.incidente_id = i.id and e.estado = 'recibido'),
         (select round(extract(epoch from min(e.creado_en) - i.creado_en) / 60)::int
          from eventos_estado e where e.incidente_id = i.id and e.estado in ('controlado', 'extinguido'))
  from incidentes i
  join incidente_institucion ii on ii.incidente_id = i.id and ii.institucion_id = mi_institucion()
  where i.creado_en >= p_desde or i.estado not in ('extinguido', 'falso')
  order by (i.estado = 'nuevo') desc, i.creado_en desc
  limit 2000
$$;
revoke execute on function panel_incidentes(timestamptz) from public, anon;
grant execute on function panel_incidentes(timestamptz) to authenticated;
