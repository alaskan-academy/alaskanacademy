-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ As duas origens de UTM que faltavam                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- As duas últimas origens sem classificação. Cada uma com precedente ou
-- evidência própria — nenhuma foi chutada.
--
--   **area-membros-lumii → organico**
--   `utm_medium = 'interno'`, campanha `calmanasala`, venda aprovada em 07/09.
--   A tabela já tem as duas irmãs: `area-membros-handify` (135 vendas) e
--   `area-membros-laura` (20), ambas `organico`, com a observação "aluna que já
--   é cliente". Esta é a terceira da família, pela mesma regra.
--
--   **primeiracompra-recovery_cart_mail_1 → email**
--   E-mail de recuperação de carrinho: `utm_medium` nulo, status `pendente`,
--   única venda em 12/05 e nunca aprovada. O enum `origem_venda` tem `email` e
--   nenhuma linha usava ainda — e é este o caso que a palavra descreve. Chamar
--   de `organico` juntaria recuperação de carrinho com área de membros, que são
--   canais diferentes, com intenção e custo diferentes.
--
-- ── Em minúsculo, porque a busca é em minúsculo ─────────────────────────
--
-- `calcular_origem` procura por `lower(trim(p_utm_source))`, e
-- `vw_origens_a_classificar` compara do mesmo jeito. Gravar
-- `'PRIMEIRACOMPRA-…'` com maiúsculas criaria uma linha que **nunca casa**: a
-- origem continuaria desconhecida E a entrada sumiria do alerta. Seria pior que
-- não cadastrar — o problema permaneceria e o aviso dele, não.
--
-- ── O dicionário sozinho não bastava ────────────────────────────────────
--
-- `vendas.origem` é coluna GRAVADA, preenchida por `trg_origem_venda` (BEFORE
-- INSERT/UPDATE). As duas vendas estavam em `desconhecido` desde que entraram.
-- Só inserir no dicionário deixaria a tabela dizendo uma coisa e a coluna
-- outra. Por isso o `update` no fim: ele não muda nada por si, só faz o gatilho
-- recalcular.
--
-- ── O QUE EU QUASE "CONSERTEI" POR ENGANO ───────────────────────────────
--
-- Escrevendo isto, uma prova minha acusou **32 vendas** de março a agosto com
-- `vendas.origem` = `pago` enquanto o dicionário diz `organico`:
-- `area-membros-handify` (26), `area-membros-laura` (4), `whatsapp` (2).
--
-- Parecia a quarta armadilha em estado puro — espelho calculado uma vez,
-- dicionário criado depois (26/08) e nada recalculado. Eu já tinha a migração
-- escrita para refazer as 32.
--
-- Não é. Olhando `trg_fn_origem`:
--
--     NEW.origem := CASE WHEN NEW.ad_id_meta IS NOT NULL THEN 'pago'
--                        ELSE calcular_origem(NEW.utm_source, NEW.utm_medium) END;
--
-- O dicionário é o **plano B**. Quando a venda carrega `ad_id_meta`, ela veio
-- de clique em anúncio e é paga, diga o que disser o `utm_source`. E as 32 têm
-- `ad_id_meta` — todas as 32, conferido, zero sem.
--
-- Ou seja: a pessoa clicou no anúncio, comprou, e o checkout carimbou por cima
-- o UTM da área de membros. O `ad_id` é evidência mais dura que a string. O
-- comportamento está certo; a minha asserção é que estava errada.
--
-- Por isso a prova cobra a invariante DE VERDADE: a origem segue o dicionário
-- **só quando não há `ad_id_meta`**. Escrever a invariante errada num teste é
-- pior que não ter teste — ele viraria uma pressão permanente para "arrumar"
-- dado correto.

begin;

insert into public.origens_utm (utm_source, origem, observacao)
values
  ('area-membros-lumii', 'organico',
   'Area de membros da Lumii -- mesma regra de area-membros-handify e -laura'),
  ('primeiracompra-recovery_cart_mail_1', 'email',
   'E-mail de recuperacao de carrinho. Canal proprio, sem custo de midia')
