-- Pruebas de la lógica de IGNIS. Cada bloque falla con un mensaje claro.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- Usuarios anónimos de prueba
\set a1 '''11111111-1111-4111-8111-111111111111'''
\set a2 '''22222222-2222-4222-8222-222222222222'''
\set a3 '''33333333-3333-4333-8333-333333333333'''

do $$
declare r jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
begin
  -- 1. Reporte en la ciudad de Guanajuato -> incidente nuevo, ruteado a Bomberos.
  r := registrar_reporte('11111111-1111-4111-8111-111111111111', 'forestal', 21.0190, -101.2574, 8, 'humo en el cerro');
  assert (r->>'es_nuevo')::boolean, 'debe crear incidente nuevo';
  assert r->>'region_id' = 'GTO', 'region debe ser GTO: ' || r::text;
  assert r->>'municipio' = 'Guanajuato', 'municipio debe ser Guanajuato: ' || r::text;
  assert r->>'folio' like 'IG-GTO-%', 'folio con region';
  assert jsonb_array_length(r->'instituciones') = 1 and r->'instituciones'->0->>'nombre' like 'Bomberos%', 'debe notificar a Bomberos';

  -- 2. Otro ciudadano a ~300 m -> mismo incidente.
  r2 := registrar_reporte('22222222-2222-4222-8222-222222222222', 'pastizal', 21.0215, -101.2560);
  assert not (r2->>'es_nuevo')::boolean, 'debe agruparse';
  assert r2->>'incidente_id' = r->>'incidente_id', 'mismo incidente';
  assert (r2->>'num_reportes')::int = 2, 'num_reportes = 2';

  -- 3. León: otro municipio, sin institución vinculada aún.
  r3 := registrar_reporte('22222222-2222-4222-8222-222222222222', 'quema_basura', 21.1250, -101.6860);
  assert (r3->>'es_nuevo')::boolean and r3->>'municipio' = 'León', 'León nuevo: ' || r3::text;
  assert jsonb_array_length(r3->'instituciones') = 0, 'León sin instituciones';

  -- 4. Fuera de cobertura (CDMX).
  r4 := registrar_reporte('33333333-3333-4333-8333-333333333333', 'forestal', 19.4326, -99.1332);
  assert r4->>'region_id' is null and r4->>'folio' like 'IG-XX-%', 'fuera de cobertura';
  raise notice 'OK 1-4 registro y agrupación (%)', r->>'folio';
end $$;

-- 5. Límite de reportes por hora.
do $$
declare i int; atrapado boolean := false;
begin
  for i in 1..4 loop
    perform registrar_reporte('33333333-3333-4333-8333-333333333333', 'quema_basura', 20.5 + i * 0.05, -100.8);
  end loop;
  begin
    perform registrar_reporte('33333333-3333-4333-8333-333333333333', 'quema_basura', 20.9, -100.8);
  exception when others then
    atrapado := sqlerrm = 'limite_reportes';
  end;
  assert atrapado, 'el 6o reporte en una hora debe rechazarse';
  raise notice 'OK 5 límite por hora';
end $$;

-- 6. Cambios de estado.
do $$
declare v_inc uuid; r jsonb; msg text;
begin
  select incidente_id into v_inc from reportes where autor = '11111111-1111-4111-8111-111111111111';
  insert into dispositivos_push values ('11111111-1111-4111-8111-111111111111', 'tok-a1', 'android', now());
  insert into dispositivos_push values ('22222222-2222-4222-8222-222222222222', 'tok-a2', 'web', now());

  begin  -- institución no vinculada
    perform cambiar_estado(v_inc, 'recibido', '00000000-0000-4000-a000-000000000002', 'x', 'telegram');
  exception when others then msg := sqlerrm; end;
  assert msg = 'sin_permiso', 'PC no vinculada debe ser rechazada: ' || coalesce(msg, 'null');

  r := cambiar_estado(v_inc, 'recibido', '00000000-0000-4000-a000-000000000001', 'Juan P.', 'telegram');
  assert r->>'estado' = 'recibido';
  assert jsonb_array_length(r->'tokens_push') = 2, 'avisar a 2 dispositivos: ' || r::text;

  msg := null;
  begin  -- retroceso
    perform cambiar_estado(v_inc, 'recibido', '00000000-0000-4000-a000-000000000001', 'x', 'telegram');
  exception when others then msg := sqlerrm; end;
  assert msg = 'transicion_invalida', 'no se repite ni retrocede';

  perform cambiar_estado(v_inc, 'extinguido', '00000000-0000-4000-a000-000000000001', 'Juan P.', 'telegram');
  msg := null;
  begin
    perform cambiar_estado(v_inc, 'falso', '00000000-0000-4000-a000-000000000001', 'x', 'telegram');
  exception when others then msg := sqlerrm; end;
  assert msg = 'incidente_cerrado', 'cerrado no cambia';
  assert (select count(*) from eventos_estado where incidente_id = v_inc) = 3, 'historial: nuevo, recibido, extinguido';
  raise notice 'OK 6 estados';
