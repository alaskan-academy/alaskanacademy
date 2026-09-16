# Os sete pedidos do painel — desenho e refutações

Medido e desenhado em **16/09/2026**, antes de escrever qualquer linha de código.

Sete pedidos (seis da Jessica em 16/09 mais uma dívida transversal achada na
análise anterior) foram desenhados por um agente cada e depois furados por três
céticos independentes — viabilidade, as quatro armadilhas do `CLAUDE.md`, e UX.
Vinte furos sobreviveram à verificação e estão incorporados abaixo.

**Este documento é a decisão de o que fazer e em que ordem. Nenhum código foi
escrito ainda.**

---

# Síntese

## 1. ORDEM DE EXECUÇÃO — o grafo

A dependência que ninguém dos sete desenhos enxergou é a mesma em quatro deles: **"o anúncio deste card está rodando?" é escrito de novo em cada um**. Se você fizer editor-ad-ativo antes da fundação, a regra de precedência nasce em TypeScript dentro de `somarCriativo`; se fizer ads-por-funil antes, nasce numa terceira leitura de `estado`. Fazer a fundação primeiro não é preferência de arquitetura — é o que faz os três itens seguintes custarem metade.

```
[A] banner-folga ─────────────────────────────────── solto, 1 tarde
      └─ nasce aqui o useHoje() que os selos "situação de hoje" vão precisar

[B] FUNDAÇÃO DO ESTADO  ← a raiz
    meta_situacao (ordem_tela + ordem_resumo) · vw_producao_estado_ads
    reescrita sobre vw_meta_status · situacoes[] para filtro de servidor ·
    situacao.ts ganha sem_anuncio e desconhecido · contradiz()/ESTADO_ADS
    reescritos NO MESMO COMMIT
      ├──► [C] editor-ad-ativo   (o pedido literal dela)
      │        └──► [G] congelar status_veiculacao (rename + gatilho + telas)
      ├──► [F] ads-por-funil     (precisa dos TRÊS estados, inclusive "sem linha")
      └──► (qualquer alerta futuro sobre anúncio)

[D] head-aprovados  — independente de B. Depende de si mesmo:
    carimbar tipo_alteracao='aprovacao' em fn_aprovar_criativo + backfill

[E] ad-morrendo — independente de B. Depende de calibração MEDIDA
    (não de código) e de unificar os limiares em configuracoes

[X] escala-vs-teste — morto por medição. Fora do grafo.
```

**C antes de G** de propósito: o selo derivado tem que estar funcionando numa tela real antes de você congelar a coluna que ele substitui. E **G depois de C** porque C já tira `status_veiculacao` do lugar onde ele mais mente (a linha de anúncio), que é metade do passo 2 do G.

---

## 2. Onde os céticos furaram e o desenho PRECISA mudar

**[B] A precedência do resumo estava invertida — e a regressão seria invisível.** Copiar `ORDEM_SITUACAO` (que é ordem de tela, "quem pede ação primeiro") para `min(ordem_acao)` faz 8 cards com anúncio entregando lerem "Pai pausado", R$ 2.021,60 saindo em 7 dias, e 4 deles são justamente os "Encerrado com dinheiro saindo" que sumiriam do ⚠. O contador continuaria em 28, porque entram casos baratos no lugar — número que não muda é número que ninguém desconfia. **Mudança: duas colunas na tabela (`ordem_tela`, `ordem_resumo`), com `rodando = 1` no resumo. Prova de aceite na própria migração: `situacao <> 'rodando' and ads_rodando > 0` tem que dar zero.** E o filtro passa a ser `situacoes text[]` com `.overlaps()`, não o rótulo colapsado — senão filtrar "rodando" devolve 84 dos 92 e some 8 em silêncio.

**[B] Duas coisas que o desenho apaga e não repõe.** `situacao.ts` não tem `sem_anuncio` nem `desconhecido`: ~3.267 cards estreariam mostrando a chave crua em cinza. E apagar `criativo_campos_opcoes` sem tirar o array cravado em `AvaliacaoView.tsx:282` promove o fallback a fonte única — o filtro "Status" passa a oferecer os rótulos velhos e devolver zero linha, com o estado vazio funcionando perfeitamente e mentindo. **Mudança: opções do filtro saem de `meta_situacao`; os arrays cravados saem no mesmo PR; teste lendo `pg_get_viewdef('vw_meta_status')` que falha quando a Meta inventar valor novo.**

**[C] A linha de `/editores → Criativos` não é um anúncio, é um criativo agregado.** `somarCriativo` herda todo escalar do anúncio que mais gastou — em metade das linhas com anúncio rodando o selo diria "parado". **Mudança: fazer B primeiro e ler a `situacao` agregada da view por `producao_id`, em vez de reimplementar a precedência em TypeScript.** Selo por anúncio só na sub-tabela expandida. A busca tem que casar `a.anuncios.some(...)`, não o `ad_nome` do base. E o chip conta os dois números ("3 criativos · 4 anúncios"), sobre a lista já peneirada.

**[C] O anúncio que subiu hoje não aparece.** `fn_criativos_meta` só devolve quem tem linha em `metricas_meta` no período, e o corte padrão de R$ 50 esconde o resto. O pedido dela ("subiu hoje, está no ar?") é respondido com um vazio indistinguível de "não existe". **Mudança: estado vazio que oferece a saída, e consulta direta a `vw_meta_status` por nome/ad_id fora do recorte.**

**[D] O grupo "nunca virou anúncio" acusa errado três vezes.** `ads_ligados = 0` é inalcançável (a view não produz linha para card sem vínculo — ausência é a resposta); a janela de 7 dias reprova 53% dos criativos que de fato sobem, porque a mediana até o primeiro gasto é 8 dias e o p90 é 15; e card parado em fase `aprovado` é *estruturalmente* inelegível para vínculo. **Mudança de eixo: o primeiro corte é `fase` + `tipo`, não desfecho de anúncio. O número de capa da tela vira "63 cards aprovados parados na fila do gestor, o mais velho há 48 dias" — que tem dono e ação — e não "X% viraram anúncio".** Mais: `.eq('tipo_alteracao','aprovacao')` carimbado em `fn_aprovar_criativo`, senão arrastar card no Kanban e arquivar card em revisão contam como "aprovei".

**[E] O piso de impressão não é o `MIN_IMPRESSOES` que já existe** (aquele é de período, este é por dia — 30x mais apertado) e ele reduz a regra a 41 dos 372 anúncios. Mas 41 anúncios carregam R$ 94.748 de R$ 124.454. **Mudança: a tela declara o par — "acompanha 11% dos anúncios e 76% da verba" — com as duas razões de exclusão separadas, derivadas da mesma função que marca.** Superfície: nada de coluna nova (a tabela já tem 31 colunas e 2.437px); marcador dentro da célula fixa do nome, mais um selo em `LinhaDeSituacoes`. E o alerta não pode nascer sem estado de "já vi", senão a fila só esvazia quando o anúncio morre sozinho.

**[F] O eixo REV esconde dois terços do que a tela promete.** 27 dos 35 projetos não têm REV nenhum; 126 dos 196 criativos aprovados-e-parados estão exatamente nesses projetos, incluindo os dois maiores estoques. Uma tela com multiselect de REV mostraria números de um dígito por coluna e ensinaria o contrário do que foi medido. **Mudança: projeto é a linha, REV é o recorte, e existe uma coluna fixa "Sem REV (126)". Três estados escritos, nunca `≠ ativo` (em JS `null !== 'ativo'` é true, em SQL é NULL — a mesma frase dá 39 ou 196 cards).**

**[F] O rename `funil_video → metodo_video` não é um `ALTER`.** Há 4 linhas em `criativo_campos_opcoes` com `campo='funil_video'` e três views expondo uma coluna `funil` que significa método. Renomear a coluna sozinha faz "WhatsApp" sumir do seletor sem erro nenhum. **Mudança: migração própria, quatro atos, e fora dos fallbacks `['TSL','VSL','QUIZ']`.**

**[A] O corte tem que ser por OCORRÊNCIA, não por evento.** O agrupamento chaveia por `ev.id`, então uma folga semanal colapsa numa faixa dizendo "de 31 de ago a 5 de out". E o `ate` vem clampado pela janela de navegação, o que faz a faixa anunciar uma volta 13 dias antes da volta real. **Mudança: blocos contíguos por ocorrência, `ate` lido de `data_fim` da ocorrência, rótulo derivado da âncora, e `useHoje()` para a virada da meia-noite.**

---

## 3. Os refinamentos que você propôs e que os números refutam

**"Anúncio bom parado em campanha de TESTE em vez de ESCALA" — cai inteiro.** A diferença de CPA entre as duas famílias é 6,5%, e o ruído de um anúncio individual com 11,6 compras é 29% — quatro vezes maior que o efeito. A seta causal ainda aponta ao contrário: ESCALA tem CPA melhor porque *recebe* o que já venceu. E o histograma de R$/ad ativo/dia, que era o critério de parada do próprio desenho, já foi medido com 138 dias de histórico e está sobreposto: a maior mediana é de uma TESTE, e uma ESCALA fica acima de quatro TESTEs. Não é bimodal. **Isso não vira tela nem alerta — vira um item de pauta: a operação não tem etapa de escala, e software não conserta isso.**

**"4 de cada 5 criativos nunca rodam" — o número mede importação, não produção.** Pela data de postagem é 92–96%; na população que a tela de aprovações consulta, 78–80% têm anúncio. **Pare de usar esse número.** O desperdício real é outro e é maior: 63 cards aprovados encalhados na fila do gestor, e 196 criativos aprovados sem nenhum anúncio ativo — 126 deles em cinco projetos que a empresa desligou.

**"ROAS/CPA caindo 3 dias seguidos" — impossível de medir.** Com 1,01 compra por dia-anúncio e 68% dos dias sem compra nenhuma, "caiu três dias" é ou impossível (0 não é menor que 0) ou universal. Só hookrate, CTR e CPM podem disparar; dinheiro entra em janela de 7 dias e só contextualiza.

**"O multiselect de funil" — ele já existe e já está quebrado.** Filtra por `funil_ids`, que está vazio em 4.082 de 4.082 cards. Não é feature nova; é um filtro que esvazia a tela.

**"A tela do editor mostra o estado mentiroso" — não mostra.** `DesempenhoAdsView` carrega `status_veiculacao` e nunca renderiza. Quem exibe é `CriativosMetaTab` e o `CriativoDrawer`. O conserto é em arquivos diferentes dos que você apontou — e a tela do Desempenho, que era o alvo, na verdade não tem nem campo de busca.

**"status_veiculacao como intenção" — não sustenta.** O vocabulário é cópia palavra por palavra do estado da Meta, e 366 dos 470 conferíveis são "Encerrado": é marcador de arquivo morto, não plano. Intenção já tem casa em `avaliacao` e em `fase=arquivado`.

---

## 4. O que ninguém olhou

**Os nove arquivos não versionados no git status.** `CriativosMetaTab (1).tsx`, `TestesTab (1).tsx`, `KanbanView.tsx`, `CriativoCard.tsx` e mais cinco estão como untracked — e sete dos desenhos editam exatamente esses arquivos. Antes de qualquer linha de código: resolver qual cópia é a viva. É o risco mais bobo e o mais caro da leva.

**Nenhum desenho conferiu o recorte por empresa nas views novas.** `vw_producao_estado_ads` reescrita, `vw_criativo_funil`, `vw_producao_criativo` — todas nascem juntando `producao_ads → producoes → projeto`. Se qualquer uma sair sem `security_invoker`, "Ambas" vaza para dentro de uma empresa só. `vw_dinheiro_sem_empresa` tem que continuar em zero depois da migração, e isso é uma linha de prova dentro dela.

**Três desenhos põem alerta em página que o dono não enxerga.** `IngestStatusBanner` sai cedo com `is_admin !== true`, `/criativos` não tem `pageKey`, e o gestor de tráfego — que é quem pausaria o anúncio — é justamente quem não veria. Trocar por `canAccess(areaDaRota(pathname))` é pré-requisito de qualquer alerta desta leva, não item opcional.

**O alerta desenhado não tem um único caso.** `ativo_nunca_entregou`, `ativo_sem_entregar`, `em_analise` e `sem_dado` têm zero linhas hoje. O que tem caso é outro: 109 anúncios `barrado_pelo_pai` em 95 cards, com verba. E `sem_dado` nunca ocorre porque o sync reescreve `visto_em` de tudo — o caso real é vínculo órfão (58 vínculos, 43 cards), que precisa de nome próprio.

**Falta medir o denominador escondido da ponte.** `fn_fixar_vinculo_ads` só liga quando há exatamente um card candidato. Ninguém mediu quantos anúncios que gastaram têm dois ou mais candidatos e por isso nunca ligam. Esse número decide se "nunca virou anúncio" é um problema de produção ou um problema da ponte — e três telas desta leva dependem dele.

**Todas as telas novas dizem "situação de hoje" e dependem de uma fonte que pode calar sem avisar.** Se o `meta-insights-sync` parar, o painel inteiro passa a mostrar "parado"/"sem dado" com cara de fato, para todo mundo, ao mesmo tempo. Hoje o único aviso é admin-only.

**Ordem de deploy.** Mudar o `RETURNS TABLE` de `fn_criativos_meta` exige `DROP FUNCTION`, e entre o deploy do banco e o do front a tela quebra. Suba o banco aditivo primeiro (o front antigo ignora coluna nova), depois o front, e recarregue o schema do PostgREST.

**A decisão que nenhum software toma.** Cinco projetos desligados com 126 criativos aprovados e parados. A pergunta que vale mais que qualquer tela é: quantas horas de editor foram gastas produzindo para projeto desligado, e o que fecha essa torneira.

---

## 5. Se só desse para fazer três coisas neste mês

**1. A fundação do estado (B), com a precedência corrigida.** Destrava quatro dos sete itens, não apaga nada, não renomeia nada, é reversível com um `create or replace` — e no dia em que sobe já conserta um número que hoje mente na sua tela: o contador de contradição da aba Avaliação compara sua marcação contra uma regra que o próprio projeto rejeitou por escrito. Guarde o número de contradições de hoje antes de subir; se ele não voltar igual, a migração comeu o ⚠.

**2. Editor-ad-ativo, fase 1, em cima da fundação (C).** É o seu pedido literal, na única tela que já tem busca e período, e — feito depois de B — sem uma linha de regra duplicada em TypeScript. Sai `status_veiculacao` da linha de anúncio, entra o selo com `ultimo_gasto` ao lado e o chip "só o que ainda roda".

**3. Head-aprovados, reenquadrado como fila do gestor (D).** Não depende de nada, não tem migração no passo 1, e é o único número desta leva que tem dono e ação amanhã de manhã: 63 criativos aprovados parados, o mais velho há 48 dias, ordenados por dias parados. Junto vai o carimbo `tipo_alteracao='aprovacao'`, para a lista não ser heurística desde o primeiro dia.

**De troco, meia tarde e fora da conta: o banner-folga (A)** — é a única coisa aqui que você vê todo dia, e é onde nasce o `useHoje()` que os selos "situação de hoje" vão usar.

**O que fica explicitamente de fora:** escala-vs-teste (morto por medição); ads-por-funil (alto, depende da fundação e de uma decisão de negócio sobre os cinco projetos desligados); o rename `funil_video` (migração própria, quatro atos, nenhum ganho isolado); e ad-morrendo — do qual vale fazer **só a calibração**, que é uma consulta sobre 90 dias e produz três números por limiar. Se a regra escolhida não nomear no máximo ~5 anúncios por dia e a maioria dos marcados não tiver morrido de fato, o item não entra no mês que vem também.

---

# Os desenhos, um a um

## Faixa "fora neste mes" deve sumir quando a data passou

**Chave:** `banner-folga` · **Esforço:** baixo

### Veredito
Confirmo o pedido, com um refinamento e um achado de brinde. O refinamento: o corte tem que ser pelo ÚLTIMO dia da folga (`ate >= hoje`), nunca pelo primeiro — folga que começou semana passada e ainda está correndo é justamente a que precisa continuar na faixa. O achado: a faixa não é "fora neste mês", é "fora no mês que está ABERTO na agenda" — navegar para dezembro troca o conteúdo dela e o rótulo continua dizendo "neste mês". É o mesmo defeito, na mesma linha, e sai de graça junto.

### Desenho
ONDE MORA: `src/features/inicio/pages/InicioPage.tsx`, rota `/` (App.tsx:79, `pageKey="inicio"`) — a porta de entrada do dash, grupo Operação. A faixa é o bloco da linha 433-450; o dado vem de `const fora` (linha 226).

POR QUE AS DUAS FAIXAS VIZINHAS DIVERGEM: `hoje` (linha 98) simplesmente NÃO EXISTE na cadeia do `fora`. Ele nasce de `itens` (linha 186), que nasce da janela `[ini, fim]` (linha 117) — o mês da âncora de NAVEGAÇÃO, com 7 dias de folga de cada lado. A consulta (linhas 128-135) filtra por `ini`/`fim`; a expansão é `diasOcupados(regra, ini, fim)` (linha 198); o agrupamento por evento não olha data nenhuma. Em nenhum desses três pontos o dia de hoje aparece. Já `paradasAVista` tem consulta PRÓPRIA (linhas 175-183: `.lte('data', ateParada)` + `.or(...data.gte.${hoje}...)`) e expande com `diasOcupados(..., hoje, ateParada)` — o hoje está DENTRO da janela de expansão, então o passado nunca chega a virar item. Duas faixas coladas uma na outra, dois eixos de tempo: uma é "o mês aberto", a outra é "os próximos 4 dias" (`AVISO_PARADA_DIAS`, linha 29).

CORREÇÃO MÍNIMA — duas linhas, no `return` do memo (linha 246):

  return [...porEvento.values()]
    // Folga que já acabou não é aviso, é histórico. O corte é pelo `ate`, e
    // nunca pelo `de`: folga que começou antes de hoje e ainda está correndo
    // é exatamente a que precisa continuar aqui.
    .filter(({ ate }) => ate >= hoje)
    .sort((a, b) => a.de.localeCompare(b.de))

e `hoje` entra nas deps: `}, [itens, nomes, hoje]);`. Comparação de string `yyyy-MM-dd` basta — é o que o resto do arquivo já faz (`i.data < atual.de`, linha 242).

CASOS DE BORDA:
- Folga em curso (`de < hoje <= ate`): fica, com o texto inteiro "de 14 a 18 de set". Correto, mas o texto agora mistura passado e futuro. Melhoria opcional de 3 linhas no `.map` (linha 248): quando `de < hoje`, escrever "até sexta" / "até 18 de set" — é a informação que sobrou.
- Termina HOJE (`ate === hoje`): FICA. `>=`, não `>`. A pessoa está fora hoje.
- Folga de um dia, hoje: fica, dizendo "na quarta". `paradasAVista` já sabe dizer "é hoje"/"é amanhã" (linha 291) e o `fora` não — terceira divergência entre as duas faixas, opcional de acertar.
- Fuso: `hoje = toYMD(new Date())` é local, `daYMD` parseia com `T00:00:00` local — batem, não há erro de um dia. O buraco é a virada: `hoje` só muda quando algo re-renderiza, e o Início é a aba que fica aberta o dia inteiro. A faixa "a empresa para" tem o MESMO buraco hoje (deps `[hoje, ateParada, eventos]`, linha 183, que não mudam sozinhas) — não é regressão nova, mas é o que a extração resolve.
- Fim do mês (o medo do enunciado): não se concretiza. `fim` já é `new Date(ano, mes+1, 7)` (linha 119) — a janela vai 7 dias ALÉM do mês. Em 28/09 a faixa ainda alcança folgas até 07/10. Ela nunca foi estritamente "o mês", por isso "sumir só o passado" funciona e "sumir o mês" não.

EXTRAIR O "HOJE": sim para o VALOR, não para a REGRA. Há cinco cópias do "que dia é hoje" no produto — InicioPage:98, EventoFormModal:51, CalendarioView:539 e :566, HojeView:40 — e a HojeView ainda reimplementa o `toYMD` inteiro (linhas 22-24), duplicando o de `src/lib/recorrencia.ts`. Cinco implementações da mesma regra, todas divergindo no mesmo ponto: nenhuma vira à meia-noite. Proposta enxuta, `src/lib/hoje.ts`: `useHoje(): string` (agenda um `setTimeout` para o próximo 00:00 local e re-renderiza) e `aindaVale(ate, hoje)` (`ate >= hoje`). Um teste ao lado de `src/test/recorrencia.test.ts`, que é onde a data pura já mora. O que NÃO extrair: a pergunta que cada faixa faz. `fora` pergunta "ainda está acontecendo?", `paradasAVista` pergunta "começa nos próximos 4 dias?". São perguntas diferentes de verdade; um `filtroDeHoje()` genérico com flag seria um helper respondendo duas coisas — armadilha 1 pelo avesso.

RÓTULO: com o filtro, navegar para setembro estando em outubro deixa a faixa vazia e ela some sozinha (`fora.length > 0`, linha 433) — sem caixa vazia. Mas "fora neste mês" continua mentindo em mês futuro. Uma linha resolve: mês corrente → "fora daqui pra frente"; outro mês → `fora em ${MESES[ancora.getMonth()]}` (o array já existe, usado na linha 308).

### Riscos
- O caminho obvio quebra o botao de pular em silencio: filtrar os DIAS antes do agrupamento (`itens.filter(i => i.tipo === 'folga' && i.data >= hoje)`) faz o `item` guardado deixar de ser o do primeiro dia — o comentario da linha 241 diz explicitamente que e ele que o clique deve abrir. E `pular()` (linhas 316-343) grava `item.data` em `recorrencia_puladas`: o botao 'Pular este dia' do drawer passaria a pular um dia do MEIO da folga. Um filtro de exibicao nao pode mudar o que um botao de escrita faz.
- `>` em vez de `>=` apaga o aviso de quem esta fora HOJE. E o bug que ninguem reporta: a faixa simplesmente nao aparece, e quem le nunca soube que deveria. Mesma familia do 'quando um numero parecer estranho' do CLAUDE.md — aqui o numero ausente e que nao vai estranhar sozinho.
- Mexer em `itens` (linha 186) para resolver isso afeta tambem a Agenda (linha 510) e sumiria com as folgas passadas do CALENDARIO. O calendario e o registro do mes, nao o aviso — a folga da semana passada tem que continuar desenhada la.
- Sem hook de meia-noite, a correcao passa no teste manual e falha as 00:01 numa aba deixada aberta. Edicao de video atravessa a meia-noite com o dash aberto; nao e caso hipotetico.
- Armadilha 1 ja em curso e ignorada: `toYMD` existe duas vezes (`src/lib/recorrencia.ts` e local em `HojeView.tsx:22`). Enquanto houver duas, uma vai divergir — a segunda ja nao tem o comentario sobre fuso que a primeira tem (`daYMD`, 'sem fuso: new Date(...) vira UTC e volta um dia no Brasil').

### O que NÃO fazer
- Nao filtrar por `de >= hoje`: apaga a folga que esta acontecendo agora, que e a mais importante da faixa.
- Nao filtrar os dias dentro de `itens.filter(...)` antes do agrupamento: muda o `de` exibido, muda o `item` clicado e muda o dia que o `pular()` grava.
- Nao restringir a janela `[ini, fim]` (linha 117) a partir de hoje: isso quebra a Agenda e o `Hoje` do calendario junto, e a faixa nem precisa disso.
- Nao criar coluna nova em `eventos` (tipo `visivel_ate`, `encerrado`): seria espelho pedindo gatilho (armadilha 4) para uma comparacao de duas strings. Zero migracao neste pedido.
- Nao transformar a faixa numa janela fixa de N dias 'para ficar igual a de cima': ela e a leitura do mes aberto de proposito (comentario da linha 221, 'nenhuma consulta a mais'), e trocar isso vira uma segunda consulta e uma segunda regra para manter.
- Nao unificar `fora` e `paradasAVista` num helper so com flag — sao duas perguntas diferentes; o que se compartilha e o valor de `hoje` e o predicado `ate >= hoje`, mais nada.
- Nao deixar a faixa renderizar vazia: manter o guarda `fora.length > 0` (linha 433) — em mes passado ela fica vazia por definicao.

### Primeiro passo
Em `src/features/inicio/pages/InicioPage.tsx`, no `return` do memo `fora` (linha 246), inserir `.filter(({ ate }) => ate >= hoje)` antes do `.sort`, com o comentario dizendo por que o corte e pelo `ate` e nao pelo `de`, e acrescentar `hoje` as deps do `useMemo` (linha 258). Duas linhas, nenhuma outra tela afetada, nenhuma migracao. Conferir na tela com uma folga que terminou ontem (sai), uma que termina hoje (fica) e uma que comecou antes de ontem e vai ate depois de amanha (fica, com o intervalo inteiro no texto).

### Furos que os céticos abriram (2)
- **[confiança alta]** Folga cadastrada como SÉRIE quebra o corte proposto. O agrupamento do memo `fora` chaveia por `i.evento?.id ?? i.chave` (InicioPage.tsx:234), e todas as ocorrências de um recorrente têm o mesmo `ev.id` — então a série inteira colapsa num único par `de/ate`. Logo o `ate` do desenho NÃO é "o último dia da folga": é o último dia da última ocorrência dentro da janela de navegação. Medido com o `diasOcupados` real (folga toda segunda desde 31/08, hoje 16/09, âncora setembro, janela 25/08–07/10): dias = 31/08, 07/09, 14/09, 21/09, 28/09, 05/10 → de=31/08, ate=05/10 → `ate >= hoje` é true, a linha FICA, e a faixa escreve "Ana de 31 de ago a 5 de out" (36 dias para 6 segundas) com três segundas já passadas ainda anunciadas. O pedido "sumir quando a data passou" não é atendido exatamente onde o desenho declara o assunto encerrado ("duas linhas, nenhuma outra tela afetada"). Folga recorrente não é hipótese: o bloco "Se repete" do EventoFormModal (linha 424) está FORA do `{ehReuniao && ...}` (282) e do `{ehFolga && ...}` (405) — quem registra a própria folga vê "Toda semana" —, e na base 2 de 2 reuniões já são séries. ARMADILHA 1: o par `de/ate` é uma segunda representação do que a lista de dias já diz, e as duas divergem justamente na série (a lista diz "seis segundas", o par diz "um mês e meio corrido"). ARMADILHA 2 no modo de trabalho: os cinco casos de borda do desenho saíram todos da leitura do código e nenhum da base — um `select tipo, count(*) filter (where recorrencia_tipo is not null) from eventos` de dez segundos mostrava que recorrência está em uso. Vale também a regra de leitura do CLAUDE.md: "de 31 de ago a 5 de out" é o número que parece estranho e está.
  - *Conserto:* Mantém o `ate >= hoje` do desenho — muda o que é agrupado. No mesmo memo `fora` (InicioPage.tsx:226-258), cortar por OCORRÊNCIA e não por evento: depois de expandir `itens`, agrupar os dias de cada evento em blocos contíguos (um dia entra no bloco anterior quando é exatamente +1 dia), guardando o `item` do primeiro dia de CADA bloco, e só então aplicar `.filter(({ ate }) => ate >= hoje)` antes do `.sort`. São ~8 linhas em vez de 2, no mesmo arquivo, sem migração e sem tocar em `itens` (a Agenda continua desenhando o passado, como o desenho corretamente exigiu). Folga simples de um ou vários dias vira um bloco só — comportamento idêntico ao de hoje; a série semanal vira um bloco por ocorrência, e o texto passa a dizer "na segunda" da próxima, não o intervalo inteiro da série. De brinde resolve o risco que o próprio desenho levantou sobre `pular()` (linhas 316-343): o `item` guardado passa a ser o primeiro dia da ocorrência ainda viva, e não o primeiro dia de uma série que começou em agosto, então "Pular este dia" deixa de escrever uma data do passado em `recorrencia_puladas`. O resto do desenho fica de pé: `>=` e não `>`, corte pelo `ate` e nunca pelo `de`, `hoje` nas deps, rótulo que deixa de dizer "neste mês" ao navegar, e `useHoje()` para a virada da meia-noite.
