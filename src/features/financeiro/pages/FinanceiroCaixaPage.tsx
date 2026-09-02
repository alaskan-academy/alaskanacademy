import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Wallet, PiggyBank, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import { AvisoRevisao } from '@/features/financeiro/components/AvisoRevisao';
import { RecorrentesAVencer } from '@/features/financeiro/components/RecorrentesAVencer';
import { SaldosDasContas } from '@/features/financeiro/components/SaldosDasContas';
import { ehCustoOperacional } from '@/features/financeiro/constants';
import { buscarTudo } from '@/features/financeiro/lib/buscar';
import { cn } from '@/lib/utils';

// ─── Grupos do DRE ────────────────────────────────────────────────────────────
// A lista vem do BANCO, de `vw_plano_de_contas`, e não mais de `constants.ts`.
//
// Escrita no código, ela envelhecia em silêncio: toda categoria criada no campo
// ficava invisível para o DRE. Em agosto foram R$ 10.065,58 de despesa que não
// apareciam — Editor de Vídeo (R$ 7.468), Hospedagem, Mídia, Contábil,
// Automação, Tokens, Domínios. A tela somava R$ 109.591,19 quando o real era
// R$ 119.656,77, e o resultado saía inflado no mesmo tanto.
//
// As constantes seguem em `constants.ts` como semente para o caso de a consulta
// falhar: melhor um DRE incompleto do que um DRE vazio.
type Conta = { categoria: string; grupo: string; tipo: string; ordem: number; ordem_grupo: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function isoMes(ano: number, mes: number) {
  return `${ano}-${String(mes + 1).padStart(2, '0')}`;
}

function labelPeriodo(ano: number, mes: number, ytd: boolean) {
  if (ytd) return `Jan–${MESES[mes]} ${ano}`;
  return `${MESES[mes]} ${ano}`;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TotalCategoria { categoria: string | null; total: number }

interface CaixaConfig {
  id: string;
  saldo_inicial: number;
  data_referencia: string;
}

interface MovimentoReserva {
  id: string;
  data: string;
  descricao: string;
  valor: number;
}

// ─── Componente DRE ───────────────────────────────────────────────────────────

function LinhasDRE({ label, totais, cats, cor }: {
  label: string;
  totais: TotalCategoria[];
  /** `readonly` porque as listas vêm de `constants.ts` como `as const`. */
  cats: readonly string[];
  cor?: string;
}) {
  const linhas = cats
    .map(c => ({ cat: c, val: totais.find(t => t.categoria === c)?.total ?? 0 }))
    .filter(l => l.val !== 0);

  if (linhas.length === 0) return null;

  const soma = linhas.reduce((a, l) => a + l.val, 0);

  return (
    <>
      <tr><td colSpan={2} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</td></tr>
      {linhas.map(l => (
        <tr key={l.cat} className="hover:bg-white/5 transition-colors">
          <td className="py-1 pl-4 text-sm text-muted-foreground">{l.cat}</td>
          <td className={cn('py-1 text-right text-sm tabular-nums', l.val >= 0 ? 'text-green-400' : 'text-red-400')}>
            {formatCurrency(l.val)}
          </td>
        </tr>
      ))}
      <tr className="border-t border-white/10">
        <td className={cn('py-1.5 pl-2 text-sm font-semibold', cor)}>Total {label}</td>
        <td className={cn('py-1.5 text-right text-sm font-semibold tabular-nums', cor ?? (soma >= 0 ? 'text-green-400' : 'text-red-400'))}>
          {formatCurrency(soma)}
        </td>
      </tr>
    </>
  );
}

function LinhaTotalDRE({ label, valor, destaque }: { label: string; valor: number; destaque?: boolean }) {
  return (
    <tr className={cn('border-t-2 border-white/20', destaque && 'bg-white/5')}>
      <td className={cn('py-2 pl-2 font-bold', destaque ? 'text-base' : 'text-sm')}>{label}</td>
      <td className={cn(
        'py-2 text-right font-bold tabular-nums',
        destaque ? 'text-base' : 'text-sm',
        valor >= 0 ? 'text-green-400' : 'text-red-400'
      )}>
        {formatCurrency(valor)}
      </td>
    </tr>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function FinanceiroCaixaPage() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const [ytd, setYtd] = useState(false);

  const [totais, setTotais] = useState<TotalCategoria[]>([]);
  const [totaisSociosPos, setTotaisSociosPos] = useState<TotalCategoria[]>([]);
  const [totaisSociosNeg, setTotaisSociosNeg] = useState<TotalCategoria[]>([]);
  const [semCategoria, setSemCategoria] = useState(0);
  /* Os saldos vem do painel de contas, que ja consulta `vw_saldo_contas`.
     Consultar de novo aqui seria a mesma pergunta em dois lugares — e dois
     numeros diferentes para o mesmo dinheiro na mesma tela. */
  const [saldos, setSaldos] = useState({ caixa: 0, fluxo: 0 });
  const [plano, setPlano] = useState<Conta[]>([]);

  // ── Navegar mês ──
  function avancar() {
    if (mes === 11) { setMes(0); setAno(a => a + 1); }
    else setMes(m => m + 1);
  }
  function voltar() {
    if (mes === 0) { setMes(11); setAno(a => a - 1); }
    else setMes(m => m - 1);
  }

  // ── O plano de contas, que é a lista do DRE ──
  // Vem antes de tudo de propósito: o efeito dos totais separa os sócios por
  // esta lista, e se ela chegasse depois eles cairiam nos totais gerais no
  // primeiro render e nunca mais sairiam de lá.
  useEffect(() => {
    supabase
      .from('vw_plano_de_contas')
      .select('categoria,grupo,tipo,ordem,ordem_grupo')
      .order('ordem_grupo').order('ordem')
      .then(({ data }) => setPlano((data ?? []) as Conta[]));
  }, []);

  // `useMemo` porque `SOCIOS` entra na lista de dependências do efeito abaixo:
  // recriar o array a cada render faria o efeito rodar em loop.
  const { RECEITAS, SOCIOS, RESERVA_CAT, CUSTOS_OPERACIONAIS } = useMemo(() => {
    const doTipo = (tipo: string) => plano.filter(c => c.tipo === tipo).map(c => c.categoria);
    return {
      RECEITAS:            doTipo('receita'),
      SOCIOS:              doTipo('socio'),
      RESERVA_CAT:         doTipo('reserva'),
      CUSTOS_OPERACIONAIS: doTipo('custo'),
    };
  }, [plano]);

  // ── Período de consulta ──
  const dataInicio = ytd
    ? `${ano}-01-01`
    : `${isoMes(ano, mes)}-01`;

  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const dataFim = `${isoMes(ano, mes)}-${ultimoDia}`;

  // ── Buscar totais por categoria ──
  const { empresaId } = useFilters();

  useEffect(() => {
    async function load() {
      /* Pagina porque esta consulta SOMA: em modo YTD ela alcancava 1.174
         transacoes em 01/09/2026 e recebia 1.000, sem erro nenhum. O corte nao
         deixava linhas de fora da tela — deixava os totais por categoria
         errados. Ver o comentario em `lib/buscar`. */
      const { linhas: data, erro: error } = await buscarTudo<{ categoria: string | null; valor: number }>(
        (de, ate) => {
          let q = supabase
            .from('transacoes')
            .select('categoria, valor')
            .gte('data', dataInicio)
            .lte('data', dataFim)
            .order('data').order('id')
            .range(de, ate);
          if (empresaId) q = q.eq('empresa_id', empresaId);
          return q;
        });
        // Conta também o que foi auto-categorizado. Antes esta tela exigia
        // `confirmado`/`revisado`, e como julho e agosto inteiros (440
        // lançamentos) estavam em `auto_categorizado`, os dois meses mais
        // recentes apareciam zerados — justamente os que interessam para
        // projetar o próximo. Auto-categorizado já TEM categoria: o que falta é
        // o olho humano, e o `AvisoRevisao` logo acima diz quantos são.

      if (error) {
        toast({ title: 'Erro', description: String((error as { message?: string }).message ?? error), variant: 'destructive' });
        return;
      }

      const map = new Map<string, number>();
      const mapSociosPos = new Map<string, number>();
      const mapSociosNeg = new Map<string, number>();
      let semCat = 0;

      for (const row of data ?? []) {
        const cat = row.categoria ?? '__sem__';
        if (cat === '__sem__') { semCat += row.valor; continue; }
        if (SOCIOS.includes(cat)) {
          if (row.valor >= 0) mapSociosPos.set(cat, (mapSociosPos.get(cat) ?? 0) + row.valor);
          else                mapSociosNeg.set(cat, (mapSociosNeg.get(cat) ?? 0) + row.valor);
        } else {
          map.set(cat, (map.get(cat) ?? 0) + row.valor);
        }
      }

      setTotais(Array.from(map.entries()).map(([categoria, total]) => ({ categoria, total })));
      setTotaisSociosPos(Array.from(mapSociosPos.entries()).map(([categoria, total]) => ({ categoria, total })));
      setTotaisSociosNeg(Array.from(mapSociosNeg.entries()).map(([categoria, total]) => ({ categoria, total })));
      setSemCategoria(semCat);
    }
    load();
  }, [dataInicio, dataFim, SOCIOS, empresaId]);


  // ── KPIs ──
  const totalReceitas = totais
    .filter(t => t.categoria && RECEITAS.includes(t.categoria) && t.total > 0)
    .reduce((a, t) => a + t.total, 0);

  // Mesma regra aberta do Fechamento: toda saida e custo, menos socio e
  // reserva. A lista fechada deixava sumir saida em categoria de receita.
  const totalCustos = totais
    .filter(t => ehCustoOperacional({ valor: t.total, categoria: t.categoria }))
    .reduce((a, t) => a + t.total, 0);

  const totalSociosRetiradas = totaisSociosNeg.reduce((a, t) => a + t.total, 0);
  const totalSociosAportes   = totaisSociosPos.reduce((a, t) => a + t.total, 0);

  const totalReserva = totais
    .filter(t => t.categoria && RESERVA_CAT.includes(t.categoria))
    .reduce((a, t) => a + t.total, 0);

  const resultadoOperacional = totalReceitas + totalCustos;
  const resultadoLiquido     = resultadoOperacional + totalSociosRetiradas;
  const posicaoCaixa         = resultadoLiquido + totalSociosAportes + totalReserva;

  return (
    <DashboardLayout title="Caixa" hideFilters hideTitle>
      <FinanceiroNav />

      {/* O DRE só conta o que passou por olho humano — `confirmado` e
          `revisado`. O que ficou de fora precisa aparecer, senão o mês parece
          menor do que foi e ninguém sabe por quê. */}
      <AvisoRevisao inicio={dataInicio} fim={dataFim} modo="inclui" />

      {/* Cabeçalho */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={voltar}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-lg font-semibold w-36 text-center">{labelPeriodo(ano, mes, ytd)}</span>
          <Button variant="ghost" size="icon" onClick={avancar}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <button
          onClick={() => setYtd(v => !v)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {ytd ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4" />}
          Acumulado (YTD)
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Receitas', valor: totalReceitas, icon: TrendingUp, cor: 'text-green-400' },
          { label: 'Despesas', valor: totalCustos, icon: TrendingDown, cor: 'text-red-400' },
          { label: 'Resultado Líquido', valor: resultadoLiquido, icon: Wallet, cor: resultadoLiquido >= 0 ? 'text-green-400' : 'text-red-400' },
          /* Era "Saldo da Reserva", deduzido do extrato da Conta Simples — dizia
             R$ 33.881,27 quando C6 e Inter somados tinham R$ 28.692,61. Agora e a
             soma dos saldos das contas de tipo `caixa`, medidos. */
          /* O rotulo NAO lista os bancos: a soma e por `tipo`, e uma lista escrita
             aqui envelheceria na primeira conta nova — foi o que aconteceu quando
             a garantia do C6 e os fundos do Inter entraram e o rotulo continuou
             dizendo 'C6 + Inter'. Quais contas somam esta ali embaixo. */
          { label: 'Caixa', valor: saldos.caixa, icon: PiggyBank, cor: 'text-blue-400' },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{k.label}</span>
              <k.icon className={cn('h-4 w-4', k.cor)} />
            </div>
            <div className={cn('text-xl font-bold tabular-nums', k.cor)}>
              {formatCurrency(k.valor)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* DRE */}
        <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
            Demonstrativo de Resultado — {labelPeriodo(ano, mes, ytd)}
          </h2>
          <table className="w-full">
            <tbody>
              <LinhasDRE label="Receitas" totais={totais.map(t => ({ ...t, total: t.total > 0 && t.categoria && RECEITAS.includes(t.categoria) ? t.total : 0 }))} cats={RECEITAS} cor="text-green-400" />
              <LinhaTotalDRE label="= Total Receitas" valor={totalReceitas} />

              <LinhasDRE label="Despesas Operacionais" totais={totais.map(t => ({ ...t, total: t.total < 0 && t.categoria && CUSTOS_OPERACIONAIS.includes(t.categoria) ? t.total : 0 }))} cats={CUSTOS_OPERACIONAIS} cor="text-red-400" />
              <LinhaTotalDRE label="= Resultado Operacional" valor={resultadoOperacional} />

              <LinhasDRE label="Distribuição aos Sócios" totais={totaisSociosNeg} cats={SOCIOS} cor="text-orange-400" />
              <LinhaTotalDRE label="= Resultado Líquido" valor={resultadoLiquido} destaque />

              <LinhasDRE label="Aportes de Sócios" totais={totaisSociosPos} cats={SOCIOS} cor="text-blue-400" />
              <LinhasDRE label="Movimentos de Reserva" totais={totais} cats={RESERVA_CAT} />
              <LinhaTotalDRE label="= Posição de Caixa do Período" valor={posicaoCaixa} destaque />

              {semCategoria !== 0 && (
                <>
                  <tr><td colSpan={2} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-yellow-400">Sem Categoria</td></tr>
                  <tr>
                    <td className="py-1 pl-4 text-sm text-yellow-400">Transações não categorizadas</td>
                    <td className={cn('py-1 text-right text-sm tabular-nums', semCategoria >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {formatCurrency(semCategoria)}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Onde o dinheiro está.
            Substituiu o bloco "Reserva de Caixa", que sabia de um saldo só por
            empresa e o DEDUZIA do extrato da Conta Simples. Com C6 e Inter, o
            saldo de um banco passaria a depender do extrato de outro — e a
            dedução já errava: dizia R$ 33.881,27 contra R$ 28.692,61 reais. */}
        <SaldosDasContas aoTotalizar={setSaldos} />
      </div>

      {/* Só o que olha para frente. O mapa de custos e o previsto x realizado
          foram para a aba Gastos: esta tela tinha seis blocos e nenhum deles
          respondia direito. Aqui a pergunta é uma só — quanto temos e quanto
          ainda sai. */}
      <div className="mt-6">
        <RecorrentesAVencer ano={ano} mes={mes} />
      </div>

    </DashboardLayout>
  );
}