end $$;

-- 7. Escalamiento: un incidente nuevo sin confirmar por 15 min.
do $$
declare r jsonb; n int; n2 int; tiene_pc boolean;
begin
  r := registrar_reporte('11111111-1111-4111-8111-111111111111', 'pastizal', 21.0450, -101.3000);
  assert (r->>'es_nuevo')::boolean, 'nuevo incidente para escalar: ' || r::text;
  update incidentes set creado_en = now() - interval '15 minutes' where id = (r->>'incidente_id')::uuid;

  select count(*), bool_or(es_respaldo and institucion_id = '00000000-0000-4000-a000-000000000002')
    into n, tiene_pc
  from escalar_pendientes() where incidente_id = (r->>'incidente_id')::uuid;
  assert n = 2 and tiene_pc, 'debe avisar a respaldo (PC) y recordar a Bomberos: n=' || n;

  select count(*) into n2 from escalar_pendientes();
  assert n2 = 0, 'no se escala dos veces';
  -- Ahora PC también puede atender el incidente
  perform cambiar_estado((r->>'incidente_id')::uuid, 'recibido', '00000000-0000-4000-a000-000000000002', 'Ana', 'telegram');
  raise notice 'OK 7 escalamiento';
end $$;

-- 8. Seguridad: lo que NO puede hacer un ciudadano.
set role anon;
do $$
declare msg text;
begin
  begin perform * from reportes; exception when others then msg := sqlerrm; end;
  assert msg like 'permission denied%', 'anon no lee reportes';
  msg := null;
  begin perform registrar_reporte('11111111-1111-4111-8111-111111111111', 'forestal', 21.0, -101.2);
  exception when others then msg := sqlerrm; end;
  assert msg like 'permission denied%', 'anon no registra directo';
  assert (select count(*) from incidentes_publicos('GTO')) >= 3, 'mapa público visible';
  raise notice 'OK 8a anon';
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
declare n int; msg text;
begin
  select count(*) into n from mis_reportes();
  assert n = 2, 'a2 ve solo sus 2 reportes, vio ' || n;
  select count(*) into n from incidentes;      -- RLS: no es personal del panel
  assert n = 0, 'ciudadano no ve incidentes por tabla';
  begin perform cambiar_estado_panel(gen_random_uuid(), 'recibido'); exception when others then msg := sqlerrm; end;
  assert msg = 'sin_permiso', 'ciudadano no cambia estados';
  raise notice 'OK 8b ciudadano autenticado';
end $$;
reset role;

-- Personal del panel de Bomberos
insert into miembros_panel values ('44444444-4444-4444-8444-444444444444', '00000000-0000-4000-a000-000000000001', true);
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
do $$
declare n int; total int;
begin
  select count(*) into n from incidentes;
  assert n = 2, 'Bomberos ve solo sus 2 incidentes, vio ' || n;
  select count(*) into n from reportes;
  assert n = 3, 'y sus 3 reportes, vio ' || n;
  raise notice 'OK 8c panel limitado a su institución';
end $$;
reset role;

select 'TODAS LAS PRUEBAS PASARON' as resultado;
