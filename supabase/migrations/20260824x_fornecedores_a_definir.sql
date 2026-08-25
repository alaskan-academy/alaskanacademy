-- Fornecedor que o extrato não sabe separar sozinho.
--
-- Juntar por nome do emissor foi longe demais em alguns casos: Hostinger cobra
-- domínio E n8n, Sellflux cobra mensalidade E token, e "Vercel" trazia o
-- Supabase junto. Somados, viram um número que não responde nada. Mas nem
-- sempre o descritor distingue — em Hostinger as 6 grafias são só a adquirente
-- mudando (DM* e EBN*), e as faixas de valor se sobrepõem: R$ 7,08 a R$ 87,99
-- nas duas.
--
-- Onde o descritor separa, separa-se. Onde não separa, a linha fica marcada
-- como não definida e aparece na tela para ser resolvida à mão. O que não pode
-- é um agrupamento provisório passar por definitivo.
alter table public.fornecedores add column if not exists definido boolean not null default true;
alter table public.fornecedores add column if not exists nota text;

comment on column public.fornecedores.definido is
  'false = agrupamento provisório, precisa de nome/decisão humana. Aparece na tela como pendente.';

-- Hostinger: duas adquirentes, dois produtos (domínio e n8n). Separadas agora
-- para o histórico já ficar dividido certo; qual é qual, ela nomeia na tela.
delete from public.fornecedores where padrao = 'HOSTINGER';

insert into public.fornecedores (nome, padrao, tipo_match, prioridade, definido, nota) values
  ('Hostinger (DM)',  '^DM\s*\*?\s*HOSTINGER',  'regex', 45, false,
   'Domínio ou n8n — a definir. 13 lançamentos.'),
  ('Hostinger (EBN)', '^EBN\s*\*?\s*HOSTINGER', 'regex', 45, false,
   'O outro dos dois — a definir. 6 lançamentos.')
on conflict do nothing;

-- JK Workspace: o do cartão é o endereço fiscal (R$ 129,20 fixo, 9x); o do PIX
-- é outro serviço (R$ 40 a R$ 65, 3x) e precisa de nome.
delete from public.fornecedores where padrao = 'JK WORKSPACE';

insert into public.fornecedores (nome, padrao, tipo_match, prioridade, definido, nota) values
  ('Endereço Fiscal (JK)', 'ASA\*JK WORKSPACE',   'regex', 45, true,  null),
  ('JK Workspace (PIX)',   '^JK WORKSPACE LTDA$', 'regex', 45, false,
   'Serviço diferente do endereço fiscal — a definir. 3 lançamentos de R$ 40 a R$ 65.')
on conflict do nothing;

-- Sellflux: mensalidade e token na mesma grafia, faixas de valor cruzadas.
update public.fornecedores
   set definido = false,
       nota = 'Mensalidade e token somados — o descritor não separa. A definir.'
 where padrao = 'SELLFLUX';

create or replace function public.fn_fornecedor_info(p_descricao text)
returns table (nome text, definido boolean)
language sql stable as $fn$
  select f.nome, f.definido
    from public.fornecedores f
   where f.ativo
     and ( (f.tipo_match = 'contains' and upper(p_descricao) like '%' || upper(f.padrao) || '%')
        or (f.tipo_match = 'regex'    and p_descricao ~* f.padrao) )
   order by f.prioridade, length(f.padrao) desc
   limit 1;
$fn$;

-- Resolve o apelido; sem apelido, cai na normalização de antes. A rede importa:
-- fornecedor novo continua sendo detectado como recorrência no dia seguinte,
-- sem ninguém precisar cadastrar nada primeiro.
create or replace function public.fn_fornecedor(p_descricao text)
returns text
language sql stable as $fn$
  select coalesce(
    (select i.nome from public.fn_fornecedor_info(p_descricao) i),
    public.fn_chave_recorrencia(p_descricao)
  );
$fn$;

comment on function public.fn_fornecedor(text) is
  'Nome do fornecedor por apelido cadastrado; cai na normalização do descritor quando não houver.';

grant execute on function public.fn_fornecedor(text)      to authenticated;
grant execute on function public.fn_fornecedor_info(text) to authenticated;
