# Plano de Implementação — Dashboard & Análise de Tendências

Reconstrução completa da área "DASHBOARDS", incluindo a camada de ingestão de dados.

---

## Diagnóstico (20/08/2026)

Levantamento feito direto no banco antes de planejar.

### O webhook da Payt está funcionando

`vendas_payt` tem **11.680 eventos**, o último em 20/08 às 04:01 BRT. Nunca parou. Cobertura contínua desde 04/01/2026.

**O elo que nunca existiu:** não há nenhuma função ou trigger no banco que leia `vendas_payt`. A tabela `vendas` — que todas as páginas do dashboard consomem — sempre foi alimentada por **import manual de CSV** (`ImportarPaytModal.tsx`), abandonado em 19/05. Os 3 meses "perdidos" estão intactos em `vendas_payt`.

A camada raw proposta originalmente **já existe** (`vendas_payt.payload_raw`) — não é preciso criar `payt_eventos_raw`.

| Fonte | Tabela | Última entrada | Situação |
|---|---|---|---|
| Payt (webhook) | `vendas_payt` | **hoje** | Funcionando |
| Payt (normalizado) | `vendas` | 19/05/2026 | Import manual abandonado — **elo a construir** |
| Meta | `metricas_meta` | 23/07/2026 | Vinha via Windsor.ai — descontinuado por decisão |
| UTMify | `metricas_diarias` | nunca | 0 linhas |

### Composição de `vendas_payt`

8.528 vendas pagas, de duas origens com formatos distintos:

| Origem | Qtd | Payload |
|---|---|---|
| Import em massa de 30/06 | ~4.628 | Vazio — só campos planos |
| Webhook real | ~3.900 | Completo, com `product.code` |

Consequência: o trigger `fn_auto_produto_venda` resolve produto via `product.code` → `ofertas`. Funciona nas do webhook; as importadas exigem resolução **por nome**.

### Achados que afetam o desenho

**1. `utm_source` está corrompido.** Das 8.528 pagas: 5.982 sem `utm_source`, 280 com `FB` correto, e ~1.968 com valores poluídos por token (`FBjLj6a5696504d5dca326db9199b`…), cada um aparecendo 1-2 vezes. Bug no template do link. O `ad_id` sobreviveu intacto em todos.

→ **A segmentação Tráfego/Back não pode usar `utm_source`.** Usar presença de `ad_id`:
- **Tráfego** = tem `ad_id` → 2.248 (26,4%)
- **Back-end** = sem `ad_id` → 6.280 (73,6%)

Mais robusto, e é como a UTMify atribui na prática.

**2. Fuso horário.** `criado_em` é `timestamptz` em UTC. **5,1% das vendas pagas (432) ocorrem entre 21h e 23h59 BRT** e caem no dia seguinte se filtradas por data em UTC. Toda métrica diária fica distorcida. A normalização deve calcular o dia em `America/Sao_Paulo`.

**3. Bug no webhook.** `DashboardsSettings` gera a URL como `/payt-webhook/{funilId}`, mas a função ignora o path. O `funil_id` nunca foi capturado.

**4. `ad_accounts` desatualizada.** 10 CAs, todas com `funil_id` null, várias já não rodam e faltam CAs ativas. Lista mantida à mão envelheceu — a correção é auto-descoberta via API do Meta, não manutenção manual.

**5. `funis` inutilizável.** 22 registros, todos `ativo = false`, nomes duplicados (4× "REV1", 3× "REV2", 3× "REV3"), `produto` quase todo null. **Decisão: recomeçar do zero**, estruturados sobre as CAs reais descobertas no passo 2.

### Lacunas em `ofertas` (bloqueiam a resolução de produto)

| Código | Produto | Vendas | Situação |
|---|---|---|---|
| `R2JAJA` | Workshop Buquê de Velas | 895 | Existe, `produto` NULL |
| `4MJ9YD` | Fábrica das Velas de Lembrancinha | 395 | Falta |
| `L9QEPN` | Kit Completo p/ Começar no Artesanato com Velas | 45 | Falta |
| `4OMXA8` | Vendas no Artesanato na Prática | 11 | Falta — categoria a definir |
| `LPGKQ8` | Handify Artesanato Completo | 7 | Falta — categoria a definir |
| — | Manual Incensos Naturais em Vareta | 123 | Só no import, sem código |

Enum disponível: `velas · saponaria · cosmeticos · hormonal · velaroma`

---

## Princípios da reconstrução

Derivados do diagnóstico acima:

**1. Camada raw imutável + camada normalizada**
O webhook atual parseia e descarta o payload original. Se a normalização tem bug, o dado é perdido definitivamente. Toda ingestão grava o payload cru primeiro; a normalização lê dele. Permite reprocessar sem re-buscar na origem.

**2. Idempotência em toda ingestão**
- Payt: chave única `transaction_id`
- Meta: upsert em `(data, ad_id)` — o mesmo dia é re-sincronizado várias vezes pela janela deslizante de atribuição

**3. Saúde da ingestão visível na UI**
As três fontes morreram em silêncio. Um dashboard com dado velho não sinalizado é pior que um quebrado — induz decisão errada. Toda fonte reporta heartbeat, e a UI exibe defasagem quando ela existe.

**4. Chave de junção Payt ↔ Meta**
O webhook extrai o `ad_id` do Meta de dentro do `utm_content` (formato `Nome do Ad|ad_id::token`). É o que viabiliza faturamento por criativo. Deve ser preservado e formalizado como coluna indexada.

---

## Contexto e decisões de negócio

### Segmentação de tráfego

Critério baseado em presença de `ad_id_meta`, **não** em `utm_source` — que está corrompido (ver diagnóstico).

| Categoria | Regra | Volume atual |
|---|---|---|
| **Tráfego** | `ad_id_meta` preenchido | 2.248 (26,4%) |
| **Back-end** | `ad_id_meta` nulo | 6.280 (73,6%) |
| **Misto** | Sem filtro | 8.528 |

A tabela `utm_sources_pagos` fica como refinamento futuro, útil apenas depois que o template de link for corrigido.

### Filtro por CA

Além do filtro de funil da sidebar, ambas as partes têm **seletor de CA** na toolbar:

- Modo "Geral" + CA → todos os funis vinculados àquela CA
- Modo funil + CA → recorte dentro do funil (quando o funil tem múltiplas CAs)
- Default: "Todas as CAs"

---

## Fase 0 — Fundação de dados (pré-requisito)

### 0.1 Normalização `vendas_payt` → `vendas` (o elo que falta)

O webhook e a camada raw já existem e funcionam. O que falta é a normalização.

**Sem dependência de `funil_id`** — deixa a coluna nula nesta fase. Isso desbloqueia o backfill imediatamente; `funil_id` é preenchido retroativamente na fase 0.3 via `ad_id_meta`.

Mapeamentos:

| `vendas_payt` | `vendas` | Regra |
|---|---|---|
| `payt_id` | `pedido_id` / `pedido_id_payt` | direto |
| `status` | `status` (enum) | `paid`→`aprovada` · `expired`→`expirada` · `canceled`→`cancelada` · `refunded`→`reembolsada` · `chargeback`→`chargeback` · `refund_requested`→`pendente` |
| `valor` | `valor_total` / `valor_oferta_principal` | direto |
| `criado_em` | `data_venda` | preservar timestamptz; dia de negócio calculado em `America/Sao_Paulo` |
| `utm_ad_id` | `ad_id_meta` | direto — chave para o passo 0.3 |
| `payload_raw` | `payload_webhook` | direto (vazio nas linhas do import de 30/06) |
| `produto` (texto) | `produto` (enum) | trigger resolve por `product.code`; **fallback por nome** para as linhas do import |
| — | `funil_id` | nulo nesta fase |

Pré-requisito: completar as lacunas de `ofertas` listadas no diagnóstico.

Os triggers já existentes em `vendas` (cliente, origem, upsell, campos de data, prejuízo) fazem o enriquecimento automaticamente na inserção.

**Backfill:** reprocessar as 8.528 pagas de `vendas_payt`, recuperando 19/05 → hoje.

**Execução contínua:** trigger `AFTER INSERT OR UPDATE` em `vendas_payt` chamando a mesma função de normalização — assim toda venda nova flui sozinha, sem depender de job externo.

**Correções pendentes no webhook** (não bloqueiam a normalização):
- Ler `funil_id` do path da URL (`/payt-webhook/{funilId}`) e gravar em `vendas_payt`
- Corrigir o template do link que corrompe `utm_source`
- Migrar de `integration_key` para assinatura HMAC se a Payt oferecer (ver CLAUDE.md)

### 0.2 Sync Meta Marketing API (novo, direto)

Substitui o Windsor.ai. Configuração de segurança:

| Item | Decisão | Motivo |
|---|---|---|
| Token | **System User Token** (BM → Usuários do Sistema) | Não expira em 60d, não atrelado a perfil pessoal, sobrevive a saída de pessoa |
| Permissão | **`ads_read` apenas** | Torna impossível um bug alterar campanha/budget/status. Nunca `ads_management` |
| Armazenamento | Supabase secrets, só server-side | Nunca no frontend |
| Tier | Development basta | Lendo apenas contas próprias, sem App Review |
| Backoff | Exponencial + respeitar `X-Business-Use-Case-Usage` | Evita throttle (erro 17/613) |

**Cadência — janela deslizante por atribuição:**

O Meta re-atribui conversões retroativamente (7d clique / 1d view). Dado de hoje é volátil, D-1 quase fechado, D-3+ estável.

- **A cada 1h** → sincroniza o dia corrente
- **1x/dia** → re-sincroniza D-1 até D-7, capturando correções de atribuição

Volume: ~31 chamadas/dia por conta (~310/dia no total). Usar `time_increment=1` para trazer múltiplos dias por chamada e async insights jobs para backfill histórico.

```sql
CREATE TABLE meta_insights_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_account_id text NOT NULL,
  data date NOT NULL,
  nivel text NOT NULL,          -- 'campaign' | 'adset' | 'ad'
  objeto_id text NOT NULL,
  payload jsonb NOT NULL,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ad_account_id, data, nivel, objeto_id)
);
```

Normalização alimenta `metricas_meta` (existente) preservando o contrato de `vw_metricas_meta_nivel`, que já é consumida por MetaAdsPage e AdsAnalysisPage.

### 0.3 Monitoramento de saúde

```sql
CREATE TABLE ingest_health (
  fonte text PRIMARY KEY,             -- 'payt' | 'meta'
  ultimo_sucesso timestamptz,
  ultimo_erro timestamptz,
  mensagem_erro text,
  registros_ultima_execucao integer,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
```

- Toda ingestão escreve heartbeat ao concluir
- Componente `<IngestStatusBanner />` no `DashboardLayout` exibe aviso quando qualquer fonte estiver defasada além do limiar (Payt > 6h, Meta > 25h)
- Sem defasagem, o componente não renderiza nada

### 0.4 Configuração

```sql
CREATE TABLE utm_sources_pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true
);

CREATE TABLE dashboard_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funil_id uuid REFERENCES funis(id) ON DELETE CASCADE,
  metrica text NOT NULL,
  valor_ideal numeric,
  valor_limite numeric,
  direcao text NOT NULL DEFAULT 'menor_melhor',  -- 'menor_melhor' | 'maior_melhor'
  ativo boolean NOT NULL DEFAULT true,
  UNIQUE(funil_id, metrica)
);
```

RLS obrigatória em todas as tabelas novas (ver CLAUDE.md).

---

## Parte 1 — Resumo revampado (`/`)

### Estrutura

1. **Toolbar**: seletor de CA (novo) + filtro de data (existente) + funil via sidebar (existente)
2. **Tabs de origem**: `Tráfego | Back-end | Misto`
3. **Gráfico temporal** (ausente hoje): faturamento diário + custo de ads + lucro
4. **KPI cards**: preservar os atuais, acrescentar CPA e ROAS

### Métricas por tab

| Métrica | Tráfego | Back-end | Misto |
|---|---|---|---|
| Faturamento | só utm pagos | só back | todos |
| Custo de ads | Meta do período | — | total Meta |
| ROAS | sim | n/a | agregado |
| CPA | sim | n/a | só tráfego |
| Margem / AOV | sim | sim | sim |
| OBs / Upsells | sim | sim | sim |

---

## Parte 2 — Tendências (`/tendencias`)

Nova rota, entrada no sidebar dentro de DASHBOARDS. Respeita funil da sidebar + CA da toolbar.

| Contexto | Exibição |
|---|---|
| Geral + todas CAs | Grade comparativa entre funis, métricas **relativas** (%) — produtos com preços diferentes não comparam em valor absoluto |
| Geral + CA | Grade dos funis daquela CA |
| Funil específico | Análise completa, métricas agrupadas |

### Grupos de métricas

