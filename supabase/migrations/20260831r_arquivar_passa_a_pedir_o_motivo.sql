-- Arquivar um card passa a pedir por quê.
--
-- 741 cards já estão arquivados e não há como saber o motivo de nenhum: a fase
-- foi gravada por importação, e a interface nem oferecia a opção. É a segunda
-- armadilha do CLAUDE.md — cadastro sem resultado ao lado, que envelhece e
-- vira ficção. "Arquivamos 741" não é informação; "arquivamos 741, sendo 300
-- por conta bloqueada e 180 por oferta descontinuada" é.
--
-- O motivo mora no EVENTO (`criativo_historico`) e não no card. Um card pode
-- ser arquivado, reaberto e arquivado de novo, e cada arquivamento tem o seu
-- motivo — em `producoes` seria um campo só, sobrescrito no segundo.
--
-- E "esta fase pede motivo" é propriedade da FASE, não um `if` comparando com
-- a string 'arquivado'. Ligar para Bloqueado depois é um UPDATE, não um deploy.

alter table criativo_historico
  add column if not exists motivo text;

comment on column criativo_historico.motivo is
  'Por que este movimento aconteceu, quando a fase de destino exige explicacao. '
  'Mora no EVENTO e nao no card: um card pode ser arquivado, reaberto e '
  'arquivado de novo, e cada arquivamento tem o seu motivo. Guardado em '
  'producoes seria um campo so, sobrescrito no segundo arquivamento.';

alter table producao_fases
  add column if not exists exige_motivo boolean not null default false;

comment on column producao_fases.exige_motivo is
  'Mover um card para esta fase pede uma explicacao escrita. Vale para Arquivado: '
  'arquivar sem motivo e a segunda armadilha do CLAUDE.md — cadastro sem '
  'resultado, que envelhece e vira ficcao. Ligar para outra fase e um UPDATE, '
  'nao um deploy.';

update producao_fases set exige_motivo = true where chave = 'arquivado';