- **[confiança alta]** O desenho transforma a faixa num AVISO (eixo "hoje") mas a deixa lendo de `itens`, que é o eixo "mês navegado" — exatamente o que o comentário das linhas 158-174 do próprio arquivo já diz que não se pode fazer, e por isso `paradasAVista` tem consulta própria: "navegar para dezembro faria o aviso da semana que vem sumir". Pior: o `ate` que vira o critério do filtro NÃO é o fim da folga. `diasOcupados` recorta a janela (`src/lib/recorrencia.ts:141-143`: `if (ymd > fim) break` e `if (ymd >= ini)`), e a janela é `[dia 1 do mês −7, dia 7 do mês seguinte]` (InicioPage:117-121). Então `ate = min(fim real da folga, fim da janela de NAVEGAÇÃO)`. Três consequências concretas, com hoje=16/09/2026: (1) Folga da Jaqueline de 14/09 a 20/10 → `ate` clampa em 07/10; a faixa escreve "de 14 de set a 7 de out" e anuncia a volta dela 13 dias antes da volta real, numa faixa cujo comentário (linha 224) diz existir justamente para "saber que a quinta não tem a Jaqueline muda o que se combina na segunda". Alguém marca entrega para o dia 8. (2) A MESMA folga em curso: clique na seta para agosto (janela [25/07, 07/09]) → `ate`=07/09 < hoje → a faixa some inteira, embora a pessoa esteja fora AGORA. Sem o filtro isso não acontecia; com ele, "quem está fora" passa a ligar e desligar pela seta do calendário, que não é um controle de ausência. (3) O rótulo vendido como "uma linha resolve" não resolve: navegar para outubro (janela [24/09, 07/11]) produz uma faixa dizendo "fora em outubro" que lista uma folga de 25 a 28 de SETEMBRO e uma de 3 de NOVEMBRO; e "fora daqui pra frente" no mês corrente promete futuro sem fim e para calada no dia 7 do mês seguinte — horizonte que encolhe de 36 dias (dia 1º) para 7 dias (dia 30) sem nada na tela dizendo. Troca uma mentira de rótulo por outra pior: a antiga tinha a grade logo abaixo mostrando o limite, a nova não tem limite visível nenhum.
  - *Conserto:* Manter o corte por `ate >= hoje` como regra, mas parar de derivá-lo de `itens`. Dar ao `fora` a mesma estrutura que `paradasAVista` já tem duas funções acima — é copiar um padrão que o arquivo já defende, não inventar um: (a) `useEffect` próprio consultando `eventos` com `.eq('tipo','folga')` numa janela ancorada em HOJE (`[hoje, emDias(N)]`, com N explícito ao lado de `AVISO_PARADA_DIAS` e o mesmo tipo de comentário justificando o número), guardando em `setFolgas`; (b) expandir com `diasOcupados(regra, hoje, ateFolga)` — assim o passado nunca vira item e não há filtro posterior para esquecer; (c) escrever o fim a partir de `ev.data_fim ?? ev.data` da ocorrência, NUNCA do último dia dentro da janela, senão o texto continua inventando data de volta; (d) manter `item` = a ocorrência (como `paradasAVista` faz na linha 297) para não mexer no que `pular()` grava. Efeito colateral bom: a faixa para de depender da navegação, some sozinha quando não há ninguém fora, e as duas faixas vizinhas passam a responder perguntas do mesmo eixo — aí "é hoje"/"é amanhã"/"volta na sexta" pode ser um único helper honesto entre elas. Se quiserem PRESERVAR o resumo do mês (que tem valor: é o que responde "como fica a equipe em outubro" quando se navega), ele deixa de ser faixa de aviso no topo e vira uma linha dentro da `section` da Agenda, colada à grade que resume — aí "fora em outubro" fica verdadeiro porque está ao lado do outubro desenhado, e as bordas de ±7 dias deixam de ser mentira porque a grade também as mostra esmaecidas. O `useHoje()` com virada à meia-noite continua valendo e fica mais necessário, não menos: com janela ancorada em hoje, um `hoje` congelado congela a consulta inteira.

---

## Head ver os ADs que aprovou e poder alterar fases

**Chave:** `head-aprovados` · **Esforço:** medio

### Veredito
Refino com uma refutação: "ADs aprovados" não é uma fase, é um evento, e a fase `aprovado` é o pior lugar possível para listá-lo — um card aprovado ANDA (esteira_teste → postado → na_plataforma), então `.eq('fase','aprovado')` mostraria justamente os que nada aconteceu. A lista do que ela aprovou já está gravada em `criativo_historico` (usuario_id = ela, campo_alterado='fase', valor_anterior em `fasesQueAprova(...)`, valor_novo <> 'alteracao'), e nenhum campo novo é necessário. E o segundo ponto: 4 de cada 5 criativos produzidos desde agosto nunca viraram anúncio (275 de 1.310), então a coluna mais importante não é o CPA — é "virou anúncio?", porque em ~79% das linhas a resposta vai ser NÃO e nunca existiu tela dizendo isso.

### Desenho
ONDE MORA: aba nova em `/producao?aba=aprovei`, rótulo "O que eu aprovei", registrada em TABS de `src/features/producao/pages/ProducaoPage.tsx` (linha 27) com `niveis: ['socio','head']`, vizinha de "Painel de Aprovação". NÃO é filtro dentro do painel de aprovação: a "fila que esvazia" existe porque `PainelAprovacaoView` consulta `.in('fase', fasesVisiveis)` (linha 58) e o card sai da consulta no instante em que `fn_aprovar_criativo` troca a fase. Qualquer toggle "ver aprovados" obriga a consulta a trazer cards fora de `fasesVisiveis` e a fila deixa de significar "o que falta". São duas perguntas diferentes: "o que falta aprovar" e "o que aconteceu com o que aprovei". Sidebar continua plana — Produção já é uma entrada só; abas dentro da página, como CriativosPage e FinanceiroNav.

DE ONDE VEM O DADO (nada disso precisa ser criado):
1. Lista base — `criativo_historico`: `.eq('usuario_id', userId).eq('campo_alterado','fase').in('valor_anterior', fasesQueAprova(fases, setor?.id ?? null, nivel === 'socio')).neq('valor_novo','alteracao').order('criado_em', {ascending:false})`. O `valor_anterior` é o que separa aprovação de devolução — as duas gravam a mesma forma de linha em `fn_aprovar_criativo` e `fn_devolver_criativo` (supabase/migrations/20260827yb_funcoes_da_producao.sql). Sócio vê as próprias aprovações por padrão, com opção de ver de todos.
2. Cards — `producoes` pelos ids, com `.in('projeto_id', projetosDaEmpresa)` de `useProjetosDaEmpresa()`, respeitando `undefined` = esperar (PainelAprovacaoView linha 53 já faz assim).
3. Estado do anúncio — `vw_producao_estado_ads` (`producao_id, ads_ligados, ads_conhecidos, estado, ultimo_gasto`), em blocos de 300 ids, exatamente o padrão de `AvaliacaoView.tsx:433`. NUNCA `producoes.status_veiculacao`.
4. Números — `useMetricasDoAd(null, null)` + `<TiraDeMetricas>` de `src/features/criativos/metricasDoAd.tsx`. Nulo/nulo é a vida inteira do AD, que é o recorte certo (o comentário do arquivo já explica: julgar pelo mês corrente reprova todo AD que estreou ontem).

O QUE MOSTRA — agrupado por DESFECHO, não por fase, com contagem no cabeçalho de cada grupo:
· "Ainda não subiu" — aprovado há menos de ~7 dias e sem vínculo (`fn_fixar_vinculo_ads` roda de hora em hora e só liga com candidato único).
· "Nunca virou anúncio" — `ads_ligados = 0` e aprovado há mais tempo. É o grupo maior, e é a informação nova da tela.
· "Subiu e sumiu da API" — `ads_ligados > 0 AND ads_conhecidos = 0`. A view já separa os dois contadores; a coluna `estado` junta ambos em 'sem_anuncio', e para esta tela eles são coisas diferentes.
· "No ar" (`estado='ativo'`) · "Reprovado pela Meta" (`reprovado`) · "Com problema" (`com_problema`) · "Parou" (`pausado`, mostrando `ultimo_gasto` — "parou em 12/09", não só "parado").
Cada linha: nome, projeto/funil, editor, data em que ela aprovou, fase atual via `rotuloDaFase(fases, c.fase)`, badge colorido do estado, e `<TiraDeMetricas>` quando houver. Click abre `CriativoDrawer`. Faixa de resumo no topo com três números, que é a medição que a tela existe para fazer: "aprovei X · Y viraram anúncio (Z%) · W ainda no ar", com a data do recorte escrita na tela.

ALTERAR FASE — REGRA DE PERMISSÃO, em três camadas, nenhuma nova:
· QUEM: quem já aprova aquela fase — `fasesQueAprova(fases, setorId, ehSocio)`. Head no próprio setor, sócio em tudo. Não criar flag `pode_editar_pos_aprovacao`.
· PARA ONDE: `fasesDoTipo(fases, c.tipo, c.fase)`, com `fora_do_fluxo` separado — é o seletor que o `CriativoDrawer` já monta (linha 454).
· COM QUÊ: `usePedirMotivo(fases.find(f => f.chave === destino))` e insert em `criativo_historico` com `motivo`. O teste `src/test/fases-vem-do-banco.test.ts` ("toda escrita de fase no histórico carrega `motivo`") falha sem isso.
A gravação é a do drawer, reusada — não um segundo caminho. Se quiser um atalho de "voltar para Alteração" direto na linha, ele chama `fn_devolver_criativo` (transacional, já avisa o responsável), nunca um `update` solto em `producoes`.

### Banco
Nenhuma migração é obrigatória: `criativo_historico`, `producao_ads`, `vw_producao_estado_ads` (migração 20260905b), `fn_criativos_metricas` e `fn_vida_util_ads` (20260831p) já entregam tudo. Dois acréscimos valem: (1) índice `create index if not exists idx_hist_usuario_fase on public.criativo_historico (usuario_id, campo_alterado, criado_em desc)` — a consulta filtra exatamente por essas três colunas e a tabela só cresce; (2) opcionalmente, uma view `vw_aprovacoes_por_pessoa` juntando histórico + estado, para a DEFINIÇÃO de "aprovação" (valor_anterior é fase de revisão E valor_novo <> 'alteracao') existir em um lugar só — se ela ficar só no front, a próxima tela que precisar da mesma pergunta vai divergir. Se essa view for criada, as fases de revisão têm que vir de `join producao_fases f on f.chave = h.valor_anterior and f.e_revisao`, nunca de uma lista literal no SQL. RLS: `criativo_historico` já está certa desde 20260827zzf — select e insert para authenticated, update e delete negados; a view nova precisa de `grant select ... to authenticated` e de `security_invoker` para não furar o recorte por empresa. Alerta (passo 2, não passo 1): código `aprovados_sem_anuncio` em `vw_alertas` + linha em `alertas_area` apontando para a página onde ele se resolve, conforme o princípio da migração 20260825l.

### Riscos
- A permissão que a feature usa já está furada. `canMoveFaseOut` (src/features/producao/components/constants.ts:173) lê o array `FASES` do mesmo arquivo — lista fixa com `revisao: true` escrita à mão — e não `producao_fases.e_revisao`. Fase de revisão nova cadastrada no banco cai em `faseInfo === undefined` e a função devolve `true`: qualquer membro move o card para fora dela. O teste `fases-vem-do-banco.test.ts` não pega porque o regex `\[[^\[\]]{0,400}?\]` só olha literais de até 400 caracteres e `FASES` é maior. Armadilhas 1 e 3 juntas, e é a regra que a tela nova herdaria. Consertar antes: a pergunta vai para `useFases`.
- `canMoveFaseOut` pergunta sobre a fase ATUAL, não sobre o destino. Depois de aprovado a fase atual é `postado`/`na_plataforma`, que não é revisão — logo devolve `true` para todo nível. Hoje isso só não aparece porque as telas filtram por nível; uma tela que oferece o seletor precisa perguntar também pelo DESTINO (`e_revisao`, `somente_socio`).
- Usar `producoes.status_veiculacao` como estado do anúncio. Medido: dos 470 cards com anúncio para comparar, 26 já divergem (5,5%); dos 28 marcados Pausado, 9 têm anúncio rodando (32% errado); e os outros 2.134 têm status sem anúncio nenhum atrás. Pior, `DesempenhoAdsView.tsx:473` já lê esse campo, então a tela dos editores hoje mostra esse estado. Armadilha 1: dois campos dizendo a mesma coisa, e a migração 20260905b já documentou a divergência em dinheiro (R$ 5.691 em 7d saindo de cards marcados Encerrado).
- Criar `producoes.aprovado_por` / `aprovado_em` para facilitar a consulta. Armadilha 1 (duplica o que `criativo_historico` já diz) e armadilha 4 (espelho que precisa de gatilho; a carga inicial preencheria o passado e a próxima aprovação nasceria fora).
- Afirmar "nunca virou anúncio" cedo demais. `fn_fixar_vinculo_ads` roda de hora em hora no cron `atribuicao-horaria` e só liga quando há EXATAMENTE um card candidato. Um card aprovado hoje de manhã ainda pode não ter linha em `producao_ads`, e a tela diria uma mentira sobre o trabalho de alguém. Por isso o grupo "Ainda não subiu" existe separado.
- ROAS e vendas da Meta não valem o mesmo em toda conta: Lembrancinha-TSL 99% e Workshop Buque-TSL 98% casam, mas Saponaria Brasil-TSL 63%, Saponaria 24% e Saponaria Brasil-VSL 0% — e as contas Saponaria são ~40% da verba. `TiraDeMetricas` já mostra Payt e Meta lado a lado com `LegendaFontes`; colapsar em um número só esconde a discordância. Regra de leitura do CLAUDE.md: quando um número parecer estranho, ele provavelmente está.
- CPA/ROAS por dia não existe nesta base: só 32,2% dos dias-anuncio têm ao menos 1 compra, média 1,01 compra/dia, e a mediana de vida útil é 5 dias (só 30% dos anúncios rodaram 7+ dias). Qualquer "3 dias seguidos em queda" seria divisão por zero em ~68% dos casos. O número certo é o acumulado da vida do AD — `fn_criativos_metricas` com `p_ini=null, p_fim=null`.
- Escrever fase por um caminho próprio nesta tela. Seria o quarto caminho de gravar fase; os anteriores divergiram (foi assim que nasceram as cinco listas que `useFases` substituiu), e o teste do motivo quebra. `usePedirMotivo` e o seletor do drawer já existem exatamente para isso.
- A tela nascer como "lista dos meus aprovados" sem a coluna de desfecho ao lado. Aí ela é cadastro sem resultado — armadilha 2 — e não responde a única pergunta que hoje ninguém consegue responder.

### O que NÃO fazer
- Não transformar o Painel de Aprovação num painel com filtro "aprovados" nem com aba interna: a consulta `.in('fase', fasesVisiveis)` é o que faz a fila esvaziar, e trazer card fora dessa lista destrói a propriedade.
- Não criar `producoes.aprovado_por` nem `aprovado_em`. `criativo_historico` já responde, e campo espelho exigiria gatilho.
- Não ler `producoes.status_veiculacao` como estado do anúncio. A fonte é `vw_producao_estado_ads` (`estado` + `ultimo_gasto`), derivada de `meta_objetos.effective_status` — `status` diverge em 4.825 de 8.123 anúncios.
- Não listar por `.eq('fase','aprovado')`: mostraria só os cards que NÃO andaram depois da aprovação, que é o oposto do pedido.
- Não escrever conta de CPA, ROAS, hook ou AOV no componente. `fn_criativos_metricas` + `<TiraDeMetricas>` já existem e o comentário de `metricasDoAd.tsx` explica por que a conta mora no banco (as métricas não se somam entre anúncios do mesmo card).
- Não usar CPA/ROAS diário, série de 3 dias, nem sparkline por dia. 68% dos dias-anuncio não têm compra nenhuma.
- Não colapsar Payt e Meta num número só, e não usar só o Meta.
- Não abrir item novo na sidebar nem sub-item aninhado — Produção é uma entrada só, e as abas ficam dentro da página.
- Não gravar fase com `supabase.from('producoes').update(...)` direto desta tela; e não gravar histórico de fase sem `motivo`.
- Não esconder o grupo "nunca virou anúncio" quando ele for grande. Ele É o resultado da tela — 79% dos criativos desde agosto.
- Não listar as fases de revisão à mão, nem em TypeScript nem dentro de SQL de view: derivar de `producao_fases.e_revisao` por join.

### Primeiro passo
A aba "O que eu aprovei" com UMA coluna de resultado além do nome: virou anúncio? e há quanto tempo. Sem métricas, sem mudar fase. São três consultas encadeadas (criativo_historico filtrado por usuario_id + valor_anterior nas fases de revisão → producoes → vw_producao_estado_ads em blocos de 300), zero migração, e o click na linha abre o `CriativoDrawer` que já sabe trocar fase, pedir motivo e gravar histórico — ou seja, "alterar fases" já vem de graça no passo 1. Isso sozinho põe na tela o número que hoje ninguém consegue ver (quantos dos aprovados nunca rodaram) e prova que a ligação histórico→card→anúncio funciona. Métricas, agrupamento por desfecho e o alerta `aprovados_sem_anuncio` em `alertas_area` entram depois, em cima de uma tela que já tem gente olhando.

### Furos que os céticos abriram (3)
- **[confiança alta]** O agrupamento por desfecho mede a coisa errada, e o numero que justifica a tela nao vale para a populacao que ela consulta.

(1) POPULACAO TROCADA. O desenho diz "em ~79% das linhas a resposta vai ser NAO". Esse 21% vem de "275 de 1.310 criativos marcados postado" — populacao dominada pela carga do Notion, que por definicao NAO tem linha em criativo_historico (a migracao 20260827zv usou exatamente isso como criterio: 80 cards na fase, 80 sem historico, 0 com). A tela consulta o historico, entao nunca vera essas linhas. Medido no banco em 16/09/2026: existem 168 aprovacoes no total (4 pessoas, 143 cards, desde 30/07). A Head (Jessica Maihato) tem 131 cards aprovados e 105 deles (80%) TEM anuncio ligado. Entre os que chegaram a postado, 113 criativos, ~93% com vinculo. O grupo "Nunca virou anuncio", vendido como "o grupo maior e a informacao nova da tela", seria 26 linhas em 131 — e, descontando o item 2, 2 linhas.

(2) ads_ligados = 0 NAO SIGNIFICA "nunca virou anuncio"; significa "o card nao chegou na fase postado". fn_fixar_vinculo_ads (supabase/migrations/20260824b_vinculo_ad_card.sql) exige p.fase = 'postado'. Card parado em 'aprovado' e estruturalmente inelegivel para ganhar vinculo, nao atrasado — e o unico guarda do desenho e a janela de ~7 dias, que nao cobre isso. Medido: dos 26 cards sem vinculo da Head, 23 estao na fase 'aprovado'. Globalmente ha 85 cards em 'aprovado', 63 deles ha mais de 7 dias, o mais velho ha 48 dias. Todos os 63 cairiam em "Nunca virou anuncio" — uma afirmacao falsa sobre o trabalho do editor quando o fato e "o gestor nao postou".

(3) AULA NAO PODE VIRAR ANUNCIO. producao_fases_tipo nao da 'esteira_teste' nem 'postado' para tipo='aula' (o fluxo dela termina em na_plataforma). Ha 41 aulas com aprovacao no historico; todas entrariam em "Nunca virou anuncio" por construcao.
  - *Conserto:* O desenho nao precisa ser jogado fora — a arquitetura (criativo_historico como base, reuso do CriativoDrawer, recusa de status_veiculacao) esta certa. Muda o EIXO do agrupamento: o primeiro corte e por producoes.fase + tipo, e so depois pelo estado do anuncio.

1. "Na fila do gestor" — fase = 'aprovado', com dias parado ao lado. Esse e o numero que hoje ninguem consegue ver: 63 cards ha mais de 7 dias, ate 48 dias. Vira a faixa de resumo no topo, no lugar de "aprovei X, Y viraram anuncio (Z%)". Alem disso ele tem dono e acao — e a fila do Gestor de Trafego, coerente com o principio de alerta na pagina onde se resolve.
2. "Nao vira anuncio" — tipos cujo fluxo nao inclui 'postado', derivado de producao_fases_tipo (nunca lista literal no codigo, armadilha 3). Hoje: aula.
3. So para tipo='criativo' E fase='postado' se consulta vw_producao_estado_ads. Ali sim valem os grupos por estado (no ar / reprovado / com problema / parou com ultimo_gasto). "Ainda nao subiu" passa a ser janela de ~2h desde a ENTRADA em postado — o cron atribuicao-horaria roda '10 * * * *' — e nao 7 dias desde a aprovacao, que e o que produz o falso "nunca rodou".
4. "Subiu e sumiu da API" (ads_ligados > 0 e ads_conhecidos = 0) continua valido e continua merecendo separacao da view.

Com isso o passo 1 continua sendo uma coluna de resultado ao lado do nome, mas a coluna certa: "esta parado na fila ha N dias" para o grupo 1, "virou anuncio?" so onde a pergunta e computavel. E a faixa de resumo passa a declarar o recorte real: o historico comeca em 30/07/2026 e nada importado do Notion aparece aqui.
- **[confiança alta]** Dois furos concretos, ambos na COLUNA DE RESULTADO — que é justamente o que salvaria a tela da armadilha 2.

(1) `ads_ligados = 0` NUNCA acontece: o grupo que o desenho chama de "a informação nova da tela" nasce vazio. Em `supabase/migrations/20260905b_o_card_diz_se_o_anuncio_dele_ainda_roda.sql` a CTE `por_card` é `FROM producao_ads pa LEFT JOIN meta_objetos o ... GROUP BY pa.producao_id`, com `count(*) AS ads_ligados`. Um card sem nenhuma linha em `producao_ads` não produz linha na view — logo toda linha devolvida tem `ads_ligados >= 1`. O predicado do grupo "Nunca virou anúncio" (`ads_ligados = 0`) é inalcançável, e "Ainda não subiu" ("sem vínculo") tem o mesmo defeito. Quem nunca virou anúncio se manifesta pela AUSÊNCIA de linha, não por um zero — é assim que `AvaliacaoView.tsx:440` já trata (`estadoMap[c.id]?.estado ?? null`), e o desenho cita esse arquivo como padrão mas escreve o predicado ao contrário. Resultado prático: a tela sobe mostrando "0 nunca virou anúncio" enquanto a verdade medida é ~79% (275 de 1.310 desde agosto viraram anúncio). Um zero numa tela nova não levanta suspeita de ninguém — é armadilha 2 com a coluna de resultado presente e morta, e a regra de leitura do CLAUDE.md ("quando um número parecer estranho, ele provavelmente está") não dispara porque o número parece ótimo. Ninguém no repositório lê `ads_ligados` hoje (grep: só a própria migração), então não há uso anterior que denunciasse o engano.

(2) "Aprovei" está sendo reconstruído de um campo que responde outra pergunta, e conta como aprovação pelo menos dois eventos que não são. O discriminador proposto (`valor_anterior` ∈ fases de revisão E `valor_novo <> 'alteracao'`) só separa `fn_aprovar_criativo` de `fn_devolver_criativo`, mas existem outros dois caminhos gravando linha idêntica: `KanbanView.tsx:185` insere `{tipo_alteracao:'fase', campo_alterado:'fase', valor_anterior, valor_novo}` para QUALQUER arrasto — inclusive `revisao_edicao → edicao`, que é devolver sem nota, o caminho mais rápido no quadro; e `CriativoDrawer.tsx handleFaseChange` grava a mesma forma para `revisao_* → arquivado/bloqueado` (é o caso do `exige_motivo`, criado em 20260831r exatamente para arquivar). Ou seja: arquivar um card parado em revisão e empurrar um card de volta para edição viram "aprovei". E o erro é direcional — card arquivado ou devolvido obviamente nunca virou anúncio, então ele cai direto no grupo "Nunca virou anúncio" e no denominador da faixa "aprovei X · Y viraram anúncio (Z%)", piorando exatamente o número que a tela existe para medir. Com 741 cards arquivados no banco (comentário de `useFases.ts`), isso não é hipótese. A view `vw_aprovacoes_por_pessoa` que o desenho oferece como remédio centraliza a definição errada — o problema não é ela estar em dois lugares, é ela ser heurística.
  - *Conserto:* Nada aqui derruba o desenho: o lugar (aba própria), a recusa de criar `aprovado_por`/`aprovado_em` e a reutilização do drawer para trocar fase continuam certos. São dois consertos pontuais.

(1) Ausência é a resposta. "Nunca virou anúncio" = id de card que NÃO volta de `vw_producao_estado_ads` na consulta em blocos de 300, exatamente o `estadoMap[c.id] ?? null` de `AvaliacaoView.tsx:440`. `ads_ligados` fica com o único papel que ele pode ter: dentro das linhas que voltaram, separar "subiu e sumiu da API" (`ads_ligados > 0 AND ads_conhecidos = 0`) de "no ar/parado". Vale acrescentar `COMMENT ON VIEW` dizendo que card sem vínculo não aparece — é a pegadinha que fez o desenho errar. Alternativa (mais cara, mais honesta): trocar a view para `producoes p LEFT JOIN producao_ads` com `count(pa.ad_id)`, aí `ads_ligados = 0` passa a existir de verdade; mas isso muda uma view já consumida pela Avaliação, então prefira a primeira. E ponha um teste que some as contagens dos grupos e compare com o total de aprovações: grupo que não fecha a conta denuncia predicado morto no dia 1.

(2) Carimbar o evento em vez de deduzi-lo, sem campo novo e sem espelho. `fn_aprovar_criativo` já é o único caminho transacional de aprovar: mude o `insert` dela para `tipo_alteracao = 'aprovacao'` (a coluna já existe e hoje recebe 'fase', que é redundante com `campo_alterado = 'fase'` — dois campos dizendo a mesma coisa, armadilha 1 já instalada). A consulta da tela vira `.eq('tipo_alteracao','aprovacao').eq('usuario_id', userId)`, sem heurística, sem depender de `fasesQueAprova` calculada HOJE para classificar o passado (outro efeito colateral: se a head trocar de setor ou alguém editar `e_revisao` em `producao_fases`, a lista "o que eu aprovei" muda retroativamente sem nada na tela dizer isso). O passado se resolve com um backfill único usando o heurístico atual, declarado na migração como aproximação e excluindo destinos `fora_do_fluxo` e destinos de `ordem` menor que a origem (voltar não é aprovar) — lidos de `producao_fases`, nunca de lista literal. É a armadilha 4 aplicada certo: carga inicial preenche o passado, a função mantém o presente. Se preferir não mexer na função agora, então o passo 1 filtra com as duas exclusões acima e a faixa de resumo escreve "reconstruído do histórico" ao lado do número — mas isso é remendo, não conserto.

Enquanto (2) não existir, o passo 1 pode subir com o texto do grupo mudado para "Saiu da revisão e nunca virou anúncio", que é o que os dados de fato dizem — e já é a informação nova, sem prometer precisão que a base não tem.
- **[confiança alta]** O grupo "Nunca virou anúncio" — que o desenho chama de "o grupo maior e a informação nova da tela" e que é a ÚNICA coluna de resultado do passo 1 — acusa errado mais da metade das vezes, e a premissa que o dimensiona vem de outra população.

1) O corte de ~7 dias foi justificado pelo cron (`fn_fixar_vinculo_ads`, de hora em hora). Mas o cron não é o que domina a espera: entre a aprovação e o primeiro dia de gasto do anúncio, o atraso medido é mediana 8 dias, p25=5, p75=12, p90=15, máximo 19 (n=112 cards com anúncio e gasto). 59 dos 112 (53%) só começaram a gastar DEPOIS do dia 7. Ou seja: mais da metade dos criativos que de fato rodam aparecem primeiro na lista rotulados "Nunca virou anúncio" — um veredito sobre o trabalho de alguém, emitido enquanto o card está no caminho normal. A Head vê isso acontecer duas vezes e para de acreditar no grupo; é exatamente o ruído que a tela existia para curar, instalado no único número que ela mostra no passo 1.

2) Os "4 de cada 5 nunca rodaram" (275 de 1.310) vêm de `producoes` marcadas 'postado' — 3.753 criativos. A lista desta tela não consulta isso: ela consulta `criativo_historico`, e lá existem 143 aprovações registradas (30/07 a 16/09; 131 da Jessica Maihato, 31 do Lucas, 4 da Academy, 1 da Jessica Gavazza). Nessa população, 112 (78%) TÊM anúncio ligado hoje. Aprovados sem anúncio: 5 com 0-1 dia, 8 com 2-7, 5 com 8-14, 13 com 15+. Logo o grupo maior é "No ar" (78%), o "nunca" duro tem 13 cards, e a faixa de resumo prometida ("Z% viraram anúncio") vai ler ~78% e não ~21%. A ordem dos grupos, o peso do layout e a frase "em ~79% das linhas a resposta vai ser NÃO" estão calibrados num número de outra tabela — é a própria regra de leitura do CLAUDE.md ("quando um número parecer estranho, ele provavelmente está") aplicada ao desenho.
  - *Conserto:* A tela continua de pé; muda o corte, o rótulo e a frase do topo — nada disso mexe nas três consultas nem exige migração no passo 1.

