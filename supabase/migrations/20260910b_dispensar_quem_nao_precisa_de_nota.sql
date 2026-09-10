-- Dispensar quem não precisa de nota
--
-- A lista de "quem falta documento" nasce dos pagamentos do mês, então ela não
-- sabe que alguns não geram nota: taxa de meio de pagamento, reembolso a
-- sócio, fornecedor pessoa física que não emite. Esses ficavam para sempre no
-- vermelho, e uma lista que nunca fecha para de ser lida.
--
-- ── Por que a dispensa tem MOTIVO obrigatório ────────────────────────────
--
-- Um X sem explicação em cima do Meta Ads tira R$ 134.005,88 da lista sem
-- deixar rastro, e daqui a três meses ninguém sabe se foi decisão ou engano.
-- É o mesmo problema dos 741 cards arquivados sem motivo em Produção: "26 de
-- 28" não é informação, "26 de 28, sendo 2 dispensados porque a Payt já
-- retém" é.
--
-- ── Por que por COMPETÊNCIA e não por fornecedor ─────────────────────────
--
-- Dispensa permanente seria regra, e regra que ninguém revisita envelhece
-- calada — a terceira armadilha. Aqui a decisão vale para o mês em que foi
-- tomada; se o mesmo fornecedor reaparecer em outubro, a pergunta reaparece
-- junto. Se um dia o padrão ficar claro, aí vira regra de propósito.
--
-- `empresa_id` é NOT NULL: dispensar é gravar, e gravar exige empresa
-- escolhida. É a mesma regra do extrato e do lançamento manual. Além disso,
-- nulo não colide com nulo no Postgres — com a coluna anulável, a unicidade
-- deixaria passar duas dispensas do mesmo fornecedor.

CREATE TABLE IF NOT EXISTS public.documento_dispensas (
  id             uuid primary key default gen_random_uuid(),
  competencia    date not null,
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  fornecedor     text not null,
  motivo         text not null,
  dispensado_por uuid references public.perfis(id),
  criado_em      timestamptz not null default now(),
  constraint documento_dispensas_unicas unique (competencia, empresa_id, fornecedor)
);

COMMENT ON TABLE public.documento_dispensas IS
  'Fornecedor que NAO precisa de nota naquele mes, com o motivo. Vale so para a '
  'competencia gravada: dispensa permanente seria regra, e regra que ninguem '
  'revisita envelhece calada.';

ALTER TABLE public.documento_dispensas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documento_dispensas_tudo ON public.documento_dispensas;
CREATE POLICY documento_dispensas_tudo ON public.documento_dispensas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── A lista passa a saber quem foi dispensado ────────────────────────────
--
-- Dispensado NÃO some da tela: ele desce para o fim, junto de quem já entregou,
-- e mostra o motivo. Sumir seria trocar uma lista que não fecha por uma que
-- esconde — e ninguém procura o que não sabe que existe.
--
-- O tipo de retorno muda, então precisa de DROP antes do CREATE, os dois na
-- mesma migração.

DROP FUNCTION IF EXISTS public.fn_checklist_fiscal(date, uuid);

CREATE FUNCTION public.fn_checklist_fiscal(
  p_competencia date DEFAULT (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)))::date,
  p_empresa uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  fornecedor text, pais text, categoria text, tipo text, valor numeric,
  lancamentos integer, primeiro_dia date, tem_documento boolean,
  documento_id uuid, drive_url text, nome_arquivo text, documentos jsonb,
  dispensado boolean, motivo_dispensa text
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
         case when cc.centro_custo = 'Departamento Pessoal'
              then 'servico' else 'ferramenta' end as tipo,
         p.valor,
         p.lancamentos,
         p.primeiro_dia,
         (docs.quantos > 0) as tem_documento,
         docs.primeiro_id,
         docs.primeiro_drive_url,
         docs.primeiro_nome,
         coalesce(docs.lista, '[]'::jsonb) as documentos,
         (disp.id is not null) as dispensado,
         disp.motivo
    from pagos p
    left join public.categorias_centro cc on cc.categoria = p.categoria
    left join lateral (
      select count(*)::int                                       as quantos,
             (array_agg(d.id           order by d.criado_em))[1]  as primeiro_id,
             (array_agg(d.drive_url    order by d.criado_em))[1]  as primeiro_drive_url,
             (array_agg(d.nome_arquivo order by d.criado_em))[1]  as primeiro_nome,
             jsonb_agg(jsonb_build_object(
                 'id',            d.id,
                 'nome_arquivo',  d.nome_arquivo,
                 'drive_url',     d.drive_url,
                 'storage_path',  d.storage_path
               ) order by d.criado_em)                            as lista
        from public.documentos_fiscais d
       where d.competencia = p_competencia
         and d.fornecedor  = p.fornecedor
         and d.tipo <> 'comprovante'
         and (p_empresa is null or d.empresa_id = p_empresa)
    ) docs on true
    left join public.documento_dispensas disp
           on disp.competencia = p_competencia
          and disp.fornecedor  = p.fornecedor
          and (p_empresa is null or disp.empresa_id = p_empresa)
   -- Resolvido é resolvido: tanto faz se foi entregando ou dispensando, os dois
   -- descem para o fim e quem ainda falta fica em cima.
   order by (docs.quantos > 0 or disp.id is not null), p.valor desc;
$function$;

COMMENT ON FUNCTION public.fn_checklist_fiscal(date, uuid) IS
  'Quem foi pago no mes e se ja tem documento. UMA linha por fornecedor mesmo '
  'com varias notas — `documentos` traz a lista inteira. `dispensado` marca '
  'quem nao precisa de nota naquele mes, com `motivo_dispensa` ao lado.';
