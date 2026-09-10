-- A dispensa descobre a empresa sozinha
--
-- Com "Ambas" no topo, o X recusava e mandava escolher uma empresa. A regra do
-- módulo está certa — gravar num limbo é o erro que só sai na conciliação do
-- contador —, mas ela estava sendo aplicada onde não precisava: o fornecedor
-- JÁ DIZ de quem ele é. Ele só existe na lista porque saiu dinheiro de uma
-- conta bancária, e a conta é carimbada.
--
-- Então a função passa a devolver `empresa_id`: a empresa dos pagamentos
-- daquele fornecedor no mês, quando é UMA só.
--
-- Quando o mesmo fornecedor foi pago pelas duas empresas, o campo vem NULO e a
-- tela volta a pedir para escolher — aí a pergunta é real, porque dispensar
-- "Meta Ads" sem dizer qual das duas deixaria a outra cobrando para sempre.
--
-- Isso não afrouxa a regra, muda quem responde. Continua impossível gravar sem
-- empresa: o que deixa de existir é a pergunta cuja resposta o banco já tinha.

DROP FUNCTION IF EXISTS public.fn_checklist_fiscal(date, uuid);

CREATE FUNCTION public.fn_checklist_fiscal(
  p_competencia date DEFAULT (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)))::date,
  p_empresa uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  fornecedor text, pais text, categoria text, tipo text, valor numeric,
  lancamentos integer, primeiro_dia date, tem_documento boolean,
  documento_id uuid, drive_url text, nome_arquivo text, documentos jsonb,
  dispensado boolean, motivo_dispensa text, empresa_id uuid
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
           min(t.data) as primeiro_dia,
           -- A empresa SÓ quando não há dúvida. Duas empresas pagando o mesmo
           -- fornecedor devolve nulo, e a tela pergunta — que é o único caso em
           -- que a pergunta tem conteúdo.
           case when count(distinct t.empresa_id) = 1
                then (array_agg(distinct t.empresa_id))[1] end as empresa_id
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
         disp.motivo,
         p.empresa_id
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
  'com varias notas. `empresa_id` e a empresa dos pagamentos quando e uma so — '
  'nulo quando as duas pagaram, e ai a tela pergunta.';