1. Não escrever 7 no código (nem 15 — seria a armadilha 3 de novo). Derivar a fronteira da distribuição observada: uma view `vw_lag_aprovacao_anuncio` que calcula o p90 do atraso entre a aprovação (`criativo_historico` × `producao_fases.e_revisao`) e o primeiro dia com gasto (`producao_ads` × `metricas_meta`). Hoje isso devolve 15 dias; quando a operação acelerar, a tela acompanha sozinha.

2. Rótulo pelo fato, não pelo veredito. Abaixo da fronteira: "Aprovado há N dias, sem anúncio ainda" com a nota "a mediana até subir é 8 dias" — a Head lê o atraso e decide. Acima: "Passou de 15 dias sem virar anúncio" (13 cards hoje), que é o grupo onde existe ação. Cada linha mostra os dias desde a aprovação; "nunca" é opinião, "há 22 dias" é dado.

3. Faixa de resumo como COORTE, não taxa sobre tudo: "dos X aprovados há mais de 15 dias, Y nunca viraram anúncio (Z%)", com a população e o intervalo escritos na tela ("aprovações registradas desde 30/07, quando o Painel de Aprovação começou a gravar"). O período do histórico é curto e precisa aparecer, senão o número parece um retrato da operação inteira.

4. Ordenar a lista por dias-desde-a-aprovação decrescente em vez de montar o layout em torno do grupo grande imaginado: o caso duro são ~13 linhas, e elas têm que estar no topo, não empurradas por 112 cards que estão bem.

5. Consequência para o passo 2: o alerta `aprovados_sem_anuncio` só pode contar a coorte acima da fronteira. Contando todos os sem-anúncio, ele acende com 31 cards todo dia, dos quais 18 estão no prazo — alerta permanentemente ligado é alerta que ninguém lê, e aí ele nasce sem dono e sem botão.

---

## Editor ve se o AD esta ativo HOJE ao filtrar/pesquisar

**Chave:** `editor-ad-ativo` · **Esforço:** medio

### Veredito
Confirmo o pedido e refuto duas premissas do enunciado. Primeira: `DesempenhoAdsView.tsx` **seleciona** `status_veiculacao` na linha 473 mas **nunca o renderiza** — não há uma única referência a ele no JSX, e a tela também não tem campo de busca nenhum, então hoje o editor não vê estado errado ali, ele não vê estado nenhum e não consegue pesquisar um AD. Segunda e mais séria: a troca de fonte que o pedido descreve **já foi feita**, em 05/09, na aba vizinha — `vw_producao_estado_ads` + a coluna com ⚠ de contradição em `AvaliacaoView.tsx`. O trabalho real não é desenhar a troca, é (a) levar o que já existe para as duas telas que ficaram de fora e (b) consertar antes que `vw_producao_estado_ads` e `vw_meta_status` já são **duas views respondendo "o anúncio está ativo?" com regras diferentes, divergindo em 114 dos 807 anúncios ligados a card (14,1%)** — armadilha 1 em andamento, medida agora.

### Desenho
ONDE MORA (três telas, nenhuma nova; sidebar continua plana)

1. `/editores` → aba **Criativos** (`src/features/editores/components/CriativosMetaTab.tsx`) — grão = ANÚNCIO. É a tela que o pedido descreve literalmente: já tem busca ("Buscar anúncio, editor ou conta", linha 703) e período. **Não precisa de regra de agregação nenhuma.**
2. `/criativos` → aba **Desempenho** (`DesempenhoAdsView.tsx`) — grão = CARD, tem período, **não tem busca** (precisa ganhar).
3. `/criativos` → aba **Avaliação** (`AvaliacaoView.tsx`) — já tem tudo; só migra de view.

DE ONDE VEM O DADO

Fonte única: `vw_meta_status` (`nivel='ad'`, coluna `situacao`, 8 valores), ligada ao card por `producao_ads (ad_id PK → producao_id)`. Rótulo e cor saem de `src/features/ads/situacao.ts` via `situacaoDe()` — que já tem fallback para valor desconhecido. A regra continua só no banco; nada de reescrevê-la em TS.

ANTES DE TUDO: refazer `vw_producao_estado_ads` sobre `vw_meta_status`

Hoje ela lê `meta_objetos.effective_status` cru e ignora `status` e `visto_em`. Medido por anúncio, entre os 807 ligados a card:

  status | effective_status | vw_meta_status | vw_producao_estado_ads | ads
  PAUSED | PAUSED           | parado         | pausado        | 595  (concordam)
  ACTIVE | ADSET_PAUSED     | barrado_pelo_pai | **pausado**  | 109  ← divergem
  ACTIVE | ACTIVE           | rodando        | ativo          |  98  (concordam)
  PAUSED | WITH_ISSUES      | parado         | **com_problema** |  3  ← divergem
  ACTIVE | ACTIVE           | ativo_sem_entregar | **ativo**  |   2  ← divergem

Os 109 são exatamente o caso que a migração 20260829b criou `barrado_pelo_pai` para não perder ("alguém LIGOU e o conjunto está pausado" ≠ "alguém desligou"), e a view do card joga os dois no mesmo balaio. Os 3 são literalmente os três anúncios que aquela migração cita no primeiro parágrafo. Os 2 seriam mostrados ao editor como "no ar" sendo que não entregam desde anteontem.

REGRA DE AGREGAÇÃO (vale a pena: 167 cards têm mais de um anúncio e **65 têm anúncios em situações diferentes**)

A pergunta do editor é "ainda roda?", então `rodando` ganha de tudo — não a ordem de `ORDEM_SITUACAO`, que é por "quem pede ação primeiro". Precedência do card:

  no ar        algum anúncio com situacao='rodando'
  pede ação    nenhum rodando, e o PIOR entre bloqueado > ativo_nunca_entregou > ativo_sem_entregar > barrado_pelo_pai > em_analise (nessa ordem, que é a de ORDEM_SITUACAO)
  parado       todos 'parado'
  sem dado     todos os anúncios com visto_em velho (a API não confirma mais)
  sem anúncio  nenhuma linha em producao_ads, ou todas apontam para ad que sumiu

E o selo **carrega a contagem quando é misto**: "no ar (1 de 4)". Esconder isso atrás de um selo único joga fora justamente o que faria o editor abrir o card — e são 8 cards hoje com um anúncio rodando e outro pedindo ação.

O QUE MOSTRAR QUANDO NÃO HÁ ANÚNCIO — e este é o número que muda o desenho

**2.459 dos 2.980 cards postados (82,5%) não têm nenhum anúncio ligado.** A coluna vai ser travessão na esmagadora maioria das linhas. Duas consequências:
- O rótulo tem de distinguir "não rodou" de "não soube ligar": `fn_fixar_vinculo_ads` só liga quando há EXATAMENTE um card candidato, então "sem anúncio" às vezes é ambiguidade de vínculo. Texto: "sem anúncio ligado" em cinza claro, com `title` explicando que o vínculo pode não ter sido feito e que dá para ligar à mão (o modal de vínculo já existe em `CriativosMetaTab`).
- O cabeçalho da lista precisa dizer a cobertura: "171 de 185 cards do período têm anúncio ligado". Sem isso a tela parece quebrada.

OS DOIS TEMPOS (o risco que o pedido já antecipou, medido)

Cards com anúncio rodando HOJE, por mês de postagem: set/26 48 de 78 (59%) · ago/26 22 de 171 (13%) · jul/26 11 de 152 (7%) · jun/26 2 de 35.

Ou seja: filtrando agosto, 87% da coluna responde "morreu" — que é exatamente o que ela quer saber, mas também significa que o valor da tela está nas 22 exceções. Desenho:
- O selo de HOJE fica **colado ao nome**, fora do bloco de métricas, e leva a data no rótulo: "no ar · hoje 16/09".
- Uma linha no cabeçalho da tabela: "Números de 01/08 a 31/08 · Situação de hoje, 16/09". Duas datas visíveis, nunca uma só.
- Quando o período filtrado **não contém hoje**, o selo ganha um traço pontilhado e o `title` "situação de hoje, fora do período que você filtrou".
- `ultimo_gasto` sempre ao lado (`AvaliacaoView` linha 826 já faz): "parado · 12/08" costura os dois tempos — diz quando morreu, e é isso que dá sentido ao período escolhido.
- Filtro/contador no topo, no molde do botão de contradição que já existe: **"só o que ainda roda (22)"**. Coluna sem filtro é armadilha 2; o contador é medido sobre a lista já filtrada, como o de `AvaliacaoView` (o comentário lá conta o bug de ter contado sobre a lista inteira).

O QUE FAZER COM `status_veiculacao`: manter como INTENÇÃO, nunca derivar, e tirar de onde ele é lido como fato

Medido hoje, sobre os 505 cards com anúncio:

  marcado        cards   rodando hoje   verba 7d do que roda
  Encerrado       401         9          R$   944,27
  Rodando          76        68          R$ 24.646,84
  Pausado          28         9          R$  2.636,81
  (sem marcação)   16         4          R$  2.348,38

26 cards divergem (9 Encerrado no ar + 8 Rodando parados + 9 Pausado no ar), e **R$ 3.581,08 saíram em 7 dias de criativo que ela deu por Encerrado ou Pausado**. Os dois campos respondem coisas diferentes — um é julgamento, o outro é fato — e é a contradição que vale ser vista. Então:
- **Não derivar por gatilho**: viraria espelho (armadilha 4 ao contrário) e apagaria a intenção; além disso 2.459 cards ficariam em branco, e 'Bloqueado'/'Arquivado' do CHECK `status_veiculacao_conhecido` não têm equivalente em `situacao`.
- **Não apagar**: cinco telas filtram por ele (`AvaliacaoView` 408, `CalendarioView` 614, `PorProjetoView` 98, `CriativoFormModal`, `CriativoDrawer`).
- **Renomear na interface** para "Marcação" ou "Status (você marcou)", com o selo da Meta sempre embaixo — o nome "Status de Veiculação" é o que faz o campo ser lido como fato.
- **Tirar da linha de ANÚNCIO** em `CriativosMetaTab.tsx:1057` (`· {a.status_veiculacao}`): ali é um campo do CARD colado numa linha de anúncio, ao lado de ROAS e CPA reais. É a pior das aparições dele, e o selo de `situacao` toma o lugar exato.
- **Tirar do SELECT** de `DesempenhoAdsView.tsx:473`, onde é carregado e nunca usado.
- Onde ele coexiste com o fato (aba Avaliação), manter o ⚠ que já existe.

### Banco
MIGRAÇÃO 1 — `fn_criativos_meta_varias_contas`: acrescentar `situacao text` e `ultimo_gasto date` ao RETURNS TABLE e um `left join public.vw_meta_status ms on ms.nivel = 'ad' and ms.objeto_id = a.ad_id` no SELECT final. Nada mais muda; a função já é por `ad_id`.

MIGRAÇÃO 2 — refazer `vw_producao_estado_ads` sobre `vw_meta_status` em vez de `meta_objetos.effective_status` cru. O comentário da migração precisa registrar o motivo com o número: as duas views divergem hoje em 114 dos 807 anúncios ligados a card (109 `barrado_pelo_pai` sendo chamados de 'pausado', 3 `parado` de 'com_problema', 2 `ativo_sem_entregar` de 'ativo'), e os 3 são literalmente os que a migração 20260829b já tinha consertado do outro lado. Estrutura:

  create or replace view vw_producao_estado_ads as
  with por_card as (
    select pa.producao_id,
           count(*) as ads_ligados,
           count(ms.objeto_id) as ads_conhecidos,
           count(*) filter (where ms.situacao = 'rodando') as rodando,
           count(*) filter (where ms.situacao in ('bloqueado','ativo_nunca_entregou',
                 'ativo_sem_entregar','barrado_pelo_pai','em_analise')) as pede_acao,
           count(*) filter (where ms.situacao = 'parado')   as parados,
           count(*) filter (where ms.situacao = 'sem_dado') as sem_dado,
           -- a situação mais grave entre as que pedem ação, pela ordem de ORDEM_SITUACAO
           min(array_position(array['bloqueado','ativo_nunca_entregou','ativo_sem_entregar',
                 'barrado_pelo_pai','em_analise'], ms.situacao)) as pior,
           max(ms.ultimo_gasto) as ultimo_gasto
      from producao_ads pa
      left join vw_meta_status ms on ms.nivel = 'ad' and ms.objeto_id = pa.ad_id
     group by 1)
  select producao_id, ads_ligados, ads_conhecidos, rodando, pede_acao, parados, sem_dado,
         case when ads_conhecidos = 0 then 'sem_anuncio'
              when rodando   > 0 then 'rodando'          -- "ainda roda?" ganha de tudo
              when pede_acao > 0 then (array[...])[pior] -- a pior, nominal, não um balaio
              when parados   > 0 then 'parado'
              when sem_dado  > 0 then 'sem_dado'
              else 'sem_anuncio' end as estado,
         ultimo_gasto
    from por_card;

Duas mudanças de contrato que as telas precisam acompanhar: `estado` passa a usar os mesmos nomes de `vw_meta_status.situacao` (para `situacao.ts` servir os dois), e `rodando`/`pede_acao`/`ads_conhecidos` saem expostos para o selo poder dizer "no ar (1 de 4)" — 167 cards têm mais de um anúncio e 65 têm anúncios em situações diferentes.

GATILHO: nenhum. Tudo é derivado na leitura, de propósito — o estado muda todo dia e guardá-lo seria a armadilha 4. A ponte `producao_ads` já tem quem a mantenha (`fn_fixar_vinculo_ads`, cron horário 'atribuicao-horaria').

RLS: a view nova herda a política das tabelas de base; conferir `FOR ALL TO authenticated USING (true)` como nas irmãs.

ALERTA (reaproveitar infra existente): um código novo em `vw_alertas` para "a Meta não confirma os anúncios há mais de 2 dias" (`sem_dado` acima de um limiar), com linha em `alertas_area` apontando para a página de Criativos. Sem isso, o cron parar faz a coluna inteira virar 'sem dado' em silêncio.

MIGRAÇÃO 3 (opcional, mesma leva): `comment on column producoes.status_veiculacao` registrando que o campo é INTENÇÃO e não fato, e que a fonte do fato é `vw_producao_estado_ads` — para o próximo que abrir a tabela não repetir a leitura errada.

### Riscos
- ARMADILHA 1, JÁ ACONTECENDO: `vw_producao_estado_ads` (criada em 05/09) e `vw_meta_status` (criada em 29/08) respondem a mesma pergunta com regras diferentes e divergem em 114 dos 807 anúncios ligados a card (14,1%) — 109 `barrado_pelo_pai` virando 'pausado', 3 `parado` virando 'com_problema', 2 `ativo_sem_entregar` virando 'ativo'. Espalhar a view do card para mais duas telas antes de refazê-la sobre `vw_meta_status` triplica o custo do conserto.
- ARMADILHA 3 VIVA NO CÓDIGO: `contradiz()` em `AvaliacaoView.tsx` lista 'Rodando'/'Encerrado'/'Pausado' à mão e devolve `false` calado para qualquer outro valor. `criativo_campos_opcoes.status_veiculacao` é editável pelo sócio (`GerenciarOpcoesPopover`), então um valor novo entra sem nunca contradizer nada — e ninguém percebe, porque a falha é um alerta que não aparece. Precisa virar tabela ou ganhar teste que quebre quando a lista do banco crescer.
- ARMADILHA 2: coluna sem contador e sem filtro envelhece. Em agosto, 87% das linhas dirão 'parado' — o valor está nas 22 exceções, e sem o botão 'só o que ainda roda (N)' ninguém as encontra numa lista de 171.
- ARMADILHA 4 SE ALGUÉM ATALHAR: a tentação de gravar `producoes.ativo_hoje` para não fazer JOIN. Seria retrato único precisando de gatilho, e o estado muda todo dia. O estado é derivado sempre, nunca guardado.
- COBERTURA: 82,5% dos cards postados (2.459 de 2.980) não têm anúncio ligado. Sem rótulo e contador de cobertura honestos, a tela parece quebrada — e pior, 'sem anúncio' vai ser lido como 'não rodou' quando às vezes é 'fn_fixar_vinculo_ads não soube ligar' (ela só liga com exatamente um candidato).
- DOIS TEMPOS SEM AVISO: selo de hoje ao lado de verba/ROAS de agosto, sem as duas datas visíveis, produz a conclusão errada ('este AD de agosto está rodando, então o ROAS dele é atual'). As duas datas têm de estar na tela, não no tooltip.
- SILÊNCIO DO CRON: `vw_meta_status` devolve `sem_dado` quando `visto_em < now() - 2 days`. Se a sincronização da Meta parar, a tela inteira vira 'sem dado' sem ninguém saber por quê. Precisa de código em `vw_alertas` + linha em `alertas_area` apontando para a página — a infra já existe e é barata.
- MISTURA DE GRÃO: `vw_producao_estado_ads` é por CARD e `vw_meta_status` é por ANÚNCIO. Cruzar os dois sem cuidado produz números que parecem certos e não são (aconteceu comigo na primeira medição desta análise). Em `/editores → Criativos` o grão já é o anúncio: nada de agregar lá.
- EMPRESA: `vw_meta_status` não carrega `empresa_id`. Em `/criativos` o recorte herda de `producoes.projeto_id` via `useProjetosDaEmpresa()` (e o estado `undefined` já é respeitado nas duas views). Em `/editores → Criativos` o grão é conta de anúncio — conferir que o recorte continua saindo de `ad_accounts → projeto → empresa` e não some no JOIN novo.
- RLS: view nova ou alterada precisa de política; `FOR ALL TO authenticated USING (true)` como as irmãs.
- VERMELHO: `situacao.ts` usa `bg-red-500` e `bg-red-400` em `bloqueado` e `ativo_nunca_entregou`. A regra do CLAUDE.md é vermelho = marca e o que se PERDE. Vale conferir se isso passa em revisão antes de espalhar o mapa para mais duas telas — se não passar, o conserto é num arquivo só, agora, e não em três depois.

### O que NÃO fazer
- Não criar coluna `producoes.ativo_hoje` nem qualquer campo espelho do estado. Armadilha 4, e o estado muda todo dia.
- Não derivar `status_veiculacao` por gatilho a partir da Meta: apagaria a intenção (que é o que torna a contradição visível), deixaria 2.459 cards em branco, e 'Bloqueado'/'Arquivado' não têm equivalente em `situacao`.
- Não apagar `status_veiculacao`: cinco telas filtram por ele (AvaliacaoView, CalendarioView, PorProjetoView, CriativoFormModal, CriativoDrawer).
- Não reescrever a classificação de situação em TypeScript. O comentário no topo de `src/features/ads/situacao.ts` já explica por quê, e ele está certo.
- Não criar uma terceira view de estado. Refazer `vw_producao_estado_ads` sobre `vw_meta_status` e parar por aí.
- Não ler `meta_objetos.status` nem `effective_status` direto no front. Divergem em 4.825 dos 8.123 anúncios; a view já resolveu a ordem certa (intenção antes do impedimento).
- Não usar a ordem de `ORDEM_SITUACAO` como precedência de agregação do card: ela é 'o que pede ação primeiro'. Para o editor, 'rodando' tem de ganhar — senão um card com 3 anúncios no ar e 1 barrado aparece como barrado.
- Não mostrar `status_veiculacao` numa linha cujo grão é o ANÚNCIO (CriativosMetaTab.tsx:1057). O campo é do card.
- Não mostrar 'no ar' em verde sem `ultimo_gasto` ao lado: 'parado' sem data não distingue ontem de junho, e essa diferença muda o que fazer com o criativo.
- Não deixar uma linha em branco quando a situação vier com valor novo do banco — `situacaoDe()` já tem o fallback pronto, usar ele e não `SITUACAO[x]` direto.
- Não entregar coluna sem o contador/filtro 'só o que ainda roda'. Cadastro sem resultado ao lado é o padrão que a armadilha 2 descreve.
- Não mexer, nesta entrega, nos arquivos duplicados não versionados ('CriativosMetaTab (1).tsx', 'TestesTab (1).tsx' e os oito outros do git status) — mas conferir em qual cópia se está editando antes de começar.

### Primeiro passo
Uma migração + um selo, em `/editores → aba Criativos`, que é a única tela onde o pedido não precisa de regra nova nenhuma porque o grão já é o anúncio.

1. Em `fn_criativos_meta_varias_contas` (última versão em `supabase/migrations/20260827zj_...sql`, o SELECT final na linha ~152): acrescentar `ms.situacao` e `ms.ultimo_gasto` ao RETURNS TABLE e um `left join vw_meta_status ms on ms.nivel='ad' and ms.objeto_id = a.ad_id`. Zero conta nova, zero agregação.
2. Em `CriativosMetaTab.tsx`: adicionar os dois campos à interface `Anuncio` (linha 74) e, na linha 1057, **trocar** `· {a.status_veiculacao}` pelo selo de `situacaoDe(a.situacao)` seguido de `· {ultimo_gasto}`. Subir o selo também para a linha fechada, colado ao `ad_nome`, com o rótulo levando a data de hoje.
3. Cabeçalho da lista: "Números de {início} a {fim} · Situação de hoje, {hoje}".
4. Um chip de filtro "só o que ainda roda (N)", contado sobre a lista já peneirada pela busca e pelos filtros — o comentário em `AvaliacaoView.tsx` (~linha 505) conta o bug de contar sobre a lista inteira; não repetir.

A busca e o período já existem nessa tela, então isso entrega o pedido inteiro — filtrar data ou pesquisar um AD e ver se ele roda hoje — sem tocar em `vw_producao_estado_ads`, sem regra de agregação e sem mexer em `status_veiculacao` no banco. Só depois disso, com o padrão validado na tela real, vale refazer `vw_producao_estado_ads` sobre `vw_meta_status` e levar o selo (aí sim agregado, com a contagem "1 de 4") para a aba Desempenho, que na mesma passada ganha o campo de busca que hoje não tem.

### Furos que os céticos abriram (3)
- **[confiança alta]** O primeiro passo se apoia numa premissa falsa sobre a tela que ele escolheu: "/editores → aba Criativos … grão = ANÚNCIO. Não precisa de regra de agregação nenhuma". Não é o grão dessa tela desde o "criativo como unidade". Em `src/features/editores/components/CriativosMetaTab.tsx:450-457`, as linhas de `fn_criativos_meta` são agrupadas por `producao_id` (`k = a.producao_id ?? 'ad:' + a.ad_id`) e passadas por `somarCriativo` (linha 122-160), que faz `const ordenado = [...grupo].sort((a,b) => b.investimento - a.investimento); const base = ordenado[0]; return { ...base, <só os absolutos somados> }`. Ou seja: TODO campo escalar que não esteja na lista de somas herda, calado, o valor do ANÚNCIO QUE MAIS GASTOU. `situacao` e `ultimo_gasto`, do jeito que o desenho manda acrescentá-los (migração 1 + interface `Anuncio` linha 74), caem exatamente nesse caso.

Medido agora no banco, com o período de agosto e o filtro padrão da tela (esconde < R$ 50):
- a tabela mostra 144 linhas (não 360 anúncios — 229 linhas sem o corte de R$ 50, 83 delas juntando mais de um anúncio);
- 20 dessas linhas têm anúncio rodando HOJE;
- em 10 delas (50%) o anúncio de maior gasto NÃO é o que roda — o selo diria "Parado" ou "Pai pausado" para criativo que está no ar.
Nos últimos 30 dias: 287 linhas, 92 ainda rodando, 13 rotuladas como mortas carregando R$ 27.524,52 de verba; e `ultimo_gasto` sai errado em 28 linhas (35 em agosto), porque também vem do `base` em vez de `max()` do grupo.

O efeito colateral pior é o chip proposto: "só o que ainda roda (N)", contado sobre essas linhas, diria 10 quando são 20 em agosto. Ele esconderia metade exatamente das exceções que o próprio desenho define como o único valor da tela ("o valor está nas 22 exceções"). E o erro é silencioso: nada na tela denuncia, porque a linha fechada já mostra "N anúncios" (linha 980) sem dizer que o estado é de um só deles.

Dois defeitos menores na mesma migração 1: (a) a função se chama `public.fn_criativos_meta(date,date,uuid[])` — `fn_criativos_meta_varias_contas` é só o NOME DO ARQUIVO da migração, a string não existe em lugar nenhum do código; (b) acrescentar coluna ao `RETURNS TABLE` muda o tipo de retorno e o `CREATE OR REPLACE` recusa — precisa de `DROP FUNCTION` antes, como a própria 20260827zj registra no comentário para o caso do parâmetro.
  - *Conserto:* O desenho não precisa ser jogado fora — ele já escreveu a regra certa, só a colocou na fase errada. A precedência "rodando ganha de tudo > pior entre as que pedem ação > parado > sem_dado" tem de entrar NO PRIMEIRO PASSO, dentro de `somarCriativo`, e não só na `vw_producao_estado_ads` da fase 2:

1. Migração 1, corrigida: `DROP FUNCTION public.fn_criativos_meta(date,date,uuid[]);` e recriar com `situacao text` e `ultimo_gasto date` no `RETURNS TABLE` + `left join public.vw_meta_status ms on ms.nivel='ad' and ms.objeto_id = a.ad_id`. Conferido: o join é seguro (8.232 anúncios, 0 objeto_id duplicado, 17 ms de custo) e a cobertura é total — 360 de 360 anúncios de agosto e 385 de 385 dos últimos 30 dias têm linha em `vw_meta_status`, todos com `visto_em` de hoje e `ultimo_gasto` preenchido. O dado existe; o problema é só onde ele é lido.

2. Em `somarCriativo`, acrescentar explicitamente:
   `situacao: grupo.some(a => a.situacao === 'rodando') ? 'rodando' : <a pior entre bloqueado > ativo_nunca_entregou > ativo_sem_entregar > barrado_pelo_pai > em_analise, pela ordem de ORDEM_SITUACAO> ?? (todos 'parado' ? 'parado' : 'sem_dado')`, e `ultimo_gasto: max do grupo`. Guardar também `rodando: N` e `anuncios.length` para o selo dizer "no ar (1 de 4)" — em agosto são 37 linhas com anúncios em situações diferentes, e nelas o número é a informação.
   Reaproveitar `ORDEM_SITUACAO` de `src/features/ads/situacao.ts` para não escrever a ordem duas vezes; a classificação continua no banco.

3. O selo por ANÚNCIO vai no bloco expandido, onde `a.anuncios.map` já existe (linha 1108) — é lá que o grão é o anúncio, não na linha fechada.

4. O chip "só o que ainda roda (N)" filtra por `a.situacao === 'rodando'` DEPOIS dessa agregação, contado sobre a lista já peneirada (busca, editor, R$ 50) — e vale lembrar que o corte padrão de `INVESTIMENTO_RELEVANTE = 50` esconde criativo recém-subido, que é justamente quando o editor mais pergunta "está no ar?": o contador precisa somar sobre o mesmo recorte que a tela mostra, ou avisar quantos ficaram fora.

5. Na fase 2, ao refazer `vw_producao_estado_ads`, fechar o buraco do nono valor: `vw_meta_status` devolve `desconhecido` (o `else` da 20260829b, criado de propósito contra a armadilha 3) e o `case` proposto não o cita — ele cairia no `else 'sem_anuncio'`, que a tela traduz como "sem anúncio ligado / o vínculo pode não ter sido feito". Hoje são 0 anúncios nesse estado, então é latente, mas o conserto é uma linha: `else 'desconhecido'` no lugar do `else 'sem_anuncio'`, e `situacaoDe()` já mostra valor cru em cinza.
- **[confiança alta]** ARMADILHA 3, duas vezes, e a segunda apaga em silêncio a única tela que hoje funciona.

