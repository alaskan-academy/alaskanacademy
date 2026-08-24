-- A regra que causava o erro de R$ 13.940.
--
-- `LUCAS DOS SANTOS VEIGA -> Aplicativos e Ferramentas` com confiança 1,00,
-- provavelmente um clique errado numa categorização manual (que grava regra com
-- confiança máxima). Havia a regra certa logo abaixo, com 0,88, e ela perdia.
--
-- Removida, não corrigida: o mesmo Lucas recebe pró-labore E retirada de lucro,
-- e nenhuma regra de texto consegue separar os dois — o descritor é idêntico.
-- Só a Conta Simples sabe, porque lá ela marca na hora da transação. Fica a
-- regra de 0,88 como rede quando o CS não tiver informado nada.
delete from public.regras_categoria
 where padrao = 'LUCAS DOS SANTOS VEIGA' and confianca >= 1.0;

-- De onde veio a categoria. Sem isto a tela não consegue dizer "isto o CS
-- decidiu" e "isto uma regra chutou", que é a diferença entre confiar e conferir.
alter table public.transacoes add column if not exists categoria_origem text;
comment on column public.transacoes.categoria_origem is
  'cs | regra | mapa — quem decidiu a categoria na última passada.';

-- O cs-sync chama `aplicar_regras_categoria` e espera um int. Vira fachada da
-- nova, para a função de borda não precisar de deploy só por causa disto.
create or replace function public.aplicar_regras_categoria()
returns integer
language plpgsql
as $fn$
declare
  r jsonb;
begin
  r := public.aplicar_categorizacao();
  return (r->>'categorias')::int;
end;
$fn$;
