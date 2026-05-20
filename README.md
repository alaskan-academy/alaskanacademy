# Alaskan Dashboard

Dashboard interno da Alaskan Academy para análise de vendas, Meta Ads e performance de editores.

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + Edge Functions)
- **Integrações:** Meta Ads (via Windsor), Payt, Notion

## Configuração local

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Copie o arquivo de variáveis de ambiente:
   ```bash
   cp .env.example .env.local
   ```
4. Preencha `.env.local` com as credenciais do projeto Supabase (Dashboard → Project Settings → API)

5. Rode o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Chave pública anon do Supabase |

> As credenciais do Supabase ficam **apenas** no `.env.local` (não commitado). As chaves secretas das Edge Functions são configuradas no painel do Supabase.

## Edge Functions (Supabase)

Localizadas em `supabase/functions/`:

| Função | Descrição |
|---|---|
| `admin-users` | Criação e gestão de usuários via service role |
| `payt-webhook` | Recebe webhooks de venda da Payt |
| `sync-notion-criativos` | Sincroniza criativos do Notion com o banco |

As secrets das funções (ex: `NOTION_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`) são configuradas em Supabase → Edge Functions → Secrets.