(A) A MIGRAÇÃO 2 enumera as situações à mão e esquece a nona. O desenho diz "coluna `situacao`, 8 valores" e monta os buckets com `rodando` + 5 de `pede_acao` + `parado` + `sem_dado`. Mas `vw_meta_status` (supabase/migrations/20260829b, linha do CASE) termina com `else 'desconhecido'`, escrito lá com este comentário: "Valor que a Meta inventou depois: aparece como desconhecido em vez de cair calado num balaio. Terceira armadilha do CLAUDE.md". Na view proposta, um card cujos anúncios sejam todos `desconhecido` tem `ads_conhecidos > 0` e todos os contadores em zero — cai no `else 'sem_anuncio'`. A tela dirá "sem anúncio ligado", em cinza claro, para um card que TEM anúncio rodando dinheiro, no meio de 82,5% de travessões onde ninguém vai reparar. A migração 2 desfaz no nível do card exatamente o conserto que a 20260829b fez no nível do anúncio. Some a isso que a mesma lista de 5 valores aparece três vezes dentro da view (filter, array_position, array de índice) e uma quarta vez como ORDEM_SITUACAO em src/features/ads/situacao.ts — que no cabeçalho declara não duplicar a regra "porque em três meses ela discordaria da view". O desenho duplica a ordem. Isso é armadilha 1 nascendo no mesmo commit que promete matá-la.

(B) Mais grave e concreto: a "mudança de contrato" (renomear `estado` para os nomes de `situacao`) quebra a aba Avaliação sem erro nenhum. Em src/features/criativos/components/AvaliacaoView.tsx:232, `ESTADO_ADS` é um Record fixo com as chaves `ativo | pausado | reprovado | com_problema | sem_anuncio` — e a linha 807 é `{c.estado_ads && ESTADO_ADS[c.estado_ads] && (...)}`. Sem fallback, ao contrário de `situacaoDe()`. Com 'ativo' virando 'rodando' e 'pausado' virando 'parado', a condição vira falsa em TODAS as linhas: some o selo de estado, some o `· ultimo_gasto` (linha 826) e some o ⚠. Junto, `contradiz()` (linhas 253-257) compara `estado === 'pausado' | 'ativo' | 'sem_anuncio'` e passa a devolver `false` para todo mundo — o contador da linha 518 zera e o filtro da 524 devolve lista vazia. O resultado na tela é "zero contradições", que se lê como "está tudo certo", justamente sobre os 26 cards e os R$ 3.581,08 em 7 dias que o próprio desenho mediu. O desenho cita `contradiz()` nos riscos, mas só pelo lado do `marcado` ('Rodando'/'Encerrado'/'Pausado'); o lado que a migração 2 dele quebra é o do `estado`, e ele escreve "manter o ⚠ que já existe" — o ⚠ não sobrevive à migração 2.
  - *Conserto:* O desenho se salva inteiro, e o primeiro passo (aba Criativos + `fn_criativos_meta_varias_contas`) não é tocado por nada disso — ele já usa `situacaoDe()`, que tem fallback. Três correções, todas na fase 2:

1. Derivar a lista, não escrevê-la. Criar `meta_situacoes(codigo pk, ordem int, pede_acao bool, rotulo, e_final bool)` e fazer `vw_meta_status`, a view do card e `situacao.ts` lerem dela. `pede_acao` vira `join meta_situacoes s on s.codigo = ms.situacao and s.pede_acao`, e a precedência vira `min(s.ordem)` — some o array repetido três vezes e some a ordem duplicada entre TS e SQL. É o que o CLAUDE.md pede na armadilha 3 ("derivar de tabela, nunca listar no código"). Se preferir não criar tabela agora, o mínimo é um teste que leia os valores distintos de `vw_meta_status.situacao` e falhe quando aparecer um que a view do card não classifique.

2. O `else` da view do card nunca pode ser 'sem_anuncio'. Acrescentar `outros = count(*) filter (where ms.situacao is not null and ms.situacao not in (<os conhecidos>))` e um ramo `when outros > 0 then 'desconhecido'` antes do fim, com o `else` final só para `ads_conhecidos = 0`. 'sem_anuncio' tem de significar exclusivamente "não há linha em producao_ads ou o ad sumiu da API" — é a distinção que o próprio desenho diz querer preservar na UI.

3. Trocar `ESTADO_ADS` por `situacaoDe()` NA MESMA migração, não depois. Concretamente, em AvaliacaoView.tsx: apagar o Record da linha 232, trocar a guarda da 807 por `{c.estado_ads && (...)}` usando `situacaoDe(c.estado_ads)` (que devolve o valor cru em cinza para chave desconhecida, exatamente o comportamento desejado), e reescrever `contradiz()` para os nomes novos — 'Rodando' contradiz qualquer coisa que não seja 'rodando'; 'Encerrado'/'Pausado' contradizem 'rodando'. Antes de mexer, capturar o número de contradições de hoje (26) e usá-lo como teste de regressão: se depois do rename o contador não voltar a 26, a migração comeu o ⚠. Sem esse número guardado, a quebra é invisível — que é o modo de falhar da armadilha 3.

Ordem sugerida: fase 1 como está (ela entrega o pedido e não depende de nada acima) → tabela `meta_situacoes` + teste → migração 2 e a troca do ESTADO_ADS no mesmo commit.
- **[confiança alta]** O "primeiro passo" se apoia numa premissa falsa sobre a tela: **a linha de `/editores → Criativos` NÃO é um anúncio, é um CARD agregado**. Em `src/features/editores/components/CriativosMetaTab.tsx:450-457`, `const criativos = useMemo(...)` agrupa `dados` por `producao_id` e passa cada grupo por `somarCriativo()` (linha 122); `LinhaAnuncio` recebe `a: Criativo` (linhas 943-944), e a linha fechada já carrega o selo "{N} anúncios" (linhas 980-984, title: "Os números aqui somam todos"). O comentário medido na linha 1091-1093 diz o tamanho: **81% do investimento está em criativos partidos em mais de um anúncio** (68 de 188 em agosto). Logo, "Não precisa de regra de agregação nenhuma" e "zero agregação" são falsos exatamente onde está o dinheiro: o passo 2 ("subir o selo colado ao `ad_nome`") precisa da precedência e do "no ar (1 de 4)" NO DIA UM — o que o desenho adiou para a fase 2 junto com `vw_producao_estado_ads`. Pelo mesmo motivo o chip "só o que ainda roda (N)" conta criativos, não anúncios: um card com 1 de 4 rodando entra inteiro na contagem, e o editor lê "roda" onde 3 de 4 morreram. E a crítica ao `· {a.status_veiculacao}` da linha 1057 erra o alvo: ele está dentro do bloco "Hipótese" do painel expandido do CARD, ao lado de `a.projeto` (linha 1056) — campo de card ao lado de campo de card, não "colado numa linha de anúncio ao lado de ROAS e CPA". O único lugar da tela com grão de anúncio é a sub-tabela das linhas 1094-1133 (Conta · Estreia · Investido · Vendas · ROAS · CPA), que o desenho não menciona.

Segundo tempo do mesmo furo, e este mata o pedido literal ("pesquisar um AD e ver se ele roda HOJE"): a tela não consegue mostrar o anúncio que subiu hoje. (a) `recorte` (linha 503-506) casa a busca contra `a.ad_nome` do `Criativo`, que vem de `...base` = o anúncio de MAIOR investimento do card (`somarCriativo`, linhas 123-124) — procurar pelo nome de um anúncio irmão não devolve nada. (b) `fn_criativos_meta` (`supabase/migrations/20260827zj_...sql`, CTEs `contas_ativas` e `ad`) só devolve `ad_id` com linha em `metricas_meta` DENTRO do período e em conta com investimento > 0 no período: anúncio ativo que ainda não entregou não tem linha nenhuma, então `ativo_nunca_entregou`, `em_analise` e `bloqueado`-antes-de-gastar **nunca poderão aparecer** na coluna nova — o `left join` vai parecer completo e a metade "pede ação" do vocabulário de `vw_meta_status` fica invisível justamente ali. (c) `INVESTIMENTO_RELEVANTE = 50` (linha 201) esconde por padrão quem gastou menos de R$ 50 no período — o anúncio de hoje é exatamente esse. O resultado é o vazio da linha 786, "Nenhum anúncio com esses filtros no período selecionado", indistinguível de "esse anúncio não existe". O desenho trata o descasamento hoje × período como tooltip e borda pontilhada; na prática ele é a lista inteira não conter a linha.
  - *Conserto:* O desenho continua certo no diagnóstico (fonte = `vw_meta_status`, nada de derivar `status_veiculacao`, nada de gravar `ativo_hoje`). Muda só o passo 1:

1. **Assumir a agregação já no passo 1, e fazê-la onde os dados já estão.** A migração 1 permanece como está (`situacao` e `ultimo_gasto` por `ad_id`, sem agregar). A precedência ("rodando ganha de tudo; senão a pior que pede ação; senão parado") entra em `somarCriativo()` (linha 122), que já soma os anúncios do grupo na memória — o "no ar (1 de 4)" sai de graça de `a.anuncios`, sem view nova e sem regra duplicada em SQL. Quando `vw_producao_estado_ads` for refeita sobre `vw_meta_status`, a tela troca o cálculo local pelo campo da view e a regra volta a morar só no banco; registrar isso no comentário para não virar armadilha 1.
2. **Selo por anúncio na sub-tabela das linhas 1094-1133**, como coluna "Hoje" ao lado de Estreia — é o único grão de anúncio da tela, e é onde o editor confere o AD específico. Na linha fechada, selo agregado com a contagem: "no ar (1 de 4)".
3. **Chip com os dois números**: "só o que ainda roda (3 criativos · 4 anúncios)", contado sobre `recorte`; e estado vazio próprio quando N = 0 ("nenhum criativo deste recorte está no ar hoje"), senão o chip desaparecido vira dúvida.
4. **Busca casando o grupo inteiro**: `a.anuncios.some(x => x.ad_nome?.includes(b) || x.ad_id === b)`, não só o `ad_nome` do base.
5. **Vazio que conta o segundo tempo**: quando a busca não encontra nada e o período não contém hoje, o texto da linha 786 oferece a saída ("esse anúncio pode estar rodando fora do período — ver hoje"), e o caminho para o anúncio sem gasto no período é uma consulta direta a `vw_meta_status` por `ad_id`/nome, fora do recorte de `metricas_meta`. Sem isso, o pedido do editor ("subiu hoje, está no ar?") continua respondido com um vazio que mente.
6. **Cabeçalho com as duas datas** como o desenho propõe, mas dizendo o grão: "Números de {ini} a {fim} · Situação de hoje, {hoje} · linha = criativo, {N} anúncios dentro" — o cabeçalho da coluna hoje diz "Anúncio" (linha 804) numa tabela de criativos, e é essa ambiguidade que produziu o erro do desenho.

Sobre o alerta de `sem_dado`: manter a infra proposta, mas conferir o dono antes de apontar `alertas_area` para Criativos — cron da Meta parado não se resolve na tela do editor (`ProducaoNivel = membro`), e alerta sem botão na página onde aparece é exatamente o ruído que se aprende a ignorar. Ou ele vai para a página de Meta Ads/integração (onde se resolve) com um aviso passivo em Criativos ("a Meta não confirma desde {data}"), ou ganha ação própria ali (botão de re-sincronizar).

---

## Acusar AD bom parado em campanha de TESTE em vez de ESCALA

**Chave:** `escala-vs-teste` · **Esforço:** medio

### Veredito
Refutado como alerta, confirmado como relatório. Os nomes já não separam nada: TESTE carrega R$ 214.685 (80% da verba) contra R$ 53.177 de ESCALA, e o CPA das duas é praticamente o mesmo — TESTE VSL 50,70 · TESTE TSL 48,85 · ESCALA VSL 47,39, uma diferença de 6,5% que é menor que o ruído de um anúncio individual. Um alerta "anúncio bom parado em TESTE" nomearia na primeira manhã a ordem de 70 a 80 dos 100 anúncios rodando hoje, e estaria errado nos 80: eles não estão parados no teste, eles ESTÃO na campanha principal.

### Desenho
POR QUE O PEDIDO NÃO FECHA, EM TRÊS NÚMEROS

1) O nome não descreve a função. `TESTE VSL - 08/04/26` roda há 93 dias, R$ 878/dia, 139 anúncios, 1.610 compras. Isso não é um teste, é a operação. `ESCALA VSL - 03/07/26` roda 62 dias a R$ 336/dia — 38% do gasto diário da "campanha de teste". A regra que a usuária pediu leria o painel ao contrário: apontaria o motor como sendo a bancada.

2) O ganho que o alerta perseguiria é 6,5% e provavelmente é zero. CPA 50,70 (TESTE VSL) contra 47,39 (ESCALA VSL). Pior: a seta causal aponta para o outro lado. Campanha ESCALA tem CPA melhor porque RECEBE os anúncios que já venceram, não porque escalar melhore alguma coisa. Os 6,5% são um teto de um número que, tirado o viés de seleção, pode ser 0 ou negativo.

3) "Bom" não existe no nível do anúncio com esta densidade. 1.610 compras / 139 anúncios = 11,6 compras por anúncio na maior campanha do período. O erro relativo de um CPA com 11,6 conversões é ~1/√11,6 = 29%. O ruído é 4,5 vezes maior que o efeito de 6,5%. Some a isso: só 32,2% dos dias-anúncio têm ao menos 1 compra, e a vida média de um anúncio é 5,8 dias (só 30% passam de 7). Não há como um anúncio "provar" que é bom dentro da própria vida.

A PERGUNTA CERTA É OUTRA, E É DE OPERAÇÃO

"Por que 80% da verba está em campanhas chamadas TESTE?" Há duas respostas possíveis e o painel não sabe qual é:
(a) a operação não tem etapa de escala — tudo continua rodando onde nasceu, e "escalar" é um ritual que ninguém executa. Nesse caso o alerta pediria um trabalho inexistente.
(b) a operação escala, mas a convenção de nome apodreceu — campanha velha guarda o prefixo para sempre.

Os números apontam (a). Software nenhum conserta (a); o que software faz é MOSTRAR (a) com clareza suficiente para a decisão ser tomada por quem manda na verba.

O DESENHO: RELATÓRIO PRIMEIRO, PAPEL DEPOIS, ALERTA TALVEZ

── Passo 1 · a coluna de comportamento medido (sem campo novo, sem escrita)

View nova `vw_campanha_papel_medido`, uma linha por `campanha_id` no período, lendo `metricas_meta` (nível 'ad', que já traz `campanha_id`, `adset_id`, `ad_id` e `empresa_id` carimbado) e `vw_meta_status`:

  campanha_id, campanha_nome, ad_account_id, empresa_id
  idade_dias            = current_date − min(data com investimento > 0)
  dias_com_gasto
  investimento, investimento_dia
  share_da_verba        (fatia da conta no período)
  ads_distintos         (ad_id com gasto)
  ads_rodando           (join vw_meta_status nivel='ad' + campanha_id, situacao='rodando')
  verba_por_ad_ativo_dia = investimento_do_dia / ads com gasto NAQUELE dia, mediana dos dias
  compras_meta, cpa
  initiate_checkout, custo_por_ic
  confianca_atribuicao  (compras_meta × pedidos que casam, por conta)

Onde mora: `/meta-ads`, aba **Campanhas**, que já existe e já lista campanha com 24 colunas. Nenhum item novo na sidebar (sidebar plana), nenhuma tela nova. Entram 4 colunas ao lado das que já estão: `Idade`, `Ads rodando`, `R$/ad ativo/dia`, `Fatia da verba`. Cabeçalho da aba ganha uma linha de resumo: "15 campanhas com TESTE no nome concentram 80% da verba; a maior roda há 93 dias".

Isso já responde o pedido de verdade. A usuária pediu "ver os ads ativos ou não em campanhas ESCALA, os bons em TESTE" — ela quer enxergar a distribuição. A distribuição aparece por campanha, não por alerta.

── Passo 2 · o papel declarado (só se o passo 1 mostrar dois comportamentos)

Papel de campanha é INTENÇÃO, e intenção não se deriva de dado. É a mesma doutrina que `vw_meta_status` já escreve: `status` (a chave que a pessoa virou) vem antes de `effective_status` (o que de fato acontece). Por isso a tabela ganha do critério derivado — um limiar de "poucos anúncios e verba alta" inventaria uma fronteira que hoje, medida, não existe.

  create table campanhas_papel (
    campanha_id   text primary key,      -- id da Meta, global; TEXT como em meta_objetos
    ad_account_id uuid references ad_accounts(id),
    papel         text not null default 'sem_papel'
                  check (papel in ('teste','escala','remarketing','sazonal','sem_papel')),
    definido_por  uuid, definido_em timestamptz not null default now()
  );
  -- RLS: for all to authenticated using (true) with check (true)

SEM foreign key para `meta_objetos` e SEM cascade: campanha some da API e a intenção tem que sobreviver ao sumiço.

Manutenção: um `<select>` na PRÓPRIA linha da aba Campanhas, ao lado dos números medidos. Não uma tela de cadastro em Configurações — cadastro sem coluna de resultado ao lado é a armadilha 2, e aqui o resultado é justamente o que corrige o julgamento: ninguém marca "teste" olhando para R$ 878/dia e 93 dias de idade.

O par declarado × medido NÃO é a armadilha 1. A armadilha 1 é dois campos dizendo a MESMA coisa; aqui um diz a intenção e o outro diz o comportamento, exatamente como status × effective_status. A salvaguarda é que `papel_medido` nunca vira coluna gravada — vive só na view.

Contra a armadilha 4 (retrato único sem gatilho): `campanhas_papel` nasceria de um preenchimento à mão das ~31 campanhas de hoje, e campanha criada amanhã no gerenciador ficaria fora em silêncio — que é literalmente o caso `funil_checkouts`. O gatilho é um alerta: `campanha_sem_papel`, disparando quando uma campanha gastou nos últimos 7 dias e não tem linha. Linha em `alertas_area`: ('campanha_sem_papel', 'meta-ads').

── Passo 3 · o alerta, se sobreviver às duas semanas

Só então `fn_alerta_ad_bom_em_campanha_de_teste`, com `alertas_area` → 'meta-ads', e com "bom" definido honestamente:
  · ≥ 15 compras acumuladas (abaixo disso o CPA não significa nada), E
  · CPA ≥ 30% abaixo do CPA da própria campanha (efeito real, não ruído), E
  · `vw_meta_status.situacao = 'rodando'`, E
  · a campanha declarada 'teste' E medida como escala, OU o anúncio bom numa campanha declarada 'teste' que de fato se comporta como teste.

Nas contas Saponaria (~40% da verba, casamento 24% e 0%) o critério troca `compras_meta` por `custo_por_initiate_checkout`: o IC vem do pixel na página de checkout e não depende da UTM sobreviver. Usar compras_meta ali é opinar sobre número que o banco desmente.

### Riscos
- O alerta nasce disparando sobre a ordem de 70 a 80 dos 100 anúncios que rodam hoje. A migração 20260825l existe justamente para que a faixa amarela não vire papel de parede — um alerta que nomeia 80% do que está no ar ensina a ignorar a faixa, inclusive quando ela for verdadeira. É o mesmo estrago que o banner de 13 alertas em todas as páginas fazia.
- Classificar campanha por `ilike '%TESTE%'` / `'%ESCALA%'` é a armadilha 3 na forma mais pura: lista fixa no código que envelheceu em silêncio — e aqui ela já está comprovadamente podre, porque a campanha chamada TESTE tem 93 dias, 139 anúncios e CPA igual ao da ESCALA.
- `campanhas_papel` preenchida à mão uma vez é a armadilha 4: carga inicial sem gatilho. Campanha criada amanhã no gerenciador não teria linha, o alerta deixaria de cobri-la e NADA na tela denunciaria — a fila continuaria mostrando as mesmas 31. Mitigação obrigatória: default 'sem_papel' explícito + alerta `campanha_sem_papel` na própria página de Meta Ads.
- Se alguém tornar `papel` declarado e `papel_medido` dois campos GRAVADOS e editáveis, vira armadilha 1 e eles divergem. Enquanto o medido for só view, é o mesmo arranjo legítimo de `status` × `effective_status`, que a 20260829b já defende.
- Tela de escolher papel sem os números medidos na mesma linha é armadilha 2: cadastro sem coluna de resultado ao lado. Sem ver 'R$ 878/dia, 93 dias, 139 ads', a pessoa marca 'teste' pelo nome — que é exatamente o erro que o recurso deveria corrigir.
- Atribuição: as contas Saponaria são ~40% da verba e casam 24% (Saponaria) e 0% (Saponaria Brasil-VSL). Um alerta que decide 'este anúncio é bom' por `compras_meta` nessas contas está opinando sobre número que o banco desmente — a regra de leitura do CLAUDE.md aplicada a um alerta que se auto-justificaria.
- Densidade: 68% dos dias-anúncio não têm compra nenhuma e a média é 1,01 compra/dia, então CPA e ROAS DIÁRIOS são indefinidos por divisão por zero. Qualquer regra do tipo '3 dias seguidos em queda' não tem substrato; só 30% dos anúncios chegam a 7 dias.
- Falso conserto: o painel recomendaria mover o anúncio para ESCALA com base numa diferença de 6,5% cuja causa provável é viés de seleção — ESCALA tem CPA melhor porque recebe vencedores, não porque escalar funcione. O painel estaria emitindo conselho operacional sem evidência causal, e podendo piorar o resultado.
- Usar `producoes.status_veiculacao` como fonte de 'está rodando' repete o erro já medido: 26 dos 470 cards comparáveis divergem (Pausado erra 32%), e 2.134 cards têm status sem anúncio nenhum atrás. `DesempenhoAdsView.tsx` já lê esse campo na linha 473 — ele é dívida, não fonte.

### O que NÃO fazer
- Não classificar campanha lendo o nome (`ilike '%TESTE%'`, `'%ESCALA%'`, regex, prefixo). Está medidamente errado hoje e envelhece em silêncio amanhã.
- Não ligar o alerta antes do relatório e antes das duas semanas de contagem em sombra. Alerta que nasce nomeando 80% do que roda não é alerta.
- Não criar `producoes.papel`, nem coluna booleana 'deveria escalar' no anúncio, nem espelho de papel em `metricas_meta`. Papel é da campanha, e retrato gravado sem gatilho é a armadilha 4.
- Não usar `producoes.status_veiculacao` para saber se o anúncio roda — a fonte é `vw_meta_status.situacao = 'rodando'`.
- Não usar `compras_meta` como prova de 'anúncio bom' nas contas Saponaria (24% e 0% de casamento). Ali o sinal é `initiate_checkout`, que vem do pixel e não depende da UTM.
- Não calcular CPA ou ROAS por dia para decidir nada: são indefinidos em ~68% dos dias-anúncio.
- Não construir botão que mexa na Meta (mover, duplicar, pausar). O escopo é leitura; ação destrutiva ou irreversível fora do painel não entra por um alerta.
- Não criar item novo na sidebar nem sub-item aninhado. Isso é coluna e resumo dentro da aba Campanhas de `/meta-ads`.
- Não pôr `on delete cascade` de `meta_objetos` para `campanhas_papel`: campanha some da API, a intenção tem que sobreviver.
- Não reescrever a regra de situação em TypeScript para filtrar 'rodando' — `src/features/ads/situacao.ts` diz explicitamente que a regra mora na view.

### Primeiro passo
Criar `vw_campanha_papel_medido` (uma linha por campanha: idade_dias, dias_com_gasto, investimento_dia, ads_distintos, ads_rodando via `vw_meta_status`, verba_por_ad_ativo_dia, cpa, custo_por_ic, share_da_verba, empresa_id) e expor 4 colunas novas na aba Campanhas de `/meta-ads`: Idade · Ads rodando · R$/ad ativo/dia · Fatia da verba, com uma linha de resumo no topo dizendo quanto da verba está em campanhas com TESTE no nome. Zero escrita, zero campo novo, zero alerta — esforço baixo, e já entrega a resposta que a usuária realmente quer ver.

O NÚMERO PARA OLHAR POR DUAS SEMANAS: a distribuição diária de `verba_por_ad_ativo_dia` por campanha (investimento do dia ÷ anúncios com gasto naquele dia). É a única grandeza que separa mecanicamente testar de escalar — teste espalha pouca verba em muitos anúncios, escala concentra muita verba em poucos. Estimativa grosseira de hoje na TESTE VSL: R$ 878/dia sobre ~8,7 anúncios ativos por dia ≈ R$ 101/ad/dia; o número real precisa ser medido, e é isso que as duas semanas fazem.
 · Se o histograma for BIMODAL, o limiar mora no vale e a tabela `campanhas_papel` nasce com o passo 2.
 · Se for UNIMODAL, está provado que a operação tem um tipo de campanha só, o pedido morre aqui, e o achado vai para a reunião e não para o código.
Segundo número, em paralelo: rodar a regra candidata em sombra e registrar quantos anúncios ela nomearia POR DIA. Meta: ≤ 5/dia. Acima disso o alerta não entra.

### Furos que os céticos abriram (3)
- **[confiança alta]** A coluna "Idade" — que é justamente a que carrega o argumento do desenho — está especificada como `idade_dias = current_date − min(data com investimento > 0)`, e esse número é CENSURADO pela janela do `metricas_meta`. Medido agora: a tabela começa em 2026-05-01 (139 dias distintos, nada antes). Consequência, nas três campanhas mais caras: `TESTE VSL - 08/04/26` daria idade 138, e `meta_objetos.criado_em_meta` diz 2026-04-07 → 162 dias reais; `TESTE - 08/04/26` idem (138 vs 162); `ESCALA TSL - 18/12` daria os MESMOS 138, quando foi criada em 2025-12-17 → 273 dias. Erro de 135 dias, e a coluna mostraria a ESCALA como mais NOVA que a TESTE VSL quando ela é 111 dias mais velha. Toda campanha anterior a 01/05 empilha no mesmo valor (a idade do DADO, não da campanha), esse valor cresce +1 por dia sozinho, e no dia em que o sync puxar histórico anterior todos os números pulam sem nada na tela explicando — o tipo de número que envelhece em silêncio. Pior: o campo certo já existe e está 100% preenchido — `meta_objetos.criado_em_meta`, 2.016/2.016 campanhas e 8.232/8.232 anúncios, o mais antigo em 2023-10-10. O próprio veredito herda o defeito: os "93 dias de gasto" da TESTE VSL são o tamanho da janela de 92 dias da consulta, não a idade dela (162 dias reais, 139 dias com gasto, R$ 111.341,77 no total, 211 anúncios na série inteira). Como o passo 2 depende de a pessoa olhar "R$ 878/dia, 93 dias, 139 ads" para não marcar 'teste' pelo nome, a única coluna que ela olharia para julgar idade está errada exatamente nas campanhas velhas que motivam o recurso. Dois furos menores da mesma lente: (a) `vw_campanha_papel_medido` é VIEW e view não aceita parâmetro, mas todas as colunas são "no período" — e a aba Campanhas é alimentada por `fn_metricas_meta_agregado(p_inicio, p_fim, p_contas, p_empresa)` (src/features/ads/pages/MetaAdsPage.tsx:416-420, deps startDateStr/endDateStr/contaIds/empresaId). Quatro colunas de janela fixa ao lado de 24 que respondem ao cabeçalho = duas contabilidades na mesma linha, que é o defeito que já custou a ESTA tela "R$ 25.082,09 na tela contra R$ 102.541,16 no banco" (migração 20260828l). E `share_da_verba` vira 100% sempre que a usuária filtra uma conta só. (b) O "número para olhar por duas semanas" já está medido e já respondeu: mediana de R$/ad ativo/dia em 30 dias dá TESTE 138,31 · 52,10 · 47,67 · 47,06 · 46,28 · 28,88 contra ESCALA 63,57 · 54,77 · 22,52 · 22,29 · 17,82 · 14,06 — as duas famílias se sobrepõem, a maior de todas é uma TESTE e uma ESCALA fica acima de quatro TESTEs. Não é bimodal, e há 138 dias de histórico para provar isso hoje, sem esperar.
  - *Conserto:* Nada do desenho precisa ser jogado fora; três emendas. 1) `idade_dias` sai de `meta_objetos.criado_em_meta` (LEFT JOIN por `objeto_id` = `campanha_id`, `nivel='campanha'` — 100% preenchido, histórico desde 2023), e o que vem de `metricas_meta` (dias_com_gasto, investimento, CPA) fica rotulado como "desde 01/05/2026, início da série" para ninguém confundir cobertura com idade. Onde `criado_em_meta` for nulo (medi 1 caso: 'TESTE - 05/05'), mostrar "—", nunca o mínimo da métrica: ausência aparece, não se preenche por chute. 2) Trocar a view por `fn_campanha_papel_medido(p_inicio, p_fim, p_contas, p_empresa)` — ou, melhor ainda, acrescentar as quatro grandezas dentro de `fn_metricas_meta_agregado`, que já existe, já recebe os quatro filtros e já devolve jsonb sem teto de 1.000 linhas. Assim as 4 colunas novas e as 24 antigas falam do mesmo período. `ads_rodando` continua vindo de `vw_meta_status` (verificado: 8.232 anúncios, 98 'rodando', ZERO com `campanha_id` nulo — o join duplo até a campanha está sólido), mas com o rótulo "agora", porque é estado, não período. 3) Cancelar a espera de duas semanas e rodar o histograma sobre os 138 dias que já existem: pelo que medi ele já está unimodal/sobreposto, o que aciona o próprio critério do desenho — o pedido morre no passo 1, `campanhas_papel` não nasce, e o achado vai para a reunião em vez de virar tabela. Quem quiser confirmar antes: a consulta é a mediana de (investimento do dia ÷ anúncios com gasto no dia) por campanha em `metricas_meta` nivel='ad', que cobre 99,8% do gasto (R$ 269.010,57 de R$ 269.553,70 no nível campanha nos 92 dias).
