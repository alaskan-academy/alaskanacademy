import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContasAnunciosTab } from "@/components/editores/ContasAnunciosTab";
import { GerenciarUsuariosTab } from "@/components/GerenciarUsuariosTab";
import { ConfiguracaoTab } from "@/components/editores/ConfiguracaoTab";
import { EmpresasOfertasTab } from "@/components/editores/EmpresasOfertasTab";
import { RadarConfigTab } from "@/components/radar/RadarConfigTab";
import { useAuth } from "@/contexts/AuthContext";

export default function SettingsPage() {
  const { perfil } = useAuth();
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    imposto_simples_nacional_pct: 0,
    imposto_meta_ads_pct: 0,
    custo_fixo_mensal: 0,
  });
  const [fatBruto, setFatBruto] = useState(0);
  const [taxaPlat, setTaxaPlat] = useState(0);
  const [investMeta, setInvestMeta] = useState(0);
  const [reembolsos, setReembolsos] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [r1, r2] = await Promise.all([
        supabase.from("configuracoes").select("chave,valor"),
        supabase.from("vw_faturamento_liquido").select("faturamento_bruto,taxa_plataforma,investimento_meta,reembolsos"),
      ]);

      const cfgMap: Record<string, number> = {};
      (r1.data || []).forEach((row: any) => {
        cfgMap[row.chave] = parseFloat(row.valor) || 0;
      });
      setForm({
        imposto_simples_nacional_pct: cfgMap["imposto_simples_nacional_pct"] ?? 0,
        imposto_meta_ads_pct: cfgMap["imposto_meta_ads_pct"] ?? 0,
        custo_fixo_mensal: cfgMap["custo_fixo_mensal"] ?? 0,
      });

      const fatRows = r2.data || [];
      setFatBruto(fatRows.reduce((s: number, r: any) => s + Number(r.faturamento_bruto || 0), 0));
      setTaxaPlat(fatRows.reduce((s: number, r: any) => s + Number(r.taxa_plataforma || 0), 0));
      setInvestMeta(fatRows.reduce((s: number, r: any) => s + Number(r.investimento_meta || 0), 0));
      setReembolsos(fatRows.reduce((s: number, r: any) => s + Number(r.reembolsos || 0), 0));
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    const updates = [
      { chave: "imposto_simples_nacional_pct", valor: String(form.imposto_simples_nacional_pct) },
      { chave: "imposto_meta_ads_pct", valor: String(form.imposto_meta_ads_pct) },
      { chave: "custo_fixo_mensal", valor: String(form.custo_fixo_mensal) },
    ];

    const errors: string[] = [];
    for (const u of updates) {
      const { error } = await supabase.from("configuracoes").update({ valor: u.valor }).eq("chave", u.chave);
      if (error) errors.push(error.message);
    }

    if (errors.length > 0) {
      toast({ title: "Erro ao salvar", description: errors.join(" | "), variant: "destructive" });
    } else {
      toast({ title: "Configurações salvas!" });
    }
  };

  const taxaPlatPct = fatBruto > 0 ? (taxaPlat / fatBruto) * 100 : 0;
  const impostoSimples = fatBruto * (form.imposto_simples_nacional_pct / 100);
  const impostoMeta = investMeta * (form.imposto_meta_ads_pct / 100);
  const fatLiqPreview = fatBruto - taxaPlat - reembolsos - impostoSimples - impostoMeta - investMeta - form.custo_fixo_mensal;
  const margemPreview = fatBruto > 0 ? (fatLiqPreview / fatBruto) * 100 : 0;

  const fields = [
    { key: "imposto_simples_nacional_pct", label: "Imposto Simples Nacional (%)", step: 0.01 },
    { key: "imposto_meta_ads_pct", label: "Imposto Meta Ads (%)", step: 0.01 },
    { key: "custo_fixo_mensal", label: "Custo Fixo Mensal (R$)", step: 1 },
  ] as const;

  return (
    <DashboardLayout title="Configurações">
      <Tabs defaultValue="fiscal">
        <TabsList className="bg-secondary border border-border mb-6 flex-wrap h-auto">
          <TabsTrigger value="fiscal" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Parâmetros Fiscais
          </TabsTrigger>
          <TabsTrigger value="contas" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            Contas de Anúncios
          </TabsTrigger>
          {perfil?.is_admin && (
            <TabsTrigger value="criterios" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Critérios
            </TabsTrigger>
          )}
          {perfil?.is_admin && (
            <TabsTrigger value="empresas" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Empresas e ofertas
            </TabsTrigger>
          )}
          {perfil?.is_admin && (
            <TabsTrigger value="usuarios" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Usuários
            </TabsTrigger>
          )}
          {perfil?.is_admin && (
            <TabsTrigger value="radar" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Radar
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="contas">
          <ContasAnunciosTab />
        </TabsContent>

        {perfil?.is_admin && (
          <TabsContent value="criterios">
            <ConfiguracaoTab />
          </TabsContent>
        )}
        {perfil?.is_admin && (
          <TabsContent value="empresas">
            <EmpresasOfertasTab />
          </TabsContent>
        )}
        {perfil?.is_admin && (
          <TabsContent value="usuarios">
            <GerenciarUsuariosTab />
          </TabsContent>
        )}
        {perfil?.is_admin && (
          <TabsContent value="radar">
            <RadarConfigTab />
          </TabsContent>
        )}

        <TabsContent value="fiscal">
          {loading ? (
            <div className="text-muted-foreground">Carregando...</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-3xl">
              <div className="bg-card border border-border rounded-lg p-6 space-y-4">
                <h3 className="text-sm font-medium text-foreground mb-2">Parâmetros fiscais</h3>
                <p className="text-xs text-muted-foreground -mt-2 mb-2">
                  A taxa da plataforma Payt é calculada automaticamente a partir dos dados de venda e não é configurável aqui.
                </p>

                {fields.map(({ key, label, step }) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground">{label}</label>
                    <input
                      type="number"
                      step={step}
                      value={form[key]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                      className="w-full mt-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                ))}

                <Button onClick={handleSave} className="w-full mt-4">Salvar Configurações</Button>
              </div>

              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-sm font-medium text-foreground mb-4">Preview do Impacto</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Faturamento bruto</span>
                    <span className="text-foreground">{formatCurrency(fatBruto)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-destructive">(-) Taxa Payt ({taxaPlatPct.toFixed(2)}%)</span>
                    <span className="text-destructive">{formatCurrency(taxaPlat)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-destructive">(-) Reembolsos</span>
                    <span className="text-destructive">{formatCurrency(reembolsos)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-destructive">(-) Simples ({formatPercent(form.imposto_simples_nacional_pct)})</span>
                    <span className="text-destructive">{formatCurrency(impostoSimples)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-destructive">(-) Imp. Meta Ads ({formatPercent(form.imposto_meta_ads_pct)})</span>
                    <span className="text-destructive">{formatCurrency(impostoMeta)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-destructive">(-) Investimento Meta</span>
                    <span className="text-destructive">{formatCurrency(investMeta)}</span>
                  </div>
                  {form.custo_fixo_mensal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-destructive">(-) Custo fixo</span>
                      <span className="text-destructive">{formatCurrency(form.custo_fixo_mensal)}</span>
                    </div>
                  )}
                  <div className="border-t border-border pt-2 flex justify-between font-semibold">
                    <span className="text-foreground">(=) Fat. líquido</span>
                    <span className="text-foreground">{formatCurrency(fatLiqPreview)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className="text-foreground">Margem</span>
                    <span className={margemPreview > 30 ? "text-success" : margemPreview >= 15 ? "text-warning" : "text-destructive"}>
                      {formatPercent(margemPreview)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
