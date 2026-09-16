-- O EVENTO PODE SE REPETIR TODO ANO
--
-- A agenda tem diario, semanal e mensal. Faltava anual, que e justamente o que
-- a maior parte dos feriados e: 25/12 nao se repete a cada 30 dias, se repete a
-- cada ano. Hoje cada Natal precisa ser cadastrado de novo a mao, e o que nao e
-- cadastrado de novo simplesmente some da agenda do ano seguinte.
--
-- POR QUE A MIGRACAO VEM ANTES DA TELA
--
-- `eventos_recorrencia_tipo_check` aceitava exatamente tres valores. Acrescentar
-- a opcao no `<Select>` sem soltar o CHECK faria a tela oferecer "Todo ano" e o
-- salvar morrer com erro de banco -- um caminho que so quebra na hora de gravar,
-- depois da pessoa ter preenchido o formulario inteiro.

begin;

alter table public.eventos
  drop constraint if exists eventos_recorrencia_tipo_check;

alter table public.eventos
  add constraint eventos_recorrencia_tipo_check
  check (recorrencia_tipo = any (array['diario','semanal','mensal','anual']));

comment on column public.eventos.recorrencia_tipo is
  'Como o evento se repete: diario, semanal, mensal ou anual. Nulo = nao se repete. '
  'A expansao em datas mora em src/lib/recorrencia.ts (ocorrencias), e nao no banco: '
  'quem grava escolhe a regra, quem desenha calcula os dias.';

commit;

-- Prova de aceite: nada do que ja estava gravado pode ter sido recusado pelo
-- CHECK novo, e o valor novo tem que passar.
do $$
declare v_fora integer;
begin
  select count(*) into v_fora from public.eventos
   where recorrencia_tipo is not null
     and recorrencia_tipo not in ('diario','semanal','mensal','anual');
  if v_fora <> 0 then
    raise exception 'eventos: % linha(s) com recorrencia_tipo fora do vocabulario', v_fora;
  end if;
  raise notice 'eventos_recorrencia_tipo_check: anual aceito, nenhuma linha existente fora do vocabulario';
end $$;
