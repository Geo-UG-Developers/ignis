#!/usr/bin/env python3
"""Limpia el histórico de reportes de IGNIS v1 (CSV 2021-2025) y genera el SQL de carga.

Uso:
  python3 scripts/historico_a_sql.py HISTORICO.csv > supabase/seed/30_historico.sql

Qué hace:
  * Lee el CSV (codificación Latin-1, fechas dd/mm/aaaa).
  * NO copia la columna Nombre (dato personal) ni fotos.
  * Corrige coordenadas invertidas (latitud y longitud intercambiadas).
  * Recupera coordenadas mal escritas a partir del enlace de Google Maps.
  * Marca en `calidad` cada corrección o sospecha, para poder filtrar después.
"""
import csv
import re
import sys
from collections import Counter

TIPOS = {'pastizal': 'pastizal', 'forestal': 'forestal', 'esquilmo': 'quema_esquilmo',
         'quema de esquilmo': 'quema_esquilmo', 'basura': 'quema_basura', 'quema de basura': 'quema_basura'}


def numero(t):
    try:
        return float(str(t).strip())
    except (TypeError, ValueError):
        return None


def desde_enlace(url):
    """'.../place/21,01858,-101,2591' o '.../place/20.93,-101.28' -> (lat, lon)."""
    if not url:
        return None
    m = re.search(r'place/([-\d.,]+)', url)
    if not m:
        return None
    t = m.group(1)
    if t.count(',') == 1:
        a, b = t.split(',')
    elif t.count(',') == 3:              # decimales con coma: 21,01858,-101,2591
        p = t.split(',')
        a, b = f'{p[0]}.{p[1]}', f'{p[2]}.{p[3]}'
    else:
        return None
    return numero(a), numero(b)


def sql(v):
    if v is None or v == '':
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"


def main(ruta):
    filas = list(csv.DictReader(open(ruta, encoding='latin-1')))
    salida, stats = [], Counter()
    for f in filas:
        if not (f.get('id') or '').strip():
            stats['vacias'] += 1
            continue
        calidad = []
        lat, lon = numero(f['Latitud']), numero(f['Longitud'])
        if lat is None or lon is None:
            rec = desde_enlace(f.get('LinkUbicacion'))
            if rec and None not in rec:
                lat, lon = rec
                calidad.append('coords_reparadas')
            else:
                stats['sin_coordenadas'] += 1
                continue
        if abs(lon) > 1000:               # punto decimal perdido: -10157542 -> -101.57542
            dig = str(int(abs(lon)))
            lon = (-1 if lon < 0 else 1) * float(dig[:3] + '.' + dig[3:])
            calidad.append('coords_reparadas')
        if lon > 0 and lat < 0:           # vienen intercambiadas
            lat, lon = lon, lat
            calidad.append('coords_invertidas')
        if not (14 <= lat <= 33 and -118 <= lon <= -86):
            stats['fuera_de_mexico'] += 1
            continue
        tipo = TIPOS.get((f['TipoIncendio'] or '').strip().lower())
        if not tipo:
            stats['tipo_desconocido'] += 1
            tipo = 'pastizal'
            calidad.append('tipo_supuesto')
        d, m, a = f['FechaCreacion'].split('/')
        hora = (f['HoraCreacion'] or '00:00:00').strip()
        plataforma = (f['SistemaOperativo'] or '').strip()
        plataforma = None if plataforma.upper() in ('', 'NA') else plataforma
        loc = (f['Localidad'] or '').strip() or None
        salida.append(
            f"({int(float(f['id']))}, '{a}-{m}-{d} {hora}', '{tipo}', {sql((f['Municipio'] or '').strip())}, "
            f"{sql(loc if loc != 'NA' else None)}, {sql((f['Estado'] or '').strip())}, "
            f"st_setsrid(st_makepoint({lon}, {lat}), 4326), {sql(plataforma)}, "
            f"array[{', '.join(sql(c) for c in calidad)}]::text[])"
        )
        for c in calidad:
            stats[c] += 1
    print('-- Histórico de reportes IGNIS v1 (2021-2025). Generado por scripts/historico_a_sql.py')
    print('-- Sin datos personales (se omite la columna Nombre).')
    print('begin;')
    print('insert into incendios_historicos (id_original, ocurrido_local, tipo, municipio_reportado, localidad, '
          'estado_reportado, ubicacion, plataforma, calidad) values')
    print(',\n'.join(salida))
    print('on conflict (fuente, id_original) do nothing;')
    print('select calcular_calidad_historico();')
    print('commit;')
    print(f'-- Filas: {len(salida)} cargadas. Estadísticas: {dict(stats)}', file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1])
