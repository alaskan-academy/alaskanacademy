import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { differenceInDays, parseISO, subDays, format } from "date-fns";

// Limpa utm_campaign
function cleanUtm(s: string | null): string {
  if (!s) return "";
  return s.split("::")[0].split("|")[0].trim().toLowerCase();
}

function periodoAnterior(start?: string, end?: string) {
  if (!start || !end) return null;
  const dias = Math.max(1, differenceInDays(parseISO(end), parseISO(start)) + 1);
  return {
    start: format(subDays(parseISO(start), dias), "yyyy-MM-dd"),
    end: format(subDays(parseISO(start), 1), "yyyy-MM-dd"),
    dias,
  };
}

// Agrupa venda_itens em formato OB/upsell, filtrando por vendas específicas
function aggregateItems(items: any[], vendaIds?: Set<string>) {
  const filtered = vendaIds ? items.filter((i: any) => vendaIds.has(i.venda_id)) : items;
  const obMap = new Map<string, { nome_ob: string; total_convertidos: number; receita_total_ob: number; vendas_com_ob: Set<string> }>();
  const upMap = new Map<string, { nome_upsell: string; total_upsells: number; receita_total: number }>();

  for (const item of filtered) {
    const tipo = item.tipo || "";
    if (tipo.startsWith("orderbump")) {
      const existing = obMap.get(item.code_payt) || { nome_ob: item.nome, total_convertidos: 0, receita_total_ob: 0, vendas_com_ob: new Set<string>() };
      existing.total_convertidos += 1;
      existing.receita_total_ob += Number(item.valor || 0);
      existing.vendas_com_ob.add(item.venda_id);
      obMap.set(item.code_payt, existing);
    } else if (tipo.startsWith("upsell")) {
      const existing = upMap.get(item.code_payt) || { nome_upsell: item.nome, total_upsells: 0, receita_total: 0 };
      existing.total_upsells += 1;
      existing.receita_total += Number(item.valor || 0);
      upMap.set(item.code_payt, existing);
    }
  }

  const totalVendasComOb = new Set(filtered.filter((i: any) => (i.tipo || "").startsWith("orderbump")).map((i: any) => i.venda_id)).size;
  const obs = [...obMap.values()].map(o => ({
    ...o,
    vendas_com_ob: o.vendas_com_ob.size,
    taxa_conversao_pct: totalVendasComOb > 0 ? (o.vendas_com_ob.size / totalVendasComOb) * 100 : 0,
  }));
  const ups = [...upMap.values()].map(u => ({
    ...u,
    taxa_conversao_pct: 0,
  }));

  return { obs, ups };
}

// Calcula métricas do funil dado linhas de meta e vendas
function calcFunnel(metaRows: any[], vendas: any[], obsRows: any[], upsells: any[]) {
  const m = metaRows.reduce(
    (a: any, r: any) => {
      a.impressoes += Number(r.impressoes || 0);
      a.cliques += Number(r.cliques || 0);
      a.visualizacoes_pagina += Number(r.visualizacoes_pagina || 0);
      a.initiate_checkout += Number(r.initiate_checkout || 0);
      a.investimento += Number(r.investimento || 0);
      a.video_plays += Number(r.video_plays || 0);
      a.video_3s += Number(r.video_3s || 0);
      a.video_75pct += Number(r.video_75pct || 0);
      return a;
    },
    {
      impressoes: 0,
      cliques: 0,
      visualizacoes_pagina: 0,
      initiate_checkout: 0,
      investimento: 0,
      video_plays: 0,
      video_3s: 0,
      video_75pct: 0,
    },
  );

  const totalVendas = vendas.length;
  const fatReal = vendas.reduce((s: number, v: any) => s + Number(v.valor_total || 0), 0);
  const fatPrincipal = vendas.reduce((s: number, v: any) => s + Number(v.valor_oferta_principal || 0), 0);
  const inv = m.investimento;
  const vis = m.visualizacoes_pagina;
  const ic = m.initiate_checkout;
  const clk = m.cliques;

  return {
    ...m,
    totalVendas,
    fatReal,
    fatPrincipal,
    obsRows,
    upsells,
    resultado: fatReal - inv,
    roas: inv > 0 ? fatReal / inv : 0,
    cpa: totalVendas > 0 ? inv / totalVendas : 0,
    cpv: vis > 0 ? inv / vis : 0,
    aov: totalVendas > 0 ? fatReal / totalVendas : 0,
    taxa_vis_vendas: vis > 0 ? (totalVendas / vis) * 100 : 0,
    taxa_ic_vendas: ic > 0 ? (totalVendas / ic) * 100 : 0,
    taxa_carregamento: clk > 0 ? (vis / clk) * 100 : 0,
    taxa_vis_ic: vis > 0 ? (ic / vis) * 100 : 0,
  };
}

