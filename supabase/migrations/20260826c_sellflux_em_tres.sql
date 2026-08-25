-- Sellflux em três, e o mistério dos valores miúdos resolvido.
--
-- Ela perguntou de onde vinham os R$ 61,11, R$ 14,10 e R$ 14,48. O payload
-- responde sozinho: `type` = "IOF". E a proporção fecha em 3,50% exatos sobre a
-- compra internacional de dois dias antes:
--
--   R$ 1.745,88 (28/01) -> R$ 61,11 (30/01)
--   R$   402,72 (03/02) -> R$ 14,10 (05/02)
--   R$   413,64 (02/03) -> R$ 14,48 (04/03)
--
-- Não era um serviço escondido -- era imposto de cartão internacional.
--
-- E o IOF PAROU. A partir de 04/03 a cobrança passou a vir da SELLFLUX LTDA
-- (nacional) em vez da SELLFLUX LLC (americana), e não há IOF depois disso.
-- Foram R$ 89,69 de imposto nos dois primeiros meses, zero desde então.
--
-- O IOF fica na categoria da compra que o gerou, e não numa rubrica de imposto.
-- Não é escolha minha: é a convenção que já existe aqui, em 93 lançamentos --
-- IOF da Anthropic em IAs, IOF do Facebook em Anúncios, IOF da Vercel em
-- Ferramentas. Por isso o R$ 61,11 acompanha a consultoria e os outros dois
-- acompanham a mensalidade.
update public.fornecedores
   set nome = 'Sellflux (mensalidade)',
       valores = array[402.72, 413.64, 397.00, 14.10, 14.48]::numeric[],
       definido = true,
       prioridade = 40,
       nota = 'Mensalidade da plataforma. Os R$ 14,10 e R$ 14,48 são o IOF dela, quando ainda era cobrada pela LLC americana.'
 where nome = 'Sellflux';

-- `where not exists` e não `on conflict`: `fornecedores.nome` não tem constraint
-- única, e o `on conflict (nome)` devolve o mesmo 42P10 que assombrou as notas
-- fiscais esta semana.
insert into public.fornecedores (nome, padrao, tipo_match, valores, definido, prioridade, nota)
select v.nome, 'SELLFLUX', 'contains', v.valores, v.definido, v.prioridade, v.nota
  from (values
    ('Sellflux (consultoria)', array[1745.88, 1750.00, 61.11]::numeric[], true, 40,
     'Consultoria em duas parcelas: parte 1 em 28/01 pela LLC e parte 2 em 04/03 pela LTDA. R$ 61,11 é o IOF da parte 1.'),
    ('Sellflux (tokens de IA)', array[75.00, 50.00]::numeric[], true, 40,
     'Consumo de tokens de IA dentro da plataforma. Pago por PIX, avulso.'),
    ('Sellflux (a definir)', null::numeric[], false, 80,
     'Rede de segurança. Um valor novo cai aqui para ser identificado, em vez de ser engolido por um dos três acima.')
  ) as v(nome, valores, definido, prioridade, nota)
 where not exists (select 1 from public.fornecedores f where f.nome = v.nome);

-- A consultoria sai de "Aplicativos e Ferramentas" e vai para "Consultorias e
-- Mentorias" -- que mora em outro centro de custo. R$ 3.556,99 deixam de contar
-- como software.
update public.transacoes
   set categoria = 'Consultorias e Mentorias'
 where descricao ilike '%SELLFLUX%' and valor < 0
   and abs(valor) in (1745.88, 1750.00, 61.11);
