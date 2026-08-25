-- Faltava o apelido do maior fornecedor de todos.
--
-- Cada cobrança do Facebook tem id próprio no descritor, então sem apelido cada
-- uma virava um "fornecedor" diferente: 105 fornecedores em agosto que são um
-- só. Prioridade 70 (perde para as regras específicas) porque os cartões de
-- WhatsApp também trazem FACEBK e têm tratamento próprio.
insert into public.fornecedores (nome, padrao, tipo_match, prioridade, definido) values
  ('Meta Ads', 'FACEBK', 'contains', 70, true)
on conflict do nothing;

-- País do fornecedor, para o controle fiscal saber se cobra NF ou invoice.
--
-- Duas versões erradas antes desta. A primeira pegava as duas últimas letras de
-- qualquer texto e produzia lixo: "MINISTERIO DA FAZENDA" virava país "DA",
-- "JAQUELINE COELHO SILVA" virava "VA". A segunda exigia dígito colado ou
-- espaçamento largo antes do código, e aí toda cobrança internacional com
-- telefone ("+19177203691 US") era lida como nacional — ChatGPT, ElevenLabs,
-- OpenAI, Supabase e Vercel todas apareciam como BR.
--
-- PIX e TED não têm código de país nenhum: são sempre nacionais.
create or replace function public.fn_pais_fornecedor(p_descricao text, p_fonte text)
returns text language sql immutable as $fn$
  select case
    when p_fonte <> 'conta_simples_cartao' then 'BR'
    else coalesce(
      nullif(substring(p_descricao from '(?:[0-9]\s?|\s{2,})([A-Z]{2})\s*$'), ''),
      'BR')
  end;
$fn$;

comment on function public.fn_pais_fornecedor(text, text) is
  'País do fornecedor pelo descritor. PIX/TED são sempre BR; no cartão o código vem após dígitos ou espaçamento largo.';

grant execute on function public.fn_pais_fornecedor(text, text) to authenticated;
