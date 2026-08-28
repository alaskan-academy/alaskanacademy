-- As chaves `radar` e `referencias` sobraram da fusao das duas telas no
-- Laboratorio. A lista de paginas em `AuthContext` so conhece `laboratorio`
-- desde entao, entao ninguem le essas 8 linhas -- mas elas continuavam no banco
-- e apareceriam para quem fosse ler a tabela na mao.
--
-- Backup primeiro. Apagar a tabela de backup quando ela conferir.
CREATE TABLE IF NOT EXISTS public.backup_permissoes_paginas_20260827 AS
  SELECT * FROM public.permissoes_paginas WHERE pagina IN ('radar', 'referencias');

ALTER TABLE public.backup_permissoes_paginas_20260827 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backup_permissoes_paginas_admin ON public.backup_permissoes_paginas_20260827;
CREATE POLICY backup_permissoes_paginas_admin ON public.backup_permissoes_paginas_20260827
  FOR ALL TO authenticated USING (public.fn_sou_admin()) WITH CHECK (public.fn_sou_admin());

COMMENT ON TABLE public.backup_permissoes_paginas_20260827 IS
  'As 8 linhas de radar/referencias antes de saírem (27/08/2026). Apagar quando conferido.';

DELETE FROM public.permissoes_paginas WHERE pagina IN ('radar', 'referencias');