- **[confiança alta]** ARMADILHA 1, no coração do Passo 1: a view `vw_campanha_papel_medido` calcula RAZÕES no SQL (cpa, custo_por_ic, investimento_dia, share_da_verba). Este módulo já decidiu o contrário, por escrito, duas vezes: `src/features/ads/metricas.ts:9-12` — "Só as colunas SOMÁVEIS moram aqui. As razões (CTR, CPM, ROAS…) não vêm do banco de propósito: razão de um dia não se soma… a fórmula existe num lugar só" — e `src/features/ads/pages/MetaAdsPage.tsx:505-507` — "As razões ficam aqui, e não no SQL, APESAR DE A VIEW TAMBÉM AS CALCULAR". Ou seja: já existe uma view que calcula CPA e a tela a ignora de propósito; a proposta seria a TERCEIRA fórmula de CPA no mesmo módulo. E o estrago é visível na mesma linha: a aba Campanhas mostra `CPA (Meta)` e `CPA (Payt)` em colunas separadas (COLS em MetaAdsPage.tsx:79-93), enquanto a view traz um `cpa` só, sem dizer de qual fonte. O alerta do Passo 3 ("CPA ≥ 30% abaixo do CPA da própria campanha") decidiria por um número que NÃO é o número exibido ao lado dele.

ARMADILHA 3, no único passo que o desenho manda executar: a "linha de resumo no topo dizendo quanto da verba está em campanhas com TESTE no nome" é a string TESTE gravada no código — exatamente o que o próprio desenho chama de "armadilha 3 na forma mais pura". E a aba JÁ responde isso de forma derivada: a busca filtra por nome sem acento e sem caso (MetaAdsPage.tsx:550) e o rodapé acompanha a busca de propósito (MetaAdsPage.tsx:795-801: "filtrou por 'TESTE', o total é dos TESTE. É o que responde 'quanto gastei nisso que estou olhando'"). O desenho recria em forma podre um recurso que já existe em forma saudável. Pior: vira um número consertável por renomear — no dia em que alguém tirar o prefixo (a reação mais barata a esse painel), a faixa passa a dizer "0% da verba em TESTE" e declara resolvido um comportamento que não mudou em nada.

ARMADILHA 1 outra vez em `campanhas_papel.ad_account_id`: a conta de uma campanha já existe e já é entregue pronta por `vw_meta_status` (`ad_account_id` + `campanha_id` do salto duplo — migração `supabase/migrations/20260829a_meta_ganha_o_estado_de_campanha_conjunto_e_anuncio.sql`). Guardá-la de novo, à mão, sem derivação e sem gatilho, é um segundo carimbo — e este módulo recusou esse movimento duas vezes com o motivo escrito: a 20260829a não guardou `campaign_id` no anúncio mesmo a API mandando ("guardar os dois seria a primeira armadilha do CLAUDE.md"), e MetaAdsPage.tsx:483 recusou `empresa_id` em `meta_objetos` ("mais um lugar para o carimbo divergir, sem mudar nenhum número na tela"). Junto vêm dois erros de fato: (a) a justificativa para tirar o FK ("campanha some da API e a intenção tem que sobreviver") é falsa — nada apaga linha de `meta_objetos`; `visto_em` envelhece e a situação vira `sem_dado`, é o desenho explícito da migração; (b) "campanha_id TEXT como em meta_objetos" lê a chave errado: `meta_objetos` é `unique (ad_account_id, nivel, objeto_id)`, nunca assumiu `objeto_id` global. E o único FK que o desenho mantém aponta para `ad_accounts` sem `on delete` — enquanto `meta_objetos` cascateia — então a tabela de intenção passaria a TRAVAR a remoção de uma conta que hoje some limpo.

ARMADILHA 4 volta silenciosa por um clique: `sem_papel` é ao mesmo tempo o DEFAULT e um valor selecionável no check, e o alerta `campanha_sem_papel` dispara só "quando a campanha não tem linha". Quem escolher "sem papel" no select cria a linha e cala o alerta para sempre, com a intenção seguindo indeclarada — e nada na tela denuncia, que é literalmente o caso `funil_checkouts`.
  - *Conserto:* O desenho se salva inteiro com quatro cortes; nenhum deles toca o veredito (que está certo) nem o número das duas semanas.

1) A view devolve SÓ o que não dá para recalcular a partir de somas: `idade_dias`, `dias_com_gasto`, `ads_distintos`, `ads_rodando` (join `vw_meta_status` por `campanha_id` + `nivel='ad'` + `situacao='rodando'`, colunas que a 20260829a já entrega) e a mediana de `verba_por_ad_ativo_dia`. Essa mediana é razão de DIA e por isso é a única que TEM que morar no SQL — escrever isso em comentário na view, senão o próximo passa ela para TypeScript e o número muda. CPA, custo/IC, investimento/dia e fatia da verba continuam saindo de `fn_metricas_meta_agregado` + `comRazoes`, um lugar só, e o alerta do Passo 3 (se existir) lê a MESMA fórmula que a tela mostra.

2) A frase de resumo sai da busca, não de uma constante: o rodapé já soma o que está filtrado. Se quiser uma frase fixa no cabeçalho, que ela seja sobre o histograma de `verba_por_ad_ativo_dia` — a grandeza que não se conserta renomeando campanha.

3) `campanhas_papel` fica com quatro colunas: `campanha_id text primary key`, `papel`, `definido_por`, `definido_em`. Sem `ad_account_id` e sem FK: conta e empresa vêm por join em `vw_meta_status`, que é onde o carimbo já mora. Isso mantém a sobrevivência ao sumiço da API sem criar um segundo dono.

4) O gatilho contra a armadilha 4 vira `sem linha OU papel = 'sem_papel'` — ou tira-se `sem_papel` do select (ausência de linha já é o não-declarado) e o default fica só para linhas nascidas de importação.

Dois ajustes menores: as 4 colunas novas entram logo depois de Nome, não no fim — a tabela já tem 31 colunas e 2.437px de largura, e no fim elas nascem fora da tela (criar sem que ninguém veja é a armadilha 2 pela porta dos fundos). E no Passo 3, trocar "nas contas Saponaria" por um corte sobre a `confianca_atribuicao` que a própria view calcula: nomear conta no código é a armadilha 3 na mesma frase que a denuncia.
- **[confiança alta]** O desenho inteiro se apoia em "93 dias" — e a tela onde ele propõe mostrar isso abre, por padrão, em HOJE, onde a coluna "Idade" vai ler 0.

`src/contexts/FilterContext.tsx:66`: `const [datePreset, setDatePresetState] = useState<DatePreset>('today')`. E, ao contrário de `empresaId`, o período NÃO sobrevive ao recarregar (o próprio comentário no arquivo diz isso: "Período é uma pergunta"). `src/features/ads/pages/MetaAdsPage.tsx:1004` não passa `hideFilters` — ela usa a barra global e o `fn_metricas_meta_agregado` recebe `p_inicio/p_fim` do filtro. Ou seja: toda vez que alguém abre /meta-ads, o recorte é um dia.

Aplicado à `vw_campanha_papel_medido`, que o desenho define como "uma linha por campanha_id NO PERÍODO":
· `idade_dias = current_date − min(data com investimento > 0)` → com período = hoje, min(data) = hoje → **Idade = 0 para as 15 campanhas TESTE**. A primeira tela que qualquer pessoa vê ensina o CONTRÁRIO do achado: parece que tudo nasceu hoje.
· `dias_com_gasto = 1`, e `verba_por_ad_ativo_dia` — que o desenho elege como "a única grandeza que separa mecanicamente testar de escalar" e como O número para olhar por duas semanas — vira um ponto só, sem distribuição. Não dá para ver histograma bimodal numa tela que carrega um dia.
· `cpa` no recorte padrão é exatamente o CPA diário que o próprio desenho condena: 68% dos dias-anúncio sem compra, divisão por zero.
· A linha de resumo "a maior roda há 93 dias" ou é constante no código (armadilha 3, e envelhece calada) ou é calculada no período e diz "roda há 0 dias".

Se a intenção era `idade_dias` de vida inteira (min sobre todo o `metricas_meta`), o furo troca de forma mas continua: aí "Idade (vida toda)" e "Ads rodando" (`vw_meta_status`, que o próprio MetaAdsPage carrega fora do período — o comentário na linha ~460 é explícito: "O estado não depende do período") ficam na MESMA linha que `investimento`, `cpa`, `ads_distintos` e `share_da_verba`, todos do período, sem nada avisando que são dois relógios. A página hoje resolve isso para UM elemento — o `PontoDeSituacao`, um ponto com `title` explicando —, mas quatro colunas numéricas não carregam tooltip de desambiguação. Pior: uma campanha morta em abril, olhada com o filtro em abril, mostraria "Idade 160 dias" contada contra `current_date` — isso não é idade, é tempo desde o nascimento incluindo o túmulo.

Segundo golpe do mesmo relógio duplo, esse no alerta: `campanha_sem_papel` dispara "gastou nos ÚLTIMOS 7 DIAS e não tem linha", janela fixa; mas a tabela onde está o `<select>` que resolve o alerta mostra só o período do filtro. Com o padrão "Hoje", uma campanha que gastou anteontem e não hoje gera o alerta em /meta-ads e NÃO EXISTE na tabela. O alerta nomeia algo que a página onde ele mora não consegue mostrar — falha na regra da migração 20260825l ("cada alerta aparece só na página onde se resolve") e é um alerta sem botão.
  - *Conserto:* O desenho é bom; ele só não olhou em que relógio a tela abre. Quatro ajustes, nenhum deles muda a tese:

1. **Separar os dois relógios na própria view, com nome.** `idade_dias` e `primeiro_gasto_em` saem de `min(data)` sobre TODO o `metricas_meta` daquela campanha, não sobre o período — é atributo da campanha, não do recorte. `ads_rodando` idem (é agora). Renomear as colunas para carregar o relógio no rótulo: **`Idade (vida toda)`** · **`Ads rodando (agora)`** · **`R$/ad ativo/dia (no período)`** · **`Fatia da verba (no período)`**. É a mesma solução que a página já usa no `PontoDeSituacao`, só que promovida a cabeçalho em vez de `title`, porque agora são quatro e não um.

2. **A coluna que o período não sustenta mostra travessão, não número.** Quando `dias_com_gasto < 7`, `R$/ad ativo/dia` e `CPA` renderizam "—" com `title="Precisa de pelo menos 7 dias no filtro. O recorte atual tem N."`. Precedente já no arquivo: o objeto sem estado vira **anel vazio** e não ponto cinza, justamente para "não sei" não parecer "está desligado". Número ruidoso mostrado com duas casas decimais é o mesmo erro com aparência de precisão.

3. **A linha de resumo leva um botão que conserta o relógio.** "15 campanhas com TESTE no nome concentram 80% da verba — medido em 90 dias · [ver 90 dias]", e o botão chama `setCustomRange(subDays(hoje, 90), hoje)`, que já existe no `FilterContext`. Sem isso o achado depende de a pessoa adivinhar que precisa trocar o período, e ela não vai: a coluna mostrando 0 já a convenceu de que não há nada ali. E o resumo diz em qual relógio fala, sempre.

4. **O alerta `campanha_sem_papel` precisa levar a pessoa à linha.** Ou o clique no alerta seta o período para os mesmos 7 dias da regra (e limpa busca e filtro de situação), ou a janela do alerta passa a ser o período da tela. A primeira opção é melhor: mantém a regra do alerta estável e faz o link entregar a linha onde está o `<select>`. Enquanto a janela do alerta e a da tabela forem números diferentes definidos em lugares diferentes, elas divergem — que é a armadilha 1 vestida de janela de tempo.

Extra barato: `vazio` e `carregando` das 4 colunas novas já vêm de graça se elas entrarem no mesmo `renderTable`; só garantir que "nenhuma campanha gastou hoje" apareça como mensagem centralizada e não como tabela em branco — obrigatório pelo CLAUDE.md e é o estado MAIS provável no recorte padrão.

---

## Acusar AD morrendo — declinio por 3+ dias seguidos

**Chave:** `ad-morrendo` · **Esforço:** medio

### Veredito
Refino, e refuto metade: ROAS e CPA **diários** não podem disparar essa regra — só 32,2% dos dias-anúncio têm ao menos 1 compra (média 1,01/dia), então em ~68% dos dias o CPA é divisão por zero e o ROAS é literalmente 0,00, e "caiu 3 dias seguidos" vira ou impossível (regra estrita: 0 não é menor que 0) ou universal (regra frouxa). CTR, CPM e hookrate estão certos: vêm de milhares de impressões/dia, e 89,5% dos dias-anúncio têm dado de vídeo. O desenho correto é de dois andares — **sinal diário só com o que tem impressão no denominador (ele dispara), dinheiro só em janela de 7 dias (ele contextualiza, nunca dispara)**.

### Desenho
POR QUE A SEPARAÇÃO É ESSA (a conta que decide)

O erro relativo de uma contagem é ~1/√n. Três dias a 1,01 compra/dia dão ~3 compras: erro de 58%. Para o CPA ser confiável a 20% seriam ~25 compras na janela — a ~1/dia, 25 dias. Logo: 3 dias nunca vão sustentar um veredito de CPA.
O hookrate a 1.000 impressões/dia tem erro padrão √(p(1−p)/n) ≈ 1,37 p.p. com p≈25% (~5,5% relativo); em 3 dias (3.000 impressões) cai para ~0,79 p.p. (~3,2% relativo). Uma queda de 25% é ~8 desvios. É a mesma pergunta com dois regimes de ruído completamente diferentes.

ANDAR 1 — SINAL DIÁRIO (fadiga de criativo; é o que dispara)
Por dia fechado d, nível ad, de `metricas_meta` (via `vw_metricas_meta_nivel`, que já é por dia e só com colunas somáveis):
  hook_d = video_3s / impressoes
  ctr_d  = cliques_link / impressoes
  cpm_d  = 1000 * investimento / impressoes
E cada um dividido pelo mesmo número da CONTA naquele dia (soma de todos os ads daquela `ad_account_id` em d) → `hook_rel_d`, `ctr_rel_d`, `cpm_rel_d`. Isso é decisivo: sem normalizar, no dia em que o leilão inteiro sobe (véspera de feriado, concorrente entrando) TODOS os anúncios da conta alertam ao mesmo tempo — e nenhum deles piorou. `fn_criativos_meta` já pensa assim: devolve `conta_hook`, `conta_ctr`, `conta_conexao` como referência.

HOOKRATE — fórmula exata e qual denominador
  hookrate = 100.0 * video_3s / nullif(impressoes, 0)
O denominador é **impressões, não `video_plays`**, por três motivos, em ordem de peso:
1. É a pergunta certa: "de todo mundo a quem isto foi mostrado, quantos ficaram 3 segundos". `video_plays` já é resultado do primeiro frame em placements sem autoplay e ≈ impressões nos com autoplay — dividir por ele remove justamente a variação que se quer medir, e o valor muda de significado conforme o mix de placement, que muda sozinho.
2. `impressoes` está sempre definido; `video_plays` some em parte das linhas.
3. O projeto JÁ tem essa fórmula escrita duas vezes com esse denominador: `fn_criativos_meta`, CTE `ref` (`sum(video_3s)*100.0/nullif(sum(impressoes),0) as hook`, supabase/migrations/00000000000002b_baseline_funcoes.sql) e src/features/ads/pages/AdsAnalysisPage.tsx (`hook_rate: ad.video_3s / ad.impressoes * 100`). Escolher outro denominador agora cria a terceira definição, discordando das duas — armadilha 1. (Essas duas cópias já são um problema: ver riscos.)
Anúncio sem vídeo (imagem) NÃO entra com hookrate 0 — entra só na regra de CTR/CPM, e a tela diz "sem vídeo". São os ~10,5% de dias-anúncio sem dado de vídeo.

A REGRA, escrita inteira
  Corrida (ilha de veiculação): dias com impressoes>0 separados por no máximo 2 dias sem entrega. Gap de 3+ dias começa outra corrida e ZERA a base — o sync já mediu que 252 anúncios ficaram 2+ dias calados e voltaram (um depois de 88 dias), então 2 dias de silêncio é normal, e anúncio que volta depois de uma semana volta com outro aprendizado.
  Elegível: `vw_meta_status.situacao = 'rodando'` E a corrida atual tem ≥ 4 dias com ≥ 1.000 impressões E os 3 últimos desses dias cabem em 7 dias de calendário.
  Base: melhor janela de 3 dias da própria corrida (média de `hook_rel` ponderada por impressões).
  Dispara quando: média ponderada de `hook_rel` dos 3 últimos dias fechados < base × (1 − limiar).
  Corrobora (aparece no card, não dispara): `cpm_rel` subiu ≥15%, `ctr_rel` caiu, e a janela econômica abaixo.
  **Nunca usa o dia de hoje.** `data <= current_date - 1`. `meta-insights-sync` roda modo=hoje de hora em hora: o dia corrente está sempre parcial e sempre parece queda — sem esse corte o alerta dispara em todo anúncio todo dia.

VERBA MÍNIMA — em impressões, não em reais
≥ 1.000 impressões em cada um dos 3 dias. É o `MIN_IMPRESSOES = 1000` que já existe em src/features/editores/components/CriativosMetaTab.tsx:182 com a justificativa certa ("mil impressões já dizem se o vídeo segura, três vendas não dizem se o anúncio é lucrativo"). A CPM medida põe isso em ~R$ 20–30/dia, ~R$ 75 na janela. Reais seriam o critério errado: o que dá significância ao hookrate é o denominador, e o denominador é impressão.
Consequência a assumir em voz alta: exigir 4 dias de corrida alcança ~metade dos 372 anúncios com gasto (236 rodaram 3+ dias, 112 rodaram 7+). A tela precisa dizer "a regra alcança N dos M anúncios do período; os outros pararam antes de 4 dias" — esconder o excluído é como o DRE perdeu R$ 10.065.

ANDAR 2 — JANELA MÓVEL DE 7 DIAS (dinheiro; contextualiza, não dispara)
  CPA_7d  = Σinvestimento / Σcompras
  ROAS_7d = Σreceita / Σinvestimento
  custo por IC = Σinvestimento / Σinitiate_checkout
Comparação: [D−7..D−1] contra [D−14..D−8], e só aparece verdicto quando as DUAS janelas têm ≥ 5 vendas (o `MIN_VENDAS = 5` de CriativosMetaTab.tsx:183). Ressalva obrigatória no rótulo: `meta-insights-sync` re-busca D−1..D−7 todo dia para capturar reatribuição, então a janela recente ainda se move — ela é contexto, e é exatamente por isso que não pode disparar nada.

EM QUE CONTA DÁ PARA CONFIAR — derivado, nunca listado
Nada de `const CONTAS_CEGAS = ['Saponaria']`: isso é armadilha 3 esperando conta nova. A confiança sai de dado: "das vendas aprovadas desta conta no período, quantas dizem de qual anúncio vieram" (`count(ad_id_meta)/count(*)` por `ad_account_id`). Essa conta JÁ existe, escondida na CTE `atribuicao` dentro de `fn_criativos_meta`, e sai como `conta_pct_atribuido`. Três faixas, os limites em `configuracoes`:
  ≥80% (Lembrancinha-TSL 99%, Workshop Buque-TSL 98%): ROAS/CPA da Payt, casado por `ad_id_meta` — é o `MIN_ATRIBUICAO = 80` de CriativosMetaTab.tsx:192.
  40–80% (Saponaria Brasil-TSL 63%): número com o aviso âmbar que já existe (CriativosMetaTab.tsx:1139), e o andar econômico não entra em nenhuma decisão.
  <40% (Saponaria 24%, Saponaria Brasil-VSL 0% — juntas ~40% da verba): a coluna de ROAS/CPA não mostra número nenhum. No lugar dela, **custo por initiate_checkout**, que vem do pixel do checkout e não depende da UTM sobreviver. E um detalhe que salva o andar 2 nessas contas: a regra compara o anúncio COM ELE MESMO ao longo do tempo, então um viés de atribuição constante se cancela na razão — métrica enviesada mas estável serve para tendência, não serve para ranking nem para valor absoluto.
Para a conta de 0% não criar alerta novo: já existe `receita_sem_rastreio` mapeado para `/utm` — o card linka para lá.

ONDE MORA NA NAVEGAÇÃO
Sidebar não ganha item (ela é plana e a página já existe). Três lugares, nenhum novo:
1. `/meta-ads`, aba **Anúncios** (src/features/ads/pages/MetaAdsPage.tsx:963, `renderTable(adRows, "ad", false)`): coluna "Queda" com selo âmbar "Caindo há 3 dias · hook −32%", ordenável, e os anúncios em queda no topo. Âmbar e não vermelho: vermelho é a marca e o que se perde; queda é atenção. Vazio e carregando obrigatórios.
2. Faixa de alerta: código novo `ad_em_queda` em `vw_alertas` + linha `('ad_em_queda','meta-ads')` em `alertas_area`, que é onde se resolve. `IngestStatusBanner` filtra pelo primeiro segmento da rota e já mostra sozinho.
3. Detalhe do anúncio: os 3 dias com data explícita (gap visível), hook_rel x conta, e o andar econômico com a faixa de confiança da conta dita por extenso.
A regra mora NA VIEW, e o TypeScript leva só rótulo e cor — exatamente como src/features/ads/situacao.ts faz com `vw_meta_status`, inclusive o comentário explicando por quê.

LIMIAR INICIAL E CALIBRAÇÃO
Começa em **−25% de hookrate relativo** (≈8 desvios do ruído a 3.000 impressões: seguro), 3 dias, 1.000 impressões/dia, janela de 7. Calibrar não é discutir o número: é rodar a regra sobre os 90 dias que já estão em `metricas_meta` — ela é função pura das linhas diárias, não precisa de tabela nova para simular o passado. Para cada limiar (15/20/25/30/40%), contar (a) quantos anúncios seriam marcados, (b) quantos pararam de entregar nos 7 dias seguintes, (c) quanto de verba continuou saindo depois da marca. O passado é limpo porque nenhum alerta influenciou ninguém ainda. Critério prático de parada: o limiar que produz **no máximo ~5 alertas/dia** com 100 anúncios rodando — acima disso vira papel de parede e ninguém mais lê, que é o destino dos 134 UTMs e dos 38 testes.

### Banco
Nenhuma tabela nova, nenhuma coluna nova, nenhum campo em `producoes` — tudo é função das linhas diárias que já existem.

1. `fn_atribuicao_conta(p_ini date, p_fim date)` → (ad_account_id, vendas, com_ad_id, pct). É a CTE `atribuicao` que hoje está enterrada dentro de `fn_criativos_meta` (supabase/migrations/00000000000002b_baseline_funcoes.sql). **E `fn_criativos_meta` passa a chamá-la** — senão a regra nova vira a segunda cópia da mesma conta, armadilha 1 em forma de função.

2. `fn_ad_queda(p_dias int, p_limiar numeric, p_min_impressoes int, p_janela int)` → uma linha por anúncio marcado, com ad_id, conta, os 3 dias e suas datas, hook_rel de cada, base, queda_pct, cpm_rel_delta, ctr_rel_delta e a faixa de confiança da conta. Parametrizada de propósito: a simulação de calibração roda O MESMO código da produção, com outros números.

3. `vw_ad_queda` = `fn_ad_queda(...)` com os parâmetros lidos por `fn_config(chave, empresa)`. Chaves novas em `configuracoes` (uma linha por chave+empresa, nula = geral): `ad_queda_dias` (3), `ad_queda_queda_min_pct` (25), `ad_queda_min_impressoes_dia` (1000), `ad_queda_janela_dias` (7), `ad_queda_min_atribuicao_pct` (80). Calibrar vira editar parâmetro, não fazer deploy — e mata a lista fixa no código.

4. `fn_alerta_ad_em_queda()` no formato das outras (codigo, severidade, titulo, detalhe), unida em `vw_alertas`, severidade `atencao`. Mais `insert into alertas_area (codigo, area) values ('ad_em_queda','meta-ads') on conflict do update` — a migração 20260825l diz que o autor do alerta é quem declara onde ele mora.

5. `grant select` para `authenticated` nas views, `revoke ... from anon` nas funções, como o resto do módulo. Nome da migração no padrão do repo: `20260916a_o_painel_acusa_o_anuncio_que_esta_morrendo.sql`.

Nada disso precisa de gatilho porque nada é espelho: é leitura derivada de `metricas_meta` + `meta_objetos`, recalculada a cada consulta. Se um dia virar tabela materializada por performance, aí sim precisa de gatilho (armadilha 4) — hoje não precisa e não deve.

### Riscos
- CPA/ROAS diários como gatilho: 67,8% dos dias-anúncio têm zero compra e a média é 1,01/dia, então a série é um trem de pulsos, não uma curva — não existe ordem para declinar. Três dias dão ~3 compras, 58% de erro relativo. É o pedido original, e é o que estou refutando.
- Usar o dia de hoje: `meta-insights-sync` roda modo=hoje de hora em hora e o dia corrente está sempre parcial. Sem `data <= current_date - 1` o alerta dispara em 100% dos anúncios todo dia — e um alerta que sempre dispara é indistinguível de um alerta quebrado.
- Hookrate ganhar uma terceira fórmula. `fn_criativos_meta` (CTE `ref`) e src/features/ads/pages/AdsAnalysisPage.tsx já calculam video_3s/impressoes, em dois lugares, hoje. Armadilha 1: se a regra escrever a terceira, em três meses as três discordam. A oportunidade é o inverso — ao criar `fn_ad_queda`, fazer as duas telas lerem a mesma função.
- CPM sem normalizar pela conta: CPM é preço de leilão, não qualidade de criativo. No dia em que o mercado sobe, a conta inteira alerta junto e nenhum anúncio piorou. Por isso todo sinal diário vai dividido pelo mesmo número da conta naquele dia.
- Contas confiáveis viradas lista no código. Saponaria é ~40% da verba com 24% e 0% de casamento hoje, mas conta nova entra sem avisar e conta ruim melhora. A faixa tem que sair de `fn_atribuicao_conta`; lista fixa é a armadilha 3, a mesma que escondeu R$ 10.065 no DRE.
- `producoes.status_veiculacao` continua mentindo ao lado do alerta novo: 26 dos 470 cards comparáveis divergem (Pausado: 9 de 28 têm anúncio rodando, 32% errado), e src/features/criativos/components/DesempenhoAdsView.tsx:473 ainda mostra esse campo digitado à mão. Vai ficar um selo dizendo 'Caindo há 3 dias' a dois cliques de um campo dizendo 'Encerrado'. É armadilha 1 pura, não é criada por este pedido, mas este pedido a torna visível — e a correção é derivar de `vw_meta_status.situacao`, nunca criar mais um campo.
- Alerta sem coluna de resultado vira papel de parede em seis semanas — o destino dos 134 UTMs e dos 38 testes. A defesa é a calibração histórica antes de ligar e o teto de ~5 alertas/dia depois; se a fila crescer sem ninguém agir, o limiar está errado e isso tem que aparecer na tela.
- O alerta chega tarde para anúncio curto: a média de vida é 5,8 dias e exigir 4 dias de corrida deixa ~metade dos 372 fora. Não é defeito a consertar baixando para 2 dias (aí é ruído) — é limite a declarar na tela, com a contagem de quantos ficaram de fora e por quê.
- Não derivar frequência somando `alcance` entre dias: alcance não é somável, as mesmas pessoas se repetem. Frequência de 7 dias exige outra chamada à API, não uma conta sobre as linhas diárias. CPM relativo subindo é o proxy observável de saturação com o dado que existe.

