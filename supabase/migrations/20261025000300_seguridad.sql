-- IGNIS 2.0 · Seguridad (Row Level Security)
-- Regla general: el ciudadano NUNCA toca tablas directamente; solo llama
-- funciones con reglas. El personal del panel ve solo lo de su institución.

alter table regiones                 enable row level security;
alter table instituciones            enable row level security;
alter table jurisdicciones           enable row level security;
alter table jurisdiccion_institucion enable row level security;
alter table incidentes               enable row level security;
alter table incidente_institucion    enable row level security;
alter table reportes                 enable row level security;
alter table eventos_estado           enable row level security;
alter table dispositivos_push        enable row level security;
alter table miembros_panel           enable row level security;
alter table detecciones_satelitales  enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Institución del usuario del panel (null si no es personal).
create or replace function mi_institucion() returns uuid
language sql stable security definer set search_path = public as $$
  select institucion_id from miembros_panel where user_id = auth.uid()
$$;

-- ---- Panel: lectura limitada a lo que le toca a su institución ----
grant select on incidentes, reportes, eventos_estado, incidente_institucion,
                instituciones, regiones, detecciones_satelitales to authenticated;

create policy panel_incidentes on incidentes for select to authenticated
  using (exists (select 1 from incidente_institucion ii
                 where ii.incidente_id = incidentes.id and ii.institucion_id = mi_institucion()));

create policy panel_reportes on reportes for select to authenticated
  using (exists (select 1 from incidente_institucion ii
                 where ii.incidente_id = reportes.incidente_id and ii.institucion_id = mi_institucion()));

create policy panel_eventos on eventos_estado for select to authenticated
  using (exists (select 1 from incidente_institucion ii
                 where ii.incidente_id = eventos_estado.incidente_id and ii.institucion_id = mi_institucion()));

create policy panel_vinculos on incidente_institucion for select to authenticated
  using (institucion_id = mi_institucion());

create or replace function mi_region() returns text
language sql stable security definer set search_path = public as $$
  select i.region_id from miembros_panel m join instituciones i on i.id = m.institucion_id
  where m.user_id = auth.uid()
$$;

create policy panel_instituciones on instituciones for select to authenticated
  using (region_id = mi_region());

create policy panel_regiones on regiones for select to authenticated using (true);

create policy panel_satelite on detecciones_satelitales for select to authenticated
  using (mi_institucion() is not null);

-- ---- Funciones permitidas ----
grant execute on function incidentes_publicos(text) to anon, authenticated;
grant execute on function mis_reportes() to authenticated;
grant execute on function registrar_push(text, text) to authenticated;
grant execute on function cambiar_estado_panel(uuid, estado_incidente) to authenticated;
grant execute on function mi_institucion() to authenticated;
grant execute on function mi_region() to authenticated;
-- registrar_reporte, cambiar_estado y escalar_pendientes: solo service_role
-- (las funciones del servidor), que ignora RLS.

-- ---- Fotos: almacenamiento privado (solo existe en Supabase) ----
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('fotos', 'fotos', false, 3145728, array['image/jpeg', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;