**Aquisição** — CPM, CPC, CTR, Hook Rate, Hold Rate, CPA, ROAS, Frequência
**Conversão** — conv. landing page, conv. checkout, taxa de upsell, taxa de order bump, conv. global
**Financeiro** — faturamento bruto/líquido, AOV, ticket com upsell, margem %, lucro por venda, break-even ROAS, taxa de reembolso
**Retenção/Back** — taxa de recompra, intervalo médio entre compras, LTV estimado, CAC tráfego vs back

### Três referências por métrica

1. **Tendência** — média móvel de 7 dias (direção real, sem ruído diário)
2. **Período anterior** — mesmo intervalo imediatamente anterior
3. **Benchmark** — meta configurável por funil (`dashboard_benchmarks`)

### Status de saúde

| Status | Critério |
|---|---|
| Saudável | Dentro do benchmark E tendência estável/melhorando |
| Atenção | Próximo do limite OU tendência piorando moderadamente |
| Crítico | Fora do benchmark E tendência negativa |

Limiar default ±15%, configurável.

---

## Fases de execução

### Fase 0.1 — Normalização Payt ✅ concluída
- [x] Enum `produto_tipo` recebeu `handify`
- [x] Lacunas de `ofertas` completadas (`R2JAJA` + 5 inserções)
- [x] `fn_normalizar_venda_payt()` — idempotente, com dia de negócio em BRT
- [x] `calcular_origem` / `trg_fn_origem` passam a priorizar `ad_id_meta`
- [x] Backfill: 11.680 eventos processados → `vendas` de 4.532 para 12.961 linhas
- [x] Trigger `trg_normalizar_venda_payt` em `vendas_payt` (falha isolada, não derruba o raw)
- [x] View `vw_ingest_health` + `<IngestStatusBanner />` no DashboardLayout
- [x] Verificado: 93 dias consecutivos sem lacuna, última venda 20/08 04:03 BRT

- [x] **Segurança:** removidas as políticas `anon_write` / `anon_update` de `vendas_payt`; restam leitura autenticada e service_role
- [x] **RLS órfã corrigida (bug crítico):** 24 tabelas tinham RLS ligada com política de SELECT só para `anon`. Como usuário logado usa o papel `authenticated`, que não é membro de `anon`, **toda query retornava zero linhas** — a Visão Geral aparecia inteira zerada. Inclui `vendas`, `venda_itens`, `ofertas`, `clientes`, `assinaturas`, `configuracoes`. Só `caixa_config` segue restrita, corretamente (service-role only)
- [x] **Taxa da plataforma:** a normalização não preenchia `taxa_plataforma_valor`, então a cascata mostrava "Taxa Payt R$ 0,00" e a margem saía inflada em 90%. O payload traz `commission[]` com `type='platform'`. Backfill aplicado: 5.987 vendas, média 6,20%

- [x] **Filtro de data em BRT.** O app passava `yyyy-MM-dd`, que o Postgres lia como meia-noite UTC, arrastando as vendas de 21h–23h59 do dia anterior. Novo `src/lib/periodo.ts` (`inicioDiaBRT` / `fimDiaBRT` / `diaBRT`) com offset calculado via `Intl`, não fixado — o Brasil já teve horário de verão e pode voltar a ter. `FilterContext` passa a expor `startISO` / `endISO`. Coberto por `src/test/periodo.test.ts` (6 testes)
- [x] **Taxa da plataforma sai de `vendas`, não da view.** A view agrupa pelo dia em UTC e divergia do faturamento, que já respeita o dia em BRT — a cascata fechava com R$1,55 de erro

- [x] `startISO`/`endISO` propagados para `SalesPage`, `FunnelPage` e `UTMPage` — as quatro páginas passam a contar o dia no mesmo fuso
- [x] **Taxa da plataforma recalculada como `total − producer`.** A linha `commission[type='platform']` traz só a comissão da Payt e ignora processamento e divisões com terceiros: media 5,34% contra 7,86% reais. Protegido o payload defeituoso (produtor zerado, que registraria 100%)
- [x] **`vendas.produto_nome`.** A tela agrupava pelo enum `produto` — 6 categorias — mostrando "Saponaria" sem distinguir o Curso Saponaria Brasil da Arte Floral em Sabonetes. Nova coluna com o nome real da Payt (43 nomes distintos), com a categoria virando badge

- [x] **Reembolsos e chargebacks ignoravam o filtro de período.** Vinham de `vw_reembolsos`, que agrega a tabela inteira numa linha só, sem recorte de data — os cards exibiam o total histórico (71 reembolsos, 11 chargebacks / R$ 972,64) ao lado de "Não aprovadas", que respeita o período. Passaram a sair de `vendas` com o mesmo filtro de data, funil e segmento
- [x] **Upsell aparecia também em "Vendas por produto".** A mesma venda era contada no painel de produtos e no de upsells. O painel de produtos passa a excluir `is_upsell` e o título deixou de dizer "produto principal", que sugeria só ofertas de entrada

- [x] **Juros de parcelamento separados da receita.** O payload traz `total_price` (o que o cliente pagou), `price_without_installments` (preço sem juros) e `installments`. A diferença é financiamento: o cliente paga, a adquirente recebe, o produtor nunca teve direito. Estava tudo sendo somado como taxa da plataforma, o que levava a taxa média do cartão de 6,45% para 11,94% — quase o dobro. Novas colunas `valor_sem_juros`, `juros_parcelamento`, `valor_liquido_produtor`; margem, ticket, ROAS e taxa% passam a usar a receita sem juros. Total identificado: R$ 6.148,01 em 572 vendas
- [x] Cards do topo não cortam mais com a sidebar aberta (4 colunas só a partir de `xl`, número com `clamp()`)
- [x] Ticket médio ganhou comparativo com o período anterior
- [x] **`valor_oferta_principal`, ticket médio e o gráfico também passaram para a base sem juros.** Numa primeira passagem só a cascata tinha sido convertida, e a lista de produtos seguia com o valor pago: o Workshop Desafios aparecia como R$ 328,80 em vez dos R$ 297,00 de tabela. Validação de que a base está certa: as duas vendas de Saponaria do dia agora mostram R$ 67,00 de oferta principal — o preço de tabela — enquanto antes uma delas saía como R$ 73,58

- [x] **Descoberto por que "back-end" aparecia em 50%: 41,5% da receita vem de links de checkout sem UTM.** O bloco `link` do payload identifica o checkout usado, e os links bem configurados rastreiam 92–99%. Já 39 links rastreiam **0%** — 1.574 vendas, R$ 135.271. O maior é "Saponaria Brasil - Desconto de Aula": **1.213 vendas, R$ 110.848, nenhuma atribuição** — a maior linha de receita da base. Não é falha de tracking, é link sem UTM configurada. Novas colunas `link_titulo` / `link_url` e nova aba **Links** na Visão Geral, que lista receita por checkout e o % rastreado de cada um

- [x] **Salvar em Configurações não gravava nada — e dizia que gravou.** 18 tabelas tinham política de escrita apenas para `anon`; usuário logado usa `authenticated`, então o UPDATE afetava zero linhas. O PostgREST devolve 200 nesse caso, e o código só checava `error`, nunca a quantidade de linhas afetadas — daí o toast "Configurações salvas!" sobre nada. Atingia também os módulos de Editores, Avaliações e Processos. Corrigido nos dois lados: política `authenticated_write` nas 18 tabelas, e `.select()` no update para detectar zero linhas
- [x] `ParametrosFiscaisTab.tsx` removido — cópia divergente de `SettingsPage.tsx` que nunca foi importada em lugar nenhum

- [x] **Alertas de coerência, não só de atualidade (`vw_alertas`).** Todo defeito encontrado neste projeto produziu um número plausível — o dashboard estava confiantemente errado, que é pior que estar quebrado. Cinco checagens, cada uma calibrada contra um caso real: fonte parada (os 3 meses de pipeline morto), conta gastando sem produto (o investimento que não chegava à tela), receita sem atribuição (os R$ 110 mil do "Desconto de Aula"), Meta reportando mais conversões que vendas (a contagem inflada 8×) e venda sem produto. As checagens ficam no banco e não no componente, para valerem a qualquer consumidor e serem conferíveis por SQL
- [x] Limiar do alerta Meta×Payt recalibrado. A primeira versão comparava com as vendas que têm `ad_id` e disparava sempre, porque essa razão fica em 2,5× só pelo buraco de rastreio — e alerta que dispara sempre vira ruído e para de ser lido. Comparando com o total de vendas, hoje dá 1,14× (silencioso) e daria 9,1× com o bug de contagem
- [x] `fn_brl()` — o `to_char` usava os separadores do locale do banco (en_US) e escrevia "R$ 24,835.69"

- [x] **O webhook rejeitava os upsells com 400 — a causa era nossa, não da Payt.** A conciliação com o export de 01–20/08 mostrou 1.358 pedidos aprovados na Payt contra 1.313 no banco, e os 45 ausentes faltavam também em `vendas_payt`. A primeira leitura foi "a Payt não dispara para upsell". Errado: os logs da edge function mostravam 28 respostas 400 em 24h, todas com user-agent `Payt Postback` e corpo de resposta de 54 bytes — exatamente o gzip de `{"error":"transaction_id ausente"}`. A Payt entregava, autenticada e com JSON válido; o upsell só não traz `transaction_id` no topo, e a função devolvia 400 sem gravar nada. Como o corpo era descartado junto, o rastro sumia
- [x] **Nenhum payload é mais descartado sem ser gravado.** Nova tabela `payt_webhook_raw` guarda o corpo bruto antes de qualquer validação; o webhook (v25) procura o id em dez caminhos possíveis e, quando não acha, grava com o motivo e devolve 200 em vez de 400 — a Payt para de reenviar e o dado fica recuperável sem depender dela
- [x] **46 upsells de agosto recuperados do export** (74 linhas no total, contando recusadas e expiradas), com `_origem: backfill_export_20_08_2026` no payload para distingui-las das entregues pelo webhook
- [x] **Agosto fecha com a Payt até o centavo.** Depois do backfill, 18 dos 20 dias batem exatamente. Os dois restantes se explicam: 20/08 tem +R$ 96,03 de uma venda que entrou depois de o export ser gerado, e 09/08 tinha −R$ 63,65 de um pedido cujo `valor_sem_juros` estava nulo. Descontada a venda tardia, a diferença é **R$ 0,00** tanto em "Valor da Venda" quanto em "Você Recebe"
- [x] **`Valor da Venda` do export é o valor sem juros** — confirmado pela conciliação, o que valida a separação entre `valor_sem_juros` e `juros_parcelamento`
- [x] **`fn_atualizar_taxa_plataforma` não descarta mais tudo quando a comissão falha.** A Payt às vezes manda `amount: 0` nas duas comissões (não calculou ainda no momento do postback). A função saía cedo e jogava fora também `price_without_installments`, que estava correto — foi assim que O9B6QZK escapou. Agora grava o que independe da comissão e só pula os campos derivados dela
- [x] **`is_upsell` passa a vir de `tipo_venda`, campo da própria Payt.** A heurística de sessão (segunda compra do mesmo cliente em 30 min) errava nos dois sentidos: marcava compra dupla legítima como upsell e perdia upsell fora da janela. Dos 46 recuperados, ela acertava 43
- [x] **Três alertas novos em `vw_alertas`:** `webhook_nao_processado` (evento recebido que não virou venda), `venda_nao_normalizada` (está na camada bruta e não em `vendas` — o trigger engole exceções com `RAISE WARNING`) e `venda_sem_liquido` (comissão zerada). O `receita_sem_rastreio` passou a excluir upsell, que por natureza nunca tem UTM
- [ ] **Descobrir onde a Payt põe o id no payload de upsell** — a próxima entrega fica gravada em `payt_webhook_raw`; daí dá para extrair `tipo_venda` direto do webhook e aposentar a heurística de vez