### O que NÃO fazer
- Não disparar em CPA ou ROAS diários — nem como segundo gatilho, nem como desempate. Dinheiro só em janela de 7 dias, e mesmo lá só contextualiza.
- Não criar `producoes.em_queda`, `metricas_meta.hookrate` nem coluna 'dias em queda' em lugar nenhum. Tudo derivado das linhas diárias; campo guardado precisaria de gatilho e viraria armadilha 4.
- Não escrever a regra dos 3 dias em TypeScript. Ela mora na view; o front leva rótulo e cor, como src/features/ads/situacao.ts faz com `vw_meta_status`.
- Não listar contas confiáveis no código nem no SQL (`where conta not in ('Saponaria',...)`). Derivar de `fn_atribuicao_conta`.
- Não usar o nome da campanha para mudar limiar: 15 campanhas com TESTE somam R$ 214.685 e uma delas roda há 93 dias com 139 anúncios — o nome não descreve a função. Verba, idade e entrega descrevem.
- Não usar `faturamento_atribuido` para afirmar ROAS nas contas Saponaria. Nelas o slot econômico é custo por initiate_checkout, e a tela diz por quê.
- Não alertar em anúncio que não está `rodando`: `ativo_sem_entregar` e `barrado_pelo_pai` já têm selo próprio em `vw_meta_status`, e dois alertas sobre o mesmo anúncio na mesma tela é ruído.
- Não usar vermelho no selo — vermelho é a marca e o que se perde. Queda é atenção: âmbar.
- Não esconder os anúncios que a regra não alcança. Dizer quantos são e por que ficaram de fora, no rodapé da lista.
- Não criar página nova nem item novo na sidebar: `/meta-ads` aba Anúncios já é onde se olha e onde se pausa.

### Primeiro passo
Uma migração com `fn_ad_queda(...)` parametrizada e NENHUMA tela — e usá-la imediatamente para rodar a simulação sobre os 90 dias que já estão em `metricas_meta`, com limiar em 15/20/25/30/40%, respondendo três números por limiar: quantos anúncios seriam marcados, quantos pararam de entregar nos 7 dias seguintes, e quanta verba continuou saindo depois da marca. O passado é limpo porque nenhum alerta influenciou ninguém ainda. Se o limiar escolhido produzir ~5 alertas/dia e a maioria dos marcados de fato morreu, aí sim entra o selo âmbar na aba Anúncios de `/meta-ads` — e só depois disso o código em `vw_alertas`. Assim a tela de resultado nasce antes da tela de aviso, em vez de depois.

### Furos que os céticos abriram (3)
- **[confiança alta]** O piso de 1.000 impressões POR DIA não é o MIN_IMPRESSOES que o desenho cita, e ele corta a regra para 11% dos anúncios — não "~metade dos 372".

1) A citação está errada de unidade. Em src/features/editores/components/CriativosMetaTab.tsx:955 e :607 o MIN_IMPRESSOES=1000 é comparado com `a.impressoes`, que vem de fn_criativos_meta (00000000000002b_baseline_funcoes.sql, CTE `ad`: `sum(m.impressoes) where m.data between p_ini and p_fim`) — é o TOTAL DO PERÍODO de um anúncio, não um número diário. O desenho transporta esse mesmo 1.000 para cada um de três dias seguidos (3.000 na janela) e apresenta isso como reaproveitar a justificativa que já existe. É um aperto de ~30x disfarçado de reuso.

2) Medido agora (nivel='ad', 90 dias, 18/06 a 15/09): a mediana de um dia-anúncio é 243 impressões. Só 1.591 de 5.373 dias-anúncio (29,6%) chegam a 1.000. O regime estatístico que o desenho usa para defender o limiar ("a 1.000 impressões/dia o erro é 1,37 p.p.") descreve o decil de cima, não o dia típico.

3) Consequência medida com a elegibilidade exata do desenho (corrida com gap<=2 dias sem entrega, >=4 dias com >=1.000 impressões, os 3 últimos com >=1.000 cada e dentro de 7 dias de calendário), últimos 30 dias: 372 anúncios com impressão (bate com o fato dado), 233 têm 3 dias seguidos de entrega (bate com os 236), e apenas 41 passam — 11,0%, não ~50%. Hoje: 100 anúncios com vw_meta_status.situacao='rodando', 15 elegíveis, 6 disparando a -25%.

4) A frase que o desenho manda imprimir também erra a CAUSA: "os outros pararam antes de 4 dias" explica 173 dos 331 excluídos. Os outros 158 rodaram 4+ dias e foram cortados pelo piso de impressão — 81 deles nunca viram 1.000 impressões em nenhum dia isolado. Ou seja, a tela diria a coisa errada pelo motivo errado, que é exatamente o "esconder o excluído" que o próprio desenho invoca ao lembrar dos R$ 10.065 do DRE.
  - *Conserto:* Nada estrutural muda; muda o número que a tela declara e o nome do piso.

1) Parar de chamar o piso de "o MIN_IMPRESSOES que já existe". São dois números diferentes: o da CriativosMetaTab é de período, o novo é diário. Criar a chave própria em `configuracoes` (`ad_queda_min_impressoes_dia`, já prevista no desenho) e escrever no comentário que ela NÃO é o MIN_IMPRESSOES do front — senão em três meses alguém "unifica" os dois e quebra uma das telas.

2) Trocar a frase da tela pela contagem medida, derivada da mesma função (nunca escrita à mão): "a regra acompanha 41 dos 372 anúncios do período (11%) — e 76% da verba". Porque o número que redime o desenho existe e ele não usou: os 41 elegíveis carregam R$ 94.748 dos R$ 124.454 gastos em 30 dias. A regra cobre um nono dos anúncios e três quartos do dinheiro. É esse par que deve aparecer, com as duas razões de exclusão separadas: 173 pararam antes de 4 dias, 158 rodaram o bastante mas nunca tiveram 3 dias de 1.000 impressões.

3) Fazer fn_ad_queda devolver também os não elegíveis com o motivo (`corrida_curta` | `sem_volume_diario`), para a contagem sair da mesma consulta que marca — assim ela não pode divergir da regra.

4) Opcional, e mede antes de decidir: baixar o piso para 500 impressões/dia sobe a cobertura sem sair do regime seguro (a 1.500 impressões na janela o erro do hook ainda é ~1,1 p.p., e -25% continua a muitos desvios). Vale rodar a simulação de calibração — que o desenho já propõe como primeiro passo — com o piso como eixo, não só o limiar: (500/1.000/2.000) x (15/20/25/30/40%).

Conferido e NÃO é furo, para o autor não perder tempo: dado de vídeo existe onde importa (95,4% dos dias-anúncio com >=1.000 impressões têm video_3s>0; hook médio 38,3%); dado de nível 'ad' está completo em todas as 6 contas (investimento no nível 'ad' bate exatamente com o de campanha, inclusive Saponaria); o volume não vira papel de parede (161 janelas em 90 dias = 1,79 alertas/dia, dentro do teto de ~5); e a base de 3 dias sobrepondo a janela testada, que na teoria exigiria um colapso de 75% num dia só, na prática quase não morde (só 80 de 761 janelas elegíveis não têm base disjunta disponível; com base disjunta o disparo cai de 161 para 155, os mesmos 28 anúncios).

Um aviso lateral, também medido: o andar 2 quase nunca vai renderizar. Dos 100 anúncios rodando, só 11 têm >=5 vendas nas DUAS janelas de 7 dias. Como o desenho já diz que ele é contexto e não gatilho, não é furo — mas o card precisa de estado vazio próprio para o andar econômico, senão vira um bloco em branco na maioria dos casos.
- **[confiança alta]** ARMADILHA 1, criada por este desenho, no exato ponto em que ele se declara imune a ela. Três dos cinco parâmetros novos em `configuracoes` são cópias de números que já existem compilados: `ad_queda_min_impressoes_dia` (1000) = `MIN_IMPRESSOES` em src/features/editores/components/CriativosMetaTab.tsx:182; `ad_queda_min_atribuicao_pct` (80) = `MIN_ATRIBUICAO` em :192; e o corte "≥ 5 vendas nas duas janelas" do andar 2 = `MIN_VENDAS` em :183 — este terceiro nem chave ganhou, ou seja, vai nascer escrito à mão dentro de `fn_ad_queda`. Verifiquei: `CriativosMetaTab.tsx` NÃO lê `fn_config` nem `configuracoes` (grep por ambos em src/ não retorna o arquivo). Então o mesmo julgamento — "a partir de quantas impressões o hook conclui" e "a partir de que % de atribuição eu mostro ROAS" — passa a ter duas fontes editáveis: uma linha de banco e um `const` que só muda por deploy. E o desenho GARANTE a divergência, porque a frase "Calibrar vira editar parâmetro, não fazer deploy — e mata a lista fixa no código" é falsa como escrita: ela não remove nenhuma constante, ela adiciona uma segunda cópia de três delas. Consequência concreta e a dois cliques de distância: baixar `ad_queda_min_impressoes_dia` para 600 na calibração faz /meta-ads carimbar "Caindo há 3 dias" num anúncio que /editores esconde com o aviso "menos de 1.000 impressões" (CriativosMetaTab.tsx:955,1144); subir `ad_queda_min_atribuicao_pct` para 90 tira a coluna de ROAS do card de queda enquanto CriativosMetaTab.tsx:532 continua rankeando ROAS daquela mesma conta como confiável. É a definição que o CLAUDE.md dá da armadilha ("nunca deixar os dois editáveis"), e o desenho a viu para a FÓRMULA do hook e não a viu para os NÚMEROS. Corroborando: ele conta duas cópias da fórmula de hook e há quatro — fn_criativos_meta, AdsAnalysisPage.tsx:119, CriativosMetaTab.tsx:256 (`hookDe`) e MetaAdsPage.tsx:137 (`taxa_video_3s`). A quarta é justamente a página onde a coluna "Queda" vai morar (MetaAdsPage), e o remédio proposto ("fazer as duas telas lerem a mesma função") não a alcança: `taxa_video_3s` é calculada sobre o período que a usuária escolheu no filtro, e `fn_ad_queda` é fixa em 3 dias — a função não serve àquela coluna. Vão ficar duas colunas chamadas "hook" na mesma linha, vindas de caminhos diferentes.
  - *Conserto:* Três mudanças, nenhuma toca a matemática da regra (o desenho de dois andares se sustenta).

1) Nomear as chaves pelo CONCEITO, não pela regra, e apagar os `const` no mesmo PR. Em vez de `ad_queda_min_impressoes_dia` / `ad_queda_min_atribuicao_pct`, criar `meta_min_impressoes_dia`, `meta_min_vendas` e `meta_min_atribuicao_pct`, e remover as linhas 182, 183 e 192 de CriativosMetaTab.tsx, que passam a ler por `fn_config(chave, empresa)` — a tela já recebe empresa do `FilterContext`, e os comentários que justificam os valores migram para o `comment on` da chave, onde a próxima pessoa que editar o número vai lê-los. Sobram como parâmetros próprios da regra só `ad_queda_dias`, `ad_queda_queda_min_pct` e `ad_queda_janela_dias`, que ninguém mais usa.

2) Se as constantes tiverem de continuar no TS por custo de round-trip, então um teste no padrão que o projeto já usa contra lista fixa (src/test/fases-vem-do-banco.test.ts, src/test/categorias-socio-batem-com-o-banco.test.ts) que falhe quando o valor em `configuracoes` divergir do `const`. É a defesa barata; o que não pode é ficar sem nenhuma das duas.

3) Antes de escrever a fórmula de hook em `fn_ad_queda`, extrair `hookDe(video_3s, impressoes)` para src/features/ads/metricas.ts e fazer AdsAnalysisPage:119, MetaAdsPage:137 e CriativosMetaTab:256 importarem de lá — aí a versão SQL vira a segunda definição, não a quinta. E atualizar o `comment on view public.vw_metricas_meta_nivel`, que hoje afirma que a razão "existe num lugar só, no front": este desenho torna essa frase falsa, e comentário mentindo no banco é como a divergência começa.

Uma observação menor que não fura mas vale corrigir no texto: `vw_alertas` devolve UMA linha agregada por código (o padrão `count(*) || ' conta(s)...'` no baseline). O teto de "~5 alertas/dia" não é de linhas de alerta, é de anúncios marcados dentro de uma linha só — o número certo para a faixa é "N anúncios em queda", e a fila propriamente dita é a coluna na aba Anúncios.
- **[confiança alta]** O desenho estatístico se sustenta; o furo é de superfície e a página já escreveu por que ele não funciona.

1) A "coluna Queda" nasce fora da tela. `src/features/ads/pages/MetaAdsPage.tsx` tem `COLS` com **31 colunas** e o comentário da linha 756 mede a tabela: **2.437px**. Só a coluna do nome é fixa (`COL_FIXA`). E a linha 715-718 já rejeita exatamente esta proposta, com a justificativa escrita: "uma coluna de status seria a 25ª, fora da tela em todo monitor que não seja ultrawide" — por isso a situação virou um **ponto dentro da célula do nome** (`PontoDeSituacao`, linha 723), e não coluna. Um selo âmbar "Caindo há 3 dias · hook −32%" na 32ª posição é um sinal visual que só existe para quem rolar dois mil pixels para a direita. E "ordenável, e os anúncios em queda no topo" briga com o componente: há **um** `sortCol` (linha 339, default `investimento`), a ordenação é `Number(a[sortCol])` — ordenar por Queda apaga a ordenação por gasto, e selo de texto não ordena.

2) Mistura dois tempos sem avisar. As linhas da aba Anúncios vêm de `fn_metricas_meta_agregado(p_inicio: startDateStr, p_fim: endDateStr)` — período do cabeçalho. A regra usa `current_date - 1`. O desenho protege contra "hoje" e **não diz uma palavra sobre o período filtrado**: com "Agosto" selecionado, a pessoa lê números de agosto com um selo medido em 13–15/09. Pior: o anúncio pode nem ter rodado no período exibido. O `PontoDeSituacao` tem o mesmo descasamento, mas ele diz "está no ar agora" — "caindo há 3 dias · −32%" se lê como medição da linha.

3) O alerta não tem dono nem botão — e o dono provável não o vê. `AppSidebar.tsx:74` marca `/meta-ads` com `adminOnly: false` (não-admin com permissão abre a página), mas `IngestStatusBanner` sai cedo com `if (!podeVer)` quando `perfil?.is_admin !== true`. A faixa `ad_em_queda` fica invisível justo para o gestor que pausaria o anúncio. E o banner renderiza só `titulo`/`detalhe` como texto: não há `href` nem `onClick` por alerta, então "o card linka para /utm" não existe no componente hoje.

4) Sem estado de "já vi", o teto de ~5 alertas/dia é de fluxo e a tela mostra estoque. A view é apátrida por desenho ("nada é espelho"), então o mesmo anúncio reaparece todo dia enquanto continuar caindo e rodando, e não há como dizer "decidi manter, é teste de ângulo". A fila só esvazia quando o anúncio morre sozinho — que é literalmente o mecanismo de virar papel de parede que o próprio desenho diz temer (os 134 UTMs, os 38 testes).
  - *Conserto:* Nada disso toca o SQL: `fn_ad_queda` / `vw_ad_queda` ficam como estão.

Superfície: em vez de coluna nova, o sinal entra onde o `PontoDeSituacao` já entrou — dentro da célula fixa do nome, um segundo marcador âmbar com o texto inteiro no `title` ("Caindo há 3 dias · hook −32% vs base 13–15/09"). E o recorte ganha um selo a mais na `LinhaDeSituacoes`, que já é a fila de selos clicáveis acima da tabela e já filtra a tabela: "Em queda (N)". Isso resolve ordenação e destaque de uma vez — clicar deixa só os N na tela, sem mexer no `sortCol`.

Dois tempos: o selo declara o intervalo por extenso sempre ("13–15/09"), e quando o período do cabeçalho **não contém** esses dias o selo fica dessaturado com "medido fora do período filtrado". A alternativa mais honesta e igualmente barata: `fn_ad_queda` recebe `p_ate date` e a tela passa `min(endDateStr, current_date - 1)` — aí a queda é dos 3 últimos dias fechados **do período que a pessoa escolheu**, e o passado fica auditável. A faixa de alerta continua usando `current_date - 1`, porque alerta é sobre agora.

Dono: `IngestStatusBanner` troca `perfil?.is_admin === true` por `canAccess(areaDaRota(pathname))` — quem tem a página tem os avisos dela, que é a regra que o próprio componente diz seguir ("na tela onde se resolve"). Enquanto isso não muda, contar com o selo na tabela como superfície primária, não com a faixa.

Já vi: uma tabela de evento (não espelho, não precisa de gatilho) `ad_queda_decisao (ad_id, corrida_inicio, quem, quando, decisao in ('pausei','mantive','troquei criativo'), nota)`. O selo some da fila enquanto a corrida for a mesma e volta se o anúncio reentregar depois de gap de 3+ dias — a corrida já é a chave natural. E essa mesma tabela é a coluna de resultado que a armadilha 2 exige: "marcados 40 · pausados 31 · mantidos 9, dos quais 7 morreram em 7 dias" é o que diz se o limiar está certo depois de ligado, sem esperar a próxima calibração manual.

---

## Area de ADs por funil (REV) — multiselect, mostrar o que da para reativar

**Chave:** `ads-por-funil` · **Esforço:** alto · **Depende de:** pedido-6

### Veredito
Refino o pedido em dois pontos e refuto um número. (1) O multiselect que ela pede JÁ EXISTE, em duas telas — `AvaliacaoView.tsx:597` e `PorProjetoView.tsx:203` — e hoje ele ESVAZIA a tela: filtra por `funil_ids`, que é `{}` em 4.082 de 4.082 cards. Não é feature nova, é filtro quebrado. (2) REV planejado não tem AD nenhum para mostrar — por definição nunca rodou; o que existe para reativar nele são criativos aprovados e parados do MESMO PROJETO, e para 2 dos 5 planejados (Handify e Velarte) esse conjunto é ZERO. (3) O número que assusta está errado: os 21% saem de `criado_em`, e 1.074 dos 1.271 cards "criados desde agosto" têm `data_inicio` ANTERIOR a agosto (o mais velho é 03/02/2025) — são cards importados. Pela data em que foram POSTADOS: jul 152/161 (94,4%), ago 171/185 (92,4%), set 78/81 (96,3%). Não é 1 em 5 que roda; é ~19 em 20.

### Desenho
ONDE MORA
Quarta aba em `/criativos` (grupo Aquisição, adminOnly), ao lado de Avaliação · Por Projeto · Desempenho — `src/features/criativos/pages/CriativosPage.tsx:9`. Nada novo na sidebar (ela é plana, um item por feature) e NÃO vai para `/funis-gestao`: Funis é Estrutura (cadastro); isto é leitura de desempenho, e o grupo é o motivo de abrir.

(a) QUAL CAMPO FICA — nenhum dos dois
`producoes.funil_id` (uuid) e `producoes.funil_ids` (uuid[] NOT NULL default '{}') estão os dois em 0/4.082. Mas há um TERCEIRO, e é o único vivo: `funil_video` (text), preenchido em 1.988/4.082 — e ele não é funil, é método: TSL 1.155 · TSL,VSL 336 · VSL 282 · QUIZ,TSL 119 · QUIZ 67 (+29 em duas grafias divergentes). São três campos com "funil" no nome para duas perguntas diferentes.
Os dois mortos SAEM (drop column). Custo de tirar, medido: a UI de escrita deles nunca foi ligada — `toggleFunilId` (`CriativoDrawer.tsx:216`) e `toggleFunil` (`CriativoFormModal.tsx:127`) existem e não são renderizados em lugar nenhum; o único controle rotulado "Funil de Vendas" (`CriativoDrawer.tsx:642`, `CriativoFormModal.tsx:335`) escreve `funil_video`. Na leitura: `DesempenhoAdsView.tsx:473` seleciona `funil_ids` mas FILTRA por `normalizarFunil(r.funil_video)` — tirar é apagar a coluna do SELECT e o campo da interface (`:49`), 2 linhas, zero efeito. `AvaliacaoView.tsx:398/512`, `PorProjetoView.tsx:88/119` e `CalendarioView.tsx:571` saem junto com o filtro quebrado. E `funil_video` é renomeado para `metodo_video` na mesma migração: enquanto ele se chamar funil, a palavra continua significando três coisas.
No lugar deles, o padrão que este projeto já escolheu duas vezes (`funil_vsls`, `funil_checkouts`): array não aceita chave estrangeira — então ligação, não coluna. E aqui a ligação se parte em duas naturezas, que é o mesmo desenho de `status_veiculacao` × Meta:
  • FATO — `vw_criativo_funil`, VIEW, derivada na leitura. Sem espelho, sem gatilho, sem armadilha 4.
  • PLANO — `producao_funis_plano (producao_id, funil_id, criado_por, criado_em)`, só as linhas manuais "quero testar este criativo neste REV". É por aqui que o REV planejado ganha fila.

(b) COMO POPULAR SEM DIGITAR — cascata de três degraus, medida
A ponte venda→REV já existe e funciona: `fn_venda_resolve_funil` resolve `vendas.funil_id` pelo checkout (5.504 de 15.683 vendas preenchidas), e `vendas.ad_id_meta` → `producao_ads.ad_id` → `producao_id` fecha o caminho até o card.
  1º por VENDA do próprio anúncio — 185 cards (175 com um REV só; 10 com 2 a 4, e esses 10 são legítimos: o mesmo criativo rodou em dois REVs).
  2º por CONJUNTO dominante (≥80% das vendas do adset num REV) — sobe para 445 anúncios / 318 cards.
  3º por CAMPANHA dominante — 707 de 1.033 anúncios, 447 de 521 cards com anúncio. A dominância é limpa: das 12 campanhas com venda atribuída, 9 dão 100% num único REV, 'TESTE TSL - 07/07/26' dá 98,7%. Só 'TESTE TSL - 27/06/26' (4 REVs, 81%) e 'TESTE Guias - 02/09' (51%) ficam de fora do corte, e ficar de fora é o comportamento certo.
Cascata inteira: 464 cards ligados a 10 REVs, com selo de origem na célula — 'venda' não é a mesma certeza que 'campanha'.
O QUE NÃO DÁ, e precisa estar escrito na tela: `angulo_teste` NÃO carrega funil — "Rotina" tem 122 cards em 5 projetos, "3 dicas" 75 em 4; ângulo é a mensagem, não o destino. `projeto_id` sozinho também não: Saponaria Brasil tem 6 REVs. Projeto + método resolve para exatamente 1 REV em 6 das 10 combinações vivas; nas outras 4 sobram 2 ou 3 (Guia dos Comportamentos TSL tem 3) — serve como SUGESTÃO pré-marcada, nunca como verdade gravada. E o nome da campanha não serve: 15 campanhas com 'TESTE' levam R$ 214.685 e rodam há 3 meses; o nome não descreve a função.
E o teto honesto: 2.459 dos 2.980 postados nunca viraram anúncio, então nenhuma derivação lhes dá REV. Para eles a resposta certa é "não rodou", não um REV chutado.

(c) A TELA
Cabeçalho: `MultiFilter` (`src/features/producao/components/MultiFilter.tsx`) com `larguraDaLista="280px"`, porque os nomes se repetem — "REV1 - Original" existe 4× e "Mini PV da Bio" 4×. Cada opção é "REV5 · Saponaria Brasil" com ponto de cor do status. Opções vêm de `vw_mapa_revs`, os 33 — NÃO de `fetchFunis()` (`src/lib/dataCache.ts:20`), que faz `.eq('ativo', true)` e por isso nunca mostraria os 5 planejados, que são justamente o caso de uso dela. Ordem: Ativos (10) · Planejados (5) · e "mostrar encerrados" abrindo os 18 restantes.
Uma coluna por REV escolhido, e em cada uma três blocos:
  RODANDO AGORA — n criativos com `vw_producao_estado_ads.estado = 'ativo'`, nunca `status_veiculacao` (26 dos 470 comparáveis já divergem; 'Pausado' erra em 32%).
  DÁ PARA REATIVAR — Validado/Escalado com estado ≠ ativo, com `ultimo_gasto` ao lado ("parou em 12/08"). Medido: 38 cards nos 10 REVs mapeados, e 14 deles só no REV1-Original/Workshop Buquê.
  NUNCA RODOU — postados do projeto sem anúncio nenhum.
REV planejado não finge ter ads: a coluna diz "nada rodou aqui ainda" e abaixo lista os aprovados-e-parados do mesmo projeto+método, com um botão "marcar para testar neste REV" que grava em `producao_funis_plano`. Para Velas Lembrancinhas/REV3 isso são 10 cards; para Workshop Buquê/REV5-VSL, 17; para Handify e Velarte, zero — e a tela diz zero com todas as letras, porque Handify tem 1 card e nenhum postado.
Vazio e carregando obrigatórios; o botão de marcar em lote pede confirmação.

(d) 'DESCARTADO' DERIVADO, N = 7 DIAS
Campo digitado repetiria a armadilha 1 na sexta vez: ninguém volta para desmarcar quando o criativo finalmente sobe, e em três meses 'descartado' discorda de `producao_ads`. Derivar é gratuito e se auto-corrige.
O N sai da medição, não do gosto: quando um card VIRA anúncio, ele vira em ≤1 dia em 90% dos casos e em ≤4 dias em 95% (p50=1, p75=1, p90=1, p95=4). Sete dias é folga de quase o dobro do p95. O p99 de 230 dias e o máximo de 703 são cards importados, e é por isso que a regra leva duas cláusulas: "postado há mais de 7 dias, sem linha em `producao_ads`, E postado a partir de 01/05/2026" — antes disso `metricas_meta` não existe, e chamar de descartado o que o banco não podia enxergar seria inventar perda.

O NÚMERO QUE ASSUSTA, NA VERSÃO QUE SE SUSTENTA
Não são 4 de 5 criativos que nunca rodam. O que existe de verdade é estoque parado: 140+ criativos Validado/Escalado sem nenhum anúncio ativo, concentrados em projetos que pararam — Velas Perfeitas 58 (58 parados, 0 rodando), Cosmética Natural 37/37, Segredos das Birras 22/22, Desafios na Sala de Aula 16/16, Limites Respeitosos 7/7. Isso não acusa editor nenhum: são criativos que a própria tela já aprovou, num projeto que a empresa desligou. A tela mostra isso como ESTOQUE, não como falha — coluna "dá para reativar", ordenada por verba já gasta e vendas acumuladas, com a frase "aprovados, parados, disponíveis". A perda que sobra depois de limpar o artefato é essa, e ela é uma oportunidade, não uma cobrança.

### Banco
MIGRAÇÃO 1 (o primeiro passo, reversível, sem DDL destrutivo):
- `create view vw_criativo_funil` — cascata em três degraus sobre `producao_ads` × `metricas_meta(nivel='ad')` × `vendas(status='aprovada', funil_id not null)`. Colunas: `producao_id, funil_id, origem ('venda'|'conjunto'|'campanha'), vendas_base`. Dominância: ≥80% E ≥10 vendas atribuídas — o percentual sozinho deixa passar conjunto com 2 vendas. `security_invoker = on`, como as outras views do projeto.
- `create view vw_criativo_sem_veiculacao` — postados a partir de 01/05/2026, há mais de 7 dias, sem linha em `producao_ads`. É o "descartado" derivado; nenhuma coluna nova.

MIGRAÇÃO 2 (depois que a tela provar a derivação):
- `create table producao_funis_plano (producao_id uuid references producoes(id) on delete cascade, funil_id uuid references funis(id) on delete cascade, criado_por uuid references perfis(id), criado_em timestamptz default now(), primary key (producao_id, funil_id))`. RLS obrigatória: `for all to authenticated using (true) with check (true)`.
- `alter table producoes drop column funil_ids;` e `drop column funil_id;` — os dois em 0/4.082, sem UI de escrita ligada. Antes: limpar `AvaliacaoView.tsx:398,512`, `PorProjetoView.tsx:88,119`, `CalendarioView.tsx:571`, `DesempenhoAdsView.tsx:49,473`, `CriativoDrawer.tsx:216-219`, `CriativoFormModal.tsx:40,50,127-132,147`, `producao/components/types.ts:12`.
- `alter table producoes rename column funil_video to metodo_video;` — tira a terceira acepção de "funil" do vocabulário. 1.988 linhas preservadas; os consumidores são os mesmos arquivos acima mais `normalizarFunil()` em `DesempenhoAdsView.tsx:127`.
- `src/lib/dataCache.ts:20` — `fetchFunis` passa a ler `vw_mapa_revs` sem `.eq('ativo', true)`, com `status` junto, para que os 5 REVs planejados apareçam.

ALERTA (opcional, mesma infra): código `criativo_aprovado_parado` em `vw_alertas` + linha em `alertas_area` com `area = 'criativos'` — hoje a tabela só tem inicio/vendas/meta-ads/utm, e sem a linha o alerta cai em 'inicio', que é a página errada para resolvê-lo.

