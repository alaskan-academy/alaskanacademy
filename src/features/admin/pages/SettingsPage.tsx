import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { ContasAnunciosTab } from "@/features/editores/components/ContasAnunciosTab";
import { GerenciarUsuariosTab } from "@/features/admin/components/GerenciarUsuariosTab";
import { ConfiguracaoTab } from "@/features/editores/components/ConfiguracaoTab";
import { EmpresasOfertasTab } from "@/features/editores/components/EmpresasOfertasTab";
import { RadarConfigTab } from "@/features/radar/components/RadarConfigTab";
import { SetoresTab } from "@/features/admin/components/SetoresTab";
import { AtivosContent } from "@/features/ads/pages/AtivosPage";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  Shield, CreditCard, Building2, SlidersHorizontal,
  ClipboardList, Radio, Users, Layers,
} from "lucide-react";

// ─── Estrutura da nav ─────────────────────────────────────────────────────────

type SectionId =
  | 'ativos' | 'contas' | 'empresas' | 'fiscal'
  | 'criterios'
  | 'radar'
  | 'usuarios' | 'setores';

interface GroupDef {
  label: string;
  items: { id: SectionId; label: string; icon: React.ElementType }[];
}

const GROUPS: GroupDef[] = [
  {
    label: 'OPERACIONAL',
    items: [
      { id: 'ativos',   label: 'Ativos',             icon: Shield           },
      { id: 'contas',   label: 'Contas de Anúncios', icon: CreditCard       },
      { id: 'empresas', label: 'Empresas e Ofertas', icon: Building2        },
      { id: 'fiscal',   label: 'Parâmetros Fiscais', icon: SlidersHorizontal },
    ],
  },
  {
    label: 'AVALIAÇÕES',
    items: [
      { id: 'criterios', label: 'Critérios de avaliação de editores', icon: ClipboardList },
    ],
  },
  {
    label: 'LABORATÓRIO',
    items: [
      { id: 'radar', label: 'Radar', icon: Radio },
    ],
  },
  {
    label: 'SISTEMA',
    items: [
      { id: 'usuarios', label: 'Usuários',         icon: Users  },
      { id: 'setores',  label: 'Setores & Cargos', icon: Layers },
    ],
  },
];

// ─── Aba Parâmetros Fiscais ───────────────────────────────────────────────────

