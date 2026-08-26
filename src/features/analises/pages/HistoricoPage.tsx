import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Lock, PenLine } from 'lucide-react';
import { AnalisesNav } from '../components/AnalisesNav';
import { AcaoEditavel } from '../components/AcaoEditavel';
import { MetricasDoRev } from '../metricas';
import { RetencaoVsl } from '../retencao';
import { formatarData } from '../periodo';
import { exportarVarias, RodadaParaExportar } from '../exportar';

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
  analise_id: string;
  metricas: MetricasDoRev | null;
  retencao: RetencaoVsl | null;
  criado_em: string;
}

interface Rodada {
  id: string;
  data: string;
  fechada_em: string | null;
  observacoes: string | null;
  analise_itens: ItemHistorico[];
}

/** O que ficou decidido, e se já foi feito. Marcar acontece na Rodada. */
export interface AcaoHistorico {
  id: string;
  analise_id: string | null;
  funil_id: string;
  texto: string;
  expectativa: string | null;
  feita: boolean;
  feita_em: string | null;
  feita_por_nome: string | null;
}

const TODOS = '_todos_';

export default function HistoricoPage() {
  const { user } = useAuth();
  const confirmar = useConfirm();
  const [rodadas, setRodadas] = useState<Rodada[]>([]);
  const [revs, setRevs]       = useState<Record<string, string>>({});
  // Dados crus do REV, para o espelho: o mapa acima guarda só o nome formatado.
  const [revsInfo, setRevsInfo] = useState<Record<string, { rev: string; projeto: string | null; metodo: string | null }>>({});
  const [acoes, setAcoes]     = useState<AcaoHistorico[]>([]);
  const [filtro, setFiltro]   = useState<string>(TODOS);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const [{ data: rodadasData, error }, { data: revsData }, { data: metodosData }, { data: acoesData }] = await Promise.all([
      supabase
        .from('analises')
        .select('id,data,fechada_em,observacoes,analise_itens(id,analise_id,funil_id,leitura,metricas,retencao,criado_em)')
        .order('data', { ascending: false })
        .limit(50),
      // O nome do REV não fica no item: guardar o nome junto seria um segundo
      // campo dizendo o que `funis.nome` já diz, e os dois divergiriam no dia
      // em que alguém renomeasse o REV.
      supabase.from('vw_mapa_revs').select('id,rev,projeto'),
      supabase.from('funis').select('id,metodo'),
      supabase.from('analise_acoes')
        .select('id,analise_id,funil_id,texto,expectativa,feita,feita_em,perfis:feita_por(nome)')
        .order('criada_em'),
    ]);

    if (error) {
      toast({ title: 'Erro ao carregar o histórico', description: error.message, variant: 'destructive' });
    }
    const listaRodadas = (rodadasData ?? []) as unknown as Rodada[];
    setRodadas(listaRodadas);

    // `perfis` chega como objeto ou array conforme o PostgREST resolve a
    // relação; normalizar aqui evita o nome sumir sem erro nenhum.
    const listaAcoes = ((acoesData ?? []) as unknown as Array<AcaoHistorico & {
      perfis: { nome: string | null } | { nome: string | null }[] | null;
    }>).map(a => ({
      ...a,
      feita_por_nome: (Array.isArray(a.perfis) ? a.perfis[0] : a.perfis)?.nome ?? null,
    }));
    setAcoes(listaAcoes);

    const metodoPor = Object.fromEntries(
      ((metodosData ?? []) as Array<{ id: string; metodo: string | null }>)
        .map(f => [f.id, f.metodo]),
    );
    const brutos = (revsData ?? []) as Array<{ id: string; rev: string; projeto: string | null }>;
    setRevs(Object.fromEntries(
      brutos.map(r => [r.id, r.projeto ? `${r.projeto} · ${r.rev}` : r.rev]),
    ));
    setRevsInfo(Object.fromEntries(
      brutos.map(r => [r.id, { rev: r.rev, projeto: r.projeto, metodo: metodoPor[r.id] ?? null }]),
    ));

    setCarregando(false);
    // Devolve o que carregou porque quem marca uma ação precisa espelhar a
    // versão recém-lida, e o estado só chega no render seguinte.
    return { rodadas: listaRodadas, acoes: listaAcoes };
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /**
   * Reespelha no Obsidian e na planilha o que mudou aqui.
   *
   * Sem isto, corrigir uma ação no Histórico deixava as duas pontas com a
   * versão velha — e registro que só se corrige num dos três lugares é pior
   * que registro que não se corrige, porque passam a se contradizer.
   *
   * Remonta a partir do que a tela já tem em mãos: o retrato gravado no item é
   * a fonte, e não um recálculo, para a nota continuar contando a história do
   * dia em que a decisão foi tomada.
   */
  const espelharAfetadas = useCallback((
    listaAcoes: AcaoHistorico[], rodadasAtuais = rodadas,
  ) => {
    const pacotes: RodadaParaExportar[] = [];
    for (const rodada of rodadasAtuais) {
      const daRodada = listaAcoes.filter(a => a.analise_id === rodada.id);
      const ids = [...new Set([
        ...rodada.analise_itens.map(i => i.funil_id),
        ...daRodada.map(a => a.funil_id),
      ])];
      for (const funilId of ids) {
        const item = rodada.analise_itens.find(i => i.funil_id === funilId) ?? null;
        const rev = revsInfo[funilId];
        if (!rev) continue;
        pacotes.push({
          dataRodada: rodada.data,
          projeto: rev.projeto, rev: rev.rev, metodo: rev.metodo,
          metricas: item?.metricas ?? null,
          retencao: item?.retencao ?? null,
          leitura: item?.leitura ?? '',
          acoes: daRodada.filter(a => a.funil_id === funilId).map(a => ({
            texto: a.texto, expectativa: a.expectativa, feita: a.feita,
            feita_em: a.feita_em, feita_por_nome: a.feita_por_nome,
          })),
        });
      }
    }
    if (pacotes.length > 0) exportarVarias(pacotes);
  }, [rodadas, revsInfo]);

  /**
   * Editar aqui e não só na Rodada, porque é aqui que se relê.
   *
   * O que NÃO se edita é o carimbo de quando e por quem: é registro do que
   * aconteceu, não opinião sobre isso. Desmarcar e marcar de novo refaz o
   * carimbo, pelo gatilho no banco.
   */
  async function salvarAcao(id: string, texto: string, expectativa: string | null) {
    const { error } = await supabase.from('analise_acoes')
      .update({ texto, expectativa }).eq('id', id);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    const lista = acoes.map(a => (a.id === id ? { ...a, texto, expectativa } : a));
    setAcoes(lista);
    espelharAfetadas(lista);
  }

  async function marcarAcao(id: string, feita: boolean) {
    const { error } = await supabase.from('analise_acoes')
      .update({ feita, feita_por: feita ? user?.id ?? null : null }).eq('id', id);
    if (error) {
      toast({ title: 'Erro ao marcar', description: error.message, variant: 'destructive' });
      return;
    }
    // Recarrega em vez de adivinhar: o carimbo é feito pelo gatilho no banco.
    const { rodadas: rs, acoes: as } = await carregar();
    espelharAfetadas(as, rs);
  }

  async function apagarAcao(id: string) {
    const ok = await confirmar({
      title: 'Apagar esta ação?',
      description: 'A decisão some do histórico e não volta.',
      confirmText: 'Apagar',
    });
    if (!ok) return;
    const { error } = await supabase.from('analise_acoes').delete().eq('id', id);
    if (error) {
      toast({ title: 'Erro ao apagar', description: error.message, variant: 'destructive' });
      return;
    }
    const lista = acoes.filter(a => a.id !== id);
    setAcoes(lista);
    espelharAfetadas(lista);
  }


  const revsComAnalise = useMemo(() => {
    const ids = new Set([
      ...rodadas.flatMap(r => r.analise_itens.map(i => i.funil_id)),
      ...acoes.map(a => a.funil_id),
    ]);
    return [...ids].map(id => ({ id, nome: revs[id] ?? 'REV removido' }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [rodadas, acoes, revs]);

  /**
   * Um cartão por REV tocado na rodada — e "tocado" inclui REV que só ganhou
   * ação, sem leitura escrita.
   *
   * A primeira versão listava só `analise_itens`, e uma rodada onde ela decidiu
   * três coisas sem escrever análise nenhuma desaparecia inteira do histórico.
   * Perder a decisão é pior que perder a leitura: é a decisão que precisa ser
   * cobrada depois.
   */
  const visiveis = useMemo(() => rodadas
    .map(rodada => {
      const daRodada = acoes.filter(a => a.analise_id === rodada.id);
      const ids = [...new Set([
        ...rodada.analise_itens.map(i => i.funil_id),
        ...daRodada.map(a => a.funil_id),
      ])].filter(id => filtro === TODOS || id === filtro);

      return {
        ...rodada,
        cartoes: ids.map(funilId => ({
          funilId,
          item: rodada.analise_itens.find(i => i.funil_id === funilId) ?? null,
          acoes: daRodada.filter(a => a.funil_id === funilId),
        })),
      };
    })
    // Rodada que ficou sem nada depois do filtro não vira cartão vazio.
    .filter(r => r.cartoes.length > 0),
  [rodadas, acoes, filtro]);

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
                  {rodada.cartoes.length === 1 ? '1 REV' : `${rodada.cartoes.length} REVs`}
                </span>
              </div>

              <div className="space-y-2">
                {rodada.cartoes.map(c => (
                  <ItemDaRodada
                    key={c.funilId} item={c.item} acoes={c.acoes}
                    nome={revs[c.funilId] ?? 'REV removido'}
                    onSalvar={salvarAcao} onMarcar={marcarAcao} onApagar={apagarAcao}
                  />
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
function ItemDaRodada(
  { item, nome, acoes, onSalvar, onMarcar, onApagar }: {
    item: ItemHistorico | null; nome: string; acoes: AcaoHistorico[];
    onSalvar: (id: string, texto: string, expectativa: string | null) => Promise<void>;
    onMarcar: (id: string, feita: boolean) => Promise<void>;
    onApagar: (id: string) => Promise<void>;
  },
) {
  const m = item?.metricas?.atual;
  const janela = item?.metricas?.inicio && item.metricas?.fim
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

      {item?.leitura && (
        <p className="text-sm whitespace-pre-wrap">{item.leitura}</p>
      )}

      {acoes.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-border/40">
          {acoes.map(ac => (
            <AcaoEditavel
              key={ac.id} acao={ac}
              onSalvar={onSalvar} onMarcar={onMarcar} onApagar={onApagar}
            />
          ))}
        </div>
      )}
    </article>
  );
}