**Pendências:**
- [x] **Escrita `anon` removida das 18 tabelas.** Verificado antes: as 7 Edge Functions usam `SERVICE_ROLE_KEY` e ignoram RLS; todas as páginas estão atrás de `ProtectedRoute`; e `windsor_meta_staging` era o provável motivo original da permissão (o Windsor escrevia direto com a chave anon), descontinuado desde 23/07. Estado final: 0 políticas de escrita anônima, 0 tabelas sem leitura autenticada, 0 tabelas sem escrita
- [x] **`caixa_config` não tinha política nenhuma** — nem leitura, nem escrita. A página de Caixa lia a configuração e gravava o saldo da reserva, e as duas falhavam em silêncio. Também corrigido o `salvarConfig`, que só checava `error`, e o `DashboardLayout` sem `title`, que deixava o cabeçalho da página em branco
- [ ] **Configurar UTM nos links de checkout com 0% de rastreio** — ação no painel da Payt, não no código. Prioridade absoluta em "Saponaria Brasil - Desconto de Aula" (R$ 110.848). Enquanto não for feito, ROAS e CPA do funil de aula ficam impossíveis de medir e a receita dele é lida como back-end
- [ ] Depois que os links estiverem rastreados, revisar a régua Tráfego/Back-end: hoje ela mistura back-end real (Suporte, Assinatura, Oferta p/ Alunas, Seguidoras) com venda de anúncio que perdeu atribuição
- [x] **Base do Simples corrigida para `valor_sem_juros`, confirmada pelas notas.** O pedido `282O8JD` (R$ 328,80 em 5x) é faturado em dois documentos que somam exatamente R$ 297,00 — o `valor_sem_juros`: NF-e de R$ 237,60 (mercadoria, NCM 49019900, com imunidade de livro pela CF/88 art. 150 VI d) e NFS-e de R$ 59,40 (serviço). Os R$ 31,80 de juro não aparecem em nota alguma. A view passou a expor `receita_tributavel` e `juros_parcelamento`
- [ ] **A receita é faturada 80/20 entre mercadoria e serviço — alíquota única pode não refletir.** Nas notas do pedido `282O8JD`, R$ 237,60 saíram como NF-e de livro (com imunidade tributária) e R$ 59,40 como NFS-e de serviço. O sistema aplica 10% linear sobre o total. Se as duas parcelas têm tratamento diferente dentro do Simples, o número está aproximado. Confirmar com a contabilidade se vale modelar a divisão — os dados já permitem, bastaria uma coluna de proporção por oferta
- [ ] **Parcelamento é questão de caixa, não de margem.** Uma venda em 12x entra no lucro hoje e no caixa ao longo de um ano. Se houver antecipação, o custo dela é real e ainda não está modelado (existe a coluna `vendas.prejuizo_parcelamento`, sem uso). Vale um recorte de fluxo de caixa separado da Visão Geral
- [x] **`vw_faturamento_liquido` agrupa por dia em BRT.** Usava `date(data_venda)`, que converte no fuso do servidor (UTC) — era a última peça fora do fuso, e por isso investimento, impostos e custo fixo ainda herdavam o desvio. Também passou a excluir `LC-%`, que as páginas já excluíam. Verificado: view e `vendas` batem ao centavo (R$ 4.098,96 de faturamento, R$ 415,25 de taxa)
- [x] **`clientes` deduplicado.** 293 grupos de e-mail duplicado (312 linhas) impediam o índice único e deixavam `fn_resolver_cliente` sujeito a corrida. Os 8 grupos com `cpf_hash` divergente foram inspecionados um a um: os nomes são da mesma pessoa — o hash mudou de formato ao longo do tempo e não é identidade estável. O `cpf_hash` **não** é propagado do descartado para o sobrevivente; uma primeira tentativa colidiu com o índice único porque o hash de um descartado já pertencia a outro cliente fora do grupo. Resultado: 10.129 → 9.817 clientes, 13.011 vendas mantiveram o vínculo, zero referência órfã. Índice único parcial criado (16 clientes legítimos não têm e-mail)
- [ ] As vendas do import de 30/06 têm `data_venda` só com precisão de data (veio de coluna DATE), então ficam com intervalo zero entre si. A regra de upsell as ignora de propósito — não há como saber a ordem real dentro do dia
- [x] **Upsell detectado por sessão.** O trigger `fn_marcar_upsell` procurava `payload.type IN ('upsell','manual_upsell')`, mas o webhook só grava `type='order'` — nunca disparava; as 110 marcadas eram todas do import antigo. `cart_id` é único por venda e não liga ao pedido pai. Regra adotada: **compra seguinte do mesmo cliente em até 30 min, de produto diferente**, gravando `upsell_de`. Escolhida por ser posicional — o upsell muda de funil para funil e a cada teste, então amarrar a produtos cadastrados em `ofertas` exigiria remanutenção constante e quebraria a cada teste novo. "Produto diferente" exclui recompra e segunda tentativa de pagamento. Resultado: 26 upsells no período do webhook (R$ 1.378,71)
- [x] **`vendas.cliente_id` era nulo em todas as 3.936 vendas do webhook.** `trg_fn_cliente` só ATUALIZA `clientes` quando o id já existe, e nada o resolvia — a página de Clientes não enxergava ninguém do período. Novo `fn_resolver_cliente`. A tabela foi de 3.801 para 10.128 clientes
- [x] **`fn_processar_venda_payt`** envolve normalização + `produto_nome` + cliente + upsell, e é o que o trigger chama. Sem isso, `produto_nome` só existiria no backfill e voltaria a ficar nulo nas vendas novas
- [ ] Vendas de jan–abr não têm `ad_id_meta` (o import de 30/06 não trouxe), então aparecem 100% como back-end nesses meses
- [ ] 339 vendas (2,6%) sem `produto` — Incensos e "Vendas no Artesanato", categorização adiada por decisão
- [ ] Taxa da plataforma ausente nas ~2.500 vendas do import de 30/06 (payload vazio, sem `commission`)
- [ ] **Order bump vendido avulso aparece como produto.** "Biblioteca de 100 Assinaturas Aromáticas" está cadastrada em `ofertas` como `orderbump_1`, mas nessa venda foi a única coisa comprada — logo é o produto principal daquela transação. Fica correto como está; só vira problema se você quiser separar "receita de oferta de entrada" de "receita de complemento", o que exigiria decidir o que fazer quando o mesmo item é vendido dos dois jeitos
- [ ] `vw_reembolsos` continua existindo e agregando sem data. Nenhuma página da Visão Geral usa mais, mas convém checar se outra depende dela antes de removê-la

### Fase 0.2 — Sync Meta (auto-descoberta)
- [x] Migrations `meta_insights_raw`, `meta_sync_estado` (+ RLS), colunas `status_meta` / `moeda` / `descoberto_em` / `visto_em` em `ad_accounts`, índice único em `account_id`
- [x] Edge Function `meta-insights-sync` deployada (v2, JWT obrigatório, CORS para disparo manual)
- [x] Descoberta automática via `/me/adaccounts` — não mexe em `ativo`, `funil_id` nem `produto_payt`, que são configuração humana
- [x] Modos `hoje` (horário), `recente` (D-1..D-7, janela de atribuição), `backfill` e `descobrir`
- [x] Backoff exponencial nos erros 17/4/613 e 5xx; leitura do header `x-business-use-case-usage` gravada em `meta_sync_estado.uso_api_pct`
- [x] Falha isolada por conta — uma conta com problema não interrompe as outras
- [x] Verificado em produção: responde 503 com instrução enquanto o token não existe
- [x] System User Token com `ads_read` criado e cadastrado como `META_ACCESS_TOKEN`
- [x] **Inventário real: 14 contas em dois Business Managers.** A primeira descoberta (só BM Handify) trouxe 5 contas e me levou a concluir, erradamente, que as 10 cadastradas à mão não existiam mais. Com o token da segunda BM, **6 delas apareceram** — estavam lá o tempo todo, só invisíveis ao primeiro token. Duas haviam sido renomeadas e mantiveram histórico intacto justamente porque o casamento é por `account_id`: `act_1612067732932482` virou "Desafios na Sala - TSL" (era "04. Velas TSL") e `act_474062128831453` virou "Velas Perfeitas - RMKT" (era "01. Velas TSL"). Mais 3 contas novas apareceram (CA2, CA3, CA4). Restam 4 das originais sem aparecer — provavelmente numa terceira BM (Ravenna) ou encerradas
- [x] **Três Business Managers, 18 contas.** A comparação com a UTMify expôs o que faltava: ela mostrava R$ 2.938 de gasto no dia contra R$ 1.738 nossos. A terceira BM tinha a conta "Saponaria" (`act_2298547470659974`, antes "01. Saponaria - TSL | Ravenna") gastando R$ 1.210/dia — praticamente o gap exato. Ela reapareceu com as **1.573 linhas de histórico intactas**, de novo porque o casamento é por `account_id`. Também apareceu `Jabon - TSL`, que nunca esteve no banco. Só `Hormonal - Principal` segue sem aparecer em nenhuma das três
- [x] Backfill completo: **9.756 linhas, 112 dias, 10 contas com gasto**. Feito quinzena a quinzena — com 18 contas × 3 níveis, mesmo um mês inteiro estoura o limite de tempo da invocação (504). O cron diário não sofre disso porque processa só 7 dias
- [x] Conferido contra a UTMify: gasto do dia fecha com 1% de diferença, explicada pelo acúmulo entre as duas leituras
- [x] Backfill de 20/05 a hoje: **3.926 linhas novas**, 94 dias cobertos. Uso da API no pico: **4%**
- [x] `pg_cron` agendado — `meta-sync-horario` (`0 * * * *`, dia corrente) e `meta-sync-diario` (`20 5 * * *`, D-1..D-7)
- [x] **Bug corrigido: contagem de conversões inflada 8×.** A Meta devolve a mesma compra sob 8 `action_type` diferentes (`purchase`, `omni_purchase`, `offsite_conversion.fb_pixel_purchase`…), todos com valor idêntico. Somar por "contém purchase" dava 224 compras onde havia 28. Mesmo problema em `initiate_checkout` (5 rótulos). Trocado por busca exata com lista de prioridade
- [x] **Bug corrigido: `numeric field overflow`.** As colunas de taxa eram `numeric(8,6)` — máximo 99.999999, ou seja nem 100% cabia. `taxa_video_compra` chega a 320%. Alargadas para `numeric(12,6)`; clampar teria destruído o dado
- [x] **`metricas_meta.produto` herda de `ad_accounts` por trigger.** Sem isso o investimento não chegava ao dashboard: `vw_faturamento_liquido` casa métricas com vendas por `(data, produto)`, e com produto nulo o join não acontecia
- [x] Verificado na Visão Geral: investimento R$ 1.531,60, ROAS 3,06x, CPA R$ 34,81 — antes os três estavam zerados ou em "—". A margem caiu de 81% para 47%, que é a margem real com tráfego contabilizado

- [x] **Múltiplos Business Managers.** Um token por BM em secrets separados (`META_ACCESS_TOKEN`, `META_ACCESS_TOKEN_2`…), e `ad_accounts.origem_token` guarda qual credencial descobriu cada conta. Escolhido em vez de compartilhar ativos entre BMs para que problema em uma não derrube a outra — mesma lógica de isolamento que aplicamos ao criar o app
- [x] Cron `processar_windsor_staging` removido (rodava diariamente sobre dados estáticos desde 23/07). As tabelas ficam, pelo histórico

**Pendências da Fase 0.2:**
- [ ] `ad_accounts.funil_id` continua nulo nas 5 contas novas — bloqueia o seletor de CA e a atribuição de venda a funil (Fase 0.3)
- [ ] O cron `processar_windsor_staging` (`0 4 * * *`) ainda roda diariamente sobre `windsor_meta_staging`, que está estático desde 23/07. Não conflita com o sync novo (as contas antigas têm outros UUIDs, então a chave única difere), mas é job morto
- [x] `RMKT Saponaria - TSL` corrigida de `cosmeticos` para `saponaria` (resquício do cadastro manual)
- [ ] `Jabon - TSL`, `CA2`, `CA3` e `CA4` seguem sem produto. Nenhuma teve gasto no período, então classificar agora seria adivinhar sem dado para conferir
- [ ] **Uma conta pode trocar de produto ao longo do tempo, e o modelo atual não expressa isso.** `Desafios na Sala - TSL` rodou Velas Perfeitas de maio a julho (R$ 18.131) e foi reaproveitada em 18/08 para o Workshop Desafios na Sala de Aula (R$ 608, campanha "TESTE - 18/08/26"). Como `produto` é um campo único na conta, qualquer valor escolhido erra um dos dois períodos. `metricas_meta.produto` é por linha e comporta o corte por data, mas falta decidir a categoria do produto novo — ele não é velas nem saponária, é outro vertical (professores). O caminho definitivo é abandonar o join por produto e casar gasto com receita via `ad_id_meta`, que é por venda e não depende de configuração
- [ ] `Jabon - TSL` sugere operação em espanhol. Se vender por outra plataforma ou outra conta Payt, a receita correspondente não está no dashboard e o ROAS dessa conta ficará distorcido

### Fase 0.3 — Funis e atribuição
- [ ] Arquivar os 22 funis antigos; criar estrutura nova sobre as CAs reais
- [ ] Vincular `ad_accounts.funil_id`
- [ ] UPDATE retroativo: `vendas.funil_id` via `ad_id_meta` → CA → funil
- [ ] Migration `dashboard_benchmarks` (+ RLS)
- [ ] Corrigir webhook: ler `funil_id` do path da URL
- [ ] Corrigir template de link que corrompe `utm_source`

### Fase 1 — Resumo (parcial)
- [x] Tabs Tráfego / Back-end / Misto, segmentadas por `ad_id_meta`
- [x] Todas as queries de `vendas` respeitam o segmento (KPIs, OBs, upsells, não-aprovadas, produtos)
- [x] Faturamento passa a ser calculado de `vendas` e não da view — garante Misto = Tráfego + Back-end
- [x] Taxas, impostos e custo fixo rateados pela participação do segmento; investimento em ads fica 100% no tráfego
- [x] Card "Vendas Backend" corrigido: usava `utm_source is null`, agora usa `ad_id_meta`
- [x] Gráfico de faturamento por dia (dia calculado em BRT)
- [x] CPA adicionado; ROAS e CPA mostram "—" enquanto não houver gasto de ads
- [ ] **Seletor de CA na toolbar** — bloqueado pela Fase 0.2 (precisa do Meta para resolver `ad_id` → CA)

