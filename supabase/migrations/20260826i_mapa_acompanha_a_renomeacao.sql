-- Renomear categoria na tela tem que arrastar o mapa do CS junto.
--
-- Ela renomeou "Edição de Vídeo" para "Editor de Vídeo" pelo campo. O mapa que
-- traduz o nome do CS ficou apontando para o nome antigo, que não existe mais
-- -- e 24 lançamentos, R$ 39.486, viraram divergência falsa: o dashboard dizia
-- "Editor de Vídeo", o CS dizia "Edição de Vídeo", e são o mesmo conceito.
--
-- Isso apareceu sozinho, sem ninguém procurar, porque confirmar transações
-- acende as divergências. Foi sorte. O certo é o mapa acompanhar a renomeação.
update public.categorias_mapa
   set categoria = 'Editor de Vídeo',
       observacao = 'A categoria daqui foi renomeada de "Edição de Vídeo" para "Editor de Vídeo". O CS segue chamando de "Edição de Vídeo" — é o mesmo conceito, e sem esta linha os 24 lançamentos apareciam como divergência.'
 where nome_cs = 'Edição de Vídeo';

-- Varredura geral: qualquer linha do mapa que aponte para um nome que só
-- difere por caixa/acento do nome atual da categoria passa a apontar para o
-- nome atual.
update public.categorias_mapa
   set categoria = cc.categoria
  from public.categorias_centro cc
 where lower(public.categorias_mapa.categoria) = lower(cc.categoria)
   and public.categorias_mapa.categoria <> cc.categoria;
