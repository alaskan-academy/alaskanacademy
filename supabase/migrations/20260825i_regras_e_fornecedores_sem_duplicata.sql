-- Impede que confirmar duas vezes crie duas verdades.
--
-- Cada confirmação na Revisão gravava uma regra NOVA com confiança 1,00. Duas
-- confirmações do mesmo fornecedor com categorias diferentes deixavam as duas
-- ativas, e qual ganhava dependia do desempate por comprimento do padrão. Foi
-- assim que a regra errada do Lucas convivia com a certa e ganhava dela.
--
-- Com chave única, a segunda confirmação corrige a primeira em vez de brigar
-- com ela — e o `upsert` da tela passa a ter em que se apoiar.
delete from public.regras_categoria a
 using public.regras_categoria b
 where a.padrao = b.padrao
   and a.tipo_match = b.tipo_match
   and a.ctid < b.ctid;

create unique index if not exists uq_regras_categoria_padrao
  on public.regras_categoria (padrao, tipo_match);

delete from public.fornecedores a
 using public.fornecedores b
 where a.nome = b.nome and a.padrao = b.padrao and a.ctid < b.ctid;

create unique index if not exists uq_fornecedores_nome_padrao
  on public.fornecedores (nome, padrao);
