import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { FASES_MAP } from '@/features/producao/components/constants';
import { cn } from '@/lib/utils';
import { AlertaDefasagem } from './AlertaDefasagem';
import {
  Defasagem, Lote, DIAS_PARA_VELHO, FAMILIA_LABEL, rotuloDoAd, rotuloDeDias,
} from './tipos';

/**
 * Quanto o Copy tem de estoque, por projeto, separado entre novo e variação.
 *
 * Somente leitura, de propósito. Editar card continua na Produção — dois
 * caminhos de escrita sobre `producoes` divergiriam, e é literalmente a
 * primeira armadilha do CLAUDE.md. Cada lote leva ao card lá.
 */
export function EsteiraTab({ defasagem, carregandoDefasagem }: {
  defasagem: Defasagem[];
  carregandoDefasagem: boolean;
}) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [projeto, setProjeto] = useState<string>('todos');
  const [familia, setFamilia] = useState<string>('todas');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase
      .from('vw_esteira_lotes')
      .select('*')
      .eq('projeto_ativo', true)
      .order('projeto', { ascending: true })
      .order('ad_num', { ascending: false });
    if (error) { setErro(error.message); setCarregando(false); return; }
    setLotes((data ?? []) as unknown as Lote[]);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const projetos = useMemo(() => {
    const s = new Set(lotes.map(l => l.projeto).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [lotes]);

  const visiveis = useMemo(() => lotes.filter(l =>
    (projeto === 'todos' || l.projeto === projeto) &&
    (familia === 'todas' || l.familia === familia)
  ), [lotes, projeto, familia]);

  const resumo = useMemo(() => {
    const conta = (f: string) => {
      const ls = visiveis.filter(l => l.familia === f);
      return {
        lotes: ls.length,
        cards: ls.reduce((s, l) => s + l.cards, 0),
        velhos: ls.filter(l => (l.dias_parado ?? 0) >= DIAS_PARA_VELHO).length,
      };
    };
    const naoClassificados = visiveis.filter(l => l.familia === 'sem_tipo' || l.familia === 'outro');
    return { novo: conta('novo'), variacao: conta('variacao'), naoClassificados };
  }, [visiveis]);

  return (
    <div className="space-y-4">
      {carregandoDefasagem
        ? <div className="h-16 animate-pulse rounded-lg border border-border bg-card" />
        : <AlertaDefasagem linhas={defasagem} />}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CartaoResumo titulo="Novo" ajuda="Novo · Iteração" {...resumo.novo} />
        <CartaoResumo titulo="Variação" ajuda="Vertical · Horizontal · Formato · Corpo" {...resumo.variacao} />
      </div>

      {/*
        Só aparece quando há o que mostrar — um cartão permanente para dizer que
        não há nada gasta um terço da largura com silêncio. Ele existe para um
        `tipo_teste` novo APARECER em vez de sumir da conta: a família sai da
        tabela `criativo_tipos_teste`, e o que não estiver lá cai aqui.
      */}
      {resumo.naoClassificados.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90">
          {resumo.naoClassificados.length} lote(s) com tipo de teste que o painel não conhece:{' '}
          <span className="font-medium">
            {Array.from(new Set(resumo.naoClassificados.map(l => l.tipo_teste ?? 'vazio'))).join(', ')}
          </span>
          . Cadastre em <code className="rounded bg-secondary px-1">criativo_tipos_teste</code> para entrar na conta.
        </div>
      )}

      {/*
        Dois controles diferentes, dois formatos diferentes. Quando os chips de
        família ficavam na mesma linha dos de projeto, a fila quebrava e os seis
        liam como um grupo só — dava para "desmarcar" o projeto clicando em
        "Só novo". O segmentado deixa claro que é outra pergunta.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip ativo={projeto === 'todos'} onClick={() => setProjeto('todos')}>Todos os projetos</Chip>
          {projetos.map(p => (
            <Chip key={p} ativo={projeto === p} onClick={() => setProjeto(p)}>{p}</Chip>
          ))}
        </div>
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
          {([['todas', 'Ambos'], ['novo', 'Novo'], ['variacao', 'Variação']] as const).map(([k, r]) => (
            <button key={k} onClick={() => setFamilia(k)}
                    className={cn('px-2.5 py-1 text-[11px] transition-colors',
                      familia === k ? 'bg-primary text-primary-foreground'
                                    : 'bg-secondary text-muted-foreground hover:text-foreground')}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {erro ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-center text-sm text-destructive-foreground">
          Não foi possível carregar a esteira: {erro}
          <button onClick={() => void carregar()} className="ml-2 underline underline-offset-2">tentar de novo</button>
        </div>
      ) : carregando ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando a esteira…
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {lotes.length === 0
            ? 'Nenhum criativo em produção nos projetos ativos.'
            : 'Nenhum lote com esses filtros.'}
        </div>
      ) : (
        <Tabela lotes={visiveis} agrupar={projeto === 'todos'} />
      )}
    </div>
  );
}

function CartaoResumo({ titulo, ajuda, lotes, cards, velhos }: {
  titulo: string; ajuda: string; lotes: number; cards: number; velhos: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{titulo}</span>
        <span className="text-[10px] text-muted-foreground/60">{ajuda}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={cn('text-2xl font-semibold tabular-nums',
          lotes === 0 ? 'text-red-400' : 'text-foreground')}>
          {lotes}
        </span>
        <span className="text-xs text-muted-foreground">{lotes === 1 ? 'AD' : 'ADs'}</span>
        <span className="text-[11px] text-muted-foreground/60">· {cards} cards</span>
      </div>
      {velhos > 0 && (
        /*
          O estoque foi definido sem janela de tempo, então um lote esquecido
          conta para sempre. Esta linha não muda a conta — só impede que ela
          engane.
        */
        <p className="mt-1 text-[11px] text-amber-300/90">
          {velhos} parado(s) há mais de {DIAS_PARA_VELHO} dias
        </p>
      )}
    </div>
  );
}

