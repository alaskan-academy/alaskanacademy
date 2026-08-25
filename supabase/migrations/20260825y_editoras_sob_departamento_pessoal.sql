-- Editoras de vídeo: um macro para o custo de pessoal, uma categoria para elas.
--
-- Decisão dela, e melhor do que a minha proposta: eu queria mover tudo para
-- "Edição de Vídeo" e pronto, o que faria o custo total de pessoal deixar de
-- existir como linha. Assim mantém os dois -- o macro soma o que se gasta com
-- gente, a categoria separa quem edita vídeo.
--
-- O problema não era de pessoa, era de DATA. O mesmo trabalho tinha três nomes
-- conforme o mês:
--
--   dez/25          -> "Edição de Vídeo" e "Freelancer"   (automático)
--   jan/26 a jun/26 -> "Departamento Pessoal"             (confirmado)
--   jul/26 a ago/26 -> "Edição de Vídeo"                  (automático)
--
-- Jaqueline recebeu R$ 2.500 em 03/06 como Departamento Pessoal e R$ 2.500 em
-- 06/07 como Edição de Vídeo. Mesma pessoa, mesmo valor, mesmo dia do mês.
--
-- E os 34 lançamentos do macro inteiro são das MESMAS TRÊS pessoas -- Jessica
-- Maihato, Jaqueline Coelho e Bruna Leopoldo, todas editoras de vídeo. Não há
-- CLT nem outro prestador ali dentro.

-- ── 1. O macro passa a se chamar Departamento Pessoal ───────────────────────
select public.fn_renomear_centro('Funcionários', 'Departamento Pessoal');

-- As categorias "Departamento Pessoal" e "Freelancer" ficam, vazias.
--
-- Ter uma categoria com o mesmo nome do macro parece estranho, mas é o padrão
-- que já existe aqui: o centro "Jurídico" contém a categoria "Jurídico". E
-- valem para o dia em que houver um CLT ou um prestador que não edite vídeo.
-- Apagá-las agora seria destruir o que ela consegue recriar em um clique --
-- mas seria ela decidindo, não eu.

-- ── 2. Os lançamentos das três vão para Edição de Vídeo ─────────────────────
-- Escopo pelos três nomes, e não pela categoria inteira: se amanhã alguém de
-- fato de folha cair em "Departamento Pessoal", um update largo o levaria junto
-- sem ninguém perceber.
update public.transacoes
   set categoria = 'Edição de Vídeo'
 where valor < 0
   and categoria in ('Departamento Pessoal', 'Freelancer')
   and (descricao ilike '%MAIHATO%' or descricao ilike '%JAQUELINE%' or descricao ilike '%BRUNA LEOPOLDO%');

-- ── 3. As regras automáticas, que eram a armadilha de verdade ───────────────
-- Quatro regras ainda mandavam essas pessoas para Departamento Pessoal e
-- Freelancer. Elas não estragaram julho e agosto só porque a categoria da Conta
-- Simples passou a ter prioridade sobre as regras. Corrigir os lançamentos sem
-- corrigir as regras deixaria a armadilha armada para o primeiro pagamento que
-- chegasse sem categoria no CS.
update public.regras_categoria
   set categoria = 'Edição de Vídeo'
 where categoria in ('Departamento Pessoal', 'Freelancer')
   and (padrao ilike '%maihato%' or padrao ilike '%jaqueline%' or padrao ilike '%bruna leopoldo%');

-- A Bruna não trabalha mais aqui, mas as regras dela seguem ativas de
-- propósito: o histórico continua sendo recategorizado quando o extrato é
-- ressincronizado, e uma regra inativa deixaria os lançamentos dela órfãos.
