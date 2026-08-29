import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
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
import { ehCustoOperacional } from '@/features/financeiro/constants';
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
            {l.val < 0 ? `(${formatCurrency(Math.abs(l.val))})` : formatCurrency(l.val)}
          </td>
        </tr>
      ))}
      <tr className="border-t border-white/10">
        <td className={cn('py-1.5 pl-2 text-sm font-semibold', cor)}>Total {label}</td>
        <td className={cn('py-1.5 text-right text-sm font-semibold tabular-nums', cor ?? (soma >= 0 ? 'text-green-400' : 'text-red-400'))}>
          {soma < 0 ? `(${formatCurrency(Math.abs(soma))})` : formatCurrency(soma)}
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
        {valor < 0 ? `(${formatCurrency(Math.abs(valor))})` : formatCurrency(valor)}
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
  const [config, setConfig] = useState<CaixaConfig | null>(null);
  const [movimentos, setMovimentos] = useState<MovimentoReserva[]>([]);
  const [plano, setPlano] = useState<Conta[]>([]);

  const [editando, setEditando] = useState(false);
  const [novoSaldo, setNovoSaldo] = useState('');
  const [novaData, setNovaData] = useState('');

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
  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('transacoes')
        .select('categoria, valor')
        .gte('data', dataInicio)
        .lte('data', dataFim);
        // Conta também o que foi auto-categorizado. Antes esta tela exigia
        // `confirmado`/`revisado`, e como julho e agosto inteiros (440
        // lançamentos) estavam em `auto_categorizado`, os dois meses mais
        // recentes apareciam zerados — justamente os que interessam para
        // projetar o próximo. Auto-categorizado já TEM categoria: o que falta é
        // o olho humano, e o `AvisoRevisao` logo acima diz quantos são.

      if (error) { toast({ title: 'Erro', description: error.message, variant: 'destructive' }); return; }

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
  }, [dataInicio, dataFim, SOCIOS]);

  // ── Buscar config da reserva e movimentos históricos ──
  useEffect(() => {
    async function load() {
      const { data: cfg } = await supabase.from('caixa_config').select('*').limit(1).single();
      if (cfg) setConfig(cfg as CaixaConfig);

      // Sem filtro de status, igual ao resto da tela. O que importa é que seja
      // a MESMA regra em todo lugar: quando esta seção e o DRE usavam critérios
      // diferentes, em 24/08 o DRE mostrava R$ 0,00 enquanto a reserva mostrava
      // −R$ 1.559,21 com movimentos de agosto, e nada na tela explicava por quê.
      // As DUAS pontas do movimento, não só a ida.
      //
      // Era `.eq('categoria', 'Reserva de Caixa')`, que pega apenas o dinheiro
      // saindo da conta para a reserva. As voltas — "Retirada do Caixa" — não
      // entravam, então a lista só tinha negativos e o saldo da reserva ficava
      // maior do que é: somava tudo que entrou e nada do que saiu de lá.
      //
      // O filtro vem do plano de contas: toda categoria de tipo `reserva`.
      // Categoria nova de reserva criada no campo entra sozinha.
      const cats = plano.filter(c => c.tipo === 'reserva').map(c => c.categoria);
      if (cats.length === 0) return;

      const { data: mov } = await supabase
        .from('transacoes')
        .select('id, data, descricao, valor')
        .in('categoria', cats)
        .order('data', { ascending: false });

      setMovimentos((mov ?? []) as MovimentoReserva[]);
    }
    load();
  }, [plano]);

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

  // ── Saldo da reserva ──
  // ── Saldo da reserva ──
  //
  // Só os movimentos POSTERIORES à data de referência.
  //
  // O saldo base é uma foto: "em 25/08 a reserva tinha R$ 32.381,27". Os
  // movimentos anteriores a essa data são justamente o que PRODUZIU esse
  // número — somá-los de novo conta a mesma coisa duas vezes.
  //
  // Era `movimentos.reduce(...)` sobre a lista inteira, e o efeito aparecia na
  // cara: ela informava o saldo real de hoje e a tela devolvia R$ 2.559,21 a
  // menos, descontando aportes de janeiro que já estavam embutidos na foto.
  /*
    O SINAL VISTO PELA RESERVA É O INVERSO DO VISTO PELA CONTA.

    `transacoes.valor` é sempre do ponto de vista da conta operacional, porque é
    de lá que o extrato vem. Uma transferência de R$ 1.500 para a reserva é
    −1.500 no extrato: saiu de lá. Mas ela ENTROU aqui.

    A tela somava esse −1.500 ao saldo base e mostrava a reserva encolhendo
    quando ela tinha acabado de crescer — erro de R$ 3.000 no caso dela, o dobro
    do movimento, porque subtrai o que devia somar.

    Confere nos dois sentidos, e é a mesma inversão:

      "Reserva de Caixa"    16 movimentos, todos negativos (−R$ 36.000)
                            dinheiro saindo da conta PARA a reserva → entra aqui
      "Retirada do Caixa"   15 movimentos, todos positivos (+R$ 31.940,79)
                            dinheiro voltando da reserva PARA a conta → sai daqui

    O dado não muda: continua sendo uma saída da conta operacional, e é assim
    que o DRE e o resto da tela devem tratá-lo. O que muda é só o ponto de vista
    deste bloco, que é o da reserva.
  */
  const paraAReserva = (valorNaConta: number) => -valorNaConta;

  const movHistorico = movimentos
    .filter(m => !config?.data_referencia || m.data > config.data_referencia)
    .reduce((a, m) => a + paraAReserva(m.valor), 0);
  const saldoReserva = (config?.saldo_inicial ?? 0) + movHistorico;

  // ── Salvar config ──
  async function salvarConfig() {
    if (!config) return;
    const val = parseFloat(novoSaldo.replace(',', '.'));
    if (isNaN(val)) return;

    // O `.select()` devolve as linhas afetadas. Sem ele, um UPDATE barrado por RLS
    // retorna 200 com zero linhas e o código dá sucesso sobre nada.
    const { data, error } = await supabase
      .from('caixa_config')
      .update({ saldo_inicial: val, data_referencia: novaData || config.data_referencia, updated_at: new Date().toISOString() })
      .eq('id', config.id)
      .select('id');

    if (error) { toast({ title: 'Erro', description: error.message, variant: 'destructive' }); return; }
    if (!data || data.length === 0) {
      toast({ title: 'Nada foi salvo', description: 'Nenhuma linha alterada — verifique permissão.', variant: 'destructive' });
      return;
    }
    setConfig(c => c ? { ...c, saldo_inicial: val, data_referencia: novaData || c.data_referencia } : c);
    setEditando(false);
    toast({ title: 'Reserva atualizada' });
  }

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
          { label: 'Saldo da Reserva', valor: saldoReserva, icon: PiggyBank, cor: 'text-blue-400' },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{k.label}</span>
              <k.icon className={cn('h-4 w-4', k.cor)} />
            </div>
            <div className={cn('text-xl font-bold tabular-nums', k.cor)}>
              {k.valor < 0 ? `(${formatCurrency(Math.abs(k.valor))})` : formatCurrency(k.valor)}
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
                      {semCategoria < 0 ? `(${formatCurrency(Math.abs(semCategoria))})` : formatCurrency(semCategoria)}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Reserva de Caixa */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Reserva de Caixa</h2>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                setNovoSaldo(String(config?.saldo_inicial ?? 0));
                setNovaData(config?.data_referencia ?? '');
                setEditando(true);
              }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Saldo base ({config?.data_referencia ?? '—'})</span>
                <span className="tabular-nums">{formatCurrency(config?.saldo_inicial ?? 0)}</span>
              </div>
              {/* "Movimentos históricos" dizia que somava tudo, e era isso que
                  fazia — inclusive o que já estava dentro do saldo base. O
                  rótulo agora nomeia o recorte, para ninguém precisar adivinhar
                  de onde sai o número. */}
              <div className="flex justify-between text-muted-foreground">
                <span>Movimentos desde então</span>
                <span className={cn('tabular-nums', movHistorico >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {movHistorico < 0 ? `(${formatCurrency(Math.abs(movHistorico))})` : `+${formatCurrency(movHistorico)}`}
                </span>
              </div>
              <div className="flex justify-between font-bold border-t border-border pt-2">
                <span>Saldo atual</span>
                <span className={cn('tabular-nums text-blue-400 text-base')}>{formatCurrency(saldoReserva)}</span>
              </div>
            </div>
          </div>

          {/* Histórico de movimentos da reserva */}
          <div className="bg-card border border-border rounded-lg p-5">
            {/* O rótulo diz de quem é o sinal. Sem isso, quem cruzar esta lista
                com o extrato vai achar que uma das duas está errada — as duas
                estão certas, olhando de lados opostos do mesmo movimento. */}
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Movimentos da Reserva</h2>
            <p className="mb-3 text-[11px] normal-case tracking-normal text-muted-foreground/60">
              Do ponto de vista da reserva: <span className="text-green-400">+</span> é dinheiro que
              entrou nela, e no extrato da conta aparece como saída.
            </p>
            {movimentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum movimento.</p>
            ) : (
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {movimentos.map(m => {
                  /*
                    A lista fala pela reserva, igual ao saldo acima dela.

                    Mostrava todos os aportes em vermelho e entre parênteses —
                    dinheiro ENTRANDO na reserva pintado como perda, e a soma
                    logo acima dizendo o contrário do que a lista dizia. Duas
                    leituras do mesmo movimento na mesma tela.
                  */
                  const v = paraAReserva(m.valor);
                  return (
                    <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                      <div>
                        <div className="text-xs text-muted-foreground">{m.data}</div>
                        <div className="text-sm">{m.descricao}</div>
                      </div>
                      <span className={cn('text-sm font-medium tabular-nums', v >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {v < 0 ? `(${formatCurrency(Math.abs(v))})` : `+${formatCurrency(v)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Só o que olha para frente. O mapa de custos e o previsto x realizado
          foram para a aba Gastos: esta tela tinha seis blocos e nenhum deles
          respondia direito. Aqui a pergunta é uma só — quanto temos e quanto
          ainda sai. */}
      <div className="mt-6">
        <RecorrentesAVencer ano={ano} mes={mes} />
      </div>

      {/* Modal editar saldo base */}
      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogContent>
          <DialogHeader><DialogTitle>Atualizar Saldo Base da Reserva</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Saldo atual da reserva (R$)</Label>
              <Input
                value={novoSaldo}
                onChange={e => setNovoSaldo(e.target.value)}
                placeholder="0,00"
                type="number"
                step="0.01"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data de referência</Label>
              <Input
                value={novaData}
                onChange={e => setNovaData(e.target.value)}
                type="date"
              />
              <p className="text-xs text-muted-foreground">
                Os movimentos ALASKAN ACADEMY após esta data são somados automaticamente.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(false)}>Cancelar</Button>
            <Button onClick={salvarConfig}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