Validação (01–20/08): Tráfego 600 vendas / R$ 55.112,53 · Back-end 660 / R$ 59.440,35 · Misto 1.260 / R$ 114.552,88 — fecha exato.

### Fase 2 — Tendências
- [ ] Rota `/tendencias` + sidebar
- [ ] Modo grade (Geral) com sparklines
- [ ] Modo detalhado (funil) com grupos de métricas
- [ ] Média móvel 7d + comparação de período
- [ ] Configuração de benchmarks

### Fora do plano — corrigido no caminho
- [x] **Copytrack:** as 6 tabelas `copytrack_*` tinham `id uuid NOT NULL` sem `DEFAULT gen_random_uuid()`, então qualquer insert falhava com not-null violation ("Erro ao salvar")
- [x] **Copytrack — histórico de anúncios:** `copytrack_offer_tracking` já existia com `tracked_date` e `active_ads_count`, e a tabela era exibida, mas não havia como **adicionar** registros. Novo `OfferTracking.tsx` com formulário inline (data, quantidade, notas), registros ilimitados, coluna de variação entre dias e exclusão com confirmação. `day_number` é calculado a partir da data mais antiga, então lançar um dia fora de ordem não quebra a sequência

### Fase 3 — Refinamentos
- [ ] Config de `utm_sources_pagos` via UI admin
- [ ] Alerta persistente para métrica crítica por N dias
- [ ] Export de relatório

---

## Dependências e riscos

| Item | Risco | Mitigação |
|---|---|---|
| Conversão de página/checkout | Não há registro de visitantes no banco | O Meta fornece `visualizacoes_pagina` e `initiate_checkout` — usar como proxy. Conversão real da página exige pixel/GA, fora do escopo V1 |
| `ad_accounts.funil_id` | Pode estar incompleto (10 CAs cadastradas) | Auditar antes de construir o filtro de CA |
| Token Meta | Revogação derruba o sync | System User Token + heartbeat em `ingest_health` alerta em < 25h |
| LTV estimado | Exige histórico de recompra | Só calcular com N mínimo; senão "dados insuficientes" |
| Lacuna 19/05–hoje | 3 meses sem vendas gravadas | Verificar se a Payt permite replay/export do período para backfill |

### Visão Geral passa a agregar no banco

- [x] **A página somava as linhas no JavaScript e o PostgREST cortava em 1.000 sem avisar.** Era o defeito por trás de *"o faturamento já passou dos 120mil e aqui no dash nem chega a isso"*: 200 OK com mil linhas, soma truncada para menos, nenhum sinal de erro. Os últimos 30 dias têm 1.959 vendas aprovadas — quase o dobro do teto. Agora uma chamada a `fn_overview()` devolve tudo agregado
- [x] **A view `vw_faturamento_liquido` não tem coluna `funil_id`, e a página filtrava por ela.** Com um funil selecionado o PostgREST devolvia erro, a página ignorava, e imposto, reembolso, investimento e custo fixo viravam zero em silêncio. O bloco fiscal passou para dentro da `fn_overview()`, com o rateio por `fat_bruto_total`
- [x] **Falha de leitura agora aparece como falha.** Antes, erro na busca deixava a tela com zeros — com a mesma cara de um período sem vendas. Zero e "não consegui ler" são coisas diferentes, e confundi-los é a raiz de metade dos defeitos deste dashboard
- [x] Conferido contra o banco nos últimos 30 dias: 1.959 vendas, R$ 184.273,43 pago, R$ 4.047,65 de juros, R$ 180.225,78 de receita, R$ 10.966,44 de taxa e R$ 105.697,88 de investimento — os seis números batem exatamente
- [x] `OverviewPage` caiu de 998 para 875 linhas; a maior parte do que saiu era montagem de query

**O segmento Tráfego revela o custo da atribuição quebrada:** ele carrega 100% do investimento mas só 48% da receita, então aparece com margem negativa. Não é erro de cálculo — é o buraco de UTM aparecendo com preço. Enquanto 53% da receita não tiver `ad_id`, o ROAS por segmento não é confiável

### Testes nas fórmulas financeiras

- [x] **`src/lib/financeiro.ts`** — as contas que decidem se o negócio dá lucro saíram de dentro do `fetchData`, onde estavam misturadas com montagem de query e por isso não tinham como ser testadas. Viraram funções puras: recebem números e devolvem números, sem conhecer Supabase, período nem segmento
- [x] **23 testes**, cobrindo a cascata do pago ao lucro, o rateio do custo fixo, a participação do recorte no total, ticket/ROAS/CPA e a taxa da plataforma. Divisor zero devolve zero em vez de `NaN` — um `NaN` que escapa some no `formatCurrency`, e sumir é pior que aparecer errado
- [x] **Bloco de regressão com agosto/2026 real**, ancorado no retrato conciliado com o export da Payt. Se uma fórmula mudar de sentido, esses valores param de fechar
- [x] **Verificados por mutação**, porque teste que passa por construção não vale nada. Quatro defeitos plantados de propósito, todos pegos: esquecer os reembolsos na cascata (2 falhas), deixar a divisão por zero virar `Infinity` (3), tirar o teto de 1 da participação (1), ratear o mês por 31 dias (4)
- [x] A página passou a **usar** as funções — teste que protege código que ninguém chama não protege nada. Conferido no navegador: os dez números da tela ficaram idênticos aos de antes da extração

**Nota sobre o `tsc`:** ele passou limpo com um `const dias` declarado duas vezes no mesmo escopo, que o navegador pegou na hora como `SyntaxError`. Typecheck verde não substitui abrir a tela.

- [ ] O custo fixo no filtro "Todos" continua assumindo um mês cheio. É aproximação ruim — todo o histórico custaria vários meses — mas foi preservada para não mudar número sem aviso

### Filtro por CA (Parte 1) — a conta de anúncio vira a dimensão de recorte

- [x] **O item "popular `ad_accounts.funil_id`" estava mal formulado.** Investigando antes de executar: a tabela `funis` tem 22 linhas, **todas inativas**, com nomes repetidos (`REV1 - Original` ×4, `REV2` ×3) e a maioria sem produto. E `vendas.funil_id` é nulo em **100% das 13.107 linhas**. Popular o `funil_id` das contas apontaria para lixo
- [x] **O seletor de funil zerava a tela em sete páginas, não só na Visão Geral.** Toda página fazia `.eq("funil_id", funilId)` contra uma coluna sempre nula. Nas páginas de anúncio era pior: `vw_metricas_meta_nivel.funil_id` é nulo nas 9.756 linhas, então Meta Ads, Análise de Anúncios e Funil também zeravam
- [x] **A CA passa a ser a dimensão**, que é o que o pedido original dizia — *"isolamos por CA cada funil"* e *"quero um filtro por CA na parte 1"*. A indireção pela tabela `funis` era invenção do código
- [x] **`vendas.ad_account_id`**, resolvido por `ad_id_meta` → `metricas_meta(nivel='ad')`. Medido antes de escolher o caminho: 2.233 das 2.274 vendas aprovadas com ad_id resolvem (**98,2%**) e **nenhum ad_id aparece em duas contas**
- [x] **Trigger de statement em `metricas_meta`** preenche as vendas que chegaram antes do anúncio ser conhecido — o webhook entrega na hora e o Meta sincroniza de hora em hora, então uma venda das 10h05 de um anúncio novo só resolveria às 11h
- [x] **`fn_overview(p_conta)`**: com conta selecionada, o investimento sai de `metricas_meta` daquela conta em vez do total rateado. Sem isso o recorte mostraria a receita de uma conta contra o gasto de todas
- [x] `contaId` substitui `funilId` no `FilterContext`; a sidebar lista `ad_accounts` ativas e vistas pelo token
- [x] Conferido na tela contra o banco: Saponaria Brasil - TSL em 20/08 dá 7 vendas, R$ 713,66 de receita, R$ 955,86 de investimento e ROAS 0,75 nos dois

**ROAS por CA em agosto (01–20), que a Parte 2 vai usar como base:**

| Conta | Vendas | Receita | Investimento | ROAS |
|---|---|---|---|---|
| Saponaria Brasil - TSL | 269 | R$ 25.803,76 | R$ 22.933,06 | 1,13 |
| Lembrancinha - TSL | 167 | R$ 18.897,66 | R$ 11.089,40 | 1,70 |
| Workshop Buquê - TSL | 164 | R$ 9.635,01 | R$ 7.313,95 | 1,32 |
| Worshop Buquê - SO | 9 | R$ 959,71 | R$ 832,57 | 1,15 |
| Desafios na Sala - TSL | 1 | R$ 297,00 | R$ 608,68 | 0,49 |

- [ ] **A tabela `funis` continua no banco**, agora sem uso pelo filtro. A feature `/funis-gestao` tem `funilId` próprio e não foi tocada. Decidir depois se a tabela é aposentada
- [ ] Só 5 das 15 contas ativas têm venda atribuída no período. Vale checar se as outras gastam sem retorno rastreável ou se é o mesmo buraco de UTM

### O recorte por CA vira filtro no cabeçalho

- [x] **Saiu da sidebar, entrou ao lado do período.** Listar as quinze contas como "dashboards" transformava a escolha em garimpo, e conceitualmente estava errado: é um recorte da mesma visão, não uma visão diferente — o mesmo lugar onde mora o período
- [x] **Só oferece conta com gasto no período escolhido** (`fn_contas_com_gasto`). Num dia típico são cinco, não quinze. O investimento aparece ao lado do nome, então dá para ver a escala sem entrar na conta
- [x] Trocar o período pode deixar a conta escolhida sem gasto nenhum; nesse caso volta para "Todas" em vez de manter um recorte que resulta em tela vazia
- [x] A sidebar voltou a ter só "Geral", e o `handleDateSelect` deixou de usar `any` — o tipo agora sai do próprio `DATE_OPTIONS`

### A conta que parecia um buraco sem fundo

O primeiro uso do filtro achou o caso: **"Saponaria" gastou R$ 29.937,87 em agosto com zero vendas atribuídas.** Investigando em vez de aceitar:

| Conta | Gasto | Meta reporta | No banco |
|---|---|---|---|
| **Saponaria** | R$ 29.937,87 | **629 compras** | **0** |
| Saponaria Brasil - TSL | R$ 22.933,06 | 451 | 269 |
| Lembrancinha - TSL | R$ 11.089,40 | 169 | 167 |
| Workshop Buquê - TSL | R$ 7.313,95 | 171 | 164 |
| Worshop Buquê - SO | R$ 832,57 | 9 | 9 |
| **Saponaria Brasil - VSL** | R$ 829,53 | **8** | **0** |
| Desafios na Sala - TSL | R$ 608,68 | 1 | 1 |

A conta tem 48 anúncios conhecidos e o Meta reporta 629 compras. O que falta não é venda — é UTM. O checkout **"Saponaria Brasil - Desconto de Aula"** fez 550 vendas e R$ 48.042,40 no período com **0,0% de `ad_id`**, enquanto todo outro link rastreia de 92% a 100%.

Atribuindo essas vendas à conta, o ROAS dela seria **1,60** — acima da média da casa. O dashboard estava prestes a apresentar a campanha que mais vende como a que só queima dinheiro.

- [x] **Alerta `conta_sem_venda`** criado a partir do caso: conta que gasta, o Meta reporta compra, e nada chega atribuído. Já dispara nomeando "Saponaria"
- [ ] **Configurar a UTM do checkout "Saponaria Brasil - Desconto de Aula"** — ação no painel da Payt. É a correção de maior valor pendente: destrava R$ 48 mil de atribuição e o ROAS de duas contas

### Correção retroativa do "Desconto de Aula"

UTM configurada no checkout (ação no painel da Payt). O ajuste do histórico foi feito
em duas partes, com escopos diferentes porque a evidência sustenta uma e não a outra.

**1. Segmento — todas as 1.219 vendas.** Nova coluna `vendas.trafego_pago` marca venda
que se sabe vir de anúncio mesmo sem `ad_id`. Antes elas caíam em back-end, e o
segmento Tráfego aparecia deficitário por carregar 100% do investimento contra metade
da receita que de fato gerou.

| Segmento Tráfego, agosto | Antes | Depois |
|---|---|---|
| Vendas | 969 | **1.176** |
| Receita | R$ 87.340,15 | **R$ 104.985,02** |
| ROAS | 0,83 | **1,43** |
| Margem operacional | −44,79% | **+6,20%** |

**2. Conta — só as 938 de julho em diante.** O mês a mês delimita onde a atribuição
se sustenta:

| Mês | Vendas no link | Rastreadas "Saponaria" | Rastreadas "Brasil-TSL" | Meta reporta |
|---|---|---|---|---|
| 05/26 | 119 | 97 | 0 | 791 |
| 06/26 | 162 | 172 | 16 | 457 |
| 07/26 | 388 | **1** | 262 | 471 |
| 08/26 | 550 | **0** | 269 | 629 |

Em maio e junho a conta era rastreada normalmente — os anúncios dela levavam UTM.
De julho em diante ela zera enquanto o link dispara: foi quando a parametrização
quebrou. Maio e junho ficam como tráfego pago sem conta, porque naqueles meses a
conta tinha vendas rastreadas próprias e não dá para dizer que as do link também eram.

Resultado: **conta Saponaria em agosto passa de 0 vendas e ROAS indefinido para 550
vendas, R$ 48.042,40 e ROAS 1,60** — de suposto buraco sem fundo a uma das melhores.

**O que não foi feito, deliberadamente:** ratear as vendas de maio–junho entre as
contas por participação no gasto. As duas contas Saponaria gastaram todos os dias do
período, e os links irmãos com rastreio aparecem servidos pelas duas — não existe dia
em que só uma rodou. Ratear ali seria modelagem vestida de dado, que é o defeito que
este projeto passou o dia corrigindo.

- [ ] Confirmar, na primeira venda pós-correção, que o `ad_id` passou a chegar. Se
      chegar, `trafego_pago` fica só como marca histórica e a UTM resolve na origem

### Os três alertas que restavam, conferidos um a um

**1. "55% da receita sem atribuição" — não estava resolvido, e o alerta media a coisa
errada.** Dos R$ 21.062,32, R$ 17.176,80 (81,5%) eram as 201 vendas históricas do
"Desconto de Aula", já marcadas como `trafego_pago`. O `ad_id` delas nunca vai
existir. E o texto virou mentira depois da correção: o checkout **tem** UTM agora.

Alerta que aponta para o que não se pode consertar treina quem lê a ignorá-lo, e aí
falha quando o próximo checkout quebrar de verdade. Passou a medir receita de **origem
desconhecida** — exclui `trafego_pago`. Caiu de **54,8% para 10,1%** (R$ 3.885,52 em
7 dias), abaixo do limiar, e o alerta silenciou. O que sobra é back-end legítimo
(suporte, recuperação, vitrine de alunas) mais a fuga normal de rastreio dos links de
tráfego, que já rastreiam de 92% a 100%.

**2. Venda sem produto — cadastrada.** Era `282O8JD`, R$ 297,00, "Workshop Desafios na
Sala de Aula", code Payt `L9Q6EN`, que não existia em `ofertas`. Registrada com
produto `velas` — o mesmo da conta "Desafios na Sala - TSL" e do "Curso Velas
Perfeitas 2.0" que a conta vendia antes. Alerta limpo.

**3. "Métricas do Meta sem atualizar" — estava correto, e a causa era minha.**
O cron `meta-sync-horario` chamava `net.http_post()`, mas a extensão `pg_net` nunca
foi instalada neste projeto. Criei o job sem verificar isso. Falhava de hora em hora
com `schema "net" does not exist`.

Instalada a extensão, o sync rodou e gravou métricas de 21/08. E apareceu um segundo
job quebrado pelo mesmo motivo, que ninguém sabia: **`cs-sync-daily`** — o extrato da
Conta Simples, do módulo Financeiro — falhando **desde pelo menos 18/08**.

- [x] **Alerta `cron_falhando`**, nascido daí. Olha a **última** execução de cada job
      ativo, não a janela inteira: um job que falhou e se recuperou não deve continuar
      gritando. Já acusa os dois
- [ ] Conferir na próxima execução (01:00 e 10:00) que os dois voltaram sozinhos

A lição que fica: eu montei um agendamento e não verifiquei que ele funcionava. Foi o
alerta `fonte_parada` — escrito horas antes, para outro caso — que pegou. Um sistema
que se acusa pega até o erro de quem o construiu.

### Tela de Ofertas Payt — e a revisão do que ela vale

Construída em Configurações → Ofertas Payt: lista as 54 ofertas, destaca as 10 sem
produto, permite editar produto/tipo e criar oferta nova. A tabela `ofertas` não tinha
tela nenhuma — as duas telas que dizem "ofertas" no menu apontam para outras tabelas
(`ofertas_editores` e `copytrack_offers`). Também faltava política de escrita: a
tabela tinha RLS ativa e só `SELECT`, então a tela salvaria em silêncio.

**Mas a usuária questionou o propósito, e ela estava certa.** Medindo em vez de
defender:

| Onde `produto` poderia importar | Depende dele? |
|---|---|
| Aba **Produtos** da Visão Geral | **Não** — agrupa por `produto_nome`, o nome real da Payt |
| Join gasto de anúncio ↔ receita | Sim, mas pelo lado da **conta**, que já tem tela própria |
| Aba "Por Produto" da página de Vendas | Sim — sem categoria cai em "Outros" |

E o join do gasto foi testado: R$ 73.545,06 no Meta contra R$ 73.545,06 chegando na
conta do lucro, **diferença de R$ 0,00**. Nada estava sendo perdido.

`tipo` vale ainda menos: o webhook manda os order bumps, e o cadastro só serve para
numerá-los de 1 a 4. Sem ele cai em `orderbump_1`, o que já acontece com 227 itens.

- [x] **O alerta que motivou a tela estava com o texto errado.** Dizia que a venda sem
      produto "fica de fora do recorte por produto" — não fica. A aba Produtos tem 12
      linhas e a venda sem categoria é uma delas, com o nome certo e a etiqueta em
      branco. Renomeado para `venda_sem_categoria`, com o efeito real descrito

A lição vale mais que a tela: **alerta que exagera a consequência faz pedir solução
maior que o problema.** O texto errado custou uma tela que resolve algo cosmético.

**Removida a pedido da usuária**, e o motivo é bom: *"se a tela não serve para nada
prefiro remover, para não ter ruído de informação"*. Menu com item que não resolve
nada cobra atenção toda vez que alguém procura outra coisa.

Duas pontas soltas fechadas junto:
- O alerta `venda_sem_categoria` mandava "cadastre em Configurações → Ofertas Payt".
  Alerta que aponta para tela inexistente é pior que alerta nenhum — passou a descrever
  só o efeito
- A política `authenticated_write` em `ofertas`, criada para a tela, foi revogada. Sem
  tela, nada no cliente escreve nessa tabela; a normalização roda como `service_role`,
  que tem política própria. Permissão aberta sem consumidor é superfície à toa

O que ficou do episódio: o texto errado do alerta (corrigido), a oferta `L9Q6EN`
cadastrada, e a descoberta de que `ofertas` não tinha política de escrita — que teria
mordido qualquer tela futura apontada para ela.

### Etiqueta de categoria removida da aba Produtos

A usuária estranhou as etiquetas ("Curso Saponaria Brasil · Saponaria") depois de a
tela de Ofertas sair, achando que sumiriam junto. Não sumiriam: a tela editava o campo,
não o criava — `produto` é preenchido sozinho quando a venda chega, casando o código do
produto contra a tabela `ofertas`.

Medido se valia a pena manter, em agosto:

| Veredito | Linhas | Vendas |
|---|---|---|
| Redundante — o nome já diz | 5 | **1.298** |
| Acrescenta informação | 6 | 10 |
| Sem categoria | 1 | 1 |

**Redundante em 99,2% do volume.** Ocupava espaço em toda linha para informar em 0,8%
dos casos. Removida da Visão Geral; o campo continua existindo e segue útil no
agrupamento "Por Produto" da página de Vendas, onde não há nome de produto ao lado
para tornar a categoria óbvia.

### Coluna de % na cascata — e dois defeitos que ela desenterrou

- [x] **Coluna "% da receita" em "Do pago ao lucro".** A base é a receita, não o pago
      pelo cliente: é dela que tudo é descontado e é ela que a margem usa, então a
      última linha da coluna fecha exatamente com a margem do topo da página. "Pago
      pelos clientes" aparece acima de 100% — na medida exata do juro que o cliente
      paga à adquirente

**Defeito 1: reembolso e chargeback apareciam zerados.** A aba Perdas mostrava
R$ 0,00 com contagem 1 e 2, enquanto a cascata, na mesma tela, mostrava R$ 594,00.
Duas regras para o mesmo conceito:

| Fonte | Regra | Resultado |
|---|---|---|
| `fn_overview` | `coalesce(valor_reembolsado, valor_total)` | R$ 0,00 |
| `vw_faturamento_liquido` | sempre `valor_total` | R$ 594,00 |

As duas erradas, por motivos diferentes. O `coalesce` supunha que nulo significa "não
sei", mas a coluna tem default 0 e nunca é preenchida — **72 dos 72 reembolsos e 8 dos
12 chargebacks estão zerados**, então ele devolvia zero e a perda sumia. Já usar sempre
`valor_total` subestima o chargeback: nos 4 casos em que o campo está preenchido, dois
passam do valor da venda (R$ 116,60 sobre R$ 97,00) porque a adquirente cobra multa
além do estorno.

- [x] **`fn_perda_da_venda()`** — uma regra só, usada pelas duas fontes: valor estornado
      quando existe de fato, valor da venda quando está zerado. Agora Perdas soma
      R$ 297 + R$ 297 e fecha com os R$ 594 da cascata

**Defeito 2: "(sem link identificado)" com 46 vendas e R$ 10.220,70.** Eram os upsells.
O upsell acontece depois do checkout, então não tem página própria e nunca terá link
nem UTM — mas apareciam numa tabela de "receita por link" com selo vermelho de 0%
rastreado, ao lado de checkouts com UTM de fato quebrada. Linha permanente que ninguém
pode consertar ensina a ignorar o vermelho.

- [x] `por_link` passa a excluir upsell, como `por_produto` já fazia

As duas migrações trocaram a expressão por substituição no DDL existente, com
`RAISE EXCEPTION` se o trecho não for encontrado — reescrever à mão uma view e uma
função longas só para mudar uma expressão é convite a erro de digitação.

### Reembolso, cancelamento e a receita que não foi perdida

A usuária desconfiou dos números de reembolso e chargeback. Conferido contra o export
da Payt, e ela estava certa: **o export registra 14 estornos, o banco mostrava 1.**

**Causa: usávamos o campo errado.** O payload traz dois status, e eles discordam:

| `status` (topo) | `transaction.payment_status` | Qtd | O que é de fato |
|---|---|---|---|
| canceled | **refunded** | 32 | reembolso contado como cancelamento |
| canceled | **refused** | 311 | cartão recusado |
| canceled | **expired** | 375 | expirou, não foi cancelado |

Reembolso e cancelamento são sinais de negócio opostos — um é quem pagou e pediu o
dinheiro de volta, o outro é quem nunca pagou. A normalização passou a preferir
`payment_status`, com `status` de fallback para os registros de importação antigos.

**Segunda causa, pior: o estorno destruía o valor da venda.** O evento de reembolso
chega com `total_price: 0` — a Payt zera o preço ao estornar — e o upsert sobrescrevia
a venda boa que já estava gravada. Agora o valor cai para `price_without_installments`,
depois para o preço do produto, e o `ON CONFLICT` nunca troca um valor bom por zero.

Resultado, contra o export de 01–20/08:

| | Export | Banco (antes) | Banco (depois) |
|---|---|---|---|
| Reembolsos | 14 · R$ 1.294,07 | 1 · R$ 297,00 | **14 · R$ 1.313,80** |
| Chargebacks | 2 · R$ 399,96 | 2 · R$ 297,00 | **2 · R$ 399,96** |

Contagem exata nos dois. Sobram R$ 19,73 (1,5%) nos reembolsos: em 6 vendas só o preço
de tabela sobreviveu (R$ 67,00 contra os R$ 66,33 pagos com desconto), porque o valor
exato foi destruído antes de existir o `payt_webhook_raw`. Daqui pra frente não
acontece: todo evento fica guardado.

### Nem toda não aprovada é receita perdida

Observação da usuária: *"talvez esteja contabilizando vendas pendentes de pessoas que
geraram um novo pix ou tentaram novamente e pagaram no final"*. Medido — **132 das 458
não aprovadas (R$ 15.857,34, quase um terço) são de cliente que comprou o mesmo produto
em até 7 dias.**

- [x] `fn_overview` devolve `recuperadas`, e o card "Não aprovadas" mostra quanto
      voltou como venda. Sem isso o número sugeria um buraco de checkout um terço maior
      do que existe

### O reembolso estava sendo contado duas vezes

Pergunta da usuária ao ver o lucro cair: *"não estava baseando em vendas aprovadas?"*.
Estava — e é justamente por isso que a dedução estava errada.

Verificado: das 16 vendas estornadas de agosto, **zero está dentro da receita**. A
receita soma só `status = 'aprovada'`, e a venda estornada perde esse status no momento
do estorno. Ela já saiu. Descontar "Reembolsos" da receita contava a mesma perda de
novo.

