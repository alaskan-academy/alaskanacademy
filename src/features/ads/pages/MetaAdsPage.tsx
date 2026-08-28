import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useFilters } from "@/contexts/FilterContext";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ConciliacaoMeta } from "@/features/ads/components/ConciliacaoMeta";
import type { LinhaMetricaMeta } from "@/features/ads/metricas";

type Nivel = "campanha" | "adset" | "ad";

// Todas as colunas pedidas
const COLS = [
  { key: "nome", label: "Nome", fixed: true },
  { key: "investimento", label: "Gastos", money: true },
  { key: "faturamento_atribuido", label: "Faturamento (Meta)", money: true },
  { key: "resultado", label: "Retorno", money: true },
  { key: "margem", label: "Margem %", pct: true },
  { key: "roas", label: "ROAS", suffix: "x" },
  { key: "compras_meta", label: "Vendas (Meta)", num: true },
  { key: "cpa", label: "CPA", money: true },
  { key: "taxa_video_3s", label: "V3s/Imp %", pct: true },
  { key: "taxa_video_75pct", label: "V75%/Inic %", pct: true },
  { key: "taxa_compras_video75", label: "Comp/V75% %", pct: true },
  { key: "ctr", label: "CTR %", pct: true },
  { key: "cpc", label: "CPC", money: true },
  { key: "cpm", label: "CPM", money: true },
  { key: "initiate_checkout", label: "ICs", num: true },
  { key: "taxa_ic", label: "Taxa IC %", pct: true },
  { key: "custo_por_ic", label: "Custo/IC", money: true },
  { key: "taxa_conv_checkout", label: "Conv. Checkout %", pct: true },
  { key: "taxa_conexao", label: "Taxa Conexão %", pct: true },
  { key: "custo_por_vis_pagina", label: "Custo/VisPag", money: true },
  { key: "taxa_vendas_vis_pagina", label: "Vend/VisPag %", pct: true },
  { key: "visualizacoes_pagina", label: "Vis. Pág.", num: true },
  { key: "cliques", label: "Cliques", num: true },
  { key: "impressoes", label: "Impressões", num: true },
];

function fmtCell(row: any, col: (typeof COLS)[number]) {
  const v = Number(row[col.key] ?? 0);
  // `formatCurrency`, e nao `R$ ${v.toFixed(2)}`: a tabela mostrava
  // "R$ 43915.63" com ponto decimal e sem separador de milhar, enquanto o
  // cartao de conciliacao logo abaixo, na mesma tela, mostrava
  // "R$ 43.915,63". O CLAUDE.md pede os formatadores justamente para isso.
  if (col.money) return formatCurrency(v);
  if (col.pct) return `${v.toFixed(2)}%`;
  if (col.suffix) return `${v.toFixed(2)}${col.suffix}`;
  if (col.num) return formatNumber(v);
  return row[col.key] ?? "-";
}

/**
 * A coluna que não rola junto.
 *
 * A tabela tem 24 colunas e nasceu para ser rolada de lado. Sem prender o
 * nome, no meio da rolagem sobra uma fileira de números sem dono — e a
 * pergunta que a tela existe para responder é "qual anúncio é esse".
 *
 * Precisa de fundo próprio: célula `sticky` sem fundo deixa o resto da linha
 * passar por baixo. `group-hover` porque o realce da linha é do `<tr>`, e a
 * célula presa não o herdaria.
 */
const COL_FIXA = "sticky z-10 bg-card group-hover:bg-secondary";

function roasColor(v: number) {
  return v >= 3 ? "text-green-400" : v >= 1 ? "text-yellow-400" : "text-red-400";
}
function margemColor(v: number) {
  return v >= 30 ? "text-green-400" : v >= 15 ? "text-yellow-400" : "text-red-400";
}

