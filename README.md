# IGNIS 2.0 · Reporte ciudadano de incendios

Plataforma de la Universidad de Guanajuato (GeoUG) para que la ciudadanía reporte incendios y las instituciones los atiendan con alertas inmediatas.

## Cómo funciona

1. El ciudadano reporta desde la app (foto, GPS, tipo de incendio).
2. El servidor guarda el reporte, ubica el municipio o ANP y lo agrupa con reportes cercanos del mismo incendio.
3. La institución responsable recibe la alerta en su grupo de Telegram y marca el estado con botones.
4. Cada cambio de estado se notifica al ciudadano.
5. Si nadie confirma en 10 minutos, se avisa a un contacto de respaldo.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `supabase/migrations/` | Esquema de la base de datos, reglas y seguridad |
| `supabase/seed/` | Regiones, municipios (INEGI/CONABIO) e instituciones del piloto |
| `supabase/tests/` | Pruebas automáticas de la base de datos |
| `supabase/functions/` | Funciones del servidor: reporte, bot de Telegram, escalamiento *(en desarrollo)* |
| `app/` | App móvil *(en desarrollo)* |
| `scripts/` | Utilidades, por ejemplo convertir GeoJSON de municipios a SQL |

## Instalación automática

Cada vez que se sube un cambio a `main`, GitHub Actions corre las pruebas y, si pasan, instala la base de datos en Supabase.

Secretos necesarios en **Settings → Secrets and variables → Actions**:

| Secreto | Dónde se obtiene |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | La clave del proyecto en la URL del panel de Supabase |
| `SUPABASE_DB_PASSWORD` | La contraseña de la base de datos del proyecto |
| `TELEGRAM_BOT_TOKEN` | El token que entrega @BotFather |

## Datos

Límites municipales de Guanajuato: [PhantomInsights/mexico-geojson](https://github.com/PhantomInsights/mexico-geojson) (licencia MIT), derivados de CONABIO / Marco Geoestadístico del INEGI 2023.