function Tabela({ lotes, agrupar }: { lotes: Lote[]; agrupar: boolean }) {
  const grupos = useMemo(() => {
    if (!agrupar) return [{ chave: '', itens: lotes }];
    const mapa = new Map<string, Lote[]>();
    for (const l of lotes) {
      const k = l.projeto ?? '(sem projeto)';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k)!.push(l);
    }
    return Array.from(mapa, ([chave, itens]) => ({ chave, itens }));
  }, [lotes, agrupar]);

  return (
    <div className="max-h-[65vh] overflow-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20 border-b border-border bg-secondary text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">AD</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tipo</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Funil</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Hooks</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Fase</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Parado</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map(g => (
            <Fragment key={g.chave}>
              {agrupar && (
                <tr className="border-b border-border/60 bg-secondary/20">
                  <td colSpan={6} className="px-3 py-1.5 text-xs font-medium text-foreground">
                    {g.chave}
                    <span className="ml-2 font-normal text-muted-foreground/60">
                      {g.itens.length} {g.itens.length === 1 ? 'AD' : 'ADs'}
                    </span>
                  </td>
                </tr>
              )}
              {g.itens.map(l => <LinhaLote key={`${l.projeto_id}-${l.ad_num}-${l.tipo_teste}`} l={l} />)}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinhaLote({ l }: { l: Lote }) {
  const velho = (l.dias_parado ?? 0) >= DIAS_PARA_VELHO;
  const parcial = l.hooks < l.hooks_totais;

  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="px-3 py-1.5 font-medium tabular-nums text-foreground">{rotuloDoAd(l.ad_num)}</td>
      <td className="px-3 py-1.5">
        <span className={cn('rounded px-1.5 py-px text-[10px]',
          l.familia === 'novo'     ? 'bg-primary/15 text-primary'
        : l.familia === 'variacao' ? 'bg-blue-500/15 text-blue-400'
        :                            'bg-amber-500/15 text-amber-400')}>
          {l.tipo_teste ?? FAMILIA_LABEL[l.familia] ?? '—'}
        </span>
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">
        {l.funil ?? <span className="text-muted-foreground/40">não informado</span>}
      </td>
      <td className="px-3 py-1.5 text-right text-xs tabular-nums">
        {/*
          `2 de 5` e não `2`: um lote entra na esteira com UM hook pronto, e sem
          o denominador "AD 052" leria como pronto quando três quintos dele
          ainda nem existem.
        */}
        <span className={parcial ? 'text-amber-300/90' : 'text-muted-foreground'}>
          {l.hooks} de {l.hooks_totais}
        </span>
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">
        {FASES_MAP[l.fase] ?? l.fase}
        {l.fases.length > 1 && (
          <span className="ml-1 text-muted-foreground/50"
                title={l.fases.map(f => FASES_MAP[f] ?? f).join(' · ')}>
            +{l.fases.length - 1}
          </span>
        )}
      </td>
      <td className={cn('px-3 py-1.5 text-right text-xs tabular-nums',
        velho ? 'text-amber-300/90' : 'text-muted-foreground')}>
        {rotuloDeDias(l.dias_parado)}
      </td>
    </tr>
  );
}

function Chip({ ativo, onClick, children }: {
  ativo: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
            className={cn('rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              ativo ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-secondary text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  );
}