export default function MetaAdsPage() {
  const { startDateStr, endDateStr, contaIds } = useFilters();
  const [allRows, setAllRows] = useState<LinhaMetricaMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState("investimento");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Checkboxes: IDs selecionados por nível pai (para filtrar filhos)
  const [selectedCamp, setSelectedCamp] = useState<Set<string>>(new Set());
  const [selectedAdset, setSelectedAdset] = useState<Set<string>>(new Set());

  /*
    A soma acontece no banco, e não aqui.

    A tela pedia a view inteira — uma linha por dia e por nível — e somava no
    JavaScript. O PostgREST corta em 1.000 linhas por padrão e não avisa:
    devolve 200 com mil linhas. Agosto tem 3.285.

    O que isso mostrava, medido com "Este mês":

      na tela    6 campanhas   R$  25.082,09
      no banco  16 campanhas   R$ 102.541,16

    Um quarto do gasto, dez campanhas sumidas, sem erro nenhum. E o cartão de
    conciliação logo abaixo, na MESMA tela, já mostrava R$ 102.541,16.

    `fn_metricas_meta_agregado` devolve uma linha só de jsonb, com os níveis já
    somados — e uma linha não tem teto para cortar.
  */
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("fn_metricas_meta_agregado", {
        p_inicio: startDateStr || null,
        p_fim: endDateStr || null,
        p_contas: contaIds,
      });
      // Erro tem que aparecer como erro: tela com zeros e "não consegui ler"
      // são coisas diferentes, e confundi-las é como este defeito durou tanto.
      if (error) {
        console.error("fn_metricas_meta_agregado:", error.message);
        setErro(error.message);
        setAllRows([]);
      } else {
        setErro(null);
        setAllRows((data as LinhaMetricaMeta[]) ?? []);
      }
      setLoading(false);
    };
    load();
  }, [startDateStr, endDateStr, contaIds]);

  /*
    Filtra o nível e calcula as razões — a soma já veio pronta.

    As razões ficam aqui, e não no SQL, apesar de a view também as calcular:
    razão de um dia não se soma. CPM de 28 dias somados não é o CPM do mês.
    Quem agrega tem que recalcular depois, e por isso a conta mora num lugar
    só, aplicada sobre os totais.
  */
  const aggregate = (nivel: Nivel, parentIds?: Set<string>) => {
    const filtered = allRows.filter((r) => {
      if (r.nivel !== nivel) return false;
      if (parentIds && parentIds.size > 0 && r.parent_id) {
        return parentIds.has(r.parent_id);
      }
      return true;
    });

    return filtered
      .map((linha: any) => {
        const r = {
          ...linha,
          impressoes: Number(linha.impressoes || 0),
          cliques: Number(linha.cliques || 0),
          investimento: Number(linha.investimento || 0),
          compras_meta: Number(linha.compras_meta || 0),
          faturamento_atribuido: Number(linha.faturamento_atribuido || 0),
          initiate_checkout: Number(linha.initiate_checkout || 0),
          visualizacoes_pagina: Number(linha.visualizacoes_pagina || 0),
          video_plays: Number(linha.video_plays || 0),
          video_3s: Number(linha.video_3s || 0),
          video_75pct: Number(linha.video_75pct || 0),
        };
        const inv = r.investimento;
        const fat = r.faturamento_atribuido;
        const luc = fat - inv;
        return {
          ...r,
          resultado: luc,
          margem: fat > 0 ? (luc / fat) * 100 : 0,
          roas: inv > 0 ? fat / inv : 0,
          cpa: r.compras_meta > 0 ? inv / r.compras_meta : 0,
          ctr: r.impressoes > 0 ? (r.cliques / r.impressoes) * 100 : 0,
          cpm: r.impressoes > 0 ? (inv / r.impressoes) * 1000 : 0,
          cpc: r.cliques > 0 ? inv / r.cliques : 0,
          taxa_video_3s: r.impressoes > 0 ? (r.video_3s / r.impressoes) * 100 : 0,
          taxa_video_75pct: r.video_plays > 0 ? (r.video_75pct / r.video_plays) * 100 : 0,
          taxa_compras_video75: r.video_75pct > 0 ? (r.compras_meta / r.video_75pct) * 100 : 0,
          taxa_ic: r.visualizacoes_pagina > 0 ? (r.initiate_checkout / r.visualizacoes_pagina) * 100 : 0,
          custo_por_ic: r.initiate_checkout > 0 ? inv / r.initiate_checkout : 0,
          taxa_conv_checkout: r.initiate_checkout > 0 ? (r.compras_meta / r.initiate_checkout) * 100 : 0,
          taxa_conexao: r.cliques > 0 ? (r.visualizacoes_pagina / r.cliques) * 100 : 0,
          custo_por_vis_pagina: r.visualizacoes_pagina > 0 ? inv / r.visualizacoes_pagina : 0,
          taxa_vendas_vis_pagina: r.visualizacoes_pagina > 0 ? (r.compras_meta / r.visualizacoes_pagina) * 100 : 0,
        };
      })
      .sort((a: any, b: any) => {
        const va = Number(a[sortCol]) || 0;
        const vb = Number(b[sortCol]) || 0;
        return sortDir === "desc" ? vb - va : va - vb;
      });
  };

  const handleSort = (key: string) => {
    if (sortCol === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortCol(key);
      setSortDir("desc");
    }
  };

  const toggleCamp = (id: string) =>
    setSelectedCamp((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleAdset = (id: string) =>
    setSelectedAdset((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const campRows = aggregate("campanha");
  const adsetRows = aggregate("adset", selectedCamp.size > 0 ? selectedCamp : undefined);
  const adRows = aggregate("ad", selectedAdset.size > 0 ? selectedAdset : undefined);

  const renderTable = (
    rows: any[],
    nivel: Nivel,
    showCheck?: boolean,
    onCheck?: (id: string) => void,
    checked?: Set<string>,
  ) =>
    loading ? (
      <div className="p-8 text-center text-muted-foreground animate-pulse">Carregando...</div>
    ) : erro ? (
      <div className="p-8 text-center">
        <p className="text-sm font-medium text-foreground">Não foi possível carregar as métricas</p>
        <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {showCheck && <th className={cn("px-3 py-3 w-8", COL_FIXA, "left-0")} />}
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => !c.fixed && handleSort(c.key)}
                  className={cn(
                    "px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap",
                    !c.fixed && "cursor-pointer hover:text-foreground select-none",
                    sortCol === c.key && "text-primary",
                    // O nome acompanha a rolagem lateral: são 24 colunas, e sem
                    // ele a linha vira uma fileira de números sem dono.
                    c.key === "nome" && cn(COL_FIXA, "border-r border-border", showCheck ? "left-8" : "left-0"),
                  )}
                >
                  {c.label}
                  {sortCol === c.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="group border-b border-border/50 hover:bg-secondary/50">
                {showCheck && onCheck && (
                  <td className={cn("px-3 py-2", COL_FIXA, "left-0")}>
                    <input
                      type="checkbox"
                      checked={checked?.has(r.nivel_id) || false}
                      onChange={() => onCheck(r.nivel_id)}
                      className="accent-primary cursor-pointer"
                    />
                  </td>
                )}
                {COLS.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2 whitespace-nowrap",
                      c.key === "nome" && cn(
                        "text-foreground font-medium max-w-48 truncate",
                        COL_FIXA, "border-r border-border", showCheck ? "left-8" : "left-0",
                      ),
                      c.key === "roas" && roasColor(Number(r.roas)),
                      c.key === "margem" && margemColor(Number(r.margem)),
                      c.key === "resultado" && (Number(r.resultado) >= 0 ? "text-green-400" : "text-red-400"),
                      !["nome", "roas", "margem", "resultado"].includes(c.key) && "text-foreground",
                    )}
                  >
                    {c.key === "nome" ? <span title={r.nome}>{r.nome}</span> : fmtCell(r, c)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + (showCheck ? 1 : 0)} className="px-4 py-8 text-center text-muted-foreground">
                  {showCheck && checked?.size === 0 ? "Selecione campanhas na aba anterior para filtrar" : "Sem dados"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );

  return (
    <DashboardLayout title="Meta Ads" hideTitle>
      <Tabs defaultValue="campanhas">
        <TabsList className="bg-secondary border border-border mb-4">
          <TabsTrigger
            value="campanhas"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Campanhas
          </TabsTrigger>
          <TabsTrigger
            value="conjuntos"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Conjuntos
          </TabsTrigger>
          <TabsTrigger
            value="anuncios"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
          >
            Anúncios
          </TabsTrigger>
        </TabsList>

        <TabsContent value="campanhas">
          {selectedCamp.size > 0 && (
            <div className="mb-3 flex items-center gap-2 text-xs text-primary">
              <span>{selectedCamp.size} campanha(s) selecionada(s) — conjuntos e anúncios filtrados</span>
              <button
                onClick={() => {
                  setSelectedCamp(new Set());
                  setSelectedAdset(new Set());
                }}
                className="underline hover:no-underline"
              >
                Limpar
              </button>
            </div>
          )}
          {/*
            De onde vem cada número, dito na tela.

            "Lucro" aqui era faturamento atribuído menos gasto — e "Lucro" no
            Resumo é depois da taxa da Payt, do Simples e do imposto de mídia.
            A mesma palavra com duas contas em duas telas é a primeira
            armadilha do CLAUDE.md aplicada ao vocabulário: ninguém percebe que
            divergiu, porque as duas parecem certas.

            Virou "Retorno", e o que é atribuição do Meta passou a dizer que é:
            em agosto o Meta atribui R$ 182.499,40 enquanto a Payt registrou
            R$ 178.200,72 — duas fontes, dois números, e a coluna não dizia de
            qual estava falando.
          */}
          <p className="text-xs text-muted-foreground mb-2">
            Marque campanhas para filtrar conjuntos e anúncios nas abas seguintes.
            <span className="block mt-1">
              Faturamento e vendas são a atribuição do Meta, não a venda registrada na Payt.
              Retorno = faturamento atribuído − gasto; não desconta taxa, Simples nem imposto de
              mídia — o lucro da empresa está no Resumo.
            </span>
          </p>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(campRows, "campanha", true, toggleCamp, selectedCamp)}
          </div>
        </TabsContent>

        <TabsContent value="conjuntos">
          {selectedCamp.size > 0 && (
            <div className="mb-3 text-xs text-primary">
              Mostrando conjuntos de {selectedCamp.size} campanha(s) selecionada(s)
              {selectedAdset.size > 0 && <span> · {selectedAdset.size} conjunto(s) marcado(s)</span>}
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-2">Marque conjuntos para filtrar anúncios na aba seguinte.</p>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(adsetRows, "adset", true, toggleAdset, selectedAdset)}
          </div>
        </TabsContent>

        <TabsContent value="anuncios">
          {selectedAdset.size > 0 && (
            <div className="mb-3 text-xs text-primary">
              Mostrando anúncios de {selectedAdset.size} conjunto(s) selecionado(s)
            </div>
          )}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {renderTable(adRows, "ad", false)}
          </div>
        </TabsContent>
      </Tabs>

      {/* O que a Meta reporta de campanha contra o que ela debitou da conta.
          Mora aqui, e nao no Financeiro: la a regra e trabalhar so com
          movimentacao bancaria, e este bloco existe justamente para comparar o
          banco com uma fonte de fora. A leitura tambem e desta tela — quem olha
          ROAS precisa saber que a cobranca vem ~14% acima do investimento
          reportado. */}
      <div className="mt-6">
        <ConciliacaoMeta meses={6} />
      </div>
    </DashboardLayout>
  );
}