function FiscalTab() {
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    imposto_simples_nacional_pct: 0,
    imposto_meta_ads_pct: 0,
    custo_fixo_mensal: 0,
  });
  const [fatBruto, setFatBruto]     = useState(0);
  const [taxaPlat, setTaxaPlat]     = useState(0);
  const [investMeta, setInvestMeta] = useState(0);
  const [reembolsos, setReembolsos] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [r1, r2] = await Promise.all([
        /* Só as linhas GERAIS. Um parâmetro pode ter uma linha por empresa desde
           que a Aeliss existe; sem este filtro o mapa por `chave` ficaria com a
           última linha que chegasse — e qual é a última é sorteio do Postgres. */
        supabase.from("configuracoes").select("chave,valor").is("empresa_id", null),
        supabase.from("vw_faturamento_liquido").select("faturamento_bruto,taxa_plataforma,investimento_meta,reembolsos"),
      ]);
      const cfgMap: Record<string, number> = {};
      (r1.data || []).forEach((row: any) => { cfgMap[row.chave] = parseFloat(row.valor) || 0; });
      setForm({
        imposto_simples_nacional_pct: cfgMap["imposto_simples_nacional_pct"] ?? 0,
        imposto_meta_ads_pct:         cfgMap["imposto_meta_ads_pct"]         ?? 0,
        custo_fixo_mensal:            cfgMap["custo_fixo_mensal"]            ?? 0,
      });
      const fatRows = r2.data || [];
      setFatBruto(fatRows.reduce((s: number, r: any)  => s + Number(r.faturamento_bruto  || 0), 0));
      setTaxaPlat(fatRows.reduce((s: number, r: any)  => s + Number(r.taxa_plataforma    || 0), 0));
      setInvestMeta(fatRows.reduce((s: number, r: any) => s + Number(r.investimento_meta  || 0), 0));
      setReembolsos(fatRows.reduce((s: number, r: any) => s + Number(r.reembolsos         || 0), 0));
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    const updates = [
      { chave: "imposto_simples_nacional_pct", valor: String(form.imposto_simples_nacional_pct) },
      { chave: "imposto_meta_ads_pct",         valor: String(form.imposto_meta_ads_pct) },
      { chave: "custo_fixo_mensal",            valor: String(form.custo_fixo_mensal) },
    ];
    const errors: string[] = [];
    for (const u of updates) {
      // O `.select()` no fim devolve as linhas afetadas. Sem ele, um UPDATE barrado
      // por RLS retorna 200 com zero linhas e o código comemora — foi assim que os
      // parâmetros fiscais ficaram meses sem salvar, exibindo "Configurações salvas!".
      const { data, error } = await supabase
        .from("configuracoes")
        .update({ valor: u.valor })
        .eq("chave", u.chave)
        /*
          O filtro que impede o pior erro desta tela.

          Sem ele, o UPDATE alcança TODAS as linhas da chave — a geral e a de
          cada empresa. Alguém ajustando a alíquota aqui sobrescreveria em
          silêncio a alíquota própria da Aeliss, e o DRE dela mudaria sem que
          ninguém tivesse mexido nela.

          Esta tela edita a configuração GERAL. O valor próprio de uma empresa
          se vê em `vw_config_por_empresa` e ainda não tem tela para editar.
        */
        .is("empresa_id", null)
        .select("chave");

      if (error) {
        errors.push(`${u.chave}: ${error.message}`);
      } else if (!data || data.length === 0) {
        errors.push(`${u.chave}: nenhuma linha alterada (permissão ou chave inexistente)`);
      }
    }
    if (errors.length > 0) {
      toast({ title: "Erro ao salvar", description: errors.join(" | "), variant: "destructive" });
    } else {
      toast({ title: "Configurações salvas!" });
    }
  };

  const taxaPlatPct   = fatBruto > 0 ? (taxaPlat / fatBruto) * 100 : 0;
  const impostoSimples = fatBruto * (form.imposto_simples_nacional_pct / 100);
  const impostoMeta    = investMeta * (form.imposto_meta_ads_pct / 100);
  const fatLiqPreview  = fatBruto - taxaPlat - reembolsos - impostoSimples - impostoMeta - investMeta - form.custo_fixo_mensal;
  const margemPreview  = fatBruto > 0 ? (fatLiqPreview / fatBruto) * 100 : 0;

  const fields = [
    { key: "imposto_simples_nacional_pct", label: "Imposto Simples Nacional (%)", step: 0.01 },
    { key: "imposto_meta_ads_pct",         label: "Imposto Meta Ads (%)",         step: 0.01 },
    { key: "custo_fixo_mensal",            label: "Custo Fixo Mensal (R$)",       step: 1    },
  ] as const;

  if (loading) return <div className="text-muted-foreground text-sm">Carregando...</div>;

  return (
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
  );
}

// ─── Aba Ativos (com sub-tab Meta Ads) ───────────────────────────────────────

function AtivosSection() {
  return (
    <Tabs defaultValue="meta-ads">
      <TabsList className="bg-secondary border border-border mb-5 h-auto">
        <TabsTrigger value="meta-ads" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
          Meta Ads
        </TabsTrigger>
      </TabsList>
      <TabsContent value="meta-ads">
        <AtivosContent />
      </TabsContent>
    </Tabs>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { perfil } = useAuth();
  const navigate   = useNavigate();
  const [active, setActive] = useState<SectionId>('ativos');

  if (!perfil?.is_admin) {
    navigate('/');
    return null;
  }

  const renderContent = () => {
    switch (active) {
      case 'ativos':    return <AtivosSection />;
      case 'contas':    return <ContasAnunciosTab />;
      case 'empresas':  return <EmpresasOfertasTab />;
      case 'fiscal':    return <FiscalTab />;
      case 'criterios': return <ConfiguracaoTab />;
      case 'radar':     return <RadarConfigTab />;
      case 'usuarios':  return <GerenciarUsuariosTab />;
      case 'setores':   return <SetoresTab />;
    }
  };

  return (
    <DashboardLayout title="Configurações" hideFilters hideTitle>
      <div className="flex gap-6 min-h-[600px]">

        {/* Nav lateral */}
        <nav className="w-56 shrink-0">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {GROUPS.map((group, gi) => (
              <div key={group.label}>
                {gi > 0 && <div className="border-t border-border" />}
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    {group.label}
                  </p>
                </div>
                <div className="pb-2 px-1.5 space-y-0.5">
                  {group.items.map(item => {
                    const Icon     = item.icon;
                    const isActive = active === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActive(item.id)}
                        className={cn(
                          'flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-sm transition-colors text-left',
                          isActive
                            ? 'bg-primary/15 text-primary font-medium'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate leading-tight">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          {renderContent()}
        </div>
      </div>
    </DashboardLayout>
  );
}
