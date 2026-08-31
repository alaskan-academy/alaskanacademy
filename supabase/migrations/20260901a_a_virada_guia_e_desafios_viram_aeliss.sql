/*
  A VIRADA — 01/09/2026

  Guia dos Comportamentos e Desafios na Sala de Aula passam a ser da Aeliss.

  Esta migração muda DUAS LINHAS. É só isso, e é de propósito: todo o resto do
  sistema deriva delas.

  O QUE ACOMPANHA SOZINHO, POR DERIVAÇÃO

      330 + 289 cards de produção      producoes.projeto_id
        2 +   4 funis                  funis.projeto_id
        0 +   1 conta de anúncio       ad_accounts.projeto_id
            os UTMs, REVs e testes     utm_links / vw_mapa_revs / radar

  Nada disso é tocado aqui. Eles perguntam "de quem é o meu projeto HOJE", e a
  resposta muda junto — que foi a decisão dela: o trabalho acompanha, o dinheiro
  congela.

  O QUE NÃO ACOMPANHA, TAMBÉM POR DESENHO

      vendas          carimbadas pela Payt que recebeu
      transacoes      carimbadas pela conta bancária
      metricas_meta   carimbadas no INSERT, e o UPSERT não reescreve

  As 18 vendas do Desafios e a mídia de agosto continuam Alaskan, porque foi a
  Alaskan que recebeu e pagou. É o congelamento, e ele não precisa de data de
  corte escrita em lugar nenhum: o carimbo já é a data.

  A PARTIR DE AMANHÃ

  A mídia nova da conta do Desafios nasce Aeliss, porque o gatilho de
  `metricas_meta` lê conta → projeto → empresa no momento do INSERT — e o
  projeto já será da Aeliss. A da madrugada anterior fica Alaskan, intocada pelo
  upsert.

  ⚠️  A VENDA NÃO SEGUE O PROJETO. ELA SEGUE A PAYT.

  Este é o ponto que a migração NÃO resolve e ninguém deve descobrir depois: a
  venda é carimbada por qual Payt a recebeu, não por qual projeto o funil
  pertence. Se os checkouts do Desafios continuarem na Payt da Alaskan, as
  vendas dele vão nascer ALASKAN mesmo com o projeto já na Aeliss.

  Os quatro funis do Desafios estão hoje com `link_checkout` vazio, então não dá
  para conferir por aqui de qual Payt eles são. Mover os checkouts para a Payt
  da Aeliss é passo de fora do banco, e precisa acontecer junto com esta
  migração — não depois.

  COMO DESFAZER

  Trocando `slug` de 'aeliss' para 'alaskan' nas duas linhas. Nada mais precisa
  voltar, porque nada mais mudou.
*/

do $virada$
DECLARE
  v_aeliss  uuid := (SELECT id FROM empresas WHERE slug = 'aeliss');
  v_alaskan uuid := (SELECT id FROM empresas WHERE slug = 'alaskan');
  v_mexidas int;

  PROJETOS constant text[] := ARRAY['Guia dos Comportamentos', 'Desafios na Sala de Aula'];
BEGIN
  IF v_aeliss IS NULL OR v_alaskan IS NULL THEN
    RAISE EXCEPTION 'Falta empresa: aeliss=% alaskan=%', v_aeliss, v_alaskan;
  END IF;

  /*
    Os dois projetos precisam existir E ainda ser da Alaskan. Se um deles já
    tiver virado, ou tiver mudado de nome, a migração para — rodar em cima de um
    estado que não é o esperado é como uma virada silenciosa fica pela metade.
  */
  SELECT count(*) INTO v_mexidas
    FROM ofertas_editores
   WHERE nome = ANY(PROJETOS) AND empresa_id = v_alaskan;

  IF v_mexidas <> 2 THEN
    RAISE EXCEPTION
      'Esperava 2 projetos da Alaskan com esses nomes, achei %. Confira os nomes em ofertas_editores antes de rodar.',
      v_mexidas;
  END IF;

  UPDATE ofertas_editores
     SET empresa_id = v_aeliss
   WHERE nome = ANY(PROJETOS) AND empresa_id = v_alaskan;

  GET DIAGNOSTICS v_mexidas = ROW_COUNT;
  IF v_mexidas <> 2 THEN
    RAISE EXCEPTION 'Mudei % linhas, esperava 2', v_mexidas;
  END IF;
END
$virada$;

/*
  O retrato de depois, para conferir na hora em vez de confiar.

  `producoes`, `funis` e `ad_accounts` devem aparecer sob a Aeliss; `vendas` e
  `metricas_meta` devem continuar TODAS na Alaskan — se alguma venda antiga
  aparecer na Aeliss, o congelamento falhou e é para parar tudo.
*/
SELECT e.nome AS empresa,
       o.nome AS projeto,
       (SELECT count(*) FROM producoes    p WHERE p.projeto_id = o.id) AS cards,
       (SELECT count(*) FROM funis        f WHERE f.projeto_id = o.id) AS funis,
       (SELECT count(*) FROM ad_accounts  a WHERE a.projeto_id = o.id) AS contas,
       (SELECT count(*) FROM vendas v JOIN funis f2 ON f2.id = v.funil_id
         WHERE f2.projeto_id = o.id AND v.empresa_id = e.id) AS vendas_ja_da_empresa
  FROM ofertas_editores o
  JOIN empresas e ON e.id = o.empresa_id
 WHERE o.ativo
 ORDER BY e.nome, o.nome;
