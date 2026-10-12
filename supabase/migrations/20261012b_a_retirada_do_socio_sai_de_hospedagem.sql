-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ A retirada do sócio sai de Hospedagem                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Em 08/10/2026 uma retirada de R$ 3.000 do Lucas caiu em
-- `Hospedagem/Infraestrutura`:
--
--   2d11ba97  2026-10-08  LUCAS DOS SANTOS VEIGA  -3.000,00
--             categoria       Hospedagem/Infraestrutura   <- errado
--             centro_custo    Sócios                      <- já estava certo
--             empresa         Alaskan Academy
--
-- O centro de custo já apontava `Sócios`, então o que ficou para trás foi só a
-- categoria.
--
-- ── Por que `Retirada de Lucro`, e não `Pró-labore` ─────────────────────
--
-- Ele recebe pelas DUAS, então o nome não se deduz da pessoa. Mas o padrão
-- decide sozinho, olhando os quatro meses anteriores:
--
--   Pró-labore ......... SEMPRE exatos -2.670,00, uma vez por mês
--                        (15/09, 20/08, 20/07, 19/06)
--   Retirada de Lucro .. valores irregulares -- EXCETO um, que se repete:
--                        -3.000,00 entre os dias 6 e 8 de cada mês
--                        08/09, 06/08, 08/07, 08/06 ... e 08/10
--
-- É a mesma retirada mensal, no mesmo valor, na mesma janela do mês,
-- classificada como `Retirada de Lucro` quatro vezes seguidas. A de outubro é
-- a quinta, e é esta.
--
-- A diferença não é cosmética: pró-labore é remuneração, com INSS e IRRF;
-- retirada de lucro é distribuição. Chutar entre as duas seria errar a
-- natureza do lançamento para a contabilidade.
--
-- ── NÃO é duplicata, e eu conferi porque o número parecia estranho ──────
--
-- Outubro já tinha uma `Retirada de Lucro` de -3.000,00, também em 08/10. Isso
-- cheirava a lançamento em dobro. Não é: são duas pessoas e duas empresas.
--
--   2d11ba97  LUCAS DOS SANTOS VEIGA      Alaskan Academy
--   4982078a  JESSICA GAVAZZA PEISINO     Aeliss
--
-- Os dois sócios retiraram R$ 3.000 no mesmo dia, cada um da sua empresa. Uma
-- foi arquivada certo, a outra não.
--
-- ── O que isso faz com o DRE de outubro ─────────────────────────────────
--
-- `Retirada de Lucro` está no grupo "o que os sócios tiraram no mês"
-- (`constants.ts:94`, lido por `resultado.ts:173`), que fica FORA do custo
-- operacional. `Hospedagem/Infraestrutura` não está nesse grupo: é custo.
--
-- Então outubro estava contando uma retirada como despesa de operação. O resto
-- da categoria no mês é Google Workspace (-98,00) e Vercel/Supabase (-228,37 e
-- -7,99):
--
--   Hospedagem/Infraestrutura   -3.334,36  ->    -334,36   (era 10x)
--   Retirada de Lucro           -3.000,00  ->  -6.000,00
--
-- O custo operacional de outubro cai R$ 3.000 e a retirada sobe R$ 3.000. O
-- caixa não muda: é a mesma saída, na prateleira certa.

begin;

-- Retrato de antes, para a prova poder dizer que SÓ a categoria mudou. Uma
-- linha de dinheiro tocada à mão merece isso.
drop table if exists _antes_retirada;
create temp table _antes_retirada as
select id, to_jsonb(t) - 'categoria' as resto
  from public.transacoes t
 where id = '2d11ba97-4236-420e-94dd-76b0364c5c6f';

update public.transacoes
   set categoria = 'Retirada de Lucro'
 where id = '2d11ba97-4236-420e-94dd-76b0364c5c6f'
   and categoria = 'Hospedagem/Infraestrutura';

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_num   numeric;
  v_alvo  constant uuid := '2d11ba97-4236-420e-94dd-76b0364c5c6f';
