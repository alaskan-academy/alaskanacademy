-- Quem avalia um criativo sabe coisas que o banco não sabe.
--
-- O gestor olha o ROAS em Criativos Meta, marca "Validado", e ali morre: por
-- que valeu a pena, o que dava para melhorar e o quanto isso urge não ficam em
-- lugar nenhum. O Copy descobre o que variar por inferência — e a inferência só
-- vê o que já aconteceu.
--
-- Esta tabela é o canal: o julgamento humano de um lado, a fila do Copy do
-- outro.
--
-- ── O que ela NÃO guarda, de propósito ─────────────────────────────────────
--
-- O quanto o AD é importante em dinheiro. Isso o banco já sabe: o AD 045 H04
-- tem R$ 6.659 investidos e rodou hoje; o AD 001 H01 tem R$ 10,25. Pedir para
-- alguém digitar "alta/média/baixa" ao lado de um campo calculado que diz a
-- mesma coisa é a primeira armadilha do CLAUDE.md, e os dois sempre divergem.
--
-- `urgencia` é outra coisa: é a informação de FORA que o dado não tem — "vai
-- entrar a campanha de Natal". Por isso ela é selo na fila, e não a ordenação:
-- a fila ordena por dinheiro.
--
-- ── E o fechamento é MANUAL, por decisão dela ──────────────────────────────
--
-- Eu recomendei gatilho automático (armadilha #4: todo espelho precisa de
-- gatilho) e ela escolheu manual. Então duas coisas seguram a fila de
-- apodrecer sem contrariar a decisão: cada pedido mostra há quantos dias está
-- aberto, e quando surge uma variação daquele (AD, hook) DEPOIS do pedido a
-- fila avisa. Avisa, não fecha.

CREATE OR REPLACE FUNCTION public.fn_pode_pedir_variacao()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis p
      LEFT JOIN public.setores s ON s.id = p.setor_id
     WHERE p.id = auth.uid()
       AND (coalesce(p.is_admin, false) OR s.nome = 'Gestor de Tráfego')
  );
$function$;

COMMENT ON FUNCTION public.fn_pode_pedir_variacao() IS
  'Gestor de Trafego ou admin. Quem decide verba e quem pede variacao.';

CREATE TABLE IF NOT EXISTS public.pedidos_variacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producao_id    uuid NOT NULL REFERENCES public.producoes(id) ON DELETE CASCADE,
  solicitado_por uuid REFERENCES public.perfis(id) ON DELETE SET NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),

  -- O que só o humano sabe
  por_que        text NOT NULL CHECK (length(trim(por_que)) > 0),
  o_que_melhorar text,
  urgencia       text NOT NULL DEFAULT 'media' CHECK (urgencia IN ('alta','media','baixa')),
  -- Qual variação ele sugere. Lê de `criativo_tipos_teste` para não virar mais
  -- uma lista de tipos solta no código.
  tipo_sugerido  text REFERENCES public.criativo_tipos_teste(nome),

  status         text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','atendido','descartado')),
  atendido_por_producao_id uuid REFERENCES public.producoes(id) ON DELETE SET NULL,
  atendido_por   uuid REFERENCES public.perfis(id) ON DELETE SET NULL,
  atendido_em    timestamptz,
  nota_fechamento text
);

-- Um pedido aberto por card. Pedir duas vezes a mesma coisa é ruído na fila;
-- depois de atendido ou descartado, pode-se pedir de novo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_variacao_aberto
  ON public.pedidos_variacao (producao_id) WHERE status = 'aberto';

DROP TRIGGER IF EXISTS trg_pedidos_variacao_atualizado_em ON public.pedidos_variacao;
CREATE TRIGGER trg_pedidos_variacao_atualizado_em
  BEFORE UPDATE ON public.pedidos_variacao
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.fn_marca_atualizado_em();

ALTER TABLE public.pedidos_variacao ENABLE ROW LEVEL SECURITY;

-- Ler: o Copy (a fila é dele) e quem pode pedir (para ver o que já pediu).
DROP POLICY IF EXISTS pedidos_variacao_ler ON public.pedidos_variacao;
CREATE POLICY pedidos_variacao_ler ON public.pedidos_variacao
  FOR SELECT TO authenticated
  USING (fn_e_copy_ou_admin() OR fn_pode_pedir_variacao());

