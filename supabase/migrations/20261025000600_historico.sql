-- IGNIS 2.0 · Histórico de incendios (reportes de IGNIS v1 y otras fuentes).
-- Tabla aparte de los reportes en vivo. Sin datos personales.

create table incendios_historicos (
  id                   bigint generated always as identity primary key,
  fuente               text not null default 'IGNIS v1',
  id_original          bigint,
  ocurrido_local       timestamp not null,              -- hora local de México, como venía
  ocurrido_en          timestamptz generated always as (ocurrido_local at time zone 'America/Mexico_City') stored,
  tipo                 tipo_incendio not null,
  municipio_reportado  text,                            -- lo que decía el reporte original
  municipio            text,                            -- calculado con los polígonos
  localidad            text,
  estado_reportado     text,
  ubicacion            geometry(Point, 4326) not null,
  superficie_ha        real,
  plataforma           text,                            -- Android / IOS, si se registró
  calidad              text[] not null default '{}',    -- correcciones y sospechas
  unique (fuente, id_original)
);
create index incendios_historicos_geom_idx on incendios_historicos using gist (ubicacion);
create index incendios_historicos_fecha_idx on incendios_historicos (ocurrido_en);

alter table incendios_historicos enable row level security;
revoke all on incendios_historicos from anon, authenticated;

-- Quita acentos sin depender de la extensión unaccent.
create or replace function unaccent_simple(t text) returns text language sql immutable as $$
  select translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚüÜñÑ', 'aeiouAEIOUuUnN')
$$;

-- Calcula el municipio real del punto y marca sospechas:
--   municipio_distinto: el punto cae en otro municipio que el reportado
--   fuera_de_cobertura: el punto no cae en ningún municipio cargado
--   punto_repetido: la misma coordenada exacta aparece 5+ veces (posible
--                   ubicación por defecto de la app vieja, no la real)
create or replace function calcular_calidad_historico()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update incendios_historicos h set municipio = j.nombre
  from jurisdicciones j
  where j.tipo = 'municipio' and st_intersects(j.geom, h.ubicacion);

  update incendios_historicos set calidad = array(
    select distinct unnest(
      array_remove(calidad, null)
      || case when municipio is null then array['fuera_de_cobertura'] else '{}' end
      || case when municipio is not null and municipio_reportado is not null
                and position(lower(unaccent_simple(trim(municipio_reportado))) in lower(unaccent_simple(municipio))) = 0
                and position(lower(unaccent_simple(municipio)) in lower(unaccent_simple(trim(municipio_reportado)))) = 0
              then array['municipio_distinto'] else '{}' end
    ));

  update incendios_historicos h set calidad = array(select distinct unnest(h.calidad || array['punto_repetido']))
  where (st_x(h.ubicacion), st_y(h.ubicacion)) in (
    select st_x(ubicacion), st_y(ubicacion) from incendios_historicos
    group by 1, 2 having count(*) >= 5);
end;
$$;
revoke execute on function calcular_calidad_historico() from public, anon, authenticated;

-- Para el mapa público: puntos del histórico (sin datos personales).
create or replace function historico_publico(p_desde int default 2021, p_hasta int default 2100)
returns table (anio int, mes int, tipo tipo_incendio, municipio text, lat double precision, lon double precision,
               confiable boolean)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select extract(year from ocurrido_local)::int, extract(month from ocurrido_local)::int, tipo, municipio,
         round(st_y(ubicacion)::numeric, 4)::double precision, round(st_x(ubicacion)::numeric, 4)::double precision,
         not (calidad && array['punto_repetido', 'fuera_de_cobertura'])
  from incendios_historicos
  where extract(year from ocurrido_local) between p_desde and p_hasta
  order by ocurrido_local
  limit 20000
$$;
grant execute on function historico_publico(int, int) to anon, authenticated;