// Componente de exibição do funil
function FunnelDisplay({ data, title, compare }: { data: any; title?: string; compare?: any }) {
  if (!data) return <div className="text-center text-muted-foreground py-8">Sem dados</div>;

  const steps = [
    { label: "Impressões", value: data.impressoes, color: "hsl(239,84%,67%)" },
    { label: "Cliques", value: data.cliques, color: "hsl(239,84%,60%)" },
    { label: "Vis. de Pág.", value: data.visualizacoes_pagina, color: "hsl(239,84%,53%)" },
    { label: "ICs", value: data.initiate_checkout, color: "hsl(239,84%,46%)" },
    { label: "Vendas", value: data.totalVendas, color: "hsl(160,60%,45%)" },
  ];
  const maxV = Math.max(...steps.map((s) => s.value), 1);
  const totalBreakdown = data.fatReal || 1;

  const Var = ({ cur, prev }: { cur: number; prev?: number }) => {
    if (prev === undefined || !compare) return null;
    const v = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
    return (
      <span className={cn("text-xs ml-1", v >= 0 ? "text-green-400" : "text-red-400")}>
        {v >= 0 ? "▲" : "▼"}
        {Math.abs(v).toFixed(1)}%
      </span>
    );
  };

  const kpis = [
    { label: "Investimento", key: "investimento", fmt: formatCurrency, color: "" },
    { label: "Faturamento", key: "fatReal", fmt: formatCurrency, color: "" },
    {
      label: "Resultado",
      key: "resultado",
      fmt: formatCurrency,
      color: data.resultado >= 0 ? "text-green-400" : "text-red-400",
    },
    {
      label: "ROAS",
      key: "roas",
      fmt: (v: number) => `${v.toFixed(2)}x`,
      color: data.roas >= 3 ? "text-green-400" : data.roas >= 1 ? "text-yellow-400" : "text-red-400",
    },
    { label: "Vendas", key: "totalVendas", fmt: (v: number) => String(Math.round(v)), color: "" },
    { label: "CPA", key: "cpa", fmt: formatCurrency, color: "" },
    { label: "CPV", key: "cpv", fmt: formatCurrency, color: "" },
    { label: "AOV", key: "aov", fmt: formatCurrency, color: "" },
  ];

  const taxas = [
    { label: "Taxa Conexão", key: "taxa_carregamento" },
    { label: "Taxa IC", key: "taxa_vis_ic" },
    { label: "Conv. Checkout", key: "taxa_ic_vendas" },
    { label: "Vis→Vendas", key: "taxa_vis_vendas" },
  ];

  return (
    <div className="space-y-5">
      {title && <h3 className="text-sm font-semibold text-primary border-b border-border pb-2">{title}</h3>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">{k.label}</div>
            <div className={cn("text-base font-bold", k.color || "text-foreground")}>
              {k.fmt(Number(data[k.key] || 0))}
              <Var cur={Number(data[k.key] || 0)} prev={compare ? Number(compare[k.key] || 0) : undefined} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Funil visual */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h4 className="text-xs font-medium text-muted-foreground mb-4">Funil de Conversão</h4>
          <div className="space-y-2">
            {steps.map((step, i) => {
              const w = Math.max((step.value / maxV) * 100, 3);
              const prev = steps[i - 1];
              const taxa = prev?.value > 0 ? ((step.value / prev.value) * 100).toFixed(1) : null;
              return (
                <div key={step.label}>
                  {taxa && <div className="text-xs text-muted-foreground text-center mb-1">↓ {taxa}%</div>}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24 text-right shrink-0">{step.label}</span>
                    <div className="flex-1">
                      <div
                        className="h-8 rounded-md flex items-center px-2 transition-all"
                        style={{ width: `${w}%`, backgroundColor: step.color }}
                      >
                        <span className="text-xs font-semibold text-white">{formatNumber(step.value)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Breakdown */}
        <div className="bg-card border border-border rounded-lg p-5">
          <h4 className="text-xs font-medium text-muted-foreground mb-4">Breakdown de Vendas</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="font-medium text-foreground">Oferta principal</span>
              <div className="text-right">
                <div className="font-semibold text-foreground">{formatCurrency(data.fatPrincipal)}</div>
                <div className="text-xs text-muted-foreground">
                  {((data.fatPrincipal / totalBreakdown) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            {(data.obsRows || []).map((ob: any, i: number) => (
              <div key={i} className="flex justify-between py-1 border-b border-border/50">
                <div>
                  <span className="text-foreground">{ob.nome_ob}</span>
                  <span className="ml-1 text-xs px-1 rounded bg-primary/20 text-primary">
                    {ob.taxa_conversao_pct?.toFixed(1)}%
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-foreground">{formatCurrency(ob.receita_total_ob || 0)}</div>
                  <div className="text-xs text-muted-foreground">
                    {(((ob.receita_total_ob || 0) / totalBreakdown) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
            {(data.upsells || []).map((up: any, i: number) => (
              <div key={i} className="flex justify-between py-1 border-b border-border/50">
                <div>
                  <span className="text-foreground">{up.nome_upsell}</span>
                  <span className="ml-1 text-xs px-1 rounded bg-yellow-500/20 text-yellow-400">
                    {up.taxa_conversao_pct?.toFixed(1)}%
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-foreground">{formatCurrency(up.receita_total || 0)}</div>
                  <div className="text-xs text-muted-foreground">
                    {(((up.receita_total || 0) / totalBreakdown) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
            <div className="flex justify-between pt-1 font-semibold border-t border-border">
              <span className="text-foreground">Total</span>
              <span className="text-foreground">{formatCurrency(data.fatReal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Taxas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {taxas.map((k) => (
          <div key={k.label} className="bg-secondary/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">{k.label}</div>
            <div className="text-sm font-semibold text-foreground">
              {Number(data[k.key] || 0).toFixed(1)}%
              <Var cur={Number(data[k.key] || 0)} prev={compare ? Number(compare[k.key] || 0) : undefined} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FunnelPage() {
  const { startDateStr, endDateStr, product } = useFilters();
  const [allMeta, setAllMeta] = useState<any[]>([]);
  const [allMetaAnt, setAllMetaAnt] = useState<any[]>([]);
  const [allVendas, setAllVendas] = useState<any[]>([]);
  const [allVendasAnt, setAllVendasAnt] = useState<any[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [campanhas, setCampanhas] = useState<string[]>([]);
  const [selectedCamps, setSelectedCamps] = useState<string[]>([]);
  const [showPeriodoAnt, setShowPeriodoAnt] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const pf = product !== "todos" ? product : null;
      const ant = periodoAnterior(startDateStr, endDateStr);

      // Meta atual
      let qMeta = supabase
        .from("metricas_meta")
        .select(
          "campanha_nome,campanha_id,nivel,produto,data,impressoes,cliques,visualizacoes_pagina,initiate_checkout,investimento,video_plays,video_3s,video_75pct,compras_meta,faturamento_atribuido",
        )
        .eq("nivel", "campanha");
      if (startDateStr && endDateStr) qMeta = qMeta.gte("data", startDateStr).lte("data", endDateStr);
      if (pf) qMeta = qMeta.eq("produto", pf);

      // Vendas atuais
      let qV = supabase
        .from("vendas")
        .select("valor_total,valor_oferta_principal,utm_campaign,produto")
        .eq("status", "aprovada")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (startDateStr && endDateStr) qV = qV.gte("data_venda", startDateStr).lte("data_venda", `${endDateStr}T23:59:59`);
      if (pf) qV = qV.eq("produto", pf);

      // OBs e Upsells vinculados às vendas (com utm_campaign)
      let qItems = supabase
        .from("venda_itens")
        .select("code_payt,tipo,nome,valor,converteu,venda_id,vendas(utm_campaign,produto,status)")
        .eq("converteu", true);

      // Período anterior
      let qMetaAnt = supabase
        .from("metricas_meta")
        .select(
          "campanha_nome,impressoes,cliques,visualizacoes_pagina,initiate_checkout,investimento,video_plays,video_3s,video_75pct",
        )
        .eq("nivel", "campanha");
      let qVAnt = supabase
        .from("vendas")
        .select("valor_total,valor_oferta_principal,utm_campaign")
        .eq("status", "aprovada")
        .not("pedido_id", "like", "TEST%")
        .not("pedido_id", "like", "LC-%");
      if (ant) {
        qMetaAnt = qMetaAnt.gte("data", ant.start).lte("data", ant.end);
        qVAnt = qVAnt.gte("data_venda", ant.start).lte("data_venda", `${ant.end}T23:59:59`);
      }
      if (pf) {
        qMetaAnt = qMetaAnt.eq("produto", pf);
        qVAnt = qVAnt.eq("produto", pf);
      }

      const [rMeta, rV, rItems, rMetaAnt, rVAnt] = await Promise.all([qMeta, qV, qItems, qMetaAnt, qVAnt]);

      // Extrair venda_ids aprovados para filtrar itens
      const vendaIds = new Set((rV.data || []).map((_: any, i: number) => {
        // We don't have venda id here, we'll filter items by matching vendas join
        return true;
      }));

      // Processar itens: filtrar apenas os de vendas aprovadas e do produto correto
      const allItems = (rItems.data || []).filter((item: any) => {
        const v = item.vendas;
        if (!v || v.status !== "aprovada") return false;
        if (pf && v.produto !== pf) return false;
        return true;
      });

      setAllMeta(rMeta.data || []);
      setAllVendas(rV.data || []);
      setAllItems(allItems);
      setAllMetaAnt(rMetaAnt.data || []);
      setAllVendasAnt(rVAnt.data || []);

      // Lista de campanhas únicas do Meta (com dados reais)
      const camps = [
        ...new Set((rMeta.data || []).map((r: any) => r.campanha_nome).filter(Boolean)),
      ].sort() as string[];
      setCampanhas(camps);
      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, product]);

  // Funil geral — OBs/upsells de todas as vendas do período
  const { obs: obsGeral, ups: upsGeral } = aggregateItems(allItems);
  const funnelGeral = calcFunnel(allMeta, allVendas, obsGeral, upsGeral);
  const { obs: obsGeralAnt, ups: upsGeralAnt } = aggregateItems([]); // sem itens para período anterior por ora
  const funnelGeralAnt = calcFunnel(allMetaAnt, allVendasAnt, obsGeralAnt, upsGeralAnt);

  // Funil por campanha: filtra Meta por campanha_nome E vendas por utm_campaign limpo
  // OBs/upsells filtrados pelos venda_ids da campanha específica
  const funnelPorCamp = selectedCamps.map((camp) => {
    const metaCamp = allMeta.filter((r) => r.campanha_nome === camp);
    const cleanCamp = cleanUtm(camp);
    const vendasCamp = allVendas.filter((v) => cleanUtm(v.utm_campaign) === cleanCamp);
    // Filtrar itens pelas vendas dessa campanha
    const vendaIdsCamp = new Set(vendasCamp.map((v: any) => v.id).filter(Boolean));
    // Se não temos venda.id, usar utm_campaign dos itens
    const itemsCamp = allItems.filter((item: any) => {
      const utm = item.vendas?.utm_campaign;
      return cleanUtm(utm) === cleanCamp;
    });
    const { obs, ups } = aggregateItems(itemsCamp);
    return { camp, meta: metaCamp, vendas: vendasCamp, data: calcFunnel(metaCamp, vendasCamp, obs, ups) };
  });

  const toggleCamp = (c: string) =>
    setSelectedCamps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const antInfo = periodoAnterior(startDateStr, endDateStr);

  if (loading)
    return (
      <DashboardLayout title="Funil">
        <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Carregando...</div>
      </DashboardLayout>
    );

  return (
    <DashboardLayout title="Funil">
      <Tabs defaultValue="geral">
        <TabsList className="bg-secondary border border-border mb-4">
          <TabsTrigger
            value="geral"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Geral
          </TabsTrigger>
          <TabsTrigger
            value="campanha"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Por Campanha / A/B
          </TabsTrigger>
        </TabsList>

        {/* ── Geral ───────────────────────────────────────── */}
        <TabsContent value="geral">
          {antInfo && (
            <div className="flex items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => setShowPeriodoAnt((v) => !v)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors",
                  showPeriodoAnt
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {showPeriodoAnt ? "✓ " : ""}Comparar com período anterior ({antInfo.dias}d atrás)
              </button>
            </div>
          )}

          {showPeriodoAnt ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-card border border-border rounded-lg p-5">
                <FunnelDisplay data={funnelGeral} title="Período Atual" compare={funnelGeralAnt} />
              </div>
              <div className="bg-card border border-border rounded-lg p-5">
                <FunnelDisplay data={funnelGeralAnt} title={`Período Anterior (${antInfo?.start} → ${antInfo?.end})`} />
              </div>
            </div>
          ) : funnelGeral ? (
            <FunnelDisplay data={funnelGeral} />
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground">Sem dados para o período</div>
          )}
        </TabsContent>

        {/* ── Por Campanha / A/B ───────────────────────────── */}
        <TabsContent value="campanha">
          <div className="bg-card border border-border rounded-lg p-4 mb-5">
            <h3 className="text-sm font-medium text-foreground mb-2">
              Selecione campanhas
              <span className="text-xs text-muted-foreground ml-2">({selectedCamps.length} selecionada(s))</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {campanhas.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCamp(c)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                    selectedCamps.includes(c)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary text-muted-foreground border-border hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
              {campanhas.length === 0 && (
                <span className="text-xs text-muted-foreground">Nenhuma campanha disponível</span>
              )}
            </div>
            {selectedCamps.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedCamps([])}
                className="text-xs text-primary hover:underline mt-2 block"
              >
                Limpar seleção
              </button>
            )}
          </div>

          {selectedCamps.length === 0 && (
            <div className="text-center text-muted-foreground py-12">Selecione campanhas acima para visualizar</div>
          )}

          {selectedCamps.length === 1 && (
            <div className="bg-card border border-border rounded-lg p-5">
              <FunnelDisplay data={funnelPorCamp[0]?.data} title={funnelPorCamp[0]?.camp} />
            </div>
          )}

          {selectedCamps.length >= 2 && (
            <div className="space-y-5">
              {/* Tabela comparativa */}
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                  <h3 className="text-sm font-medium text-foreground">Comparação entre campanhas</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Meta: dados de investimento/tráfego por campanha · Receita: vendas atribuídas por UTM
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase w-40">Métrica</th>
                        {funnelPorCamp.map(({ camp }) => (
                          <th key={camp} className="px-4 py-3 text-left text-xs text-primary uppercase">
                            {camp}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Investimento", key: "investimento", fmt: formatCurrency },
                        { label: "Faturamento", key: "fatReal", fmt: formatCurrency },
                        { label: "Resultado", key: "resultado", fmt: formatCurrency },
                        { label: "Vendas (UTM)", key: "totalVendas", fmt: (v: number) => String(Math.round(v)) },
                        { label: "ROAS", key: "roas", fmt: (v: number) => `${v.toFixed(2)}x` },
                        { label: "CPA", key: "cpa", fmt: formatCurrency },
                        { label: "Ticket Médio", key: "aov", fmt: formatCurrency },
                        { label: "Impressões", key: "impressoes", fmt: formatNumber },
                        { label: "Cliques", key: "cliques", fmt: formatNumber },
                        { label: "Vis. de Página", key: "visualizacoes_pagina", fmt: formatNumber },
                        { label: "ICs", key: "initiate_checkout", fmt: formatNumber },
                        { label: "Taxa Conexão", key: "taxa_carregamento", fmt: (v: number) => `${v.toFixed(1)}%` },
                        { label: "Taxa IC", key: "taxa_vis_ic", fmt: (v: number) => `${v.toFixed(1)}%` },
                        { label: "Conv. Checkout", key: "taxa_ic_vendas", fmt: (v: number) => `${v.toFixed(1)}%` },
                        { label: "Vis→Vendas", key: "taxa_vis_vendas", fmt: (v: number) => `${v.toFixed(1)}%` },
                      ].map((row) => (
                        <tr key={row.label} className="border-b border-border/50 hover:bg-secondary/50">
                          <td className="px-4 py-2 text-muted-foreground text-xs font-medium">{row.label}</td>
                          {funnelPorCamp.map(({ camp, data }) => {
                            const val = data ? Number(data[row.key] || 0) : 0;
                            // Highlight maior valor
                            const vals = funnelPorCamp.map(({ data: d }) => (d ? Number(d[row.key] || 0) : 0));
                            const isBest = val > 0 && val === Math.max(...vals);
                            return (
                              <td
                                key={camp}
                                className={cn("px-4 py-2 font-medium", isBest ? "text-green-400" : "text-foreground")}
                              >
                                {data ? row.fmt(val) : "-"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Funis lado a lado */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {funnelPorCamp.map(({ camp, data }) => (
                  <div key={camp} className="bg-card border border-border rounded-lg p-5">
                    <FunnelDisplay data={data} title={camp} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