-- Pedir: só gestor, sócio e admin.
DROP POLICY IF EXISTS pedidos_variacao_criar ON public.pedidos_variacao;
CREATE POLICY pedidos_variacao_criar ON public.pedidos_variacao
  FOR INSERT TO authenticated
  WITH CHECK (fn_pode_pedir_variacao());

-- Mexer: quem pediu pode editar, e o COPY pode fechar — porque o fechamento é
-- manual e quem faz a variação é ele. Sem isso a fila só poderia ser fechada
-- por quem não trabalha nela.
DROP POLICY IF EXISTS pedidos_variacao_mexer ON public.pedidos_variacao;
CREATE POLICY pedidos_variacao_mexer ON public.pedidos_variacao
  FOR UPDATE TO authenticated
  USING (fn_pode_pedir_variacao() OR fn_e_copy_ou_admin())
  WITH CHECK (fn_pode_pedir_variacao() OR fn_e_copy_ou_admin());

DROP POLICY IF EXISTS pedidos_variacao_apagar ON public.pedidos_variacao;
CREATE POLICY pedidos_variacao_apagar ON public.pedidos_variacao
  FOR DELETE TO authenticated
  USING (fn_pode_pedir_variacao());

COMMENT ON TABLE public.pedidos_variacao IS
  'Pedidos de variacao feitos por quem avalia o criativo. Fechamento MANUAL por decisao -- a fila mostra ha quantos dias cada um esta aberto para o esquecimento nao passar calado.';

-- ── A fila como o Copy precisa ler ─────────────────────────────────────────
--
-- Conferido assumindo cada identidade, e não só lendo a política:
--   Helena (Especialista)   vê 0 · não pode pedir
--   Jaqueline (Editor)      vê 0 · não pode pedir · INSERT bloqueado pela RLS
--   Lucas (Copy)            vê 1 · pode pedir (é admin)
CREATE OR REPLACE VIEW public.vw_pedidos_variacao
WITH (security_invoker = true) AS
SELECT pv.id,
       pv.producao_id,
       pv.status,
       pv.urgencia,
       pv.por_que,
       pv.o_que_melhorar,
       pv.tipo_sugerido,
       pv.criado_em,
       pv.atendido_em,
       pv.nota_fechamento,
       (current_date - pv.criado_em::date)      AS dias_aberto,
       p.nome                                   AS criativo,
       fn_ad_numero(p.nome)                     AS ad_num,
       fn_ad_hook(p.nome)                       AS hook,
       fn_funil_video_norm(p.funil_video)       AS funil,
       p.avaliacao,
       p.projeto_id,
       o.nome                                   AS projeto,
       coalesce(o.ativo, false)                 AS projeto_ativo,
       quem.nome                                AS solicitado_por_nome,
       fez.nome                                 AS atendido_por_nome,
       atendeu.nome                             AS card_que_atendeu,
       round(ci.inv_30d, 2)                     AS inv_30d,
       CASE WHEN coalesce(ci.inv_30d, 0) > 0
            THEN round(ci.fat_30d / ci.inv_30d, 2) END AS roas_30d,
       ci.ultimo_dia                            AS ultimo_dia_com_gasto,
       -- O aviso que impede a fila de virar ficção com o fechamento manual.
       EXISTS (
         SELECT 1 FROM producoes v
           JOIN criativo_tipos_teste t ON t.nome = v.tipo_teste
          WHERE t.familia = 'variacao'
            AND v.tipo = 'criativo'
            AND v.projeto_id IS NOT DISTINCT FROM p.projeto_id
            AND fn_ad_numero(v.nome) = fn_ad_numero(p.nome)
            AND fn_ad_hook(v.nome) IS NOT DISTINCT FROM fn_ad_hook(p.nome)
            AND v.criado_em > pv.criado_em
       )                                        AS ja_tem_variacao
  FROM public.pedidos_variacao pv
  JOIN public.producoes p        ON p.id = pv.producao_id
  LEFT JOIN public.ofertas_editores o ON o.id = p.projeto_id
  LEFT JOIN public.perfis quem   ON quem.id = pv.solicitado_por
  LEFT JOIN public.perfis fez    ON fez.id = pv.atendido_por
  LEFT JOIN public.producoes atendeu ON atendeu.id = pv.atendido_por_producao_id
  LEFT JOIN public.vw_criativo_investimento ci ON ci.producao_id = p.id;

COMMENT ON VIEW public.vw_pedidos_variacao IS
  'A fila de pedidos com o contexto que decide: AD, projeto, funil, investimento e ROAS de 30 dias, e se ja apareceu uma variacao depois do pedido.';
