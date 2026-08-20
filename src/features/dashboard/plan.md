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

**Pendências:**
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
- [ ] Criar Meta App + System User Token com `ads_read`
- [ ] Migration `meta_insights_raw` (+ RLS)
- [ ] Edge Function `meta-insights-sync`: descobrir CAs via `/me/adaccounts`, sincronizar insights
- [ ] Agendamento: horário (dia corrente) + diário (D-1..D-7)
- [ ] Backfill histórico via async insights jobs
- [ ] Reconciliar `ad_accounts` com as CAs reais descobertas

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
