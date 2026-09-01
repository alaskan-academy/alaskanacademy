-- O painel passa a vigiar o único ponto que a virada não resolvia sozinha.
--
-- ── O buraco ──────────────────────────────────────────────────────────────
--
-- A venda segue a PAYT; o projeto segue o cadastro. Quando um projeto troca de
-- empresa, o trabalho acompanha na hora — 619 cards, 6 funis e 1 conta de
-- anúncio mudaram de dono na virada de 01/09/2026 sem uma linha ser tocada.
-- Mas a venda continua sendo carimbada por qual Payt a recebeu.
--
-- Se o checkout ficar na Payt antiga, o faturamento vai para a empresa errada
-- EM SILÊNCIO: nada dá erro, o número só aparece no lugar errado. E ninguém
-- descobre olhando a tela, porque a tela mostra exatamente o que foi gravado.
--
-- A própria migração da virada avisava disso e dizia que mover o checkout é
-- "passo de fora do banco". "Confira a próxima venda" depende de alguém
-- lembrar, num dia que ninguém sabe qual é. Isto aqui não depende.
--
-- ── `empresa_desde` separa o congelamento legítimo do erro ────────────────
--
-- Sem uma data, as 18 vendas do Desafios anteriores à troca acusariam na hora:
-- elas SÃO da Alaskan num projeto que agora é da Aeliss, e isso está certo —
-- quem recebeu, recebeu. Com a data, o alerta só olha o que veio depois.
--
-- Nulo quer dizer "sempre foi desta empresa", que é o caso dos outros nove
-- projetos. A coluna se mantém sozinha na próxima troca: quem mover um projeto
-- carimba a data junto, e o alerta passa a valer do jeito certo sem ninguém
-- editar regra nenhuma.
--
-- ── Testado disparando ────────────────────────────────────────────────────
--
-- Alerta que nunca disparou não é alerta. Recuando `empresa_desde` do Desafios
-- para 01/01/2026, as 18 vendas congeladas passaram a contar como "depois", e
-- a mensagem saiu:
--
--   18 venda(s) carimbada(s) na empresa errada
--   O projeto Desafios na Sala de Aula é da Aeliss Ltda, mas 18 venda(s)
--   depois da troca entraram como Alaskan Academy — o checkout ainda aponta
--   para a Payt antiga. R$ 5.764,66
--
-- A data foi restaurada em seguida, e a base voltou a zero alertas.

alter table ofertas_editores
  add column if not exists empresa_desde timestamptz;

comment on column ofertas_editores.empresa_desde is
  'Quando a empresa ATUAL assumiu este projeto. Nulo = sempre foi dela. '
  'Existe para separar o congelamento legitimo do erro: venda ANTES desta data '
  'com carimbo da empresa anterior esta certa (quem recebeu, recebeu); venda '
  'DEPOIS com carimbo divergente quer dizer que o checkout ficou na Payt errada.';

update ofertas_editores set empresa_desde = now()
where nome in ('Guia dos Comportamentos', 'Desafios na Sala de Aula')
  and empresa_desde is null;

create or replace function fn_alerta_venda_empresa_errada()
returns table (codigo text, severidade text, titulo text, detalhe text)
language sql stable as $$
  select 'venda_empresa_errada'::text,
         'critico'::text,
         count(*)::text || ' venda(s) carimbada(s) na empresa errada',
         'O projeto ' || string_agg(distinct o.nome, ', ') ||
         ' é da ' || string_agg(distinct ed.nome, ', ') ||
         ', mas ' || count(*)::text || ' venda(s) depois da troca entraram como ' ||
         string_agg(distinct ev.nome, ', ') ||
         ' — o checkout ainda aponta para a Payt antiga. ' || fn_brl(sum(v.valor_sem_juros))
    from vendas v
    join funis f              on f.id = v.funil_id
    join ofertas_editores o   on o.id = f.projeto_id
    join empresas ed          on ed.id = o.empresa_id
    left join empresas ev     on ev.id = v.empresa_id
   where o.empresa_desde is not null
     and v.data_venda >= o.empresa_desde
     and v.empresa_id is distinct from o.empresa_id
  having count(*) > 0;
$$;

comment on function fn_alerta_venda_empresa_errada is
  'A venda segue a PAYT, o projeto segue o cadastro — e eles podem discordar. '
  'Quando um projeto troca de empresa o trabalho acompanha na hora, mas a venda '
  'continua carimbada por qual Payt a recebeu. Se o checkout ficar na Payt antiga, '
  'o faturamento vai para a empresa errada em silêncio. Era o único ponto que a '
  'virada de 01/09/2026 não resolvia sozinha, porque mover checkout é passo de '
  'fora do banco.';

-- Reescrita ancorada: `vw_alertas` tem quinze ramos, e copiá-los aqui criaria
-- uma segunda cópia que envelhece.
do $$
declare def text;
begin
  def := pg_get_viewdef('vw_alertas'::regclass, true);
  if position('fn_alerta_venda_empresa_errada' in def) > 0 then return; end if;
  /* `pg_get_viewdef` devolve a definição TERMINADA em ponto-e-vírgula; sem
     tirá-lo o UNION seguinte vira erro de sintaxe. */
  def := regexp_replace(def, ';\s*$', '');
  execute 'create or replace view vw_alertas as ' || def ||
          E'\nUNION ALL\n SELECT x.codigo, x.severidade, x.titulo, x.detalhe'
          || E'\n   FROM fn_alerta_venda_empresa_errada() x(codigo, severidade, titulo, detalhe)';
end $$;
