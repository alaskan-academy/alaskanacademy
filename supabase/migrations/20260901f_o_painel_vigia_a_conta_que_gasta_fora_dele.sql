-- O painel passa a vigiar a conta de anúncio que gasta sem ele ver.
--
-- ── Por que este alerta existe ────────────────────────────────────────────
--
-- Em 01/09/2026 a conta `Guia do Comportamento - TSL` estava gastando R$ 32
-- por dia e nada disso chegava à tela: `ativo = false` no cadastro, e
-- `meta-insights-sync` só lê conta ativa. Ficou assim por tempo indeterminado
-- — a conta nunca teve UMA linha em `metricas_meta`.
--
-- E só foi descoberta porque ela desconfiou de um número: "vejo mais aqui no
-- gerenciador". É exatamente a forma de erro que este projeto já pagou caro
-- quatro vezes, e a regra de leitura do CLAUDE.md em ação — quando um número
-- parece estranho, ele está.
--
-- O conserto de ontem religou a conta. Isto aqui é o que impede o próximo
-- caso, que virá de outra conta e em outro dia.
--
-- ── O sinal: saldo em aberto ─────────────────────────────────────────────
--
-- `ad_accounts.saldo_conta` é o `balance` da Meta — o que ela ainda não cobrou.
-- Saldo em aberto quer dizer gasto recente, e foi o que separou a conta viva
-- das dormentes quando as dezoito foram medidas:
--
--     Guia do Comportamento - TSL    R$ 25,65   ← gastando
--     Velas Perfeitas - RMKT         R$  0,01   ← centavo preso
--     Cosmética, CA2, CA3, CA4,      R$  0,00   ← dormentes
--     Jabon, Velas - VSL, e as demais
--
-- O piso de R$ 1,00 vem dessa medição, não de gosto: separa a conta que opera
-- do centavo que ficou parado. É um número no código, então fica dito de onde
-- saiu — e se ele estiver errado o próprio alerta denuncia, disparando à toa
-- em vez de calar.
--
-- `visto_em` recente é condição junto: sem a descoberta ter passado, o saldo é
-- retrato velho e o alerta estaria opinando sobre dado congelado.
--
-- ── Duas formas do mesmo problema ────────────────────────────────────────
--
-- 1. desligada no cadastro → o sync nem lê: o dinheiro não existe para o painel
-- 2. ligada, mas sem projeto → o sync lê e não sabe de quem é: a métrica nasce
--    sem empresa, e cai em `vw_dinheiro_sem_empresa`
--
-- As duas são "gasto que o painel não consegue atribuir", e por isso vêm no
-- mesmo alerta, cada uma dizendo o seu motivo. A segunda tem rede embaixo; a
-- primeira não tinha nenhuma.
--
-- ── Testado disparando ───────────────────────────────────────────────────
--
-- Alerta que nunca disparou não é alerta. Com a conta do Guia devolvida a
-- `ativo = false`, a mensagem saiu:
--
--   1 conta de anúncio gastando fora do painel
--   Guia do Comportamento - TSL (R$ 32,18, desligada no cadastro). O saldo em
--   aberto é gasto que a Meta ainda não cobrou, então esta conta está rodando
--   agora e o painel não está lendo.
--
-- Religada em seguida, e a base voltou a zero alertas.

create or replace function fn_alerta_conta_anuncio_invisivel()
returns table (codigo text, severidade text, titulo text, detalhe text)
language sql stable as $$
  with fora as (
    select a.nome, a.saldo_conta,
           case when not a.ativo then 'desligada no cadastro'
                else 'sem projeto — a métrica nasce sem empresa' end as motivo
      from ad_accounts a
     where a.visto_em > now() - interval '2 days'
       /* Piso medido, não escolhido: as dormentes ficam em R$ 0,00–0,01 e a que
          operava tinha R$ 25,65. Ver o topo da migração 20260901f. */
       and coalesce(a.saldo_conta, 0) >= 1
       and (not a.ativo or a.projeto_id is null)
  )
  select 'conta_anuncio_invisivel'::text,
         'critico'::text,
         count(*)::text || ' conta(s) de anúncio gastando fora do painel',
         string_agg(nome || ' (' || fn_brl(saldo_conta) || ', ' || motivo || ')', '; '
                    order by saldo_conta desc) ||
         '. O saldo em aberto é gasto que a Meta ainda não cobrou, então esta(s) '
         'conta(s) está(ão) rodando agora e o painel não está lendo.'
    from fora
  having count(*) > 0;
$$;

comment on function fn_alerta_conta_anuncio_invisivel is
  'Conta de anuncio com saldo em aberto que o painel nao le. Existe porque a '
  'conta do Guia gastava R$ 32/dia com `ativo = false` e nada denunciava — foi '
  'descoberta so porque alguem desconfiou do numero na tela. `ativo` e escrito '
  'na mao e `saldo_conta` vem da API: quando os dois discordam, quem tem razao '
  'e a API.';

-- Reescrita ancorada: `vw_alertas` tem quinze ramos e dez funcoes de alerta;
-- copiá-los aqui criaria uma segunda cópia que envelhece.
do $$
declare def text;
begin
  def := pg_get_viewdef('vw_alertas'::regclass, true);
  if position('fn_alerta_conta_anuncio_invisivel' in def) > 0 then return; end if;
  /* `pg_get_viewdef` devolve a definição TERMINADA em ponto-e-vírgula; sem
     tirá-lo o UNION seguinte vira erro de sintaxe. Foi o tropeço da 20260901c. */
  def := regexp_replace(def, ';\s*$', '');
  execute 'create or replace view vw_alertas as ' || def ||
          E'\nUNION ALL\n SELECT x.codigo, x.severidade, x.titulo, x.detalhe'
          || E'\n   FROM fn_alerta_conta_anuncio_invisivel() x(codigo, severidade, titulo, detalhe)';
end $$;