on conflict (utm_source) do nothing;

-- Retrato de antes das duas vendas afetadas. `atualizado_em` fica fora da
-- comparação porque `trg_fn_origem` o toca de propósito (`NEW.atualizado_em :=
-- NOW()`) — ele e `origem` são as únicas que podem mudar.
create temp table _antes_origem on commit drop as
select v.id, to_jsonb(v) - 'origem' - 'atualizado_em' as resto
  from public.vendas v
 where lower(trim(v.utm_source)) in
       ('area-membros-lumii', 'primeiracompra-recovery_cart_mail_1');

update public.vendas v
   set utm_source = v.utm_source
  from _antes_origem a
 where a.id = v.id;

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
  -- 1. Nada além de `origem` e `atualizado_em` mudou. `vendas` tem DOZE
  --    gatilhos BEFORE e qualquer update dispara todos — esta é a prova que
  --    autoriza tocar uma linha histórica.
  select count(*) into v_n
    from _antes_origem a join public.vendas v on v.id = a.id
   where (to_jsonb(v) - 'origem' - 'atualizado_em') is distinct from a.resto;
  if v_n > 0 then
    v_erros := v_erros || format('%s venda(s) tiveram outra coluna alterada. ', v_n);
  end if;

  -- 2. As duas saíram de 'desconhecido'.
  select count(*) into v_n from public.vendas
   where lower(trim(utm_source)) in ('area-membros-lumii','primeiracompra-recovery_cart_mail_1')
     and origem::text = 'desconhecido';
  if v_n > 0 then
    v_erros := v_erros || format('%s venda(s) seguem com origem desconhecida. ', v_n);
  end if;

  -- 3. A INVARIANTE DE VERDADE: o dicionário manda quando NÃO há ad_id_meta.
  --    Havendo, a origem é 'pago' e isso está certo — ver o cabeçalho sobre as
  --    32 que eu quase "consertei".
  select count(*) into v_n
    from public.vendas v join public.origens_utm o on o.utm_source = lower(trim(v.utm_source))
   where v.ad_id_meta is null
     and v.origem is distinct from o.origem;
  if v_n > 0 then
    v_erros := v_erros || format('%s venda(s) sem ad_id com origem diferente do dicionario. ', v_n);
  end if;

  -- 4. E o outro lado da regra: toda venda COM ad_id_meta é paga.
  select count(*) into v_n from public.vendas
   where ad_id_meta is not null and origem::text <> 'pago';
  if v_n > 0 then
    v_erros := v_erros || format('%s venda(s) com ad_id_meta nao estao como paga. ', v_n);
  end if;

  -- 5. A fila zerou.
  select count(*) into v_n from public.vw_origens_a_classificar;
  if v_n <> 0 then
    v_erros := v_erros || format('ainda ha %s origem(ns) sem classificar. ', v_n);
  end if;

  -- 6. Tudo no dicionário em minúsculo: linha com maiúscula nunca casa.
  select count(*) into v_n from public.origens_utm
   where utm_source <> lower(trim(utm_source));
  if v_n > 0 then
    v_erros := v_erros || format('%s linha(s) do dicionario com maiuscula ou espaco. ', v_n);
  end if;

  -- 7. E as duas novas com a classificação que a evidência manda.
  for v_r in select * from (values
      ('area-membros-lumii', 'organico'),
      ('primeiracompra-recovery_cart_mail_1', 'email')) as t(src, origem)
  loop
    if not exists (select 1 from public.origens_utm o
                    where o.utm_source = v_r.src and o.origem::text = v_r.origem) then
      v_erros := v_erros || format('%s nao ficou como %s. ', v_r.src, v_r.origem);
    end if;
  end loop;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: as duas origens entraram em minusculo, a fila zerou, e as vendas foram recalculadas sem nenhuma outra coluna mudar.';
end $prova$;

notify pgrst, 'reload schema';
