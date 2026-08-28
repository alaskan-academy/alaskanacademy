import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KPICard } from "@/components/KPICard";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatters";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeradorUtmTab } from "../components/GeradorUtmTab";
import { cn } from "@/lib/utils";
import { aoClicarSemArrastar } from "@/lib/clique";
import type { LinhaNivelUtm, LinhaUtmAgregada, TuplaUtm } from "@/features/ads/utm";

const LEVELS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_placement"] as const;
type UTMLevel = (typeof LEVELS)[number];

const LEVEL_LABELS: Record<string, string> = {
  utm_source: "Source",
  utm_medium: "Medium",
  utm_campaign: "Campaign",
  utm_content: "Content",
  utm_placement: "Placement",
};

// Placement: rede social explícita
const placementInfo: Record<string, { label: string; network: string; color: string }> = {
  feed: { label: "Feed", network: "Facebook", color: "hsl(214,89%,52%)" },
  stories: { label: "Stories", network: "Instagram", color: "hsl(329,86%,56%)" },
  reels: { label: "Reels", network: "Instagram", color: "hsl(329,86%,50%)" },
  marketplace: { label: "Marketplace", network: "Facebook", color: "hsl(214,89%,45%)" },
  search: { label: "Search", network: "Facebook", color: "hsl(214,89%,38%)" },
  audience_network: { label: "Audience Network", network: "Meta", color: "hsl(239,84%,60%)" },
  messenger: { label: "Messenger", network: "Facebook", color: "hsl(214,89%,60%)" },
  outro: { label: "Outro", network: "Meta", color: "hsl(0,0%,50%)" },
  /*
    "Sem placement" nao e "outro".

    Sao 804 vendas e R$ 72.606,20 em agosto que nao trouxeram `utm_term`
    nenhum, contra 51 vendas e R$ 5.222,01 que trouxeram e nao se encaixaram em
    nenhuma categoria. Juntar os dois dava um "Outro" de 46,7%, que se le como
    "a Meta entregou num lugar estranho" quando quase tudo e "nao temos o dado".
  */
  sem_placement: { label: "Sem placement", network: "Sem dado", color: "hsl(0,0%,32%)" },
};

/*
  `sourceColors` saiu junto com a aba "Por Source", que era o único lugar que
  o usava. Ele também já carregava uma entrada morta: `organico`, que a
  limpeza nunca produzia porque valor vazio vira "(vazio)", não "organico".
*/

const normalizeText = (value: string | null | undefined) => String(value ?? "").replace(/\s+/g, " ").trim();

/*
  `cleanPlacementValue` foi embora.

  Ela refazia em JavaScript a MESMA escada de regras que o gatilho
  `fn_campos_data` já roda no banco para preencher `vendas.utm_placement`
  (enum): reels, stories, feed, marketplace, search, audience_network, senão
  `outro`. Duas cópias de uma regra só — e elas já divergiam na cauda, porque
  só a do banco tem o `outro`:

    utm_term                   banco    esta tela
    Whatsapp_Status            outro    whatsapp_status
    Facebook_Instream_Video    outro    facebook_instream_video
    an                         outro    an

  Ou seja: a aba de placement inventava categorias que o detalhe da venda, que
  lê a coluna, não reconhecia. Agora `fn_utm_agregado` devolve o placement já
  classificado e existe uma regra só.
*/

const cleanUtmValue = (value: string | null | undefined, level: UTMLevel) => {
  const raw = normalizeText(value);
  if (!raw) return "(vazio)";

  const base = raw.split("::")[0].split("|")[0].trim();
  const lower = base.toLowerCase();

  if (level === "utm_source") {
    // `*` e não `+`: a fonte chegava como "FBjLj6a8ee83..." — o prefixo colado
    // num id de sessão da Payt —, e o `+` existia para engolir o id. Agora o
    // banco limpa na porta e o valor gravado é "FB" puro, com duas letras, que
    // o `+` deixaria passar direto para o rótulo cru.
    if (lower.includes("instagram") || /^ig[a-z0-9]*$/i.test(base)) return "instagram";
    if (lower.includes("facebook") || /^fb[a-z0-9]*$/i.test(base)) return "meta ads";
    if (lower.includes("google") || /^g[a-z0-9]{6,}$/i.test(base)) return "google";
    if (lower.includes("organ")) return "organico";
    return base;
  }

  // `utm_placement` não passa por aqui: ele chega classificado do banco.
  return base;
};