O defeito era antigo e passava despercebido porque o valor era pequeno (R$ 594). Ficou
visível quando a classificação de reembolso foi corrigida e o número saltou para
R$ 1.713,76 — a usuária estranhou a queda do lucro e puxou o fio.

- [x] `reembolsos` saiu de `calcularResultado` e da cascata. O número continua na aba
      Perdas, onde informa sem distorcer
- [x] Teste novo guarda o raciocínio: compara um mês com e sem estorno e verifica que a
      diferença no lucro é exatamente o que saiu da receita, uma vez só
- [x] Bloco de regressão recalculado

**Consequência do modelo, registrada porque não é óbvia:** um estorno reduz
retroativamente a receita do mês em que a venda aconteceu, não do mês em que foi
estornada. É o mesmo critério do export da Payt, contra o qual estes números são
conciliados — então as duas fontes continuam batendo.

Os dois testes que falharam na primeira tentativa eram erro de aritmética meu nas
expectativas, não no código. Foi para isso que eles foram escritos.

### O upsell revelado, e a correção do que eu diagnostiquei errado

A usuária notou vendas de back-end na tabela "Conversão de upsells". Estava certa: dos
51 marcados em agosto, **46 eram upsell de verdade e 5 eram falso positivo da minha
heurística** — Velaroma Artesanal, Kit Natal, Guia das Velas, Arte Floral e um Handify,
todos segunda compra por checkout normal.

Investigando, o `payt_webhook_raw` — criado ontem — já tinha capturado o primeiro
evento de upsell da história, e ele **desmente o diagnóstico que eu registrei**:

| id | `type` | `status` | O que aconteceu |
|---|---|---|---|
| 8 | **upsell** | waiting_payment | descartado pelo filtro `type !== 'order'`, com **200** |
| 10 | order | **lost_cart** | sem `transaction_id` → **400** |

Ou seja, eram **duas causas diferentes**, e eu atribuí os 400 ao upsell. Os 400 eram
carrinho abandonado. O upsell sumia em silêncio, com 200 — que é pior, porque nem
aparecia nos logs de erro.

O payload de upsell traz `type: "upsell"`, `upsell_code`, `transaction_id` no topo e
até `link` com UTM completa.

- [x] **Webhook v26**: aceita `type: 'upsell'`, ignora `lost_cart` explicitamente, e
      grava `tipo_venda` a partir de `type`/`upsell_code`
- [x] **Heurística de sessão aposentada.** Vira no-op em vez de ser apagada, porque
      `fn_processar_venda_payt` a chama e removê-la quebraria o processamento
- [x] Histórico realinhado: só é upsell o que a Payt chamou de upsell. A tabela agora
      mostra os 3 produtos reais, 46 conversões
- [x] Valor no webhook ganhou a mesma cascata de recuperação da normalização, porque a
      Payt zera `total_price` no estorno

### Duas colunas de percentual, e o card de não aprovadas legível

- [x] **`% vendas` e `% fat.`** nas tabelas de order bump e upsell. Respondem a
      perguntas diferentes: a primeira mede o poder de conversão da oferta, a segunda o
      quanto ela move o resultado. Um item pode converter pouco e pesar muito
- [x] **Card "Não aprovadas" refeito.** O número grande passou a ser o que de fato
      ficou pelo caminho — total menos o recuperado — com o percentual do faturamento
      ao lado. Era isso que confundia: o bruto parecia receita perdida e um terço dele
      não era. Layout em duas colunas em vez de quatro, porque o card divide a largura
      com outros dois e sobram ~250px

### Um PIX a mais não é uma oportunidade a mais

Pergunta da usuária: *"está considerando 1 tentativa por produto? pois normalmente a
galera gera mais de um pix de uma vez"*. Estava — e inflava o número. Medido em 01–21/08:

| | Contando tentativas | Contando pessoa+produto |
|---|---|---|
| Registros | 455 | **385** |
| Valor | R$ 51.663,56 | **R$ 43.244,16** |
| Inflação | — | **R$ 7.661,34 (14,8%)** |

53 combinações tinham tentativa repetida. Se alguém gera três PIX de R$ 67 e não paga
nenhum, a oportunidade perdida é R$ 67, não R$ 201.

- [x] `nao_aprovadas` e `recuperadas` passam a deduplicar por pessoa+produto, ficando
      com a tentativa mais recente — o estado final daquela intenção de compra. Quem
      não tem `cliente_id` cai no `pedido_id`, que é único: sem identificação não há
      como agrupar, e supor que são a mesma pessoa seria pior que contar duas vezes

### O "Desconto de Aula" continua sem UTM, e o motivo não é o checkout

A usuária configurou e na Utmify aparece certo, mas para nós não. Comparando os eventos
crus de hoje:

| Link | `link.sources` | Com UTM |
|---|---|---|
| **Saponaria Brasil - Desconto de Aula** | array vazio | **0 de 56** |
| Fábrica das Velas — Vitalício | objeto | 11 de 11 |
| Saponaria Brasil Rev5 | objeto | 8 de 8 |
| **Assinatura** | **os dois** | **2 de 4** |

O "Assinatura" aparecendo das duas formas é o que resolve: **não é configuração do
checkout, é como o visitante chega nele.** Quando a pessoa entra na URL do checkout já
com os parâmetros, a Payt registra em `link.sources`; quando entra sem, vem `[]`.

A Utmify enxerga porque rastreia por script no navegador, independente da URL do
checkout — por isso as duas fontes discordam sem que nenhuma esteja quebrada.

- [ ] **O que falta é no botão da VSL que leva ao checkout**, não no checkout. Ele
      precisa repassar a query string, com `utm_content` no formato
      `Nome do Ad|{{ad.id}}` — é dele que o `ad_id` é extraído

### Remendo de UTM com prazo de validade

A usuária confirmou que faltava a UTM no botão e pediu para marcar como tráfego tudo
que já foi vendido pelo "Desconto de Aula".

- [x] `links_trafego_sem_utm` — tabela de uma linha só, com o motivo escrito. **Não é a
      taxonomia de links descartada antes**: aquela classificava todo checkout por
      natureza e envelhecia mal. Esta tem propósito único e prazo de validade
- [x] Trigger marca `trafego_pago` sozinho enquanto a venda chegar sem `ad_id`. Quando
      a UTM voltar, a regra fica inócua por si só, porque só se aplica na ausência dele
- [x] 1.236 vendas do link marcadas, zero faltando
- [x] **Alerta `remendo_utm_resolvido`** avisa quando o link voltar a rastrear, dizendo
      que a linha pode sair da tabela. Remendo sem data de saída vira permanente e
      ninguém lembra por que existe

### O `utm_source` não estava corrompido

Investigando uma venda que a Utmify atribuía ao `chatgpt.com`, o campo que eu havia
chamado de corrompido (`FBjLj6a8778719fca...`) revelou-se **origem colada num token**:

| Origem | Vendas | Receita | Desde |
|---|---|---|---|
| FB | 2.276 | R$ 181.268,77 | 20/05 |
| whatsapp | 117 | R$ 8.009,22 | 21/05 |
| area-membros-handify | 71 | R$ 2.653,77 | 21/05 |
| instagram | 62 | R$ 4.886,36 | 22/05 |
| site-handify | 17 | R$ 2.027,79 | 17/06 |
| organic | 10 | R$ 659,08 | 26/05 |
| **chatgpt.com** | **3** | **R$ 287,21** | **12/08** |

Basta remover o sufixo `jLj6a[0-9a-f]+` para ter a origem legível. Isso dá um recorte
de back-end por procedência que hoje não existe na tela — e mostra que o ChatGPT virou
fonte de venda em agosto.

- [ ] Usar isso para abrir o segmento back-end por origem, em vez de tratá-lo como bloco único

### Back-end aberto por origem

O bloco de R$ 24 mil que só dizia "back-end" agora diz de onde vem, em agosto:

| Origem | Vendas | Receita | % |
|---|---|---|---|
| Upsell (pós-checkout) | 48 | R$ 10.814,70 | 44,8% |
| (sem origem) | 49 | R$ 4.846,75 | 20,1% |
| whatsapp | 37 | R$ 3.031,11 | 12,6% |
| instagram | 19 | R$ 1.798,18 | 7,5% |
| site-handify | 11 | R$ 1.598,06 | 6,6% |
| area-membros-handify | 19 | R$ 1.513,60 | 6,3% |
| **chatgpt.com** | 3 | R$ 287,21 | 1,2% |
| organic | 2 | R$ 157,73 | 0,7% |
| Voxuy | 1 | R$ 66,33 | 0,3% |

Upsell aparece separado porque acontece depois do checkout e nunca terá origem própria.
Somá-lo ao "(sem origem)" fazia esse balaio ser 65% do back-end sem dizer nada — o que
seria repetir, em escala menor, o problema que o painel veio resolver.

- [ ] Os 20,1% "(sem origem)" continuam sem explicação. Vale investigar antes de tratar
      como resíduo aceitável

### O upsell pertence ao anúncio que trouxe o cliente

Pergunta da usuária: *"o upsell está em back-end e não em tráfego, certo?"*. Estava — e
estava errado. O upsell não tem `ad_id` porque acontece depois do checkout, mas só
existe porque um anúncio trouxe aquele cliente. Em resposta direta, essa receita é do
anúncio.

A ligação é o **`cart_id`**: a Payt manda o mesmo nos dois eventos. Conferido nos
capturados desde a v26 — todos casam com a venda original, e herdaram
"Saponaria Brasil - TSL" e "Workshop Buquê - TSL".

- [x] `vendas.cart_id` + `fn_herdar_origem_do_upsell()`, idempotente e por carrinho
- [x] **`ad_id_meta` fica nulo de propósito.** Não houve clique naquele anúncio para
      esta venda; copiá-lo mentiria sobre o que aconteceu. Herdam-se a conta e a marca
      de tráfego, que é o que a atribuição precisa
- [x] Os 46 upsells do backfill não têm `cart_id` — o campo não existia no export. Para
      eles o pai é achado pelo cliente, na venda não-upsell mais próxima em até 6h.
      Parece a heurística aposentada, mas o uso é outro e bem mais seguro: lá ela
      **decidia** o que era upsell e errava; aqui a Payt já afirmou, e ela só acha o pai
- [x] A normalização passou a gravar `cart_id` e chamar a herança a cada evento, porque
      o upsell chega depois do pai e a ordem varia

**Efeito em agosto:** 43 dos 49 upsells passam para tráfego (R$ 9.986,30 de
R$ 11.111,70), e o ROAS do segmento vai de **1,43 para 1,56**. Os 6 que ficaram são de
carrinhos cujo pai também não veio de anúncio.

### Back-end não paga imposto de mídia que não comprou

O investimento já era zerado no back-end, mas o **imposto sobre o Meta** não: ele era
rateado pela participação no faturamento. É imposto sobre o *gasto* com anúncio — sem
gasto, não há imposto. O back-end pagava mídia alheia e sua margem saía menor do que é.

Em 21/08 a margem do segmento vai de **32,67% para 83,85%** com a correção.

### Dois ROAS, porque são duas perguntas

- **1,56x** com o carrinho inteiro — "o funil fecha?", o padrão em resposta direta
- **1,43x** sem upsell — "o anúncio se paga sozinho?", o número de quem escala mídia

Order bump fica dentro dos dois de propósito: está no mesmo carrinho e vale
R$ 26.372,21 contra R$ 9.986,30 do upsell — quase três vezes mais. Tirá-lo de um deles
seria arbitrário, e é justamente o argumento contra mover o upsell para back-end.

### Testes de `fn_overview()`

O buraco estrutural apontado na revisão: a lógica migrou para o SQL e os testes ficaram
no JavaScript. `supabase/tests/fn_overview.test.sql` monta um cenário à mão, roda a
função e confere 11 asserções — cada uma é um defeito que apareceu neste dia:

- receita soma só aprovadas, e o estorno não é descontado duas vezes
- a perda cai para `valor_total` quando `valor_reembolsado` está zerado
- três PIX da mesma pessoa contam uma vez, e valem 60 e não 180
- o upsell herda o carrinho do pai e entra em tráfego
- tráfego + back-end fecham o misto
- a origem sai legível, sem o sufixo `jLj6…`
- o filtro por conta traz a venda e o upsell que herdou a conta

Roda dentro de `BEGIN … ROLLBACK`, então não suja o banco.

**Nota de execução:** rodei pelo MCP, que não respeita a transação, e os dados de teste
ficaram gravados. Removidos na sequência, com as 1.402 aprovadas de agosto conferidas
antes e depois. Pelo `psql` o rollback funciona; pelo MCP é preciso limpar na mão.

### A UTM do "Desconto de Aula" voltou — confirmado em 21/08 às 11h50

