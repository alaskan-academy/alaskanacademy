-- Onde mora o id da planilha das Análises.
--
-- Em `configuracoes_texto` e não no código da edge function, como está em
-- `radar-sheets-sync`: assim ela troca de planilha sem deploy, e a função
-- consegue dizer "pulado" em vez de estourar quando ainda não há planilha
-- nenhuma ligada.
--
-- Nasce vazio de propósito. A tela da rodada mostra um convite discreto para
-- colar a URL — configuração que aparece onde a falta é sentida e some quando
-- ela acaba não precisa de tela de configuração.

insert into public.configuracoes_texto (chave, valor)
values ('analises_spreadsheet_id', '')
on conflict (chave) do nothing;

comment on table public.configuracoes_texto is
  'Configuração de texto livre por chave. `obsidian_api_key` e '
  '`analises_spreadsheet_id` alimentam as exportações do módulo Análises.';
