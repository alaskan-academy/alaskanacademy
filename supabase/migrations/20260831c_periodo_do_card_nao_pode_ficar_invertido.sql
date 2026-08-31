-- Ela moveu 32 cards para a esteira de teste "para hoje" e disse que não
-- moveram de data. Moveram: `data_inicio` foi para 31/08 nos 32. O que não
-- moveu foi o `data_prazo`.
--
-- `data_inicio` e `data_prazo` formam um PERÍODO (início → prazo), e o
-- calendário desenha o card em `data_prazo ?? data_inicio`. Com o prazo parado
-- no dia antigo, o card continuou desenhado no dia antigo — e o período ficou
-- INVERTIDO: começa em 31/08 e termina em 06/08.
--
-- A prova está nos próprios dados: os cards que MOVERAM certo (AD 015, AD 062,
-- AD 089) são exatamente os que têm `data_prazo` nulo, onde o calendário cai no
-- `data_inicio`. E os 29 invertidos tinham todos `data_prazo` = o `data_inicio`
-- ANTIGO — eram cards de UM DIA SÓ.
--
-- Efeito colateral que ninguém tinha notado: `getUrgency` usa
-- `prazoEfetivo = data_prazo ?? data_inicio`, então esses 29 também estavam
-- sendo pintados como ATRASADOS — prazo em agosto, início hoje.
--
-- O caminho exato que gravou não foi identificado no código. O histórico mostra
-- dois lotes hoje: às 07:32 dez cards receberam `data_prazo → null` (o caminho
-- do seletor funcionando certo, dia único grava prazo nulo), e às 09:08 os 29
-- receberam só `fase` e `data_inicio`. Por isso a garantia foi para o BANCO:
-- ela vale para qualquer tela, inclusive a que eu não encontrei.

-- ── 1. O conserto dos 29 ─────────────────────────────────────────────────────
--
-- A duração sai do histórico, não de um chute: prazo novo = início novo +
-- (prazo antigo − início antigo). Para os 29 essa diferença é zero — eram cards
-- de um dia — então o prazo passa a ser o próprio 31/08.
with antigo as (
  select distinct on (h.criativo_id)
         h.criativo_id, h.valor_anterior::date as inicio_antigo
  from public.criativo_historico h
  where h.campo_alterado = 'data_inicio'
    and h.valor_anterior is not null
  order by h.criativo_id, h.criado_em desc
)
update public.producoes p
   set data_prazo = p.data_inicio + (p.data_prazo - a.inicio_antigo)
  from antigo a
 where a.criativo_id = p.id
   and p.data_inicio is not null
   and p.data_prazo is not null
   and p.data_inicio > p.data_prazo;

-- Rede de segurança: card invertido sem histórico de `data_inicio` vira um dia
-- só, em vez de continuar invertido.
update public.producoes
   set data_prazo = data_inicio
 where data_inicio is not null
   and data_prazo is not null
   and data_inicio > data_prazo;


-- ── 2. O gatilho, para não acontecer de novo ─────────────────────────────────
--
-- A validação existia em UM caminho só: `saveResize`, no calendário, recusa
-- período invertido com um toast. Os outros — arrastar, edição em lote, o
-- seletor do drawer — não tinham nada.
--
-- Regra: quando o período ficaria invertido e SÓ UMA das pontas mudou, a outra
-- acompanha, preservando a duração. É o que a pessoa quis dizer ao mover o
-- card: "este card agora é neste dia".
--
-- Quando as DUAS pontas mudam para um par invertido, o gatilho não mexe: é uma
-- instrução explícita, e reescrever instrução explícita seria magia demais.
-- Esse caso continua com a validação da tela.
create or replace function public.fn_periodo_do_card_coerente()
returns trigger
language plpgsql
as $$
declare
  duracao integer;
begin
  if new.data_inicio is null or new.data_prazo is null
     or new.data_inicio <= new.data_prazo then
    return new;
  end if;

  -- Só o início mudou: o prazo vai junto.
  if new.data_inicio is distinct from old.data_inicio
     and new.data_prazo is not distinct from old.data_prazo then
    duracao := coalesce(old.data_prazo - old.data_inicio, 0);
    new.data_prazo := new.data_inicio + greatest(duracao, 0);
    return new;
  end if;

  -- Só o prazo mudou: o início vai junto.
  if new.data_prazo is distinct from old.data_prazo
     and new.data_inicio is not distinct from old.data_inicio then
    duracao := coalesce(old.data_prazo - old.data_inicio, 0);
    new.data_inicio := new.data_prazo - greatest(duracao, 0);
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_periodo_do_card on public.producoes;
create trigger trg_periodo_do_card
  before update of data_inicio, data_prazo on public.producoes
  for each row execute function public.fn_periodo_do_card_coerente();