### Riscos
- Armadilha 1, no campo que sobra: se `funil_video` continuar se chamando funil ao lado de `vw_criativo_funil`, a palavra volta a ter dois donos. Ele guarda TSL/VSL/QUIZ, que é `funis.metodo`, e o comentario em DesempenhoAdsView.tsx ja registra que o campo acumulou 3 grafias da mesma combinacao. Renomear para `metodo_video` na mesma migracao.
- Armadilha 1 em forma de UI viva: hoje selecionar qualquer funil em Criativos/Avaliacao (AvaliacaoView.tsx:512) ou Producao/Por Projeto (PorProjetoView.tsx:119) zera a lista, sem erro nenhum na tela. Se a aba nova nascer e esses dois filtros ficarem, a mesma pergunta passa a ter duas respostas — uma certa e uma vazia.
- Armadilha 4: se `vw_criativo_funil` virar tabela materializada por um backfill, congela igual a `funil_checkouts` (que nasceu de insert...select e deixou venda orfa). Por isso FATO e view derivada na leitura; se um dia virar tabela por desempenho, o refresh entra no cron `atribuicao-horaria`, ao lado de `fn_fixar_vinculo_ads`, nunca como carga unica.
- Armadilha 3: o limiar de 0,8 da dominancia e qualquer leitura de nome de campanha sao lista fixa envelhecendo. O limiar fica em `configuracoes` ou explicito no comentario da view com o numero que o justificou; o nome da campanha nao entra na regra — 'TESTE TSL - 27/06/26' mistura 4 REVs e 15 campanhas 'TESTE' carregam R$ 214.685.
- Atribuicao fraca: as contas Saponaria sao ~40% da verba e casam 24% e 0% das compras. Um REV derivado por dominancia de campanha nessas contas sai de uma minoria das vendas. Exigir volume ABSOLUTO minimo alem do percentual (>= 10 vendas atribuidas) e mostrar o selo de origem na celula — 'por venda' e 'por campanha' nao sao a mesma afirmacao.
- `fetchFunis()` em src/lib/dataCache.ts:20 filtra `.eq('ativo', true)`: e o mesmo `.eq('ativo', true)` que ja escondeu 4 REVs por meses. Usado aqui, os 5 planejados — o pedido inteiro dela — ficam invisiveis.
- Armadilha 2: multiselect que so filtra e cadastro sem coluna de resultado. Se a celula do REV nao trouxer numero (rodando / parado-aprovado / nunca rodou), a tela vira mais um lugar de escolher sem medir.
- O vinculo de plano (`producao_funis_plano`) e cadastro: sem uma coluna dizendo 'marcado ha X dias e ainda nao subiu', ele envelhece igual aos 36 order bumps, 10 dos quais nunca venderam.

### O que NÃO fazer
- Nao digitar vinculo criativo->REV a mao em 3.753 linhas, nem em 2.980 postados.
- Nao reaproveitar `funil_ids` so porque a coluna ja existe: uuid[] nao aceita chave estrangeira, e o projeto ja decidiu isso por escrito em 20260908a (funil_vsls) e em funil_checkouts.
- Nao criar `producoes.descartado` como campo digitado — nem 'arquivado', nem 'nao usado', nem checkbox equivalente.
- Nao derivar REV do NOME da campanha ou do conjunto: medido, o nome nao descreve a funcao.
- Nao usar `producoes.status_veiculacao` para dizer se o criativo esta no ar (DesempenhoAdsView.tsx:473 ja usa, e 26 dos 470 comparaveis divergem). Usar `vw_producao_estado_ads`.
- Nao reescrever a regra de situacao em TypeScript: `vw_meta_status` e a fonte, e src/features/ads/situacao.ts so carrega rotulo e cor.
- Nao repetir os 21% (275/1.310) em tela, alerta ou conversa — o numero mede importacao, nao producao.
- Nao criar item novo na sidebar nem sub-itens; a aba entra em /criativos.
- Nao inventar REV para os 2.459 postados sem anuncio: 'nao rodou' e a resposta certa.
- Nao prometer fila de reativacao para Handify e Velarte: os dois tem zero criativos postados.

### Primeiro passo
Criar `vw_criativo_funil` — só a view, nenhuma mudança de esquema — com a cascata venda → conjunto (≥80% e ≥10 vendas) → campanha, devolvendo `producao_id, funil_id, origem`. Ela liga 464 cards a 10 REVs hoje. Em seguida, na aba Desempenho que já existe (`src/features/criativos/components/DesempenhoAdsView.tsx`), trocar o `MultiFilter` de "Funil" para ler dessa view em vez de `funil_video`, e acrescentar a coluna REV na tabela de escalados. Isso já responde "quais criativos rodaram em cada REV", conserta o filtro que hoje mente, e PROVA a derivação antes de qualquer coluna ser apagada ou criada.

### Furos que os céticos abriram (3)
- **[confiança alta]** O eixo REV não alcança a maior parte do que a tela promete mostrar — e não por atribuição fraca, mas porque o REV não existe como registro.

Medido agora no banco:
- `funis` tem 33 linhas cobrindo APENAS 8 projetos. `ofertas_editores` (a tabela de projetos) tem 35. **27 projetos não têm nenhum REV**, nem arquivado.
- **1.821 dos 2.980 cards postados (61%) estão em projetos com zero REVs.** Nenhum degrau da cascata resolve isso: não há `funil_id` para derivar.
- Pior, bate exatamente no payload que o desenho vende. Dos ~196 cards Validado/Escalado sem anúncio ativo (a coluna "DÁ PARA REATIVAR", o "estoque parado" do parágrafo final), **126 (64%) estão em projetos sem REV nenhum**:
  · Velas Perfeitas 58 parados · 755 postados · **0 REVs**
  · Cosmética Natural 37 · 545 postados · **0 REVs**
  · Segredos das Birras 22 · 114 postados · **0 REVs**
  · Limites Respeitosos 7 · **0 REVs** · Núcleo de Testes 2 · **0 REVs**
  Dos cinco projetos que o próprio desenho nomeia como a perda ("Velas Perfeitas 58, Cosmética Natural 37, Segredos das Birras 22, Desafios 16, Limites 7"), **quatro não têm coluna possível na tela**. Sobra Desafios (16).

Ou seja: uma tela cujo cabeçalho é um multiselect de REV mostra, na melhor das hipóteses, ~70 dos 196 cards reativáveis, e esconde os dois maiores estoques inteiros. Os 38 cards medidos na coluna "dá para reativar" não são um começo modesto da cascata — são o teto estrutural do eixo escolhido.

Dois agravantes do mesmo eixo:
1. Coluna por REV duplica o que é por projeto. "NUNCA RODOU — postados do projeto sem anúncio nenhum" é por `projeto_id`; Saponaria Brasil tem 9 REVs, então o mesmo conjunto apareceria idêntico em 9 colunas, e o total da tela passa a contar o mesmo card 9 vezes. O mesmo vale para o fallback do REV planejado (projeto+método).
2. `vw_producao_estado_ads` só tem linha para card COM vínculo em `producao_ads` (o `FROM producao_ads ... GROUP BY`). São 521 cards de 2.980 postados. O bloco "nunca rodou" depende de LEFT JOIN + ausência de linha, não de `estado`; lido como o desenho escreve ("estado = 'ativo'" de um lado, "sem anúncio nenhum" do outro), 2.459 cards não têm linha para ler.

É o mesmo defeito que o CLAUDE.md já cobrou uma vez com `.eq('ativo', true)`: o dado não aparece e a tela não diz que sumiu. Aqui some por INNER JOIN com `funis`, o que é mais silencioso ainda.
  - *Conserto:* Não jogue nada fora — `vw_criativo_funil`, a cascata de três degraus, o selo de origem, o descartado derivado com N=7 e o drop de `funil_id`/`funil_ids` continuam certos e medidos. Troque só o EIXO da tela.

1. **Projeto é a linha; REV é a coluna.** Todo card tem projeto (4.076 de 4.087; 11 órfãos). Todo card tem, no máximo, REV. A tela vira "Estoque de criativos por projeto", e dentro de cada projeto as colunas são os REVs dele MAIS uma coluna obrigatória **"sem REV"** — que é onde caem os 126 reativáveis e os 1.821 postados de hoje. Sem essa coluna a tela mente por omissão.

2. **O multiselect vira de projeto+REV, não só de REV.** Opções de `ofertas_editores` (35) agrupando `vw_mapa_revs` (33) por baixo; projeto sem REV aparece com o rótulo "sem REV cadastrado" em vez de não aparecer. Mantém `larguraDaLista="280px"` e a ordem Ativos · Planejados · encerrados — a razão dela (os 5 planejados) continua válida.

3. **Os blocos que são por projeto ficam na LINHA do projeto, não repetidos em cada coluna.** "NUNCA RODOU" e "aprovados e parados" são por `projeto_id`; só "RODANDO AGORA" e "veio deste REV" são por REV (via `vw_criativo_funil`). Isso mata a duplicação ×9 do Saponaria e faz o total da tela fechar.

4. **Ler estado com LEFT JOIN e três estados, não dois:** `estado='ativo'` · `estado` presente e ≠ ativo (parou — com `ultimo_gasto`) · **sem linha em `vw_producao_estado_ads`** (nunca virou anúncio). Os 2.459 postados sem anúncio precisam do terceiro, e ele não existe na view.

5. **Primeiro passo, corrigido:** criar `vw_criativo_funil` como proposto (ela é boa e prova a derivação), mas medir junto, na mesma migração, a cobertura — quantos cards ficam sem REV por projeto — e mostrar esse número na própria tela ("126 aprovados e parados em 5 projetos sem REV"). É a coluna de resultado ao lado do cadastro, aplicada ao próprio mapeamento. Se um dia esses projetos ganharem REV, o número cai sozinho; enquanto não ganharem, a tela diz por que estão fora em vez de escondê-los.
- **[confiança alta]** A Migração 2 mata a ambiguidade de "funil" só no TypeScript. Nos dois lugares onde a palavra é DADO e não código, ela sobrevive — e um deles quebra em silêncio.

(1) ARMADILHA 3, medida agora no banco: `criativo_campos_opcoes` tem 4 linhas com `campo = 'funil_video'` — TSL | VSL | QUIZ | WhatsApp. Esse `campo` é conteúdo de coluna, não nome de coluna: `ALTER TABLE producoes RENAME COLUMN funil_video TO metodo_video` não encosta nele. Quem lê é `CriativoDrawer.tsx:109` (`byField('funil_video')`) e `CriativoFormModal.tsx:100` (`by('funil_video')`), e quem escreve é `GerenciarOpcoesPopover campo="funil_video"` (`CriativoDrawer.tsx:663`, `FunilModal.tsx:399`). Trocando o literal para `'metodo_video'` junto com a coluna, a consulta volta vazia, o guarda `if (fv.length)` não dispara e a tela cai no fallback fixo `FALLBACK_FUNIL_VIDEO = ['TSL','VSL','QUIZ']` (`CriativoFormModal.tsx:24`) e `useState<string[]>(['TSL','VSL','QUIZ'])` (`CriativoDrawer.tsx:75`). Resultado: "WhatsApp" — opção que ela cadastrou pelo popover — some do seletor sem erro nenhum, e uma lista que hoje é derivada de tabela vira lista escrita no código. É o `funil_ids` que "esvazia a tela sem erro" reencenado pela própria migração que veio matá-lo. Não trocar o literal é pior: fica coluna `metodo_video` com chave de opções `funil_video`, dois nomes para a mesma coisa (armadilha 1).

(2) ARMADILHA 1, a acepção que não morre: o desenho afirma que a Migração 2 "tira a terceira acepção de 'funil' do vocabulário" e lista como consumidores apenas arquivos .tsx mais `normalizarFunil()`. O banco diz outra coisa — existem hoje TRÊS views expondo uma coluna chamada `funil` que significa MÉTODO, todas alimentadas por `fn_funil_video_norm(p.funil_video)`: `vw_esteira_lotes`, `vw_gestor_fila` e `vw_pedidos_variacao` (definidas em `supabase/migrations/20260827zm`, `zp`, `zq`, `zr`, `zu`, `zw`). O Postgres reescreve a referência interna sozinho no RENAME, então nada estoura: a função continua se chamando `fn_funil_video_norm`, as views continuam devolvendo `funil`, e `vw_gestor_fila` continua sendo lida por tela viva (`src/features/producao/components/gestor/tipos.ts:5`). Depois da migração, `funil` significa MÉTODO em três views e REV em `vw_criativo_funil` — ao mesmo tempo, no mesmo banco. Ironia registrada no próprio repositório: o cabeçalho de `20260827zu_fila_do_gestor_de_trafego.sql` diz que duplicar a resolução de funil "seria a primeira armadilha do CLAUDE.md".

Obs. de honestidade: `CriativoCard.tsx:17` e `HojeView.tsx:132` também leem `funil_video` e ficaram fora da lista, mas esses o TypeScript denuncia ao renomear `types.ts:13` — são barulhentos. Os dois de cima são os que passam calados, justamente por viverem fora do alcance do compilador.
  - *Conserto:* O desenho inteiro se salva tirando o rename da Migração 2 e tratando-o como migração própria, com escopo real:

1. Primeiro passo fica como está. `vw_criativo_funil` + coluna REV no Desempenho não dependem de renomear nada. Prove a derivação antes.

2. Quando o rename vier, ele é UMA migração com quatro atos, não um `ALTER`:
   a. `alter table producoes rename column funil_video to metodo_video;`
   b. `update criativo_campos_opcoes set campo = 'metodo_video' where campo = 'funil_video';` (4 linhas — sem isso o seletor esvazia)
   c. `fn_funil_video_norm` → `fn_metodo_video_norm`, com o antigo virando wrapper só se algo externo depender dele;
   d. `vw_esteira_lotes`, `vw_gestor_fila`, `vw_pedidos_variacao` recriadas com a coluna `funil` renomeada para `metodo` (CREATE OR REPLACE não renomeia coluna — precisa DROP/CREATE na ordem de dependência), e os consumidores de `.funil` nas telas de esteira/gestor ajustados junto. Só aí a frase "funil significa REV e nada mais" passa a ser verdade.

3. Matar os fallbacks fixos `['TSL','VSL','QUIZ']` (`CriativoFormModal.tsx:24`, `CriativoDrawer.tsx:75`) na mesma leva. Enquanto existirem, qualquer chave errada no futuro volta a falhar em silêncio em vez de gritar. No lugar: estado de carregando e estado vazio explícito ("nenhum método cadastrado — abrir Gerenciar Opções"), que o próprio CLAUDE.md já exige de toda lista.

4. Como a chave é DADO, só teste pega a divergência: um teste no padrão do `src/test/configuracoes-por-empresa.test.ts` (que lê o código-fonte para impedir UPDATE sem filtro) — aqui, um que leia os literais passados a `GerenciarOpcoesPopover campo="..."` / `byField('...')` e falhe quando algum não tiver linha correspondente em `criativo_campos_opcoes`. É o teste que a armadilha 3 pede quando a lista precisa existir nos dois lados.

5. Ajuste menor, de brio: "DÁ PARA REATIVAR — estado ≠ ativo" joga `reprovado` no mesmo balde que `pausado`, e `20260905b_o_card_diz_se_o_anuncio_dele_ainda_roda.sql` criou a precedência exatamente para separar os dois ("reprovado PARECE pausado na tela e exige acao diferente"). Um criativo DISAPPROVED não se reativa — ele se refaz. Use os cinco valores de `vw_producao_estado_ads.estado`, não um binário em cima deles.
- **[confiança alta]** A tela é organizada em COLUNA POR REV, e a maior parte do que ela promete mostrar não tem REV nenhum para morar — nem existe opção no multiselect capaz de contê-lo.

Medido agora no banco (prtkfwwqpcziexgipoqk), cruzando `producoes` × `vw_producao_estado_ads` × `funis.projeto_id`:

- Cards Validado/Escalado com estado ≠ 'ativo' ou sem anúncio: **196**. Desses, **126 estão em projetos com ZERO linhas em `funis`**: Velas Perfeitas 58 (0 REVs), Cosmética Natural 37 (0), Segredos das Birras 22 (0), Limites Respeitosos 7 (0), Núcleo de Testes 2 (0).
- São exatamente os projetos que o fechamento do próprio desenho chama de "a perda que sobra... uma oportunidade". Eles não aparecem como REV ativo, nem planejado, nem em "mostrar encerrados" — `vw_mapa_revs` sai de `funis`, e não há linha. O bloco "NUNCA RODOU" também é por REV, então tampouco os alcança.
- O que sobra para as colunas: **39 cards aprovados-e-parados com linha na view** (37 `pausado`, 1 `com_problema`, 1 `sem_anuncio`) — casa com os "38 nos 10 REVs mapeados" do próprio desenho. Ou seja, a tela criada para responder "o que dá para reativar" mostra 39 de 196, e some com 126 sem uma linha na interface dizendo que sumiu.

O efeito de UX é o pior possível para esta usuária: ela seleciona todos os REVs, vê números de um dígito por coluna e conclui "tem pouco parado" — o oposto do que o desenho mediu. É a regra de leitura do CLAUDE.md invertida: aqui o número vai parecer PEQUENO, e número pequeno ninguém desconfia. E a tela não tem onde denunciar o que não consegue mostrar.

Furo menor, mesma origem, mas concreto: **157 cards aprovados não têm linha em `vw_producao_estado_ads`** (a view só tem linha para quem está em `producao_ads` — ver `supabase/migrations/20260905b_o_card_diz_se_o_anuncio_dele_ainda_roda.sql`). O desenho define a coluna como "estado ≠ ativo" e nunca diz o que fazer com a ausência de linha: em JS `null !== 'ativo'` é **true** e os 157 inundam a coluna com "parou em —"; em SQL `estado <> 'ativo'` é NULL e eles **somem**. Mesma frase do desenho, 39 ou 196 cards na tela conforme o filtro caia no cliente ou na view.
  - *Conserto:* Manter tudo (a cascata, `vw_criativo_funil`, o plano, o descartado derivado) e trocar só quem manda no eixo — de porteiro para recorte:

1. **A tela nasce do ESTOQUE, não do REV.** A lista base é "aprovados e parados" (196 hoje), agrupada por projeto e ordenada por verba já gasta. O `MultiFilter` de REV filtra em cima dela, como os filtros de editor/projeto já fazem em `DesempenhoAdsView.tsx:794-796`. Nada some por não ter atribuição. Se quiser manter a visão em colunas, então a última coluna é fixa e sempre visível: **"Sem REV (126)"**, com o subrótulo "projeto sem funil cadastrado" — o REV explica, não filtra para fora.

2. **Três estados escritos, não dois.** `estado = 'ativo'` → rodando agora; `estado in ('pausado','reprovado','com_problema')` → parou, com `ultimo_gasto` ("parou em 12/08"); **sem linha na view** → "nunca virou anúncio", bucket próprio, badge de cor diferente, 157 cards. Isso não pode cair no `≠ ativo` por acidente — e resolve a divergência JS/SQL de uma vez, porque a regra deixa de depender de `null`.

3. **A linha que denuncia o achado**, no topo da aba, no espírito de `vw_dinheiro_sem_empresa`: "5 projetos com 126 criativos aprovados e nenhum REV cadastrado" — clicável, levando à lista. É o número que justifica a tela existir, e hoje o desenho o deixa fora dela.

4. **Antes do alerta `criativo_aprovado_parado`**: ele nasceria aceso em 126 cards de projetos que a empresa desligou, sem botão que o apague — reativar é ação na Meta, não no painel. Ou o alerta só conta cards de projeto ATIVO (aí tem dono: quem toca o projeto) e ganha o botão "marcar para testar neste REV" como saída, ou ele não entra. Alerta que fica aceso depois da única ação disponível é o ruído que se aprende a ignorar.

5. Detalhe de reuso já verificado: `MultiFilter` (`src/features/producao/components/MultiFilter.tsx`) aceita só `{id, nome}` plano — não tem ponto de cor, agrupamento "Ativos/Planejados" nem "mostrar encerrados", e com `options` vazio abre um popover em branco. O desenho descreve os três; ou estende o componente (com estado vazio) ou descreve a opção como "REV5 · Saponaria Brasil · planejado" em texto.

---

## A divida que bloqueia tudo: producoes.status_veiculacao

**Chave:** `status-veiculacao` · **Esforço:** medio

### Veredito
Confirmo a dívida, mas dois fatos do briefing estão errados e mudam o plano. (1) `DesempenhoAdsView.tsx` NÃO mostra o campo: ele aparece só na interface (linha 46) e na string do SELECT (linha 473), e nenhuma linha das outras 1.163 o renderiza ou filtra — quem mostra o estado mentiroso é `CriativosMetaTab.tsx` (linhas 1057 e 1415) e `CriativoDrawer.tsx:844`, e `PorProjetoView.tsx:98` filtra por ele sem sequer selecioná-lo. (2) Não é "um espelho do que `vw_meta_status` já sabe": ninguém lê `vw_meta_status` no nível de card. A migração 20260905b criou `vw_producao_estado_ads` com uma regra PRÓPRIA sobre `effective_status` — exatamente a regra que a 20260829b tinha rejeitado por escrito. Hoje existem TRÊS respostas para "o anúncio deste card roda?", não duas. Escolho a opção (1) com o passado congelado, e refuto a (3) adiante.

### Desenho
## Por que (1) e não (2) nem (3)

**Contra a (3) — manter como INTENÇÃO.** O vocabulário do campo desmente a
hipótese: `Rodando | Pausado | Encerrado | Bloqueado | Arquivado` (constraint
`status_veiculacao_conhecido`, 00000000000002_baseline_constraints.sql:143) é
cópia palavra por palavra do estado da Meta. Intenção seria "deixar mais 3
dias", "matar". Chamar de intenção os 2.604 valores existentes é relabelar
2.604 linhas que foram digitadas como tentativa de FATO. E a intenção já tem
casa: `avaliacao` (Validado/Escalado/Não validado) e `fase = arquivado`. Um
terceiro campo seria armadilha 1 contra os dois e armadilha 2 (nenhuma tela
provaria que alguém age sobre ele). A distribuição confirma: dos 470
conferíveis, 366 são `Encerrado` — é marcador de arquivo morto, não plano.

**Contra a (2) — derivar por gatilho.** O fato muda na META, não na linha. Não
existe evento em `producoes` para o gatilho escutar; ele teria de pendurar-se no
`meta-insights-sync`, e entre dois syncs a coluna estaria errada com cara de
certa. Armadilha 4 manda pôr gatilho em espelho que PRECISA existir; aqui a
view já responde e não envelhece. Materializar 3.753 linhas que uma view calcula
de graça é fabricar armadilha 1 de propósito.

**A (1), com uma correção:** apagar o valor, não. Para 2.134 cards não existe
segunda fonte. A coluna deixa de ser CAMPO e vira REGISTRO datado.

## Passo 0 — a view para de ter regra própria (é aqui que mora o defeito)

`vw_producao_estado_ads` conta `effective_status` sem nunca olhar `status`.
A 20260829b decidiu o contrário ("a intenção vem antes do impedimento"), e a
divergência é nomeável:

- anúncio que a pessoa DESLIGOU e está `WITH_ISSUES`: `parado` em
  `vw_meta_status`, `com_problema` em `vw_producao_estado_ads`. São os três
  casos que a 20260829b cita por escrito.
- `ACTIVE` dentro de conjunto pausado: `barrado_pelo_pai` (28 anúncios,
  R$ 2.347,21/30d — o caso que fez a view existir) some dentro de `pausado`.
- `ativo_nunca_entregou` / `ativo_sem_entregar` não existem no nível de card:
  o anúncio ligado que não entrega aparece como "no ar". É o falso positivo mais
  caro dos cinco.
- `sem_dado` (API parou de confirmar) é misturado com `sem_anuncio` (nunca teve
  vínculo). Ações diferentes.
- os dois calculam `ultimo_gasto` sobre `metricas_meta` separadamente.

Reescrever `vw_producao_estado_ads` como agregação de `vw_meta_status`, com o
MESMO vocabulário de 8 valores + `sem_anuncio` (único que a view inventa, e é
sobre o vínculo, não sobre a Meta). Assim `situacao.ts` serve as duas telas e
existe UM mapa de rótulo, não dois. A precedência de "o card tem vários
anúncios" é a ordem-por-ação que `ORDEM_SITUACAO` já define — e ela deve morar
num lugar só: tabela `meta_situacao (chave, ordem_acao)` que a view lê por
`min(ordem_acao)`. Expor também `ads_rodando`, `ads_bloqueados`, `ads_ligados`,
para o selo poder dizer "bloqueado · 2 de 5" e nenhum anúncio sumir dentro do
resumo.

## Passo 1 — a coluna congela

`rename column status_veiculacao to status_veiculacao_legado`. O rename É o
mecanismo de segurança: qualquer caminho de escrita esquecido quebra ALTO no
próximo deploy, em vez de continuar gravando em silêncio num campo que ninguém
lê. Mais: derruba a constraint `status_veiculacao_conhecido`, `comment on
column` com a data do congelamento, e um `BEFORE UPDATE` que levanta exceção se
o valor mudar — CLAUDE.md diz "nunca deixar os dois editáveis", e isso o banco
garante, não o combinado. Apagar as linhas `campo = 'status_veiculacao'` de
`criativo_campos_opcoes` na mesma migração (armadilha 3: vocabulário órfão é
convite para a próxima tela).

Isto não é armadilha 4. Espelho é errado quando a fonte muda e ele não segue;
um registro congelado não tem mais fonte — o gatilho que o manteria é justamente
o que estamos removendo. Vale dizer isso na migração, porque alguém vai citar a
armadilha 4 contra o plano.

## Passo 2 — as telas (Criativos, aba Avaliação; /editores)

- **`AvaliacaoView.tsx`**: some o `<select>` da linha 789 e o `handleChange` de
  `status_veiculacao`; a célula vira selo derivado por `situacaoDe()`. E somem a
  função `contradiz()` (linha ~253), `qtdContradicao` e o botão "só
  contradição" — eles existem para medir uma divergência que a migração torna
  impossível; mantê-los é cadastro sem resultado. É a entrega visível: a tela
  perde uma coluna e para de precisar dela.
- **O filtro tem de continuar NO BANCO.** `.in('status_veiculacao', filtroStatus)`
  em `AvaliacaoView:408`, `CalendarioView:614` e `PorProjetoView:98` é filtro de
  servidor sobre busca paginada (`todasAsLinhas`). Movido para o cliente, ele
  filtra uma página e some card sem avisar — o defeito que esta mesma tela já
  teve (916 de 2.916 nunca chegavam). Solução: view `vw_producao_criativo` com
  as colunas do card + `situacao` + `ultimo_gasto` + `inv_7d`, e a consulta passa
  a ler dela mantendo `.in('situacao', ...)` no servidor. `PorProjetoView`
  precisa também SELECIONAR a coluna: hoje filtra por um valor que nunca mostra.
- **`CriativoDrawer.tsx`**: fora o `<Select>` (830) e o
  `GerenciarOpcoesPopover campo="status_veiculacao"` (841) — o sócio não pode
  editar um vocabulário que é da Meta. Modo leitura (844) mostra o selo
  derivado e, só quando houver valor legado, uma linha discreta: "marcado à mão
  como *Encerrado* até 16/09/2026".
- **`CriativoFormModal.tsx`**: tirar do payload (164) e o `Sel` da linha 412.
  Card novo não tem anúncio; o campo nasce mentindo.
- **`CriativosMetaTab.tsx` (1057 e 1415)**: são os que de fato exibem a
  mentira, e são de nível ANÚNCIO — devem usar a `situacao` do próprio anúncio,
  não o resumo do card. `fn_criativos_meta` troca `status_veiculacao text` por
  `situacao text` no `RETURNS TABLE`.
- **`DesempenhoAdsView.tsx`**: apagar as linhas 46 e 473. Zero mudança de tela,
  e essa ausência de mudança é a prova para este arquivo.

## Passo 3 — a coluna de resultado ao lado (armadilha 2)

