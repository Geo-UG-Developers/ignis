-- IGNIS 2.0 · Esquema base
-- Base de datos geoespacial para reportes ciudadanos de incendios.
-- Coordenadas en EPSG:4326 (WGS84, lon/lat).

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------
create type tipo_incendio as enum ('forestal', 'pastizal', 'quema_esquilmo', 'quema_basura');

create type estado_incidente as enum (
  'nuevo',        -- recién reportado, nadie lo ha confirmado
  'recibido',     -- la institución lo vio
  'en_camino',    -- brigada en camino
  'controlado',   -- fuego contenido
  'extinguido',   -- cerrado
  'falso'         -- falso o duplicado, cerrado
);

create type tipo_institucion as enum ('bomberos', 'proteccion_civil', 'conafor', 'conanp', 'brigada', 'otra');
create type tipo_jurisdiccion as enum ('municipio', 'anp', 'zona_especial');
create type canal_evento as enum ('telegram', 'panel', 'sistema');

-- ---------------------------------------------------------------
-- Regiones: cada despliegue (Guanajuato, Querétaro, Sayula...).
-- Costa Rica va en un proyecto (servidor) separado.
-- ---------------------------------------------------------------
create table regiones (
  id          text primary key check (id ~ '^[A-Z]{2,5}$'),   -- 'GTO', 'QRO'
  nombre      text not null,
  pais        text not null default 'MX',
  activa      boolean not null default true,
  creado_en   timestamptz not null default now()
);

create table instituciones (
  id                    uuid primary key default gen_random_uuid(),
  region_id             text not null references regiones(id),
  nombre                text not null,
  tipo                  tipo_institucion not null,
  telegram_chat_id      bigint unique,             -- grupo de Telegram que recibe alertas
  correo                text,                       -- respaldo por correo
  respaldo_id           uuid references instituciones(id),  -- a quién se escala
  minutos_escalamiento  int not null default 10 check (minutos_escalamiento between 1 and 240),
  activa                boolean not null default true,
  creado_en             timestamptz not null default now()
);

create table jurisdicciones (
  id          uuid primary key default gen_random_uuid(),
  region_id   text not null references regiones(id),
  tipo        tipo_jurisdiccion not null,
  clave       text,                                -- CVEGEO del INEGI, clave de ANP, etc.
  nombre      text not null,
  geom        geometry(MultiPolygon, 4326) not null,
  unique (tipo, clave)
);
create index jurisdicciones_geom_idx on jurisdicciones using gist (geom);

-- Quién atiende cada jurisdicción.
create table jurisdiccion_institucion (
  jurisdiccion_id uuid not null references jurisdicciones(id) on delete cascade,
  institucion_id  uuid not null references instituciones(id) on delete cascade,
  primary key (jurisdiccion_id, institucion_id)
);

-- ---------------------------------------------------------------
-- Incidentes: un incendio. Agrupa varios reportes ciudadanos.
-- ---------------------------------------------------------------
create sequence folio_seq;

create table incidentes (
  id                   uuid primary key default gen_random_uuid(),
  folio                text not null unique,
  region_id            text references regiones(id),       -- null = fuera de cobertura
  tipo                 tipo_incendio not null,
  estado               estado_incidente not null default 'nuevo',
  ubicacion            geometry(Point, 4326) not null,      -- del primer reporte
  municipio            text,
  num_reportes         int not null default 1,
  confirmado_satelite  boolean not null default false,
  escalado_en          timestamptz,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now()
);
create index incidentes_ubicacion_idx on incidentes using gist (ubicacion);
create index incidentes_abiertos_idx on incidentes (estado, creado_en)
  where estado not in ('extinguido', 'falso');

-- Instituciones notificadas por incidente (y el mensaje de Telegram a editar).
create table incidente_institucion (
  incidente_id         uuid not null references incidentes(id) on delete cascade,
  institucion_id       uuid not null references instituciones(id),
  es_respaldo          boolean not null default false,
  notificado_en        timestamptz,
  telegram_message_id  bigint,
  primary key (incidente_id, institucion_id)
);

-- ---------------------------------------------------------------
-- Reportes ciudadanos. autor = usuario anónimo de Supabase Auth.
-- ---------------------------------------------------------------
create table reportes (
  id            uuid primary key default gen_random_uuid(),
  incidente_id  uuid not null references incidentes(id) on delete cascade,
  autor         uuid not null,                       -- auth.uid() del dispositivo
  tipo          tipo_incendio not null,
  ubicacion     geometry(Point, 4326) not null,
  precision_m   real check (precision_m >= 0),
  comentario    text check (char_length(comentario) <= 500),
  nombre        text check (char_length(nombre) <= 120),
  telefono      text check (char_length(telefono) <= 30),
  fotos         text[] not null default '{}' check (cardinality(fotos) <= 3),
  creado_en     timestamptz not null default now()
);
create index reportes_autor_idx on reportes (autor, creado_en desc);
create index reportes_incidente_idx on reportes (incidente_id);

-- Historial de estados: quién, cuándo y por qué canal.
create table eventos_estado (
  id              bigint generated always as identity primary key,
  incidente_id    uuid not null references incidentes(id) on delete cascade,
  estado          estado_incidente not null,
  institucion_id  uuid references instituciones(id),
  actor           text,                  -- nombre visible en Telegram o correo del panel
  canal           canal_evento not null,
  creado_en       timestamptz not null default now()
);
create index eventos_incidente_idx on eventos_estado (incidente_id, creado_en);

-- Tokens de notificación push por usuario anónimo.
create table dispositivos_push (
  autor           uuid primary key,
  token           text not null,
  plataforma      text not null check (plataforma in ('android', 'ios', 'web')),
  actualizado_en  timestamptz not null default now()
);

-- Usuarios del panel web (personal de instituciones).
create table miembros_panel (
  user_id         uuid primary key,      -- auth.users.id
  institucion_id  uuid not null references instituciones(id),
  es_admin        boolean not null default false
);

-- Focos de calor satelitales (NASA FIRMS).
create table detecciones_satelitales (
  id              bigint generated always as identity primary key,
  fuente          text not null,                       -- 'VIIRS_NOAA20_NRT', 'GOES'...
  ubicacion       geometry(Point, 4326) not null,
  adquirido_en    timestamptz not null,
  confianza       text,
  frp             real,                                -- potencia radiativa (MW)
  incidente_id    uuid references incidentes(id),
  unique (fuente, adquirido_en, ubicacion)
);
create index detecciones_ubicacion_idx on detecciones_satelitales using gist (ubicacion);
