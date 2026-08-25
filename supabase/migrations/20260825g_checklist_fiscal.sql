-- Quem foi pago no mês e ainda não tem documento.
--
-- A pergunta "de quem falta NF" não precisa de cadastro: se saiu dinheiro da
-- conta para um fornecedor, ele deve documento.
--
-- Fica de fora o que não gera documento de terceiro: sócio, reserva e imposto —
-- o DARF é o próprio documento.
create or replace function public.fn_checklist_fiscal(
  p_competencia date default date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
)
returns table (
  fornecedor    text,
  pais          text,
  categoria     text,
  tipo          text,
  valor         numeric,
  lancamentos   int,
  primeiro_dia  date,
  tem_documento boolean,
  documento_id  uuid,
  drive_url     text,
  nome_arquivo  text
)
language sql stable as $fn$
  with pagos as (
    select public.fn_fornecedor(t.descricao, -t.valor) as fornecedor,
           -- O país de um fornecedor é o do descritor mais recente: se ele
           -- mudou de praça, o que vale é a cobrança de hoje.
           (array_agg(public.fn_pais_fornecedor(t.descricao, t.fonte)
                      order by t.data desc))[1] as pais,
           mode() within group (order by t.categoria) as categoria,
           sum(-t.valor)::numeric(14,2) as valor,
           count(*)::int as lancamentos,
           min(t.data) as primeiro_dia
      from public.transacoes t
     where t.valor < 0
       and t.data >= p_competencia
       and t.data <  (p_competencia + interval '1 month')::date
       and coalesce(t.categoria, '') not in
           ('Pró-labore', 'Retirada de Lucro', 'Sócios', 'Reserva de Caixa', 'Impostos e Tributos')
     group by 1
  )
  select p.fornecedor,
         p.pais,
         p.categoria,
         -- Serviço quando a categoria é de gente; ferramenta no resto. O tipo
         -- decide a pasta e o sufixo do nome do arquivo.
         case when p.categoria in ('Departamento Pessoal', 'Edição de Vídeo', 'Freelancer')
              then 'servico' else 'ferramenta' end as tipo,
         p.valor,
         p.lancamentos,
         p.primeiro_dia,
         (d.id is not null) as tem_documento,
         d.id,
         d.drive_url,
         d.nome_arquivo
    from pagos p
    left join public.documentos_fiscais d
           on d.competencia = p_competencia
          and d.fornecedor  = p.fornecedor
          and d.tipo <> 'comprovante'
   order by (d.id is not null), p.valor desc;
$fn$;

comment on function public.fn_checklist_fiscal(date) is
  'Fornecedores pagos no mês e se já têm NF/invoice. A lista sai do extrato, não de cadastro.';

grant execute on function public.fn_checklist_fiscal(date) to authenticated;
