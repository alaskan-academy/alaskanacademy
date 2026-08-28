-- `acessos` e o cofre de credenciais da empresa: 52 ferramentas, 51 com senha.
-- Excluir era `DELETE` definitivo, e a tabela nao guardava quem criou nem quem
-- alterou. Num cofre, a linha apagada era a unica copia da credencial -- e nao
-- havia a quem perguntar o que aconteceu.
--
-- ── Sobre as senhas em texto puro ─────────────────────────────────────────
--
-- Elas estao em texto puro e a policy de SELECT e `USING (true)`: todo usuario
-- logado le todas, incluindo Hostinger, Vercel, Hotmart e o "Gmail de acessos",
-- que reseta as outras. Hoje elas viajam para o navegador de todo mundo a cada
-- carregamento da pagina.
--
-- Isso foi levantado com ela em 27/08/2026, com os numeros na mao, e a resposta
-- foi manter: e um cofre de equipe por decisao, com seis pessoas de confianca.
--
-- Fica escrito aqui para quem ler depois saber que foi ESCOLHA, e nao descuido
-- -- e para que mudar de ideia seja uma conversa, e nao uma descoberta.

ALTER TABLE public.acessos
  ADD COLUMN IF NOT EXISTS criado_por     uuid REFERENCES public.perfis(id),
  ADD COLUMN IF NOT EXISTS atualizado_por uuid REFERENCES public.perfis(id),
  ADD COLUMN IF NOT EXISTS deletado_em    timestamptz,
  ADD COLUMN IF NOT EXISTS deletado_por   uuid REFERENCES public.perfis(id);

COMMENT ON COLUMN public.acessos.deletado_em IS
  'Excluida da lista, mas guardada: num cofre a linha apagada e a unica copia da credencial.';

-- `atualizado_em` era carimbado pelo formulario, entao qualquer escrita por
-- fora dele (painel, script) deixava a data velha. Gatilho faz sozinho -- e e a
-- mesma correcao que `producoes` recebeu hoje, pelo mesmo motivo.
DROP TRIGGER IF EXISTS trg_acessos_atualizado_em ON public.acessos;
CREATE TRIGGER trg_acessos_atualizado_em
  BEFORE UPDATE ON public.acessos
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.fn_marca_atualizado_em();
