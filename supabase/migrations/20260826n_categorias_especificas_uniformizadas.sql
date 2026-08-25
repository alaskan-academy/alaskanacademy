-- Onze fornecedores com a categoria específica que ela aprovou.
--
-- A varredura achou o padrão do OpenAI repetido em 11 fornecedores: uma
-- categoria mais específica foi criada e aplicada em alguns lançamentos, e o
-- resto ficou em "Aplicativos e Ferramentas". Ela confirmou que a específica é
-- a certa em todos.
--
-- O grupo NÃO muda: as seis categorias envolvidas moram todas em "Softwares e
-- Ferramentas". Então nenhum total de centro de custo se mexe -- o que muda é
-- conseguir ver quanto vai para hospedagem, quanto para mídia, quanto para
-- domínio, em vez de um balaio único.
--
-- As regras já estavam certas: cada fornecedor tinha uma regra em MAIÚSCULA a
-- 1.00 apontando para a específica, que vence a antiga em minúscula a 0.90-0.95.
-- A única exceção era a Supabase, cuja regra mandava para "Aplicativos e
-- Ferramentas" a 1.00 -- corrigida aqui, senão o próximo lançamento dela
-- desfaria esta migration sozinho.
update public.regras_categoria
   set categoria = 'Hospedagem/Infraestrutura'
 where padrao = 'SUPABASE' and tipo_match = 'contains' and categoria = 'Aplicativos e Ferramentas';

update public.transacoes t
   set categoria = alvo.categoria
  from public.vw_transacoes_revisao v,
       (values
         ('Hostinger (domínio)', 'Domínios'),
         ('Spedy',               'Contábil'),
         ('VTurb',               'Mídia'),
         ('UTMify',              'Hospedagem/Infraestrutura'),
         ('Google Workspace',    'Hospedagem/Infraestrutura'),
         ('Voxuy',               'Automação/Marketing'),
         ('CapCut',              'Mídia'),
         ('Panda Video',         'Mídia'),
         ('Supabase',            'Hospedagem/Infraestrutura'),
         ('Vercel',              'Hospedagem/Infraestrutura'),
         ('Resend',              'Automação/Marketing')
       ) as alvo(fornecedor, categoria)
 where v.id = t.id
   and v.fornecedor = alvo.fornecedor
   and t.valor < 0
   and t.categoria is distinct from alvo.categoria;
