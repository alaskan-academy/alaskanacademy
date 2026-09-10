-- Um fornecedor pode ter várias notas
--
-- A tela de Notas Fiscais anexava um arquivo por vez, e o Meta Ads de agosto
-- tem 129 lançamentos e R$ 134.005,88 — são várias faturas, não uma.
--
-- ── Por que a função precisava mudar junto ───────────────────────────────
--
-- `fn_checklist_fiscal` fazia `LEFT JOIN documentos_fiscais` sem agregar. Com
-- dois documentos do mesmo fornecedor, o fornecedor apareceria DUAS VEZES na
-- lista, com o mesmo valor em cada linha — e a soma de "quem falta documento"
-- passaria a contar o mesmo dinheiro duas vezes.
--
-- Então a permissão para anexar vários só é segura se a leitura agregar. As
-- duas metades andam juntas: sem esta, a tela mentiria no total.
--
-- ── O que muda ───────────────────────────────────────────────────────────
--
-- O join vira LATERAL agregado. Cada fornecedor volta a ser UMA linha, e a
-- função passa a devolver `documentos`: a lista inteira, com id, nome e
-- caminho de cada arquivo.
--
-- As três colunas antigas (`documento_id`, `drive_url`, `nome_arquivo`)
-- continuam, apontando para o documento MAIS ANTIGO. Elas não são o espelho de
-- `documentos` — são um atalho para o caso de um arquivo só, que é a maioria.
-- Some-as e toda a tela quebra sem ganho nenhum.
--
-- `criado_em` é a ordem, e não o nome: nome de arquivo é escolha de quem
-- envia, e ordenar por ele faria "o primeiro" mudar de identidade quando
-- alguém anexasse um arquivo cujo nome começa com A.
--
-- O tipo de retorno muda, então precisa de DROP antes do CREATE. Os dois na
-- mesma migração: não existe instante em que a função não exista.

DROP FUNCTION IF EXISTS public.fn_checklist_fiscal(date, uuid);

CREATE FUNCTION public.fn_checklist_fiscal(
  p_competencia date DEFAULT (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)))::date,
  p_empresa uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  fornecedor text, pais text, categoria text, tipo text, valor numeric,
  lancamentos integer, primeiro_dia date, tem_documento boolean,
  documento_id uuid, drive_url text, nome_arquivo text, documentos jsonb
)
LANGUAGE sql
STABLE
AS $function$
  with pagos as (
    select public.fn_fornecedor(t.descricao, -t.valor) as fornecedor,
           (array_agg(public.fn_pais_fornecedor(t.descricao, t.fonte)
                      order by t.data desc))[1] as pais,
           mode() within group (order by t.categoria) as categoria,
           sum(-t.valor)::numeric(14,2) as valor,
           count(*)::int as lancamentos,
           min(t.data) as primeiro_dia
      from public.transacoes t
      left join public.categorias_centro cc on cc.categoria = trim(t.categoria)
     where (p_empresa is null or t.empresa_id = p_empresa)
       and t.valor < 0
       and t.data >= p_competencia
       and t.data <  (p_competencia + interval '1 month')::date
       -- Sócio e reserva por TIPO, não por lista de nomes: uma categoria nova
       -- de sócio criada no campo pediria nota fiscal de uma retirada.
       and coalesce(cc.tipo, 'custo') = 'custo'
       -- Imposto não tem nota fiscal; o comprovante é a própria guia.
       and coalesce(t.categoria, '') <> 'Impostos e Tributos'
     group by 1
  )
  select p.fornecedor,
         p.pais,
         p.categoria,
         -- Serviço quando a categoria mora no grupo de pessoal. Era uma lista
         -- de nomes com 'Edição de Vídeo' dentro -- renomeada para 'Editor de
         -- Vídeo', ela parou de casar e as editoras viraram 'ferramenta': a NF
         -- delas iria para a pasta `ferramentas/` com sufixo `_NF` em vez de
         -- `servicos/` com `_pagamento`.
         case when cc.centro_custo = 'Departamento Pessoal'
              then 'servico' else 'ferramenta' end as tipo,
         p.valor,
         p.lancamentos,
         p.primeiro_dia,
         (docs.quantos > 0) as tem_documento,
         docs.primeiro_id,
         docs.primeiro_drive_url,
         docs.primeiro_nome,
         coalesce(docs.lista, '[]'::jsonb) as documentos
    from pagos p
    left join public.categorias_centro cc on cc.categoria = p.categoria
    left join lateral (
      select count(*)::int                                                as quantos,
             (array_agg(d.id          order by d.criado_em))[1]           as primeiro_id,
             (array_agg(d.drive_url   order by d.criado_em))[1]           as primeiro_drive_url,
             (array_agg(d.nome_arquivo order by d.criado_em))[1]          as primeiro_nome,
             jsonb_agg(jsonb_build_object(
                 'id',            d.id,
                 'nome_arquivo',  d.nome_arquivo,
                 'drive_url',     d.drive_url,
                 'storage_path',  d.storage_path
               ) order by d.criado_em)                                    as lista
        from public.documentos_fiscais d
       where d.competencia = p_competencia
         and d.fornecedor  = p.fornecedor
         and d.tipo <> 'comprovante'
         and (p_empresa is null or d.empresa_id = p_empresa)
    ) docs on true
   order by (docs.quantos > 0), p.valor desc;
$function$;

COMMENT ON FUNCTION public.fn_checklist_fiscal(date, uuid) IS
  'Quem foi pago no mes e se ja tem documento. UMA linha por fornecedor mesmo '
  'com varias notas — `documentos` traz a lista inteira, e as colunas '
  '`documento_id`/`drive_url`/`nome_arquivo` sao atalho para a mais antiga.';
