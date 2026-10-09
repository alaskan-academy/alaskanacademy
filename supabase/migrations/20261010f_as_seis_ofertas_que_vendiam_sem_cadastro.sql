-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ As seis ofertas que vendiam sem cadastro                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- `vw_ofertas_faltando` acusava 6 códigos da Payt com venda aprovada e sem
-- linha em `ofertas`. Somadas, **R$ 32.169,07 em 252 vendas** — e duas delas
-- vendendo no próprio dia em que isto foi escrito. A maior, `RAOJGY`, fez
-- R$ 22.949,86 em 195 vendas desde 02/09 e estava invisível para o cadastro.
--
-- Elas ficaram enterradas porque o alerta de cadastro misturava isto com 115
-- itens de projeto encerrado (ver `20261010d`): pesavam 4% de um número que
-- ninguém abria.
--
-- ── O `tipo` de cada uma saiu dos DADOS, não de palpite ──────────────────
--
-- `tipo` é `NOT NULL` e não tem default, então era o campo com risco de
-- invenção. Cada um foi decidido por evidência:
--
--   RAOJGY       195 vendas, ZERO como upsell, ticket R$ 113  -> oferta_principal
--   6995…comun.   22 vendas, 22 como upsell                   -> upsell
--   LXM7JB        17 vendas, 15 como upsell, ticket R$ 275    -> upsell
--   697388…sabo.  16 vendas, 16 como upsell                   -> upsell
--   4O2A52         1 venda direta, mas 49 linhas em
--                  venda_itens com tipo orderbump_1           -> orderbump_1
--   RV6GQJ         1 venda direta, sem linha de bump          -> oferta_principal
--
-- ── Duas delas JÁ EXISTEM com outro código, e isso é esperado ────────────
--
--   `697388068128c-saboariaenergetica`  já existe como `4M2WW6`
--   `6995becba08f7-workshopecomunidade` já existe como `4OMBNZ`
--
-- `code_payt` é UNIQUE: a tabela é uma linha por CÓDIGO, não por produto. Um
-- mesmo produto vendido por dois checkouts tem dois códigos, e os dois
-- precisam estar lá — senão metade das vendas continua órfã. Os códigos longos
-- com slug são de um checkout mais novo que o formato curto de seis letras.
--
-- E repare na Saboaria Energética: o código curto está cadastrado como
-- **orderbump_4** e o longo vende **16 de 16 como upsell**. Não é erro de
-- nenhum dos dois. É a regra que o CLAUDE.md já registra sobre upsell — *"um
-- mesmo produto vende como upsell e direto, então o tipo é da venda e não do
-- produto"*. Por isso cada linha recebe o tipo que o CÓDIGO dela pratica, e
-- não o tipo do irmão.
--
-- ── O que NÃO foi preenchido ─────────────────────────────────────────────
--
-- `meta_taxa` fica nula: nenhuma das 43 ofertas já cadastradas tem esse campo
-- preenchido, e inventar uma meta para seis delas criaria um número que
-- ninguém definiu.
--
-- `produto` fica nulo no "Sistema de Decoração de Balões": o enum
-- `produto_tipo` tem velas, saponaria, cosmeticos, hormonal, velaroma, handify
-- e sala_de_aula, e balões não é nenhum deles. Quatro ofertas já cadastradas
-- também têm `produto` nulo — é o valor honesto para o que não se encaixa, e
-- bem melhor que forçar a categoria mais parecida.
--
-- `primeira_vez` recebe a DATA DA PRIMEIRA VENDA, e não o `now()` do default:
-- o campo quer dizer "desde quando esta oferta existe", e carimbar hoje
-- apagaria que a RAOJGY vende desde 02/09.

begin;

insert into public.ofertas (code_payt, nome, tipo, produto, ativo, primeira_vez)
values
  -- A maior: R$ 22.949,86 em 195 vendas desde 02/09, nenhuma como upsell.
  ('RAOJGY',
   'Guia do Comportamento na Sala de Aula',
   'oferta_principal', 'sala_de_aula', true, '2026-09-02 12:37:24-03'),

  -- 15 de 17 como upsell, e ticket de R$ 275 — o mais caro dos seis.
  ('LXM7JB',
   'Workshop Desafios na Sala de Aula',
   'upsell', 'sala_de_aula', true, '2026-09-03 17:32:13-03'),

  -- Segundo código do mesmo produto de `4OMBNZ`, que já é upsell/saponaria.
  ('6995becba08f7-workshopecomunidade',
   'Workshop Primeira Venda em 7 dias + Comunidade 2.0',
   'upsell', 'saponaria', true, '2026-07-08 06:53:41-03'),

  -- Segundo código de `4M2WW6`. Aquele é orderbump_4; ESTE vende 16 de 16 como
  -- upsell. O tipo é da venda, não do produto — ver o cabeçalho.
  ('697388068128c-saboariaenergetica',
   'Saboaria Energética: Purificação e Bem-Estar 2.0',
   'upsell', 'saponaria', true, '2026-07-08 06:54:15-03'),

  -- 1 venda direta, mas 49 linhas em venda_itens como orderbump_1: na prática
  -- é bump, e a venda avulsa é a exceção.
  ('4O2A52',
   'Calma na Sala de Aula 2.0',
   'orderbump_1', 'sala_de_aula', true, '2026-09-07 09:30:09-03'),

  -- Balões não cabe em nenhum valor de produto_tipo. Nulo é a resposta honesta.
  ('RV6GQJ',
   'Sistema de Decoração de Balões',
   'oferta_principal', null, true, '2026-08-25 07:44:32-03')

