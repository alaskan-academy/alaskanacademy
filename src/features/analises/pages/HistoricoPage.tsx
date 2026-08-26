import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Lock, PenLine, ArrowRight } from 'lucide-react';
import { AnalisesNav } from '../components/AnalisesNav';
import { MetricasDoRev } from '../metricas';
import { formatarData } from '../periodo';

/**
 * Onde a leitura escrita na rodada vai parar.
 *
 * É a metade que faltava do módulo. A armadilha nº 2 do CLAUDE.md — "criar sem
 * medir" — tem uma irmã: escrever sem reler. Uma tela que só recebe texto e
 * nunca o devolve produz o mesmo abandono do Google Chat, onde dá para ver que
 * alguém mudou o preço em 28/07 e nunca o que aconteceu depois.
 *
 * Cada item guarda o RETRATO das métricas do dia. Não recalculamos: a leitura
 * precisa continuar fazendo sentido ao lado dos números que a motivaram, mesmo
 * que uma venda seja recategorizada depois.
 */

interface ItemHistorico {
  id: string;
  funil_id: string;
  leitura: string | null;
  proximas_acoes: string | null;
  metricas: MetricasDoRev | null;
  criado_em: string;
}

interface Rodada {
  id: string;
  data: string;
  fechada_em: string | null;
  observacoes: string | null;
  analise_itens: ItemHistorico[];
}

const TODOS = '_todos_';

export default function HistoricoPage() {
  const [rodadas, setRodadas] = useState<Rodada[]>([]);
  const [revs, setRevs]       = useState<Record<string, string>>({});
  const [filtro, setFiltro]   = useState<string>(TODOS);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const [{ data: rodadasData, error }, { data: revsData }] = await Promise.all([
      supabase
        .from('analises')
        .select('id,data,fechada_em,observacoes,analise_itens(id,funil_id,leitura,proximas_acoes,metricas,criado_em)')
        .order('data', { ascending: false })
        .limit(50),
      // O nome do REV não fica no item: guardar o nome junto seria um segundo
      // campo dizendo o que `funis.nome` já diz, e os dois divergiriam no dia
      // em que alguém renomeasse o REV.
      supabase.from('vw_mapa_revs').select('id,rev,projeto'),
    ]);

    if (error) {
      toast({ title: 'Erro ao carregar o histórico', description: error.message, variant: 'destructive' });
    }
    setRodadas((rodadasData ?? []) as unknown as Rodada[]);
    setRevs(Object.fromEntries(
      ((revsData ?? []) as Array<{ id: string; rev: string; projeto: string | null }>)
        .map(r => [r.id, r.projeto ? `${r.projeto} · ${r.rev}` : r.rev]),
    ));
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const revsComAnalise = useMemo(() => {
    const ids = new Set(rodadas.flatMap(r => r.analise_itens.map(i => i.funil_id)));
    return [...ids].map(id => ({ id, nome: revs[id] ?? 'REV removido' }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [rodadas, revs]);

  const visiveis = useMemo(() => rodadas
    .map(r => ({
      ...r,
      analise_itens: filtro === TODOS
        ? r.analise_itens
        : r.analise_itens.filter(i => i.funil_id === filtro),
    }))
    // Rodada que ficou sem item depois do filtro não vira cartão vazio.
    .filter(r => r.analise_itens.length > 0),
  [rodadas, filtro]);

  return (
    <DashboardLayout title="Análises" hideFilters>
      <AnalisesNav />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtro} onValueChange={setFiltro}>
            <SelectTrigger className="h-9 w-72 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os REVs</SelectItem>
              {revsComAnalise.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {visiveis.length === 1 ? '1 rodada' : `${visiveis.length} rodadas`}
            {filtro !== TODOS && ' com este REV'}
          </span>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-32">
            <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : visiveis.length === 0 ? (
          <div className="py-20 text-center space-y-2">
            <p className="text-sm text-muted-foreground">Nenhuma leitura registrada ainda.</p>
            <p className="text-xs text-muted-foreground/70">
              O que você escrever na Rodada aparece aqui, com os números do dia ao lado.
            </p>
          </div>
        ) : (
          visiveis.map(rodada => (
            <section key={rodada.id} className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold">{formatarData(rodada.data)}</h2>
                <span className={cn(
                  'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border',
                  rodada.fechada_em
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30',
                )}>
                  {rodada.fechada_em ? <Lock className="h-3 w-3" /> : <PenLine className="h-3 w-3" />}
                  {rodada.fechada_em ? 'fechada' : 'em andamento'}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {rodada.analise_itens.length === 1
                    ? '1 REV' : `${rodada.analise_itens.length} REVs`}
                </span>
              </div>

              <div className="space-y-2">
                {rodada.analise_itens.map(item => (
                  <ItemDaRodada key={item.id} item={item} nome={revs[item.funil_id] ?? 'REV removido'} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}

/** Um REV dentro de uma rodada: o que ela leu, e os números que estavam na tela. */
function ItemDaRodada({ item, nome }: { item: ItemHistorico; nome: string }) {
  const m = item.metricas?.atual;
  const janela = item.metricas?.inicio && item.metricas?.fim
    ? `${formatarData(item.metricas.inicio)} a ${formatarData(item.metricas.fim)}`
    : null;

  return (
    <article className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-semibold">{nome}</span>
        {janela && <span className="text-[10px] text-muted-foreground">{janela}</span>}
      </div>

      {/* O retrato: os números como estavam quando a leitura foi escrita. */}
      {m && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
          <span>{formatNumber(m.vendas)} vendas</span>
          <span>{formatCurrency(m.faturamento)}</span>
          {m.roas != null && <span>ROAS {m.roas.toFixed(2)}</span>}
          {m.lucro_liquido != null && (
            <span className={m.lucro_liquido < 0 ? 'text-red-400' : 'text-emerald-400'}>
              lucro {formatCurrency(m.lucro_liquido)}
            </span>
          )}
          {m.cpa != null && <span>CPA {formatCurrency(m.cpa)}</span>}
          {m.conv_funil_pct != null && <span>conversão {m.conv_funil_pct.toFixed(2)}%</span>}
        </div>
      )}

      {item.leitura && (
        <p className="text-sm whitespace-pre-wrap">{item.leitura}</p>
      )}

      {item.proximas_acoes && (
        <p className="text-sm whitespace-pre-wrap flex gap-1.5">
          <ArrowRight className="h-3.5 w-3.5 mt-1 shrink-0 text-primary" />
          <span className="text-muted-foreground">{item.proximas_acoes}</span>
        </p>
      )}
    </article>
  );
}
