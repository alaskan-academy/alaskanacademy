-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ "Pausado" quer dizer VOLTAR A RODAR                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Definido por ela em 09/10/2026: **"Pausado" é quando o anúncio está com boa
-- performance mas não está rodando, e devemos voltar a rodar.**
--
-- Isso muda o que a marcação é. "Rodando", "Encerrado" e "Bloqueado" descrevem
-- um estado; "Pausado" descreve uma **intenção de retomar** — é uma pendência
-- que alguém precisa resolver, não um fato sobre o passado. Dois cards parados
-- no Meta, um "Pausado" e outro "Encerrado", não diferem no que aconteceu:
-- diferem no que deve acontecer.
--
-- ── O que estava errado no que eu entreguei ontem ────────────────────────
--
-- `marcacaoQueOMetaSugere` (20261009, em `situacao.ts`) traduzia TODO estado
-- parado — `parado`, `parado_recente`, `barrado_pelo_pai`, `sem_anuncio` — para
-- "Encerrado". Com esta definição, isso está errado para a metade que importa:
-- um criativo **Validado** que parou de rodar é exatamente o caso de "Pausado",
-- e o botão oferecia encerrá-lo.
--
-- Medido agora, antes do conserto: dos 39 cards hoje marcados "Pausado", a
-- tela ofereceria `[marcar Encerrado]` em todos os que estivessem parados no
-- Meta — desfazendo a marcação que significa "volte a isto".
--
-- O conserto não é no mapa de estados: é combinar o FATO com a AVALIAÇÃO.
-- Parado + nível de aprovação → "Pausado". Parado + reprovado → "Encerrado".
-- Os níveis de aprovação saem de `vw_crivo_niveis_vigentes`, como em todo o
-- resto.
--
-- ── Por que o significado vai para a TABELA ──────────────────────────────
--
-- `criativo_campos_opcoes` guardava só `campo`, `valor` e `ordem`: o vocabulário
-- sem o que cada palavra quer dizer. O resultado é que "Pausado" vinha sendo
-- usado por cada pessoa com o sentido que ela supunha — e 2.119 cards foram
-- para "Encerrado" enquanto 39 ficaram em "Pausado", o que é muita diferença
-- para duas palavras que, sem definição, parecem sinônimos.
--
-- Escrever o sentido num comentário de componente não resolveria: a lista é
-- montada a partir desta tabela em cinco telas, e o `select` não tem onde
-- caber uma explicação que não existe no dado.

begin;

alter table public.criativo_campos_opcoes
  add column if not exists significa text;

comment on column public.criativo_campos_opcoes.significa is
  'O que esta opção quer dizer, em uma frase, para aparecer como dica na tela. '
  'Existe porque vocabulário sem definição vira sinônimo na cabeça de cada um: '
  '"Pausado" e "Encerrado" descrevem o mesmo fato (o anúncio não está no ar) e '
  'pedem ações opostas.';

update public.criativo_campos_opcoes set significa = v.texto
  from (values
    ('status_veiculacao', 'Rodando',
     'No ar agora, e é para continuar.'),
    -- A definição que originou esta migração.
    ('status_veiculacao', 'Pausado',
     'Fora do ar, mas ia bem — é para VOLTAR a rodar. Isto é uma pendência, não um fim.'),
    ('status_veiculacao', 'Encerrado',
     'Fora do ar e é para ficar: não se pagou, ou já cumpriu o que tinha para cumprir.'),
    ('status_veiculacao', 'Bloqueado',
     'A Meta barrou. Depende de recurso ou de refazer a peça, não de orçamento.'),
    ('status_veiculacao', 'Arquivado',
     'Saiu da operação. Não aparece nas listas do dia a dia.'),
    ('avaliacao', 'Sem dados',
     'Não gastou o bastante para ser julgado — ainda não é notícia sobre o criativo.'),
    ('avaliacao', 'Validado',
     'Se paga com margem. Mantém no ar e pede variação.'),
    ('avaliacao', 'Escalado',
     'Se paga com volume. Aguenta receber mais orçamento.'),
    ('avaliacao', 'Não validado',
     'Teve verba suficiente e não se pagou.')
  ) as v(campo, valor, texto)
 where criativo_campos_opcoes.campo = v.campo
   and criativo_campos_opcoes.valor = v.valor;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_txt   text;
begin
  -- 1. Nenhuma opção dos dois campos ficou sem significado. Um valor novo na
  --    tabela sem definição é o começo de "Pausado" outra vez.
  select count(*) into v_n from public.criativo_campos_opcoes
   where campo in ('status_veiculacao', 'avaliacao') and significa is null;
  if v_n > 0 then
    v_erros := v_erros || format('%s opcao(oes) de status/avaliacao sem significado. ', v_n);
  end if;

  -- 2. E a definição de "Pausado" diz o que ela definiu: que é para VOLTAR.
  --    Sem isto a migração teria preenchido a coluna sem resolver o problema.
  select significa into v_txt from public.criativo_campos_opcoes
   where campo = 'status_veiculacao' and valor = 'Pausado';
  if v_txt is null or v_txt !~* 'volt' then
    v_erros := v_erros || format('o significado de Pausado nao diz que e para voltar a rodar: %L. ', v_txt);
  end if;

  -- 3. "Pausado" e "Encerrado" não podem ter a mesma frase: são o mesmo fato
  --    com ações opostas, e é a diferença entre eles que esta coluna existe
  --    para registrar.
  if (select significa from public.criativo_campos_opcoes
       where campo = 'status_veiculacao' and valor = 'Pausado')
     = (select significa from public.criativo_campos_opcoes
         where campo = 'status_veiculacao' and valor = 'Encerrado') then
    v_erros := v_erros || 'Pausado e Encerrado ficaram com a mesma definicao. ';
  end if;

  -- 4. Nenhum valor de marcação mudou: isto é dicionário, não reclassificação.
  --    Os 39 "Pausado" continuam 39.
  select count(*) into v_n from public.producoes where status_veiculacao = 'Pausado';
  if v_n <> 39 then
    v_erros := v_erros || format('os cards marcados Pausado viraram %s, esperava 39. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  raise notice 'PROVA OK: as 9 opcoes de marcacao e avaliacao ganharam significado, Pausado diz que e para voltar a rodar, e nenhum card foi reclassificado.';
end $prova$;

notify pgrst, 'reload schema';