O ciclo fechou. A venda `X9BEDGX` chegou com `link.sources` como objeto (era array
vazio em 56 de 56 pela manhã), `ad_id_meta = 120250395750880323` e
`utm_content = "AD 045 H05 V01"`. Rodada a resolução de conta, ela ligou em
**"Saponaria"** — a conta que aparecia como buraco sem fundo, gastando R$ 29.937,87 em
agosto com zero vendas atribuídas.

**O remendo fica ligado por decisão da usuária.** Uma venda não é amostra: a das 11h15
ainda veio sem `ad_id`, e pode ser tanto outro caminho de entrada quanto a correção
pegando aos poucos. A vigilância diária das 11h confirma com alguns dias de dado e
avisa quando `links_trafego_sem_utm` puder ser esvaziada.

Enquanto isso o remendo é inofensivo: ele só age na ausência de `ad_id`, então a venda
que chega rastreada passa por ele sem ser tocada.

### Duas regras discordando sobre a mesma decisão

O alerta `remendo_utm_resolvido` dizia *"já pode sair"* com **2 de 81** vendas
rastreadas — 2,5%. Ele disparava com uma única venda com `ad_id`, enquanto a decisão
automatizada agendada exige 80% em pelo menos 5 vendas.

Conselho errado: remover o remendo ali faria 97% das vendas voltarem a cair em
back-end. Alinhado ao mesmo critério, e agora ele distingue os dois estados — "voltando
parcialmente" informa, "restabelecida" recomenda.

Vale registrar o padrão: **quando a mesma decisão tem duas regras em lugares
diferentes, uma delas está errada.** É a terceira vez nesta sessão — antes foram a
perda de venda estornada (view × função) e a classificação de upsell (heurística × Payt).

## Parte 2 — Tendências por conta de anúncio

Rota `/tendencias`, alimentada por `fn_tendencias(p_ini, p_fim, p_dias_ant)`.

**O ponto da tela é o que ela não mostra.** O ROAS diário destas contas oscila entre 31%
e 86% da própria média — a "Lembrancinha - TSL" vai de 0,53 a 3,43 em torno de 1,69. Um
painel que comparasse dias soltos apontaria alta ou queda todo dia e não significaria
nada. Só vira tendência o que passa de duas vezes o erro padrão da diferença; o resto é
**estável**, com a faixa de ruído ao lado para que isso seja verificável e não uma
afirmação a ser aceita.

**Doze métricas em quatro grupos**, porque o resultado diz *que* piorou e as etapas
dizem *onde*: Resultado (ROAS, ticket, receita, vendas, investimento, CPA), Leilão (CPM,
CPC), Criativo (CTR, hook), Funil (conexão da página, conversão do checkout).

**Oito faixas.** Seis comparam um período com o anterior de mesmo tamanho; duas comparam
*hoje* com uma média longa — outra pergunta, por isso separadas na barra.

**Metas por conta** (`ad_accounts.roas_meta`, `cpa_meta`), editáveis em Configurações.
Respondem "está bom o suficiente?", que é independente de "está piorando?".

### Três defeitos corrigidos durante a construção

- [x] **Média de razões, não razão de totais.** O comentário dizia uma coisa e o código
      fazia outra: `avg(receita/gasto)` dá peso igual a um dia de R$ 30 e a um de
      R$ 3.000. Na "Desafios na Sala - TSL" isso dava ROAS 1,63 onde o real era **0,85**.
      Toda métrica virou um par (numerador, denominador) somado sobre a janela; as
      aditivas usam denominador 1 e o resultado é a média diária
- [x] **`diasEntre` contava um dia a mais.** `hoje` carrega a hora corrente, e o resto de
      horas virava um dia no arredondamento: a tela dizia "15 dias" numa janela de 14
- [x] **Dia parcial comparado com dias inteiros.** Na faixa "hoje", receita e vendas caem
      por construção. Aviso na tela diz isso e aponta quais métricas são confiáveis
      agora: CPM, CPC, CTR, hook e conexão são razões e não sofrem

### O aviso que a usuária provocou

*"hoje vs últimos 7 dias, estranho demais"* — CPA de R$ 59,96 para R$ 257,66. Não era a
página: em 21/08 o checkout "Desconto de Aula" fez **22 vendas com apenas 4 carregando
`ad_id`**. As outras 18 ficam como tráfego sem conta, então a Saponaria enxerga 4 das 22
vendas dela enquanto o gasto aparece inteiro.

- [x] A tela avisa quantas vendas de tráfego do período não têm conta identificada, e
      que por isso CPA, ROAS e conversões estão subestimados

### Meta de ROAS: calculada, não digitada

`fn_metas_sugeridas(p_dias, p_margem)` deriva o alvo da estrutura de custo real, e a aba
Contas de Anúncios mostra o número junto dos insumos que o produziram. Uma meta escrita
à mão envelhece calada: o Simples muda de faixa, a taxa da Payt muda com o mix de
parcelamento, o custo fixo sobe — e o número na tela segue cobrando a conta por um alvo
que não corresponde mais a nada. **A taxa da Payt nem é parâmetro: é medida do que ela de
fato cobrou** — 5,95% nos últimos 30 dias, não os 6,10% que eu havia estimado.

Dois pares, porque são duas perguntas:

| | Equilíbrio | Margem de 30% |
|---|---|---|
| **Campanha** (marginal, sem custo fixo) | 1,34 | 2,08 |
| **Operação** (custo fixo rateado) | 1,63 | 2,53 |

Custo fixo não entra na decisão de campanha porque não muda se ela ligar ou desligar;
entra na da operação, que é a que paga a conta de luz. O CPA sai do ROAS pelo ticket de
cada conta — o alvo da "Lembrancinha" (R$ 118) não serve para os "Desafios na Sala"
(R$ 297).

#### Correção: o 1,74 que eu havia dado não era margem de 30%

Era o equilíbrio multiplicado por 1,30 — "30% acima do equilíbrio", que rende cerca de
**19%** de margem. Margem de verdade é lucro sobre faturamento, e resolve para 2,08
(campanha) ou 2,53 (operação). Não é diferença de arredondamento: nenhuma conta chega
perto de 2,53 hoje.

A fórmula foi validada contra o resultado real — no ROAS de 1,73 dos últimos 30 dias ela
devolve margem de 5,08%, e o P&L do período fecha em 5,09%. Por R$ 1 investido, com
R = ROAS: `lucro = R·(1 − taxa − simples) − 1 − imposto_meta − fixo_rateado`; o
equilíbrio zera o lucro e a margem `m` resolve `lucro/R = m`.

### Segunda passada: filtro de CA e a série na tela

- [x] **Filtro de conta na própria página.** A lista sai dos mesmos dados dos cards, com
      o gasto/dia ao lado, ordenada por escala. Isso desenterrou um defeito: a página já
      filtrava por `contaId`, mas com `hideFilters` **não havia controle nenhum** — uma
      conta escolhida no Resumo filtrava Tendências de forma invisível. Conta selecionada
      que não gastou na janela agora é dita pelo nome, com caminho de volta, em vez de
      tela vazia ou limpeza silenciosa
- [x] **A série diária de cada métrica** (`fn_tendencias` passou a devolver `serie` e
      `serie_corte`). A tela existia para separar sinal de ruído e mostrava só dois
      números: "estável" tinha de ser aceito na palavra. Agora se vê a nuvem de pontos,
      a divisa entre as janelas e as duas médias comparadas

      Sem faixa de ruído desenhada em volta da linha, de propósito: ela é a precisão da
      diferença entre médias, não a dispersão dos dias. Ali pareceria certa e estaria
      medindo outra coisa
- [x] Ajuda das métricas saiu para tooltip e legenda (eram 180 repetições do mesmo texto);
      metodologia virou uma linha com o resto atrás de um clique; grupos de diagnóstico
      fecham quando não têm nada a dizer e abrem sozinhos quando têm movimento; cabeçalho
      do card leva investido, receita, vendas e ROAS; esqueleto no lugar de "Carregando..."

#### Três classes que não existem no CSS gerado deste projeto

Mesma assinatura de sempre: **falharam em silêncio e pareciam certas**, e o `tsc` passou
limpo nas três.

| Classe | O que acontecia |
|---|---|
| `stroke-muted-foreground/40` | `stroke: none` — metade das linhas do gráfico invisível |
| `normal-case` | resumo do grupo saía em CAIXA ALTA, herdada do botão |
| `sm:grid` | container em `display: block`, colunas declaradas e ignoradas |

Só apareceram porque a verificação mediu `getComputedStyle` na tela, não o screenshot —
no print, uma linha que falta não chama atenção. Todas trocadas por `currentColor` com
classes `text-*`, que este projeto comprovadamente gera. **Regra que fica: em SVG, cor vem
de `text-*` + `currentColor`, nunca de `stroke-*`/`fill-*`.**

## Auditoria da aba Contas de Anúncios

Provocada por *"esta área realmente é necessária?"*. A resposta medida: sim, mas o texto
da tela dizia que ela configurava a atribuição de vendas — e **nenhuma função ou view do
banco lê `produto_payt`**. A atribuição vai por `ad_id` → `metricas_meta` →
`ad_account_id`. Mesmo defeito da tela Ofertas Payt: uma tela explicada por uma premissa
falsa manda procurar problema no lugar errado.

| Campo | Quem usa de verdade | Decisão |
|---|---|---|
| `produto_payt` | só a aba Criativos (casa anúncio e venda pelo par `ad_id` + produto) | mantido, com conferência automática ao lado |
| `roas_meta` / `cpa_meta` | Tendências | mantido — é o motivo vivo de abrir a tela |
| `ativo` | **`meta-insights-sync` só coleta métrica de conta ativa** | mantido, agora com confirmação |
| `account_id` (coluna) | referência cruzada com o Gerenciador | virou linha sob o nome; a largura foi para o que se edita |
| Caixa "Como funciona a atribuição" | ninguém — descrevia regra que não existe | reescrita para o que cada campo faz |

- [x] **O toggle "Ativo" corta a coleta de dados** e disparava em um clique, sem dizer
      isso. Conta desligada some das telas por CA, e os dias parados não voltam ao
      religar. Agora confirma, e o texto diz o que se perde
- [x] **Onze das dezoito contas nunca tiveram uma única métrica** e a ordem alfabética as
      punha no topo — a tela abria com "CA2, CA3, CA4" e campos de exemplo. Ficam atrás
      de "mostrar 11 contas paradas"
- [x] `overflow-hidden` no container da tabela escondia 728 dos 1.102px: **os campos de
      meta e o próprio botão Salvar estavam inalcançáveis** no painel de Configurações,
      que dá 374px. Virou `overflow-x-auto`

### `produto_payt`: removido, não automatizado pela metade

Primeira versão desta seção propunha manter o campo e só mostrar o derivado ao lado,
como conferência. A Jessica rejeitou — *"podemos simplesmente passar a vender outro
produto na CA ou até mesmo vender mais de um, o ideal é que fosse totalmente
automático"* — e ao medir, ela estava certa por um motivo pior do que o previsto: **o
campo não era só manual, ele perdia venda.**

A aba Criativos casava anúncio e venda pela chave `ad_id + produto configurado na
conta`. Quem não batesse com o texto simplesmente sumia:

| | |
|---|---|
| Anúncios que vendem mais de um produto | 12 de 204 |
| Vendas descartadas pelo filtro em 60 dias | **57** |
| Receita invisível por causa disso | **R$ 6.874** |

A "Workshop Buquê - TSL" vende Workshop Buquê (490) **e** Kit Completo (33); o campo
cabia um. O anúncio que trouxe as 33 aparecia como se tivesse parado de vender.

- [x] A chave passou a ser o `ad_id` sozinho, que já é único por anúncio. Se um anúncio
      vendeu dois produtos, ele vendeu os dois — somar é a resposta certa, filtrar era a
      errada
- [x] O produto que a busca do Notion usa sai das vendas do próprio anúncio, não de um
      campo da conta: acompanha sozinho quando a CA troca de oferta
- [x] A coluna editável virou **"Vende (60 dias)"**, somente leitura, com a lista de
      produtos e a contagem de cada um — `fn_produto_derivado` devolve todos, não o
      campeão. `ad_accounts.produto_payt` ficou sem nenhum leitor; a coluna segue no
      banco para não perder o histórico, mas nada mais escreve nela

**A lição repetida:** meia automação — derivar o valor e ainda pedir confirmação humana —
teria mantido o defeito de pé, porque o campo continuaria sendo a fonte da verdade. O que
resolveu foi remover a pergunta, não facilitá-la.

## Checkout sem UTM: `checkouts_origem`

O "back-end sem origem" — R$ 7.359 em 75 vendas — não era falha de atribuição na maior
parte: é suporte, recuperação no WhatsApp, oferta na área de membros e upsell, que
legitimamente não carregam UTM. Classificado pela Jessica:

