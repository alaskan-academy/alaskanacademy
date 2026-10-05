/*
  A tabela antiga sai, para não existirem duas listas do mesmo fato.

  Conferido antes de apagar, que é a ordem que o CLAUDE.md exige depois de o
  DROP ter derrubado Produção duas vezes em 21/09/2026:

  · nenhuma função a referencia (as duas que liam, o gatilho
    `trg_fn_marcar_trafego_sem_utm` e o alerta `fn_alerta_remendo_utm_resolvido`,
    já foram repontadas para `checkouts_origem`);
  · nenhuma view a referencia;
  · nenhuma chave estrangeira aponta para ela;
  · o front nunca a leu — a busca no `src/` só acha menção em `plan.md`.

  Ela estava vazia desde 23/08, então não há dado a preservar. O que ela
  guardava foi reclassificado em `checkouts_origem`, onde cada checkout diz
  também QUAL é a origem (tráfego, suporte, recuperação, bio, upsell), e não só
  se é pago.
*/
DROP TABLE IF EXISTS public.links_trafego_sem_utm;
