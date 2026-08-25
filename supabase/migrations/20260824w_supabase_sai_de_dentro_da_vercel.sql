-- Supabase é cobrado pelo marketplace da Vercel e o descritor diz isso:
-- "VERCEL MKT SUPABASE" e "VERCEL MKT HOLD SUPABA". Somados sob "Vercel", dois
-- serviços distintos viravam um número só — R$ 794 que não se sabia de quem
-- eram. São R$ 325 de Vercel e R$ 469 de Supabase.
--
-- Prioridade menor que a do "VERCEL" genérico para ser testado antes.
insert into public.fornecedores (nome, padrao, prioridade) values
  ('Supabase', 'VERCEL MKT SUPABASE',    20),
  ('Supabase', 'VERCEL MKT HOLD SUPABA', 20)
on conflict do nothing;

update public.fornecedores
   set prioridade = 60
 where nome = 'Vercel' and padrao = 'VERCEL';