| Checkout / produto | Origem |
|---|---|
| Saponaria Brasil Suporte R$67 · Oferta Personalizada | suporte |
| Fábrica das Velas — Desconto e Acesso Vitalício | recuperação no WhatsApp |
| Saponaria Brasil Rev2/Rev5/Rev6 · VSL 03 · Oferta Relâmpago | **tráfego** — só perdeu a UTM |
| Vendas no Artesanato — oferta de aluna | área de membros |
| Seguidoras - Saponaria Brasil | link da bio |
| Handify Artesanato Completo *(e "Assinatura")* | back-end — acesso anual |
| Workshop Primeira Venda *(e "Assinatura")* · Saboaria Energética | upsell |

**Tabela, não `UPDATE` solto:** um update resolveria as 75 vendas de hoje e deixaria as
de amanhã sem origem de novo.

**Chave composta, não só o checkout:** três dos casos não têm `link_titulo` nenhum, e o
mesmo link "Assinatura" é back-end quando vende Handify e upsell quando vende o Workshop
Primeira Venda. Nulo significa "qualquer" e a regra mais específica ganha.

Marcar os "Rev" como `trafego_pago` os faz aparecer no aviso de *tráfego sem conta
identificada* em vez de sumirem num back-end que eles não são — a tela passa a dizer a
verdade sobre eles.

- [x] **Workshop Buquê de Velas Rev1 / Rev2 / Rev3** confirmados como tráfego pela
      Jessica, fechando a lista: **zero vendas sem origem** nos últimos 30 dias, contra
      as 75 de R$ 7.359 de onde isto partiu

## A atribuição passa a rodar sozinha

`fn_resolver_conta_das_vendas` liga a venda à conta pelo `ad_id`; `fn_herdar_origem_do_upsell`
dá ao upsell a conta da compra que o gerou. **Nenhuma das duas estava agendada** — não
estavam em cron, nem no webhook, nem em caminho nenhum do código. Rodavam quando alguém
as executava à mão, e é delas que dependem o filtro de CA, o CPA, o ROAS e as Tendências.

- [x] `pg_cron` **`atribuicao-horaria`**, aos 10 minutos de cada hora, logo depois do
      `meta-sync-horario`. A ordem importa: a venda chega antes de o anúncio aparecer nas
      métricas, então quem chegou cedo demais só é ligado numa passada posterior — por
      isso uma execução manual conserta o passado e não o amanhã. Ambas são idempotentes

**Resíduo conhecido:** 41 vendas aprovadas (21/05 a 20/08) têm `ad_id` que não existe em
`metricas_meta` em nenhum nível, então o cron não as alcança. São anúncios de contas que
não são sincronizadas — `meta-insights-sync` só busca conta ativa, e onze estão desligadas.

## AOV no lugar de "ticket médio"

O divisor era a linha de venda, e um upsell é uma linha separada no mesmo carrinho. Isso
inflava a contagem sem haver cliente novo: o CPA aparecia mais barato do que é e o valor
por pedido, mais baixo.

| Conta | Receita ÷ linhas *(antes)* | AOV sem upsell *(agora)* |
|---|---|---|
| Saponaria | R$ 89,27 | R$ 87,60 |
| Saponaria Brasil - TSL | R$ 99,07 | R$ 96,13 |
| Lembrancinha - TSL | R$ 118,26 | R$ 114,60 |
| Workshop Buquê - TSL | R$ 67,37 | R$ 61,16 |

Hoje a diferença é de 2% a 9%, pequena porque upsell ainda é raro — 13 de 739 vendas na
Saponaria. **Mas o erro cresce exatamente quando o upsell melhorar**: é uma métrica que se
degrada conforme o negócio evolui, e esse é o motivo de trocar agora e não quando doer.

- [x] Mudam de denominador **AOV, Vendas, CPA e a conversão do checkout** — todas
      respondem "quantos pedidos a conta trouxe"
- [x] **Não** mudam Receita e ROAS: seguem somando o upsell, porque ele é receita que a
      conta gerou de verdade. Por isso `Receita ÷ Vendas` na tela não bate com o AOV, e as
      ajudas de cada métrica dizem isso

### O `ativo` escrito por duas telas — e a correção do meu próprio alerta

`toggleCA` em `DashboardsSettings` gravava `ativo: false` junto com o desvínculo do
funil. Vínculo com funil e coleta de métricas são decisões independentes, e a mesma
decisão em Contas de Anúncios avisa o que se perde enquanto esta não avisava nada.

- [x] `toggleCA` escreve só `funil_id`, com `.select()` para não comemorar um UPDATE
      barrado por RLS. O estado da coleta virou informação na linha ("coleta desligada"),
      não parte do vínculo — antes uma CA vinculada com a coleta desligada aparecia como
      não vinculada

**Mas o alerta que eu dei estava errado na parte que importava.** Eu disse "em
Configurações → Dashboards, desvincular uma CA…" tendo lido só o código: fui verificar e
`DashboardsSettings` **não é importado por nada**. Não existe seção "Dashboards" em
Configurações. O defeito era real no arquivo e inalcançável na tela.

- [x] **Arquivo apagado.** Eram 386 linhas mexendo em `ad_accounts` e `funis`, com
      `funil_id` nulo nas 18 contas e os 22 funis inativos. Nenhum import em todo o
      repositório; `tsc`, build de produção e os 31 testes passam sem ele. O histórico
      fica no git se a gestão de funis voltar um dia

**A lição:** "o código faz X" e "a usuária consegue fazer X" são afirmações diferentes, e
eu apresentei a primeira como se fosse a segunda. Vale o mesmo hábito de sempre — abrir a
tela, não só ler o arquivo.

## Reconciliação contra a Payt (21/08)

Comparação manual do dia 21/08 contra o relatório da Payt. **O faturamento bruto bateu no
centavo — R$ 7.063,03 nos dois lados.** As três diferenças, e o que cada uma é:

| Métrica | Nosso | Payt/UTMify | O que é |
|---|---|---|---|
| Faturamento bruto | 7.063,03 | 7.063,03 | idêntico |
| Gasto e imposto Meta | −2,4% | | atraso de sync (último às 16:00) |
| Vendas | 60 pedidos | ~96 itens | eles contam order bump como venda; 60 + 36 bumps = 96 |
| Imposto sobre vendas | 659,65 | 706,30 | **base diferente: juros de parcelamento** |
| Taxa da plataforma | 442,25 | 529,73 | nossa é a comissão medida; a deles parece 7,5% fixo |

**A que vale decisão:** o bruto carrega R$ 466,55 de juros de parcelamento, dinheiro que
fica com a adquirente. Cobramos Simples sobre a receita **sem** juros; eles cobram sobre o
bruto **com**. São ~R$ 1.400/mês de imposto, e nós pagamos menos — bom se estivermos
certos, risco se não. **Pergunta para o contador, não para o código.**

Também: a margem deles é sobre o líquido (43,4%), a nossa sobre o bruto. Os dois números
nunca vão bater e nenhum está errado.

## Testes de `fn_tendencias`

- [x] `supabase/tests/fn_tendencias.test.sql` — 17 asserções, todas passando

Cada uma é um defeito que apareceu ou apareceria:

- ROAS como razão dos totais e não média das razões — no cenário, 9 dias de razão 4,00 e
  um de 0,11 dariam média 3,61 contra o valor certo de **0,46**
- AOV, CPA e Vendas ignoram upsell no denominador; Receita e ROAS o somam no numerador
- Uma alta de 30% que cabe dentro do ruído do próprio histórico permanece **estável** —
  é o comportamento que dá sentido à tela inteira
- Série cobre as duas janelas com o corte no lugar certo; conta sem gasto fica de fora;
  `p_dias_ant` encurta a janela atual sem encurtar a base

O arquivo tem `BEGIN`/`ROLLBACK` **e** limpeza explícita, de propósito: o MCP do Supabase
ignora a transação, e numa sessão anterior sete linhas de teste ficaram em produção por
confiar só no rollback. Rodado, verificado que sobrou zero linha, e conferidos os
controles — 60 vendas do dia e 7 contas ativas intactas.

## Lembrete de conferência no Resumo

`conferencias_payt` registra cada conferência; `LembreteConferencia` cobra quando passa
de 7 dias e abre o diálogo que faz a comparação.

**Cadência: quinzenal nos dois primeiros ciclos, mensal depois.** A troca sai do próprio
histórico, não de uma data no calendário — ninguém precisa lembrar de afrouxar. Os dois
primeiros são apertados porque é quando ainda não se sabe se o dashboard e a Payt andam
juntos; confirmado duas vezes, mensal basta, e um lembrete que aparece demais vira parte
do cenário. O período proposto emenda no fim do último conferido, para não sobrepor nem
deixar buraco: um dia que nunca entrou em conferência nenhuma é onde um defeito se esconde.

A tela busca os **próprios** números e pede só os da Payt — se pedisse os dois, um erro de
digitação de um lado passaria por divergência do outro. Compara sobre `fat_bruto` (com
juros), que é a base do relatório da Payt; comparar contra a receita sem juros acusaria
divergência todo dia. Acima de 1% marca como divergente, e o diálogo diz para registrar
mesmo assim: divergência anotada e não explicada vale mais que divergência que ninguém
escreveu.

**Por que isto e não um alerta automático:** os alertas do projeto cobrem *ausência* de
dado. A classe que mais custou — reembolso descontado duas vezes, média de razões, upsell
no denominador — é dado presente e errado, que não dispara nada porque parece normal.
Nenhum código pega isso sozinho: o dashboard não tem contra o que se comparar. O que dá
para garantir é que a comparação humana aconteça e que a tela cobre quando atrasar.

## Primeiro ciclo de conferência — agosto (01 a 20)

Comparação venda a venda contra três exportações da Payt: vendas, origens e upsells.

**O núcleo bateu.** Os 1.821 códigos são idênticos por hash — nenhuma venda a mais, nenhuma
a menos — e os valores fecham ao centavo em quatro dos cinco status. A receita aprovada:
**R$ 128.236,46 dos dois lados.**

Três coisas apareceram, e nenhuma teria aparecido sozinha.

### 1. Estorno sobrescrevia o valor da venda — R$ 46,60

A Payt zera `total_price` no aviso de estorno. A webhook tratava isso com uma escada de
alternativas que terminava no **preço de tabela do produto** — e era ela que ganhava. Sete
dos quatorze reembolsos de agosto viraram R$ 67,00 no lugar dos R$ 66,33 com desconto do
Pix, dos R$ 60,30 com cupom e dos R$ 123,65 que incluíam um order bump.

A regra nova: **estorno muda o status da venda, não o quanto ela custou.** Só grava valor
vindo da transação de verdade; senão mantém o que já está gravado.

- [x] Webhook v27 no ar, com `verify_jwt` preservado em `false`
- [x] Os 7 valores antigos corrigidos pela planilha — reembolsos agora somam R$ 1.360,40
      nos dois lados, e agosto fecha ao centavo nos **cinco** status

### 2. `{{ad.id}}` literal como identificador de anúncio — 59 vendas

A macro do Meta não é substituída na URL de alguns anúncios, e gravávamos o texto cru como
se fosse um id. São 59 vendas desde 25/03, 19 em agosto, em seis checkouts: Fábrica das
Velas — Desconto e Acesso Vitalício, Saponaria Brasil Rev2 e Rev5, Workshop Buquê de Velas
Rev1, Rev3 47 e VSL 01 Rev01.

- [ ] **Aberto** — é configuração do anúncio, não do dashboard

### 3. Os 27 upsells sem anúncio

A Payt atribui o upsell à origem do pedido que o gerou. Nós tínhamos a mesma ligação pelo
`cart_id`, com dois problemas somados: a herança copiava só a **conta**, e nenhum upsell de
agosto tinha `cart_id` gravado.

- [x] `cart_id` dos 74 upsells preenchido a partir da planilha ("Código do Upsell" →
      "Código da Venda")
- [x] `fn_herdar_origem_do_upsell` passou a herdar `ad_id_meta` e `utm_content` além da
      conta. Resultado: **653 vendas com anúncio, exatamente o número da Payt**

Correção de um alerta meu: a aba Criativos **já exclui upsell de propósito**
(`tipo_venda.neq.Upsell`), então essas 27 não estavam custando tela nenhuma. Herdar mantém
a exclusão sendo uma escolha em vez de um acidente.

### O que a conferência ensinou sobre ela mesma

Os três achados são invisíveis num total. O de R$ 46,60 some em R$ 128 mil; o `{{ad.id}}`
não muda soma nenhuma; os 27 upsells têm origem que ninguém olha hoje. **Nenhum apareceria
comparando só faturamento** — só apareceram porque a comparação foi feita linha a linha,
com as três exportações cruzadas.

- [x] O lembrete deixou de cobrar todos os dias: some depois de conferido e volta no dia
      certo. Lembrete que aparece sempre vira paisagem — inclusive no dia em que importa.
      A exceção é divergência não resolvida, que continua visível
- [x] O texto passou a pedir o que de fato funciona: exportar e mandar no chat, porque a
      comparação venda a venda não cabe num formulário