begin
  -- 1. A linha existia e era uma só. Se o retrato veio vazio, o id mudou e a
  --    migração não fez nada -- que é pior que falhar, porque passaria calada.
  select count(*) into v_n from _antes_retirada;
  if v_n <> 1 then
    v_erros := v_erros || format('o retrato de antes tem %s linha(s), esperava 1. ', v_n);
  end if;

  -- 2. A categoria virou.
  if (select categoria from public.transacoes where id = v_alvo)
       is distinct from 'Retirada de Lucro' then
    v_erros := v_erros || 'a categoria nao virou Retirada de Lucro. ';
  end if;

  -- 3. E NADA MAIS mudou nessa linha. Valor, data, descrição, empresa e centro
  --    de custo ficam como estavam -- em especial o valor, que e dinheiro.
  select count(*) into v_n
    from _antes_retirada a join public.transacoes t on t.id = a.id
   where (to_jsonb(t) - 'categoria') is distinct from a.resto;
  if v_n > 0 then
    v_erros := v_erros || 'outra coluna da linha mudou alem da categoria. ';
  end if;

  -- 4. O centro de custo continua Sócios. Ele já estava certo antes, e a
  --    prova 3 cobre isso -- mas este caso diz em voz alta o que importa.
  if (select centro_custo from public.transacoes where id = v_alvo)
       is distinct from 'Sócios' then
    v_erros := v_erros || 'o centro de custo saiu de Sócios. ';
  end if;

  -- 5. Nenhuma OUTRA transação foi tocada: a contagem e a soma do mês inteiro
  --    continuam as mesmas. Recategorizar move de prateleira, nao mexe no caixa.
  select count(*) into v_n from public.transacoes
   where data between '2026-10-01' and '2026-10-31';
  if v_n <> 179 then
    v_erros := v_erros || format('outubro tem %s transacoes, tinha 179. ', v_n);
  end if;

  select round(sum(valor), 2) into v_num from public.transacoes
   where data between '2026-10-01' and '2026-10-31' and valor < 0;
  -- -41047.72 -7600 -3334.36 -3000 -1500 -962.90 -954 -948.37 -575.54 -321.28 -165 -39.57
  if v_num is distinct from -60448.74 then
    v_erros := v_erros || format('a saida total de outubro virou %s, era -60448.74. ', v_num);
  end if;

  -- 6. As duas prateleiras ficaram como o cabeçalho diz.
  select round(sum(valor), 2) into v_num from public.transacoes
   where data between '2026-10-01' and '2026-10-31'
     and categoria = 'Hospedagem/Infraestrutura';
  if v_num is distinct from -334.36 then
    v_erros := v_erros || format('Hospedagem de outubro ficou em %s, esperava -334.36. ', v_num);
  end if;

  select round(sum(valor), 2) into v_num from public.transacoes
   where data between '2026-10-01' and '2026-10-31'
     and categoria = 'Retirada de Lucro';
  if v_num is distinct from -6000.00 then
    v_erros := v_erros || format('Retirada de Lucro de outubro ficou em %s, esperava -6000.00. ', v_num);
  end if;

  -- 7. E a da Jessica, que já estava certa, não foi encostada.
  if (select categoria from public.transacoes
       where id = '4982078a-4dc6-45bd-9936-64fe8e4edb6b')
       is distinct from 'Retirada de Lucro' then
    v_erros := v_erros || 'a retirada da Jessica foi alterada, e nao devia. ';
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: a retirada de R$ 3.000 do Lucas saiu de Hospedagem para Retirada de Lucro. A hospedagem de outubro caiu de -3.334,36 para -334,36, a retirada subiu para -6.000,00, e nenhuma outra linha nem o caixa do mes se mexeram.';
end $prova$;

drop table if exists _antes_retirada;