Estado sozinho é cadastro. Ao lado do selo, `inv_7d` do card. É o que torna
acionável o achado que originou tudo ("marcado Encerrado, R$ 5.691,62 em 7
dias") e o que sobrevive à correção: dinheiro saindo em card que ninguém olha.

## Passo 4 — o alerta, na página onde se resolve

`fn_alerta_card_gastando_sem_entregar()` unida a `vw_alertas` pelo idioma
ancorado de `pg_get_viewdef` (20260901f), mais `insert into alertas_area
values ('card_gastando_sem_entregar', 'criativos')`. Sem linha em
`alertas_area` ele cai no Início, fora do caminho. O alerta não é mais "os
campos divergem" — é `ativo_nunca_entregou` / `ativo_sem_entregar` com verba.

### Banco
## Migração `20260916a_o_estado_do_anuncio_deixa_de_ser_digitado.sql`

**Tabela nova** `meta_situacao (chave text pk, ordem_acao int not null,
criado_em timestamptz default now())`, RLS `for select to authenticated using
(true)`. Nove linhas, na ordem de `ORDEM_SITUACAO`: bloqueado 1,
ativo_nunca_entregou 2, ativo_sem_entregar 3, barrado_pelo_pai 4, em_analise 5,
rodando 6, parado 7, sem_dado 8, sem_anuncio 9. Existe para a precedência do
resumo por card morar em UM lugar em vez de um `CASE` no SQL mais um array no
TypeScript (armadilha 1 e 3).

**View reescrita** `vw_producao_estado_ads`: `producao_ads pa LEFT JOIN
vw_meta_status v ON v.nivel = 'ad' AND v.objeto_id = pa.ad_id LEFT JOIN
meta_situacao s ON s.chave = v.situacao`, agrupada por `pa.producao_id`,
devolvendo `situacao` = a chave de `min(s.ordem_acao)` (ou `'sem_anuncio'`
quando `count(v.objeto_id) = 0`), mais `ads_ligados`, `ads_conhecidos`,
`ads_rodando`, `ads_bloqueados`, `max(v.ultimo_gasto) as ultimo_gasto`,
`sum(v.inv_30d)`, e `inv_7d` de `metricas_meta` em 7 dias. A coluna `estado`
sai; quem usa é só `AvaliacaoView.tsx:436`, que muda junto. `ultimo_gasto` passa
a vir de `vw_meta_status` em vez de ser recalculado.

**View nova** `vw_producao_criativo`: `producoes p LEFT JOIN
vw_producao_estado_ads e ON e.producao_id = p.id`, com as colunas que as três
telas selecionam hoje + `situacao`, `ultimo_gasto`, `inv_7d`,
`status_veiculacao_legado`. Existe para o filtro por estado continuar sendo
`.in()` de servidor sobre busca paginada.

**Coluna**:
`alter table producoes drop constraint status_veiculacao_conhecido;`
`alter table producoes rename column status_veiculacao to status_veiculacao_legado;`
`comment on column producoes.status_veiculacao_legado is 'Digitado à mão até
16/09/2026, quando o estado passou a sair de vw_meta_status. Congelado: 2.604
valores, dos quais 2.134 sem anúncio ligado e portanto sem segunda fonte. Não
escrever — há gatilho impedindo.';`
Gatilho `BEFORE UPDATE ON producoes` que faz `raise exception` quando
`new.status_veiculacao_legado is distinct from old.status_veiculacao_legado`.
Protege o que o teste não alcança: editor SQL, importação, edge function futura.

**Limpeza**: `delete from criativo_campos_opcoes where campo =
'status_veiculacao';`

**Função**: `fn_criativos_meta` — `RETURNS TABLE` muda, então exige `DROP
FUNCTION` + `CREATE`, não `create or replace`. Trocar `status_veiculacao text`
por `situacao text`, lido de `vw_meta_status` pelo `ad_id` (nível anúncio, não
resumo do card). As quatro migrações antigas que declaram a assinatura
(baseline_funcoes:375, 20260823b:27, 20260824b:105, 20260827zj:27) NÃO se
editam; a nova supera.

**Prova dentro da migração**: antes do rename, `raise exception` se
`count(*) filter (where status_veiculacao is not null) <> 2604` — se a base
mudou desde a medição, o plano para em vez de seguir sobre número velho.
Depois, tabela `_conferencia_status_20260916` com o cruzamento valor antigo x
`situacao` nova para os 470 cards com anúncio, guardada para conferência.

**Migração seguinte, só quando ela confirmar**: nada. A coluna legada fica.
Não há data marcada para apagá-la, porque não há ganho em apagá-la.

### Riscos
- Os 2.134 cards sem anuncio passam todos a ler `sem anuncio`, e isso se le como "a migracao apagou meus status". A regra de leitura do CLAUDE.md funciona contra nos aqui: o numero VAI parecer estranho, e desta vez ele esta certo. Mitiga a linha legada no drawer ("marcado a mao como X ate 16/09/2026") — o risco real e fazer a troca em silencio.
- O filtro por status e `.in()` de SERVIDOR em tres telas (AvaliacaoView:408, CalendarioView:614, PorProjetoView:98) sobre busca paginada por `todasAsLinhas`. Se virar filtro de cliente, ele filtra uma pagina e some card sem nada na tela denunciando — e a AvaliacaoView ja sofreu exatamente isso (916 de 2.916 cards nunca chegavam). Por isso `vw_producao_criativo` existe. E a regra de leitura do CLAUDE.md: o total da lista e o numero a desconfiar depois do deploy.
- Armadilha 1 entre DUAS VIEWS, que e o risco de so consertar a coluna: `vw_producao_estado_ads` conta `effective_status` sem olhar `status`, e a 20260829b ja decidiu por escrito que a intencao vem antes do impedimento. Trocar um espelho digitado por um espelho CALCULADO e pior — contradicao calculada parece autoridade. Se o passo 0 nao for feito, o resto e cosmetica.
- `isPendente()` em AvaliacaoView.tsx:93 le `status_veiculacao === 'Rodando'` e `!status_veiculacao` para montar a fila "so pendentes". Com a coluna derivada, `!situacao` nunca e verdadeiro (todo card tem estado), entao o ramo `completamenteVazio` colapsa e a fila de trabalho DELA muda de tamanho sem ninguem ter pedido. Precisa ser redefinida de proposito (pendente = situacao em rodando/ativo_sem_entregar/ativo_nunca_entregou e sem avaliacao) e mostrada a ela antes de subir. Nao e mudanca de rotulo, e mudanca de fila.
- `fn_criativos_meta` muda o `RETURNS TABLE`, o que exige DROP + CREATE (o `create or replace` recusa). Esquecer o DROP quebra so a aba Criativos Meta de /editores, que e a menos aberta das tres — da para subir quebrada e ninguem notar por semanas. Armadilha 2 na forma de tela sem quem olhe.
- Os 5,5% de divergencia foram medidos sobre 470 de 2.604 cards (18%). Nao existe medicao para os outros 82%, e o numero NAO deve aparecer na tela como taxa de erro do projeto — foi medido na unica fatia mensuravel. O que a migracao entrega e outra coisa: fonte para 100% dos cards que tem anuncio, e um `sem anuncio` honesto para o resto.
- `criativo_campos_opcoes` com `campo = 'status_veiculacao'` sobrevivendo a migracao e armadilha 3 esperando: o proximo autor de `GerenciarOpcoesPopover` acha um vocabulario pronto e liga uma tela nova nele. As linhas tem de ir embora na mesma migracao, nao depois.
- `PorProjetoView.tsx:98` filtra por um campo que nao seleciona — o resultado do filtro nunca aparece na linha. Se a migracao so trocar o nome da coluna no filtro, o defeito atravessa intacto. Armadilha 2: filtro e cadastro; sem a coluna de resultado ao lado ninguem confere se o filtro fez o que disse.

### O que NÃO fazer
- Nao criar campo novo de INTENCAO. `avaliacao` e `fase = arquivado` ja respondem isso; um terceiro e armadilha 1 contra os dois e armadilha 2 (nenhuma tela provaria que alguem age sobre ele). E os 2.604 valores existentes nao sao intencoes — o vocabulario e copia do estado da Meta, entao relabela-los seria mentir sobre 2.604 linhas.
- Nao gravar o estado derivado de volta em `producoes` por gatilho. O fato muda na Meta, nao na linha: o gatilho teria de se pendurar no `meta-insights-sync`, e entre dois syncs a coluna estaria errada com cara de certa. Uma view nao envelhece.
- Nao apagar os 2.604 valores. Para 2.134 deles nao existe segunda fonte no sistema inteiro — nao ha como derivar depois, nem conferir contra nada.
- Nao editar as quatro migracoes antigas que declaram a assinatura de `fn_criativos_meta`. A nova supera; reescrever historico de migracao e o jeito de o banco de producao e o das migracoes discordarem.
- Nao transformar o filtro de status em filtro de cliente. Sobre busca paginada ele some card em silencio.
- Nao usar `effective_status` direto em nenhum lugar novo, no SQL ou no TypeScript. A ordem (intencao antes do impedimento) ja foi decidida na 20260829b e mora em `vw_meta_status`.
- Nao manter a coluna de contradicao (o ⚠ e o botao "so contradicao") "por enquanto". Ela mede uma divergencia que a migracao torna impossivel; sobreviver a propria causa e como lista fixa envelhece.
- Nao deixar o sócio gerenciar as opcoes desse campo pelo `GerenciarOpcoesPopover`. O vocabulario e da Meta; opcao editavel aqui e a porta de volta para o campo digitado.

### Primeiro passo
Reescrever `vw_producao_estado_ads` em cima de `vw_meta_status` (mesmo vocabulário de 8 valores + `sem_anuncio`, precedência lida de `meta_situacao`, mais `inv_7d`) e apontar a coluna `estado_ads` que a `AvaliacaoView.tsx` já consome (linha 436) para o novo vocabulário, exibindo-a por `situacaoDe()` de `src/features/ads/situacao.ts`.

Isso não apaga nada, não renomeia nada, não muda nenhum caminho de escrita e é reversível com um `create or replace`. E entrega valor no dia em que sobe: hoje o contador "⚠ contradição" da aba Avaliação compara a marcação dela contra uma regra que o próprio projeto rejeitou por escrito na 20260829b — ele conta errado os anúncios desligados de propósito que estão `WITH_ISSUES`, e esconde os 28 `barrado_pelo_pai` (R$ 2.347,21 em 30 dias) dentro de "parado". Depois desse passo o número passa a ser verdadeiro.

De quebra, ele produz exatamente a prova que o passo do rename precisa: com as duas colunas convivendo por alguns dias, dá para gerar o cruzamento dos 470 cards com anúncio e verificar que os incompatíveis são 26 e são nomeáveis um a um — antes de congelar qualquer coisa.

### Furos que os céticos abriram (3)
- **[confiança alta]** A precedência `min(s.ordem_acao)` do Passo 0 inverte a única regra que faz o selo valer dinheiro, e o Passo 0 é justamente o "primeiro passo seguro".

`ORDEM_SITUACAO` (src/features/ads/situacao.ts) está documentado no próprio arquivo como "A ORDEM DESTE MAPA É A ORDEM DA TELA" — ordem de exibição em /meta-ads, onde cada LINHA É UM ANÚNCIO. O desenho afirma que ela "já define" a precedência de resumo de um card com vários anúncios. Não define: nela `barrado_pelo_pai` (4) e `bloqueado` (1) vêm ANTES de `rodando` (6), enquanto a 20260905b escolheu por escrito o contrário (`WHEN c.ativos > 0 THEN 'ativo'` primeiro, "pelo menos um anúncio entregando").

Medido agora, com a regra proposta aplicada sobre `producao_ads` × `vw_meta_status`:
- 8 dos 92 cards que têm anúncio entregando deixam de ler "no ar" e passam a ler "Pai pausado", inclusive os dois maiores gastadores: AD 042 H05 V01 (anúncio `rodando` com R$ 831,20 em 7 dias) e AD 015 H06 V04.
- 4 desses 8 são exatamente a classe cara que a 20260905b diz ser a razão da coluna existir ("marcado Encerrado, dinheiro saindo"): AD 038 H03 V01 RMKT (Encerrado, anúncio `rodando` gastando R$ 69,82 / card R$ 230,53 em 7d), AD 033 H01 V01 (Encerrado, R$ 45,98), AD 016 H01 V02 (Pausado, R$ 24,37), AD 006 H01 V04 (Encerrado, R$ 18,60). Com o card lido como `barrado_pelo_pai`, `contradiz()` (AvaliacaoView.tsx:253-259, `'Encerrado' → estado === 'ativo'`) devolve false e esses 4 SOMEM do ⚠ e do filtro "só contradição".
- E some em silêncio: o contador total continua 28 antes e depois, porque entram no lugar casos baratos de "marcado Rodando × barrado_pelo_pai". O desenho promete que "depois desse passo o número passa a ser verdadeiro"; na prática o número fica igual e troca a metade cara por metade barata — o pior formato possível pela regra de leitura do CLAUDE.md, porque não há número estranho para desconfiar.

Dois fatos de viabilidade que agravam (medidos em 8.232 anúncios): `vw_meta_status.situacao` só assume QUATRO valores hoje — barrado_pelo_pai 4.857, parado 2.725, bloqueado 550, rodando 100. `ativo_nunca_entregou`, `ativo_sem_entregar`, `em_analise` e `sem_dado` têm ZERO linhas. Ou seja: (a) o alerta do Passo 4, construído inteiramente sobre `ativo_nunca_entregou`/`ativo_sem_entregar`, não tem um único caso para disparar nem para testar; (b) a separação que o Passo 0 promete entre `sem_dado` ("a API parou de confirmar") e `sem_anuncio` ("nunca teve vínculo") não existe do jeito que ele descreve — o sync reescreve `visto_em` de todos os objetos, então `sem_dado` nunca ocorre; o que ocorre de verdade são 58 vínculos (43 cards) cujo `ad_id` sumiu de `meta_objetos`, que pelo LEFT JOIN caem em `count(v.objeto_id)=0` e a regra proposta rotula `sem_anuncio` — exatamente a mistura que ela diz vir consertar.

De quebra, a prova da migração aborta sozinha: `count(*) filter (where status_veiculacao is not null) <> 2604` conta sobre `producoes` inteira, que hoje dá 2.649 (2.604 é só `tipo='criativo'`; há 44 `vsl` e 1 `aula` com o campo preenchido).
  - *Conserto:* Não jogue o Passo 0 fora — ele está certo em tirar a regra própria da `vw_producao_estado_ads`. Três ajustes:

1. `meta_situacao.ordem_acao` tem de ser escrita como precedência DE RESUMO, não como ordem de tela. Entrega vence: `rodando` = 1, e só depois `bloqueado`, `ativo_nunca_entregou`, `ativo_sem_entregar`, `barrado_pelo_pai`, `em_analise`, `parado`, `sem_dado`, `sem_anuncio`. É a regra da 20260905b preservada, agora numa tabela. Se quiser manter a ordem-por-ação de /meta-ads, então são duas ordens com propósitos diferentes e a tabela precisa de duas colunas (`ordem_tela`, `ordem_resumo`) — o que não é armadilha 1, porque respondem perguntas diferentes e ambas saem do mesmo lugar. E mantenha o que o desenho já previu (`ads_rodando`, `ads_bloqueados`, `ads_ligados`) para o selo dizer "rodando · 1 de 5, 2 barrados": nenhum anúncio some dentro do resumo.

2. `contradiz()` (AvaliacaoView.tsx:253) e `ESTADO_ADS` (linha 232) mudam NA MESMA subida do Passo 0, não no Passo 2 — hoje eles leem 'ativo'/'pausado'/'sem_anuncio', que deixam de existir. Antes de subir, rode o cruzamento dos 28 casos de contradição hoje × depois e confira nome por nome que os 4 caros (AD 038, AD 033, AD 016, AD 006) continuam na lista. Contador que não muda de tamanho é o que esconde a regressão.

3. Corrija a prova da migração: filtre `tipo='criativo'` e use `>= 2604` (ou registre o valor lido em vez de exigir igualdade) — o campo continua gravável pelas três telas até a própria migração, então igualdade exata está garantida a falhar.

E rebaixe o Passo 4: com zero linhas em `ativo_*_entregar`, o alerta não é entrega verificável. O alerta que TEM dados hoje é outro — card com anúncio entregando e marcação/avaliação que diz o contrário, ou card `barrado_pelo_pai` com verba (109 anúncios, 95 cards). Sobre a distinção `sem_dado` × `sem_anuncio`: o caso real é vínculo órfão (58 vínculos, 43 cards), então derive-o de `producao_ads` sem par em `meta_objetos` e dê nome próprio a ele, em vez de depender de um `visto_em` velho que o sync nunca deixa acontecer.
- **[confiança alta]** A precedência do resumo por card está errada, e isso é ARMADILHA 2 (criar sem medir) montada em cima de ARMADILHA 3 (lista fixa que envelhece).

**A precedência inverte o caso que originou o pedido — medido agora no banco (projeto prtkfwwqpcziexgipoqk):**
O desenho manda `vw_producao_estado_ads` devolver a chave de `min(s.ordem_acao)`, com a ordem copiada de `ORDEM_SITUACAO`: bloqueado 1 … barrado_pelo_pai 4 … rodando 6. Rodei exatamente essa regra contra `producao_ads` + `vw_meta_status`:

- cards com anúncio ligado: 486 → 307 `parado`, 95 `barrado_pelo_pai`, 84 `rodando`.
- **8 desses 95 têm anúncio RODANDO agora** e mesmo assim sairiam rotulados "Pai pausado". Eles gastaram **R$ 2.021,60 nos últimos 7 dias**.
- hoje a view antiga mostra esses 8 como `ativo` ("no ar"): 92 cards `ativo` = 84 + 8.

Ou seja: o selo passaria a dizer "Pai pausado" ao lado do `inv_7d` do passo 3 dizendo R$ 2.021,60 — a linha se contradiz sozinha, e é o mesmíssimo defeito que o desenho existe para matar ("dinheiro saindo em card que ninguém olha"). A 20260905b pôs `ativo` no TOPO da precedência de propósito; o desenho reverte essa decisão sem citá-la.

E o pior é o filtro: como `.in('situacao', ['rodando'])` roda no SERVIDOR sobre `vw_producao_criativo`, filtrar por "rodando" devolveria 84 dos 92 cards que rodam, **sem nada na tela denunciando os 8 que faltam** — exatamente o sumiço silencioso que o próprio autor listou como risco.

Causa: `ORDEM_SITUACAO` está documentado em `src/features/ads/situacao.ts:56-64` como "a ordem da TELA... por quanto pede ação" — ordenação de uma LISTA de anúncios, cada um com uma situação. Promovê-lo a `meta_situacao.ordem_acao` e usar `min()` responde "o que pede mais ação" quando a pergunta do card é "o que é verdade sobre ele agora". `ads_rodando` exposto ao lado não salva: quem filtra é a coluna colapsada.

**Armadilha 3, no mesmo objeto:** `meta_situacao` é apresentada como o fim da lista fixa, mas é uma lista fixa digitada à mão. O desenho enumera nove linhas e afirma "MESMO vocabulário de 8 valores"; `vw_meta_status` (20260829b, `else 'desconhecido'`) tem NOVE, e `desconhecido` existe justamente como escotilha anti-armadilha-3 ("Valor que a Meta inventou depois... Terceira armadilha do CLAUDE.md"). Sem linha em `meta_situacao`, esse anúncio entra no `LEFT JOIN` com `ordem_acao` NULL, `min()` ignora NULL, e o card cujos anúncios são todos `desconhecido` não cai no ramo `count(v.objeto_id)=0` → `situacao` NULL → selo em branco e card fora de todo `.in()`. Hoje são 0 anúncios nesse estado (conferido), então o defeito nasce mudo e só aparece no dia em que a Meta inventar um `effective_status` — que é a definição da armadilha. E o vocabulário passa a viver em DOIS lugares (o CASE da view e as linhas da tabela) sem nada que force a sincronia, contra a regra do CLAUDE.md: "se a lista precisa existir no código, ela precisa de um teste que falhe quando o banco ganhar um item novo".

**Bônus verificável hoje:** o desenho diz que `situacao.ts` vira o mapa único de rótulo, mas `SITUACAO` não tem `sem_anuncio`. Com 486 de 3.753 cards ligados a anúncio, ~3.267 cards renderizariam pelo fallback de `situacao.ts:74-80`: a chave crua "sem_anuncio" em cinza, com o tooltip "Situação que o painel ainda não conhece."
  - *Conserto:* Nada do plano precisa ser jogado fora — o passo 0 continua certo, o que muda é a regra do resumo e o modo de encher a tabela.

1. **Separar as duas perguntas em `meta_situacao`**: `ordem_acao` (a da tela do Meta Ads, como está) e `ordem_card` (a do resumo). Em `ordem_card`, `rodando` vem primeiro — a decisão escrita da 20260905b ("pelo menos um anúncio entregando") —, depois `ativo_nunca_entregou`, `ativo_sem_entregar`, `bloqueado`, `em_analise`, `barrado_pelo_pai`, `parado`, `sem_dado`, `sem_anuncio`. Duas colunas na mesma linha não são armadilha 1: são duas perguntas diferentes saindo de uma fonte só, e é exatamente o que o `min()` estava confundindo. Prova de aceite da migração: `select count(*) from vw_producao_estado_ads where situacao <> 'rodando' and ads_rodando > 0` tem de dar 0, e os 92 cards `ativo` de hoje têm de virar 92 `rodando`.

2. **Filtro por contagem, não por rótulo colapsado.** Acrescentar `situacoes text[]` (array_agg distinct) em `vw_producao_criativo` e trocar `.in('situacao', ...)` por `.overlaps('situacoes', ...)` (`.ov()` no supabase-js) nas três telas. Assim o card aparece em toda situação que ele de fato tem, o servidor continua fazendo o corte sobre a busca paginada, e nenhum card some por causa de uma precedência.

3. **A tabela para de ser digitada.** Encher `meta_situacao` incluindo `desconhecido` e `sem_anuncio`, e blindar dos dois lados: na view, `coalesce` para nunca devolver `situacao` NULL quando há anúncio ligado (situação desconhecida aparece crua, como `situacaoDe()` já faz), e um teste no padrão de `src/test/configuracoes-por-empresa.test.ts` que lê `pg_get_viewdef('vw_meta_status')`, extrai os literais do CASE e falha se algum não tiver linha em `meta_situacao`. É o "teste que falha quando o banco ganha item novo" que o CLAUDE.md exige.

4. **Um verso em `src/features/ads/situacao.ts`**: entradas para `sem_anuncio` ("Sem anúncio" / "Nenhum anúncio ligado a este card, ou o anúncio sumiu da API", cinza) e `desconhecido`. Sem isso o estado da maioria dos cards estreia como chave crua na tela.

5. No passo 4, o alerta deve ler o NÍVEL ANÚNCIO (`vw_meta_status` filtrado por `producao_ads`), não a `situacao` resumida do card — senão um anúncio `ativo_sem_entregar` com verba desaparece dentro do resumo de um card que tem outro anúncio em estado mais "urgente".
- **[confiança alta]** O desenho apaga a ÚNICA fonte de tabela do vocabulário (`delete from criativo_campos_opcoes where campo = 'status_veiculacao'`) e nunca diz de onde passam a sair as OPÇÕES do filtro "Status" — e os três consumidores dessa lista têm comportamentos diferentes e silenciosos quando ela some.

1. `AvaliacaoView.tsx:282` — `useState<string[]>(['Rodando','Pausado','Encerrado','Bloqueado','Arquivado'])`, e a linha 369 só sobrescreve `if (opS?.length)`. Com as linhas apagadas, `opS` vem vazio e o fallback CRAVADO NO CÓDIGO vira a fonte ativa. O MultiFilter da linha 592 continua oferecendo os cinco rótulos antigos, enquanto a consulta (linha 408, que o desenho manda manter no servidor, agora como `.in('situacao', filtroStatus)`) passa a comparar com o vocabulário novo (`rodando|parado|bloqueado|…`). Marcar "Rodando" devolve ZERO linhas e a tela mostra "Nenhum criativo encontrado." (linha ~721) — o estado vazio obrigatório do projeto, funcionando perfeitamente e mentindo. Nada na tela denuncia; o total de pills some junto e parece resposta legítima.

2. `CalendarioView.tsx:392` e `PorProjetoView.tsx:42` inicializam `opStatus` como `[]` e renderizam o filtro sob `opStatus.length > 0` (linhas 1165 e 190). Nesses dois o filtro "Status" simplesmente DESAPARECE da barra, sem aviso. E `PorProjetoView` é a aba "Por Projeto" da MESMA página `/criativos` (`CriativosPage.tsx:9,37`): na aba Avaliação o filtro fica quebrado devolvendo zero, na aba ao lado ele some — duas respostas diferentes para o mesmo campo, na mesma tela, no mesmo deploy.

O agravante é que o desenho justifica esse `delete` citando a armadilha 3 ("vocabulário órfão é convite para a próxima tela") — mas a armadilha 3 de verdade já está no TypeScript (`AvaliacaoView.tsx:282`, `CriativoDrawer.tsx:76`, `CriativoFormModal.tsx:70`), e o `delete` é exatamente o que a promove de fallback a fonte única. O passo 2 remove os selects do Drawer e do FormModal, mas não toca no array da linha 282, que é o que alimenta o FILTRO.

Efeito no meu recorte: um filtro que devolve zero sem dizer por quê é a forma mais rápida de a pessoa aprender a ignorar a tela — e é pior que ruído, porque o vazio aqui tem cara de verdade ("não há criativo rodando neste período").
  - *Conserto:* Não joga o desenho fora; falta um parágrafo no passo 1/2.

1. As opções do filtro passam a sair de `meta_situacao` — a tabela que a própria migração já cria. Uma consulta (`select chave from meta_situacao order by ordem_acao`), rótulo por `situacaoDe()` de `src/features/ads/situacao.ts`, que já trata valor desconhecido sem virar linha em branco. Assim o vocabulário continua derivado de tabela, na ordem por ação que a tela já usa.
2. Os arrays cravados (`AvaliacaoView.tsx:282`, `CriativoDrawer.tsx:76`, `CriativoFormModal.tsx:70`) saem NA MESMA migração/PR do `delete`. Enquanto existirem, eles são o que a tela vai mostrar. Sem fallback: lista vazia = filtro não renderiza, como `CalendarioView`/`PorProjetoView` já fazem — e um teste que falhe se `meta_situacao` ganhar chave sem rótulo em `SITUACAO`.
3. `CalendarioView.tsx:1165` e `PorProjetoView.tsx:190` apontam para a mesma fonte, para as três telas concordarem; `PorProjetoView` precisa também SELECIONAR `situacao` (hoje filtra por campo que nunca mostra — o desenho já viu isso, mas o conserto tem de vir junto do filtro, não depois).

Três coisas menores, da mesma lente, que cabem no mesmo passo:

- **Dois tempos sem aviso.** `preset` nasce `'this'` (AvaliacaoView.tsx:~407) e `baseCriativos` corta por `data_ref` (data de postagem). O alerta do passo 4 e o `inv_7d` do passo 3 são de AGORA/7 dias. Card postado em junho gastando hoje entra no alerta e não aparece na lista ao chegar. Este arquivo já pagou esse preço — o comentário acima de `baseCriativos` conta o botão que dizia "(60)" e não mostrava nada. Ou o alerta leva o período junto (link com `preset=custom` abrangendo o gasto), ou a coluna diz a janela ("R$ X · 7d") e o banner avisa que conta fora do período da tela.
- **O alerta não tem botão nem dono.** `IngestStatusBanner.tsx` renderiza só texto e só para `perfil?.is_admin === true`, enquanto `/criativos` é `<ProtectedRoute>` sem `pageKey` — quem trabalha a aba Avaliação pode não ver o aviso. Se o alerta é para ela, ou o banner ganha ação (levar ao filtro `situacao in (ativo_sem_entregar, ativo_nunca_entregou)` com período aberto) ou vira pill contador na própria toolbar, no lugar do "⚠ Só contraditórios".
- **`contradiz()` zera em silêncio no passo 1.** Ela mapeia só `'ativo' | 'pausado' | 'sem_anuncio'` (AvaliacaoView.tsx:~253). Com a view devolvendo o vocabulário de 9 valores, só o par `Rodando × sem_anuncio` sobrevive: o contador cai de 53 para quase zero e os 24 "Encerrado" gastando R$ 5.691,62 deixam de ter ⚠ — sem crash, porque a linha 811 guarda com `ESTADO_ADS[c.estado_ads] &&`, o que faz a linha do fato sumir calada. O passo 1 promete que "o número passa a ser verdadeiro"; como está escrito, ele passa a ser 0, e 0 se lê como boa notícia. Reescrever `contradiz()` para o novo vocabulário no MESMO passo (Encerrado × rodando/ativo_sem_entregar/barrado_pelo_pai etc.), ou dizer explicitamente que o contador morre ali e o que ocupa o lugar dele.

---
