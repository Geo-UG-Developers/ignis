-- IGNIS · Conservación de datos (aviso de privacidad) y limpieza de pruebas.

-- Fotos 6 meses; nombre, teléfono y comentario 12 meses. Devuelve las fotos a borrar del almacenamiento.
create or replace function aplicar_conservacion() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_fotos text[];
begin
  select coalesce(array_agg(f), '{}') into v_fotos from (
    select unnest(r.fotos) f from reportes r where r.creado_en < now() - interval '6 months' and cardinality(r.fotos) > 0) x;
  update reportes set fotos = '{}' where creado_en < now() - interval '6 months' and cardinality(fotos) > 0;
  update reportes set nombre = null, telefono = null, comentario = null
    where creado_en < now() - interval '12 months' and (nombre is not null or telefono is not null or comentario is not null);
  return jsonb_build_object('fotos', to_jsonb(v_fotos));
end $$;
revoke execute on function aplicar_conservacion() from public, anon, authenticated;

-- Antes de salir a producción (se corre una vez desde el SQL Editor de Supabase):
--   select limpiar_datos_prueba();
-- Borra incidentes y reportes de prueba (no toca el histórico 2021–2025 ni instituciones).
create or replace function limpiar_datos_prueba() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if auth.uid() is not null and not exists (select 1 from miembros_panel where user_id = auth.uid() and es_admin) then
    raise exception 'sin_permiso' using errcode = '42501';
  end if;
  select count(*) into n from incidentes;
  delete from incidentes;   -- en cascada: reportes, eventos e incidente_institucion
  perform setval('folio_seq', 1, false);
  return jsonb_build_object('incidentes_borrados', n, 'nota', 'Las fotos de prueba se borran solas en 6 meses o desde Storage › fotos.');
end $$;
revoke execute on function limpiar_datos_prueba() from public, anon, authenticated;