-- Idempotente: `code_payt` é UNIQUE, e rodar duas vezes não pode duplicar.
on conflict (code_payt) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_r     record;
begin
  -- 1. A fila zerou. É o objetivo direto desta migração.
  select count(*) into v_n from public.vw_ofertas_faltando;
  if v_n <> 0 then
    v_erros := v_erros || format('ainda faltam %s oferta(s) no cadastro. ', v_n);
  end if;

  -- 2. As seis existem, e com o tipo que os dados mandaram. Travar o tipo aqui
  --    é o que impede alguém de "arrumar" a Saboaria para orderbump só porque
  --    o irmão dela é.
  for v_r in
    select * from (values
      ('RAOJGY', 'oferta_principal', 'sala_de_aula'),
      ('LXM7JB', 'upsell', 'sala_de_aula'),
      ('6995becba08f7-workshopecomunidade', 'upsell', 'saponaria'),
      ('697388068128c-saboariaenergetica', 'upsell', 'saponaria'),
      ('4O2A52', 'orderbump_1', 'sala_de_aula'),
      ('RV6GQJ', 'oferta_principal', null)
    ) as t(code, tipo, produto)
  loop
    if not exists (
      select 1 from public.ofertas o
       where o.code_payt = v_r.code
         and o.tipo::text = v_r.tipo
         and o.produto::text is not distinct from v_r.produto
    ) then
      v_erros := v_erros || format('%s nao ficou como %s/%s. ', v_r.code, v_r.tipo, coalesce(v_r.produto,'(nulo)'));
    end if;
  end loop;

  -- 3. `primeira_vez` é a data da primeira venda, não o dia de hoje. Carimbar
  --    hoje apagaria que a RAOJGY vende desde 02/09.
  select count(*) into v_n
    from public.ofertas o
   where o.code_payt in ('RAOJGY','LXM7JB','6995becba08f7-workshopecomunidade',
                         '697388068128c-saboariaenergetica','4O2A52','RV6GQJ')
     and o.primeira_vez::date > current_date - 7;
  if v_n > 0 then
    v_erros := v_erros || format('%s oferta(s) ficaram com primeira_vez de hoje em vez da primeira venda. ', v_n);
  end if;

  -- 4. Nenhuma venda aprovada ficou sem oferta correspondente — a prova de que
  --    o cadastro cobre o que de fato vendeu.
  select count(distinct (v.payload_webhook->'product'->>'code')) into v_n
    from public.vendas v
   where v.status = 'aprovada'
     and (v.payload_webhook->'product'->>'code') is not null
     and not exists (select 1 from public.ofertas o
                      where o.code_payt = (v.payload_webhook->'product'->>'code'));
  if v_n > 0 then
    v_erros := v_erros || format('%s codigo(s) de produto seguem sem cadastro. ', v_n);
  end if;

  -- 5. E os dois produtos que agora têm DOIS códigos continuam com os dois.
  --    Apagar um deles para "limpar a duplicata" deixaria metade das vendas
  --    orfã de novo — a tabela é por código, não por produto.
  for v_r in select unnest(array['Saboaria Energética: Purificação e Bem-Estar 2.0',
                                 'Workshop Primeira Venda em 7 dias + Comunidade 2.0']) as nome
  loop
    select count(*) into v_n from public.ofertas where nome = v_r.nome;
    if v_n <> 2 then
      v_erros := v_erros || format('%L tem %s codigo(s) cadastrados, esperava 2. ', v_r.nome, v_n);
    end if;
  end loop;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: as 6 ofertas entraram com o tipo que os dados mandaram, primeira_vez na data da primeira venda, e nenhuma venda aprovada segue sem cadastro.';
end $prova$;

notify pgrst, 'reload schema';