/*
  "(vazio)" é o maior item da tela e merecia um nome.

  Em agosto ele é a segunda maior "origem": 675 vendas e 36,5% do faturamento
  sem nenhum UTM. Escrito como "(vazio)" ele se lê como falha de formatação e
  passa batido; escrito como "Sem origem" ele se lê como o que é — a maior
  fatia do faturamento que ninguém sabe de onde veio.
*/
const SEM_ORIGEM = "(vazio)";

const displayUtmValue = (value: string, level: UTMLevel) => {
  if (value === SEM_ORIGEM) return "Sem origem";
  if (level === "utm_placement") return placementInfo[value]?.label || value.replace(/_/g, " ");
  return value.replace(/_/g, " ");
};

export default function UTMPage() {
  const { startDateStr, endDateStr, startISO, endISO, contaIds } = useFilters();
  const [levelIndex, setLevelIndex] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [utmData, setUtmData] = useState<LinhaNivelUtm[]>([]);
  const [allUtm, setAllUtm] = useState<TuplaUtm[]>([]);
  const [loading, setLoading] = useState(true);

  const currentLevel = LEVELS[levelIndex];

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      /*
        A soma vem do banco; a limpeza de source/medium/campaign/content
        continua aqui.

        A tela pedia as linhas cruas de `vendas` e agrupava no JavaScript.
        Agosto tem 2.462 vendas no recorte dela e o PostgREST corta em 1.000
        sem avisar — então a análise que existe para dizer de ONDE vem a venda
        respondia sobre 40% delas, sem sinal de erro.

        `fn_utm_agregado` para nas tuplas CRUAS de UTM: 2.462 vendas viram 409
        linhas. A limpeza fica onde sempre esteve, com as regras que ela tem —
        "FBjLj6a8…" vira "meta ads". Reescrever isso em SQL seria duas versões
        da mesma regra esperando divergir.

        Funciona porque limpar é função pura do valor cru: duas tuplas que
        limpam para a mesma chave são somadas aqui embaixo, e soma de soma dá a
        mesma soma.

        A exceção é `utm_placement`, que vem PRONTO do banco — ali a segunda
        versão da regra já existia, e já divergia.
      */
      const { data: agregado, error } = await supabase.rpc("fn_utm_agregado", {
        p_inicio: startISO || null,
        p_fim: endISO || null,
        p_contas: contaIds,
      });
      if (error) console.error("fn_utm_agregado:", error.message);

      /*
        As tuplas cruas viram tuplas limpas, somando as que colapsam.

        Nenhuma razão é calculada aqui: taxa e ticket só existem depois do
        agrupamento, sobre os TOTAIS do grupo. Guardar a taxa por tupla foi o
        que produziu a média de médias que esta revisão desfez.
      */
      const utmMap: Record<string, TuplaUtm> = {};
      ((agregado as LinhaUtmAgregada[]) ?? []).forEach((v) => {
        const utmSource = cleanUtmValue(v.utm_source, "utm_source");
        const utmMedium = cleanUtmValue(v.utm_medium, "utm_medium");
        const utmCampaign = cleanUtmValue(v.utm_campaign, "utm_campaign");
        const utmContent = cleanUtmValue(v.utm_content, "utm_content");
        // Vem pronto do banco: uma regra só para classificar placement. E
        // nulo vira `sem_placement`, que é resposta diferente de "outro".
        const utmPlacement = v.utm_placement || "sem_placement";

        const key = [utmSource, utmMedium, utmCampaign, utmContent, utmPlacement].join("|||");
        if (!utmMap[key]) {
          utmMap[key] = {
            utm_source: utmSource,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            utm_content: utmContent,
            utm_placement: utmPlacement,
            produto: v.produto,
            vendas_aprovadas: 0,
            vendas_pendentes: 0,
            vendas_canceladas: 0,
            faturamento: 0,
            vendas_com_anuncio: 0,
            faturamento_com_anuncio: 0,
          };
        }
        utmMap[key].vendas_aprovadas += Number(v.vendas_aprovadas || 0);
        utmMap[key].vendas_pendentes += Number(v.vendas_pendentes || 0);
        utmMap[key].vendas_canceladas += Number(v.vendas_canceladas || 0);
        utmMap[key].faturamento += Number(v.faturamento || 0);
        utmMap[key].vendas_com_anuncio += Number(v.vendas_com_anuncio || 0);
        utmMap[key].faturamento_com_anuncio += Number(v.faturamento_com_anuncio || 0);
      });

      setAllUtm(Object.values(utmMap));
      setLoading(false);
    };
    load();
  }, [contaIds, startDateStr, endDateStr, startISO, endISO]);

  useEffect(() => {
    let rows = allUtm;

    Object.entries(filters).forEach(([key, value]) => {
      rows = rows.filter((r) => (String(r[key as keyof TuplaUtm] ?? "") || SEM_ORIGEM) === value);
    });

    /*
      Taxa e ticket saem dos TOTAIS do grupo, e não da média das tuplas.

      A tela fazia média de médias: guardava a taxa de cada tupla e tirava a
      média aritmética delas dentro do grupo. Uma tupla com 2 vendas pesava o
      mesmo que uma com 300, e a distorção não era pequena — medida em agosto
      de 2026, por source:

        Sem origem   81,9% na tela   contra   71,4% real   (10,5 pontos)
        instagram    77,8%           contra   64,6%        (13,2 pontos)
        whatsapp     68,4%           contra   78,1%        (−9,8 pontos)

      Errava para os dois lados, que é o pior caso: não dá para corrigir "de
      cabeça" quem já se acostumou com o número. Agora somam-se aprovadas e
      tentativas, e a divisão é feita uma vez no fim.
    */
    const grouped: Record<string, { aprovadas: number; tentativas: number; faturamento: number }> = {};
    rows.forEach((r) => {
      const key = String(r[currentLevel as keyof TuplaUtm] ?? "") || SEM_ORIGEM;
      if (!grouped[key]) grouped[key] = { aprovadas: 0, tentativas: 0, faturamento: 0 };
      grouped[key].aprovadas += r.vendas_aprovadas;
      grouped[key].tentativas += r.vendas_aprovadas + r.vendas_pendentes + r.vendas_canceladas;
      grouped[key].faturamento += r.faturamento;
    });

    setUtmData(
      Object.entries(grouped)
        .map(([name, v]): LinhaNivelUtm => ({
          name,
          displayName: displayUtmValue(name, currentLevel),
          vendas_aprovadas: v.aprovadas,
          tentativas: v.tentativas,
          faturamento: v.faturamento,
          taxa_aprovacao_pct: v.tentativas > 0 ? (v.aprovadas / v.tentativas) * 100 : 0,
          ticket_medio: v.aprovadas > 0 ? v.faturamento / v.aprovadas : 0,
        }))
        .sort((a, b) => b.faturamento - a.faturamento),
    );
  }, [allUtm, levelIndex, filters, currentLevel]);

  // Os totais do nível aberto. A taxa é a razão das somas, pelo mesmo motivo.
  const totals = utmData.reduce(
    (acc, r) => ({
      vendas: acc.vendas + r.vendas_aprovadas,
      tentativas: acc.tentativas + r.tentativas,
      faturamento: acc.faturamento + r.faturamento,
    }),
    { vendas: 0, tentativas: 0, faturamento: 0 },
  );
  const taxaTotal = totals.tentativas > 0 ? (totals.vendas / totals.tentativas) * 100 : 0;
  const avgTicket = totals.vendas > 0 ? totals.faturamento / totals.vendas : 0;

  /*
    Quanto do faturamento chega sem dizer de onde veio.

    É a pergunta que esta tela existe para responder, e ela estava diluída numa
    linha chamada "(vazio)" no meio da tabela. Em agosto são 36,5% — mais de um
    terço do faturamento sem origem nenhuma. Fica no topo, e sempre sobre o
    período inteiro: filtrar por uma origem não muda quanto do total é cego.
  */
  const semOrigem = allUtm.reduce(
    (acc, r) => ({
      faturamento: acc.faturamento + (r.utm_source === SEM_ORIGEM ? r.faturamento : 0),
      total: acc.total + r.faturamento,
      vendas: acc.vendas + (r.utm_source === SEM_ORIGEM ? r.vendas_aprovadas : 0),
      comAnuncio: acc.comAnuncio + r.faturamento_com_anuncio,
      vendasComAnuncio: acc.vendasComAnuncio + r.vendas_com_anuncio,
      vendasTotal: acc.vendasTotal + r.vendas_aprovadas,
    }),
    { faturamento: 0, total: 0, vendas: 0, comAnuncio: 0, vendasComAnuncio: 0, vendasTotal: 0 },
  );
  const pctSemOrigem = semOrigem.total > 0 ? (semOrigem.faturamento / semOrigem.total) * 100 : 0;

  /*
    O segundo buraco, encaixado no primeiro: tem canal e não tem anúncio.

    "Sem origem" é o link que não leva UTM nenhuma. "Sem anúncio" é maior e
    inclui aquele: são as vendas sem `ad_id_meta`, ou seja, sem dizer QUAL
    anúncio pagou por elas. Agosto/2026:

      sem anúncio             R$ 73.958,87   819 vendas   44,4%
        ├─ sem origem         R$ 60.395,04   675
        └─ com canal, sem id  R$ 13.563,83   144

    São dois consertos diferentes — o primeiro no link, o segundo no parâmetro
    da campanha —, e por isso dois números em vez de um.
  */
  const semAnuncio = {
    faturamento: semOrigem.total - semOrigem.comAnuncio,
    vendas: semOrigem.vendasTotal - semOrigem.vendasComAnuncio,
  };
  const pctSemAnuncio = semOrigem.total > 0 ? (semAnuncio.faturamento / semOrigem.total) * 100 : 0;


  const drillDown = (value: string) => {
    if (levelIndex < LEVELS.length - 1) {
      setFilters((prev) => ({ ...prev, [currentLevel]: value }));
      setLevelIndex((prev) => prev + 1);
    }
  };

  const goBack = () => {
    if (levelIndex > 0) {
      const newFilters = { ...filters };
      delete newFilters[LEVELS[levelIndex - 1]];
      setFilters(newFilters);
      setLevelIndex((prev) => prev - 1);
    }
  };

  const resetAll = () => {
    setFilters({});
    setLevelIndex(0);
  };

  const breadcrumbs = LEVELS.slice(0, levelIndex).map((level) => ({
    label: LEVEL_LABELS[level],
    value: displayUtmValue(filters[level], level),
  }));

  /*
    A aba "Por Source" saiu.

    Ela era o nível 0 do drill-down mostrado de novo, com menos informação: as
    mesmas linhas por source, sem taxa de aprovação e sem ticket médio, e sem
    poder abrir. Duas telas para a mesma pergunta, e a pior delas era a que
    abria primeiro.

    "Por Placement" fica, e por um motivo concreto: no drill-down ele é o
    último nível, a quatro cliques de distância, então na prática ninguém
    chegava lá.
  */
  const placementData = (() => {
    const mapa: Record<string, { placement: string; vendas_aprovadas: number; faturamento: number }> = {};
    allUtm.forEach((r) => {
      const k = r.utm_placement || "sem_placement";
      if (!mapa[k]) mapa[k] = { placement: k, vendas_aprovadas: 0, faturamento: 0 };
      mapa[k].vendas_aprovadas += r.vendas_aprovadas;
      mapa[k].faturamento += r.faturamento;
    });
    return Object.values(mapa).sort((a, b) => b.faturamento - a.faturamento);
  })();
  const plTotal = placementData.reduce((s, r) => s + r.faturamento, 0);


  return (
    <DashboardLayout title="Análise UTM" hideTitle>
      <Tabs defaultValue="drilldown">
        <TabsList className="bg-secondary border border-border mb-4">
          <TabsTrigger
            value="drilldown"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            UTM Drill-down
          </TabsTrigger>
          <TabsTrigger
            value="placement"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Por Placement
          </TabsTrigger>
          <TabsTrigger
            value="gerador"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Gerador de links
          </TabsTrigger>
        </TabsList>

        {/* O gerador veio de Funis, onde estava por acidente de história: só 1
            dos 134 links é de funil — o resto é suporte, bio do Instagram, área
            de membros.

            Criar o link e MEDIR o link são a mesma conversa. Separados em duas
            áreas do dash, ninguém nunca soube qual link vendeu; por isso a lista
            aqui ganhou a coluna de vendas. */}
        <TabsContent value="gerador">
          <GeradorUtmTab />
        </TabsContent>

        {/* ── UTM Drill-down (código original preservado) ─── */}
        <TabsContent value="drilldown">
          {/* Breadcrumb */}
          {breadcrumbs.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <button onClick={resetAll} className="text-xs text-primary hover:underline">
                Início
              </button>
              {breadcrumbs.map((b, i) => (
                <span key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-foreground">{b.value}</span>
                </span>
              ))}
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs font-medium text-primary">{LEVEL_LABELS[currentLevel]}</span>
            </div>
          )}

          {/*
            Quatro números do nível aberto, e um do período inteiro.

            "Sem origem" não acompanha o filtro de propósito: ele responde
            "quanto do faturamento chega cego", e essa resposta não muda porque
            alguém entrou numa campanha. Ele é o estado do rastreio, não um
            recorte.
          */}
          {/*
            Seis números numa faixa só, 2 / 3 / 6 colunas — o mesmo bloco de
            Vendas. Cinco cartões soltos numa grade de três deixavam um cartão
            sozinho na última linha e um buraco do lado dele.

            Os quatro primeiros são do nível aberto; os dois últimos são do
            período inteiro e não acompanham o filtro, de propósito: eles
            respondem "quanto chega cego", e isso não muda porque alguém entrou
            numa campanha.
          */}
          <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
            <KPICard title="Total Vendas" value={formatNumber(totals.vendas)} className="rounded-none border-0" />
            <KPICard title="Faturamento" value={formatCurrency(totals.faturamento)} className="rounded-none border-0" />
            <KPICard title="Taxa Aprovação" value={formatPercent(taxaTotal)} className="rounded-none border-0" />
            <KPICard title="Ticket Médio" value={formatCurrency(avgTicket)} className="rounded-none border-0" />
            <KPICard
              title="Sem origem"
              value={formatPercent(pctSemOrigem)}
              subtitle={`${formatCurrency(semOrigem.faturamento)} · ${formatNumber(semOrigem.vendas)} vendas`}
              className="rounded-none border-0"
            />
            <KPICard
              title="Sem anúncio"
              value={formatPercent(pctSemAnuncio)}
              subtitle={`${formatCurrency(semAnuncio.faturamento)} · ${formatNumber(semAnuncio.vendas)} vendas`}
              className="rounded-none border-0"
            />
          </div>

          {/* Voltar */}
          {levelIndex > 0 && (
            <button onClick={goBack} className="flex items-center gap-1 text-xs text-primary hover:underline mb-4">
              <ArrowLeft className="h-3 w-3" /> Voltar para {LEVEL_LABELS[LEVELS[levelIndex - 1]]}
            </button>
          )}

          {/* Tabela */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        {LEVEL_LABELS[currentLevel]}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Vendas
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Faturamento
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        % Total
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Taxa Aprov.
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                        Ticket Médio
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {utmData.map((row, i) => (
                      <tr
                        key={i}
                        onClick={aoClicarSemArrastar(() => drillDown(row.name))}
                        className={cn(
                          "border-b border-border/50 hover:bg-secondary/50 transition-colors",
                          levelIndex < LEVELS.length - 1 && "cursor-pointer",
                        )}
                      >
                        {/* `displayName` e não `name`: é o rótulo tratado —
                            "Sem origem" no lugar de "(vazio)", "Stories" no
                            lugar de "stories". A tabela mostrava o valor cru e
                            só o breadcrumb mostrava o tratado. */}
                        <td className="px-4 py-3 font-medium text-primary">{row.displayName}</td>
                        <td className="px-4 py-3 text-foreground">{formatNumber(row.vendas_aprovadas)}</td>
                        <td className="px-4 py-3 text-foreground">{formatCurrency(row.faturamento)}</td>
                        <td className="px-4 py-3 text-foreground">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-secondary rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full bg-primary"
                                style={{
                                  width: `${totals.faturamento > 0 ? (row.faturamento / totals.faturamento) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <span>
                              {totals.faturamento > 0 ? ((row.faturamento / totals.faturamento) * 100).toFixed(1) : 0}%
                            </span>
                          </div>
                        </td>
                        <td
                          className="px-4 py-3 text-foreground"
                          title={`${formatNumber(row.vendas_aprovadas)} de ${formatNumber(row.tentativas)} tentativas`}
                        >
                          {formatPercent(row.taxa_aprovacao_pct)}
                        </td>
                        <td className="px-4 py-3 text-foreground">{formatCurrency(row.ticket_medio)}</td>
                      </tr>
                    ))}
                    {utmData.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          Nenhum dado encontrado
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>


        {/* ── Por Placement ────────────────────────────────── */}
        <TabsContent value="placement">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por Placement</h3>
            <div className="space-y-2">
              {placementData.map((r, i) => {
                const info = placementInfo[r.placement] || {
                  label: r.placement,
                  network: "Outro",
                  color: "hsl(0,0%,50%)",
                };
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: info.color }} />
                      <div>
                        <span className="text-sm font-medium text-foreground">{info.label}</span>
                        <span
                          className="ml-2 text-xs px-1.5 py-0.5 rounded text-white font-medium"
                          style={{ backgroundColor: info.color }}
                        >
                          {info.network}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-secondary rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${plTotal > 0 ? (r.faturamento / plTotal) * 100 : 0}%`,
                              backgroundColor: info.color,
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-10">
                          {plTotal > 0 ? ((r.faturamento / plTotal) * 100).toFixed(1) : 0}%
                        </span>
                      </div>
                      <span className="text-muted-foreground">{formatNumber(r.vendas_aprovadas)} vendas</span>
                      <span className="font-semibold text-foreground w-24 text-right">
                        {formatCurrency(r.faturamento)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {placementData.length === 0 && (
                <div className="text-center text-muted-foreground py-8">Sem dados de placement</div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
