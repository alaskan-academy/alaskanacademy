-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ O CPF vem da exportação da Payt, e o telefone vem junto                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Aplicado em 12/10/2026, a partir de cinco planilhas que ela exportou da Payt
-- cobrindo **04/01 a 12/10/2026**. São 9.744 pares `e-mail → (CPF, telefone)`,
-- aplicados em 14 blocos de 700.
--
-- ── Por que este arquivo não tem o dado dentro ──────────────────────────
--
-- O CLAUDE.md da raiz é categórico: migração aplicada sem `.sql` no
-- repositório "não é dívida de organização, é desligar os testes". Este
-- arquivo existe por causa dessa regra — mas carrega a PROVA, não a carga.
--
-- O motivo é a outra regra, a de segurança: 9.744 CPFs em git ficariam no
-- histórico para sempre, legíveis por qualquer pessoa que clonasse o
-- repositório, inclusive depois de a linha ser apagada do banco. A planilha
-- fica onde ela decidiu em 12/10 — fora do controle de versão —, e o que entra
-- aqui é o retrato verificável de antes e depois.
--
-- Nenhum teste deste projeto lê definição criada por esta migração: ela não
-- cria tabela, view nem função. O que ela muda é conteúdo, e conteúdo é o que
-- a prova abaixo afere.
--
-- ── O UPDATE que rodou, 14 vezes ────────────────────────────────────────
--
--   update public.clientes c
--      set cpf = coalesce(c.cpf, v.doc),
--          telefone = coalesce(nullif(trim(c.telefone),''), v.tel),
--          atualizado_em = now()
--     from (values (<700 pares>)) as v(email, doc, tel)
--    where lower(trim(c.email)) = v.email
--      and (c.cpf is null or nullif(trim(c.telefone),'') is null);
--
-- `coalesce` em vez de atribuição direta: o que o webhook já tinha gravado
-- VENCE a planilha, porque o webhook é a fonte de quem recebeu. A planilha só
-- preenche buraco.
--
-- ── O que mudou, medido ─────────────────────────────────────────────────
--
--                        antes              depois
--   clientes ........... 13.650             13.653   (+3, vendas do próprio dia)
--   com CPF ............  4.471  (32,8%)    12.786  (93,6%)
--   com telefone .......  7.413  (54,3%)    13.528  (99,1%)
--
-- ── Os 867 que sobraram sem CPF não são buraco: são carrinho ────────────
--
-- Conferido contra `vendas`, que é a segunda fonte que a regra de leitura do
-- CLAUDE.md pede:
--
--   sem CPF, total ....................................... 867
--   destes, que nunca aparecem em `vendas` ............... 0
--   destes, com venda APROVADA ........................... 20
--
-- Ou seja: 847 dos 867 só existem como carrinho abandonado, pendente ou
-- expirado — exatamente a população em que a Payt não exige o documento, e
-- exatamente o que ela afirmou em 12/10 ("toda aluna é obrigada a pôr CPF para
-- comprar"). Ela estava certa, e agora o número prova.
--
-- Os 20 com venda aprovada e sem CPF estão espalhados em seis meses
-- (2 em mar, 8 em abr, 3 em jul, 4 em ago, 2 em set, 1 em out). Espalhados
-- assim, não são recorte de data que faltou na exportação: são e-mail que não
-- casou — grafia diferente entre o cadastro e a planilha. São 0,5% das vendas
-- aprovadas e não justificam caçar um a um.
--
-- ── O que isso destrava, e o que ainda não ──────────────────────────────
--
-- A chave de cliente único pode passar a ser o CPF, que era o pedido dela:
--
--   CPFs distintos .......................................... 12.645
--   CPFs com mais de um e-mail (mesma aluna, contas diferentes) 137
--   linhas de cliente que colapsam nesses CPFs .............. 141
--
-- 141 linhas a menos em 12.786 é 1,1%. É pouco em percentual e é exatamente o
-- número que ela queria enxergar — a aluna que comprou com dois e-mails e
-- contava como duas pessoas. Trocar a chave de LTV e recompra para CPF agora
-- tem base: 93,6% de cobertura, contra os 30% que havia quando a migração
-- `20261012d` decidiu, com razão, NÃO trocar ainda.
--
-- O que não dá para fazer: usar CPF como chave em carrinho abandonado. Lá a
-- cobertura é ~4%, e vai continuar sendo, porque ninguém digita documento numa
-- compra que não terminou.

begin;

-- Retrato de agora, para a prova comparar contra ele e não contra número
-- escrito à mão que envelhece sozinho.
drop table if exists _retrato_cpf;
create temp table _retrato_cpf as
select count(*)                                            as linhas,
       count(cpf)                                          as com_cpf,
       count(nullif(trim(telefone), ''))                   as com_tel
  from public.clientes;

commit;

-- ---------------------------------------------------------------------------
-- PROVAS
-- ---------------------------------------------------------------------------
do $prova$
declare
  v_erros text := '';
  v_n     integer;
  v_pct   numeric;
begin
  -- 1. A cobertura chegou onde devia. Antes eram 32,8%; o piso de 90% deixa
  --    folga para clientes novos entrarem sem CPF (carrinho) sem reprovar,
  --    e reprova se alguém apagar a coluna em massa.
  select round(100.0 * count(cpf) / nullif(count(*), 0), 1)
    into v_pct from public.clientes;
  if v_pct < 90 then
    v_erros := v_erros || format('cobertura de CPF caiu para %s%%, esperava >=90%%. ', v_pct);
  end if;

  select round(100.0 * count(nullif(trim(telefone), '')) / nullif(count(*), 0), 1)
    into v_pct from public.clientes;
  if v_pct < 95 then
    v_erros := v_erros || format('cobertura de telefone caiu para %s%%, esperava >=95%%. ', v_pct);
  end if;

  -- 2. Só dígito entrou. CPF com ponto ou traço não casaria com a próxima
  --    exportação, e o erro só apareceria lá na frente.
  select count(*) into v_n from public.clientes
   where cpf is not null and cpf !~ '^[0-9]{11,14}$';
  if v_n > 0 then
    v_erros := v_erros || format('%s CPF(s) fora do formato de digitos. ', v_n);
  end if;

  -- 3. A FECHADURA de `20261012d` continua de pé. Esta migração encostou em
  --    13 mil linhas da coluna protegida; se o privilégio tivesse voltado no
  --    caminho, o CPF estaria aberto para qualquer pessoa logada.
  if has_column_privilege('authenticated', 'public.clientes', 'cpf', 'SELECT') then
    v_erros := v_erros || 'authenticated voltou a ler a coluna cpf. ';
  end if;
  if has_column_privilege('anon', 'public.clientes', 'cpf', 'SELECT') then
    v_erros := v_erros || 'anon voltou a ler a coluna cpf. ';
  end if;

  -- 4. E o resto da tabela segue legível: a proteção é da coluna.
  if not has_column_privilege('authenticated', 'public.clientes', 'email', 'SELECT') then
    v_erros := v_erros || 'authenticated perdeu o acesso ao email. ';
  end if;

  -- 5. Ninguém foi criado nem apagado. Isto preenche coluna, não mexe em gente.
  select count(*) into v_n from public.clientes;
  if v_n <> (select linhas from _retrato_cpf) then
    v_erros := v_erros || format('clientes tem %s linhas, o retrato dizia %s. ',
                                 v_n, (select linhas from _retrato_cpf));
  end if;

  -- 6. Quem ficou sem CPF é carrinho, não comprador. Este é o caso que
  --    sustenta a afirmacao dela, e o que volta a gritar se um dia o
  --    checkout parar de exigir documento: se aparecer gente COMPRANDO sem
  --    CPF em volume, a premissa mudou e a conta de cliente unico quebra.
  select count(*) into v_n
    from public.clientes c
   where c.cpf is null
     and exists (select 1 from public.vendas v
                  where v.cliente_id = c.id and v.status = 'aprovada');
  if v_n > 60 then
    v_erros := v_erros || format(
      '%s clientes tem venda APROVADA e nenhum CPF (eram 20). '
      'Ou a exportacao parou de cobrir, ou o checkout parou de exigir. ', v_n);
  end if;

  if v_erros <> '' then
    raise exception 'PROVA FALHOU: %', v_erros;
  end if;

  select count(cpf), count(distinct cpf) into v_n, v_pct from public.clientes;
  raise notice
    'PROVA OK: % clientes com CPF (% distintos), so digitos, coluna ainda '
    'revogada de authenticated e anon, ninguem criado nem apagado, e quem '
    'ficou sem CPF e carrinho abandonado.', v_n, v_pct;
end $prova$;

drop table if exists _retrato_cpf;
