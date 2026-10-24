#!/usr/bin/env python3
"""Convierte un GeoJSON de municipios (formato CONABIO/INEGI) en SQL de jurisdicciones.

Uso:
  python3 scripts/geojson_a_sql.py data/raw/gto_2023.json GTO > supabase/seed/municipios_gto.sql

Fuente de Guanajuato: PhantomInsights/mexico-geojson (MIT), derivado de los
shapefiles 2023 de CONABIO / Marco Geoestadístico del INEGI.
"""
import json
import sys


def main(ruta, region):
    datos = json.load(open(ruta, encoding='utf-8'))
    print(f"-- Municipios de {region} generados desde {ruta.split('/')[-1]}")
    print('begin;')
    for f in datos['features']:
        p = f['properties']
        clave = p['CVEGEO']
        nombre = p['NOMGEO'].replace("'", "''")
        geom = json.dumps(f['geometry'], separators=(',', ':'))
        print(
            "insert into jurisdicciones (region_id, tipo, clave, nombre, geom) values "
            f"('{region}', 'municipio', '{clave}', '{nombre}', "
            f"st_multi(st_makevalid(st_simplifypreservetopology(st_setsrid(st_geomfromgeojson('{geom}'), 4326), 0.0002)))) "
            "on conflict (tipo, clave) do update set nombre = excluded.nombre, geom = excluded.geom;"
        )
    print('commit;')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
