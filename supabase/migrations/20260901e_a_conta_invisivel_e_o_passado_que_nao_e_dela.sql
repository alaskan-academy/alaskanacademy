-- Duas coisas, e a primeira era dinheiro sumindo da tela todo dia.
--
-- ══ 1. UMA CONTA DE ANÚNCIO QUE O SYNC NÃO ENXERGAVA ══════════════════════
--
-- "Vejo mais no gerenciador, principalmente da Aeliss." Via mesmo.
--
--     painel   R$ 191,47        gerenciador   R$ 250,74
--
-- Faltavam duas parcelas. Uma é benigna: `meta-sync-horario` roda no minuto 0,
-- então o painel fica até 59 minutos atrás da Meta por desenho. A outra não:
--
--     Guia do Comportamento - TSL   act_2637840179716581
--        ativo = false      projeto = null      empresa = null
--        última métrica = NUNCA
--
-- O Guia dos Comportamentos virou Aeliss na virada de hoje e é projeto vivo —
-- 2 funis, 330 cards. A conta de anúncio dele estava desligada no cadastro,
-- e `meta-insights-sync` filtra por `ativo = true`: nada dela chegava.
--
-- ── O comentário do código dizia o contrário do que os dados dizem ────────
--
-- O sync justifica o filtro assim: as contas desligadas "não pertencem mais ao
-- portfólio e devolviam 403 a cada execução". Era verdade quando foi escrito.
-- Hoje `visto_em` está em 2026-09-01 10:00:01 nas DEZOITO contas — a descoberta
-- enxerga todas. O que separava as vivas das mortas virou uma flag na mão.
--
-- É a primeira armadilha do CLAUDE.md outra vez, na forma que ela assume aqui:
-- `ativo` (escrito por gente) e `visto_em`/`status_meta`/`saldo_conta` (lidos da
-- API) respondem à mesma pergunta e discordavam em onze contas.
--
-- O que separou a conta viva das dormentes foi o SALDO EM ABERTO, que é o que
-- a Meta ainda não cobrou — ou seja, gasto recente:
--
--     Guia do Comportamento - TSL    saldo  R$ 25,65   ← gastando
--     Velas Perfeitas - RMKT         saldo  R$  0,01
--     Cosmética, CA2, CA3, CA4,      saldo  R$  0,00   ← dormentes
--     Jabon, Velas - VSL
--
-- Ligada e apontada ao projeto, a leitura do dia confirmou: R$ 32,12 hoje.
--
--     Desafios na Sala - TSL     Aeliss    R$ 218,62
--     Guia do Comportamento      Aeliss    R$  32,12   ← era invisível
--                                          ─────────
--                                          R$ 250,74
--
-- ══ 2. O PASSADO DELA É DA ALASKAN, E CONTINUA SENDO ══════════════════════
--
-- Ligar a conta abria um buraco no sentido contrário, e sozinho: amanhã às
-- 05:20 o `modo=recente` puxa D-1 a D-7. Como a conta não tinha NENHUMA linha
-- anterior, a busca por linha irmã não acharia nada, e o carimbo cairia na
-- empresa de HOJE — agosto entrando como Aeliss.
--
-- A regra é a dela, e é a mesma do resto do painel: a partir de hoje essa BM
-- sai da Alaskan e passa para a Aeliss; o que ela gastou antes era da Alaskan
-- e continua sendo. Nada é removido, nada muda de dono para trás.
--
-- ── Por que a linha irmã não bastava ─────────────────────────────────────
--
-- A irmã responde "de quem era este dia?" olhando outra linha do mesmo dia na
-- mesma conta. Funciona para o Desafios, que já tinha métrica gravada quando a
-- virada aconteceu. Não funciona para uma conta que ENTRA depois da troca: não
-- há irmã nenhuma, e o mecanismo cai no chute.
--
-- `empresa_anterior` responde direto. Não é a primeira armadilha: `empresa_id`
-- é o presente e `empresa_anterior` é o passado — dois fatos diferentes, não
-- duas cópias do mesmo. E não é a quarta: não é espelho de nada, é escrito uma
-- vez no dia da troca, junto de `empresa_desde`, que é quando o fato acontece.
--
-- ── O que esta migração NÃO faz ──────────────────────────────────────────
--
-- Não traz os R$ 103.816 de histórico da conta do Guia para dentro do painel.
-- Aquilo é carga histórica de meses que já foram fechados, e mexeria no lucro
-- de agosto para trás — decisão dela, não efeito colateral de um conserto.
-- Se um dia entrar, entra pela porta certa: carimbado Alaskan.

alter table ofertas_editores
  add column if not exists empresa_anterior uuid references empresas(id);

comment on column ofertas_editores.empresa_anterior is
  'De quem o projeto era ANTES de `empresa_desde`. Nulo = nunca trocou. '
  'Existe porque a busca por linha irma so funciona para conta que ja tinha '
  'metrica gravada na hora da troca: uma conta que entra DEPOIS nao tem irma, '
  'e sem este campo o carimbo cai na empresa de hoje — dando a ela um passado '
  'que nao e dela. Escrito uma vez, junto de `empresa_desde`.';

update ofertas_editores
   set empresa_anterior = (select id from empresas where slug = 'alaskan')
 where empresa_desde is not null
   and empresa_anterior is null;

CREATE OR REPLACE FUNCTION public.fn_carimbar_empresa_metricas()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_empresa  uuid;
  v_desde    timestamptz;
  v_anterior uuid;
  v_irma     uuid;
BEGIN
  SELECT o.empresa_id, o.empresa_desde, o.empresa_anterior
    INTO v_empresa, v_desde, v_anterior
    FROM ad_accounts a
    JOIN ofertas_editores o ON o.id = a.projeto_id
   WHERE a.id = NEW.ad_account_id;

  /* Congela — menos depois de o projeto trocar de empresa. Projeto que nunca
     trocou tem `empresa_desde` nulo e congela sempre, como antes. */
  IF TG_OP = 'UPDATE' AND OLD.empresa_id IS NOT NULL
     AND NOT (v_desde IS NOT NULL AND NEW.data >= v_desde::date) THEN
    NEW.empresa_id := OLD.empresa_id;
    RETURN NEW;
  END IF;

  /* Data anterior à troca. Duas fontes, nesta ordem: quem já carimbou aquele
     dia na mesma conta, e depois quem era o dono antes da troca. A segunda
     existe para a conta que entra DEPOIS e não tem irmã nenhuma — ver o topo
     da migração 20260901e. */
  IF v_desde IS NOT NULL AND NEW.data < v_desde::date THEN
    SELECT m.empresa_id INTO v_irma
      FROM metricas_meta m
     WHERE m.ad_account_id = NEW.ad_account_id
       AND m.data = NEW.data
       AND m.empresa_id IS NOT NULL
       AND m.empresa_id IS DISTINCT FROM v_empresa
     LIMIT 1;

    IF coalesce(v_irma, v_anterior) IS NOT NULL THEN
      NEW.empresa_id := coalesce(v_irma, v_anterior);
      RETURN NEW;
    END IF;
  END IF;

  IF v_empresa IS NOT NULL
     AND (NEW.empresa_id IS NULL
          OR (v_desde IS NOT NULL AND NEW.data >= v_desde::date)) THEN
    NEW.empresa_id := v_empresa;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── A conta que estava fora ──────────────────────────────────────────────

update ad_accounts
   set projeto_id = (select id from ofertas_editores where nome = 'Guia dos Comportamentos'),
       ativo      = true
 where account_id = 'act_2637840179716581';
