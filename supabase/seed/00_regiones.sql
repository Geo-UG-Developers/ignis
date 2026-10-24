-- Regiones del despliegue México.
insert into regiones (id, nombre) values
  ('GTO', 'Guanajuato'),
  ('QRO', 'Querétaro')
on conflict (id) do nothing;
