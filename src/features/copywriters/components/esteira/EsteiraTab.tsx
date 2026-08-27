import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { FASES_MAP } from '@/features/producao/components/constants';
import { MultiFilter } from '@/features/producao/components/MultiFilter';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

import { AlertaDefasagem } from './AlertaDefasagem';
import { FilaPedidos } from './FilaPedidos';
import {
  Defasagem, Lote, Familia, DIAS_PARA_VELHO, FAMILIA_LABEL,
  rotuloDoAd, rotuloDeDias,
} from './tipos';

/** As três famílias, na ordem em que a operação pensa nelas. */
const FAMILIAS: Familia[] = ['novo', 'iteracao', 'variacao'];

const FAMILIA_AJUDA: Record<string, string> = {
  novo:     'Novo',
  iteracao: 'Iteração',
  variacao: 'Vertical · Horizontal · Formato · Corpo',
};

const FAMILIA_COR: Record<string, string> = {
  novo:     'bg-primary',
  iteracao: 'bg-emerald-500',
  variacao: 'bg-blue-500',
};

const FAMILIA_SELO: Record<string, string> = {
  novo:     'bg-primary/15 text-primary',
  iteracao: 'bg-emerald-500/15 text-emerald-400',
  variacao: 'bg-blue-500/15 text-blue-400',
};

/**
 * Quanto o Copy tem de estoque, por projeto, separado entre novo, iteração e
 * variação.
 *
 * Somente leitura, de propósito. Editar card continua na Produção — dois
 * caminhos de escrita sobre `producoes` divergiriam, e é literalmente a
 * primeira armadilha do CLAUDE.md.
 */
export function EsteiraTab({ defasagem, carregandoDefasagem, onRecarregar }: {
  defasagem: Defasagem[];
  carregandoDefasagem: boolean;
  onRecarregar?: () => void;
}) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /* Multiselect: vazio = todos. Um array e não uma string porque a pergunta
     "como está Saponaria E Velas juntos?" não cabia num chip só. */
  const [projetos, setProjetos] = useState<string[]>([]);
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

  /*
    A tabela mostra os projetos ATIVOS; o alerta mostra só os que têm verba.
    São coisas diferentes de propósito: o alerta cobra de quem está gastando, e
    a tabela deixa ver o que existe em qualquer projeto vivo. Os projetos com
    verba vêm primeiro na lista, e os outros levam a marca.
  */
  const comVerba = useMemo(
    () => new Set(defasagem.map(d => d.projeto).filter(Boolean) as string[]),
    [defasagem]);

  const opcoesDeProjeto = useMemo(() => {
    const s = new Set(lotes.map(l => l.projeto).filter(Boolean) as string[]);
    return Array.from(s)
      .sort((a, b) => {
        const va = comVerba.has(a) ? 0 : 1, vb = comVerba.has(b) ? 0 : 1;
        return va !== vb ? va - vb : a.localeCompare(b);
      })
      .map(p => ({ id: p, nome: comVerba.has(p) ? p : `${p} · sem verba` }));
  }, [lotes, comVerba]);

  const visiveis = useMemo(() => lotes.filter(l =>
    (projetos.length === 0 || (l.projeto != null && projetos.includes(l.projeto))) &&
    (familia === 'todas' || l.familia === familia)
  ), [lotes, projetos, familia]);

  /* O resumo ignora o filtro de família — senão "Só novo" zeraria os outros dois
     cartões e o mix deixaria de fazer sentido. */
  const noProjeto = useMemo(
    () => lotes.filter(l =>
      projetos.length === 0 || (l.projeto != null && projetos.includes(l.projeto))),
    [lotes, projetos]);

  const resumo = useMemo(() => {
    const conta = (f: Familia) => {
      const ls = noProjeto.filter(l => l.familia === f);
      return {
        lotes: ls.length,
        cards: ls.reduce((s, l) => s + l.cards, 0),
        velhos: ls.filter(l => (l.dias_parado ?? 0) >= DIAS_PARA_VELHO).length,
      };
    };
    return {
      novo: conta('novo'), iteracao: conta('iteracao'), variacao: conta('variacao'),
      naoClassificados: noProjeto.filter(l => l.familia === 'sem_tipo' || l.familia === 'outro'),
    };
  }, [noProjeto]);

  const metaPctNovo = defasagem[0]?.pct_novo_meta ?? 20;

  return (
    <div className="space-y-4">
      {carregandoDefasagem
        ? <div className="h-16 animate-pulse rounded-lg border border-border bg-card" />
        : <AlertaDefasagem linhas={defasagem} />}

      <FilaPedidos onMudou={onRecarregar} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {FAMILIAS.map(f => (
          <CartaoResumo key={f} titulo={FAMILIA_LABEL[f]} ajuda={FAMILIA_AJUDA[f]}
                        {...resumo[f as 'novo' | 'iteracao' | 'variacao']} />
        ))}
      </div>

      <BarraDoMix novo={resumo.novo.lotes} iteracao={resumo.iteracao.lotes}
                  variacao={resumo.variacao.lotes} metaPctNovo={metaPctNovo} />

      {/*
        Só aparece quando há o que mostrar — um cartão permanente para dizer que
        não há nada gasta espaço com silêncio. Ele existe para um `tipo_teste`
        novo APARECER em vez de sumir da conta: a família sai da tabela
        `criativo_tipos_teste`, e o que não estiver lá cai aqui.
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
        A tabela precisava dizer o que é. Ela mostrava seis colunas sem título
        nenhum, e "Parado" ao lado de "Aprovado" dava a entender que o card
        estava travado — quando é só o tempo desde a última data de início.
      */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">O que já está em produção</span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Cada linha é um <span className="text-foreground">AD ainda não postado</span> — do briefing
              à esteira de teste. <span className="text-foreground">Hooks</span> é quantos dos hooks
              daquele AD já entraram; <span className="text-foreground">Parado</span> é o tempo desde a
              última data de início, não que o card esteja travado.
            </p>
          </div>

          {/*
            Dois controles diferentes, dois formatos diferentes. Quando os chips
            de família ficavam na mesma linha dos de projeto, a fila quebrava e
            os seis liam como um grupo só — dava para "desmarcar" o projeto
            clicando em "Só novo". Lista e segmentado deixam claro que são duas
            perguntas.
          */}
          <div className="flex shrink-0 items-center gap-2">
            <MultiFilter
              label="Todos os projetos"
              options={opcoesDeProjeto}
              value={projetos}
              onChange={setProjetos}
              width="w-44"
              larguraDaLista="340px"
            />
            <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
              {([['todas', 'Todas'], ...FAMILIAS.map(f => [f, FAMILIA_LABEL[f]])] as [string, string][]).map(([k, r]) => (
                <button key={k} onClick={() => setFamilia(k)}
                        className={cn('px-2.5 py-1 text-[11px] transition-colors',
                          familia === k ? 'bg-primary text-primary-foreground'
                                        : 'bg-secondary text-muted-foreground hover:text-foreground')}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {erro ? (
          <div className="p-4 text-center text-sm text-destructive-foreground">
            Não foi possível carregar a esteira: {erro}
            <button onClick={() => void carregar()} className="ml-2 underline underline-offset-2">tentar de novo</button>
          </div>
        ) : carregando ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando a esteira…</div>
        ) : visiveis.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {lotes.length === 0
              ? 'Nenhum criativo em produção nos projetos ativos.'
              : 'Nenhum AD com esses filtros.'}
          </div>
        ) : (
          <Tabela lotes={visiveis} agrupar={projetos.length !== 1} />
        )}
      </div>
    </div>
  );
}

/**
 * O mix contra a meta de 80/20.
 *
 * A barra mostra a proporção real; o traço vertical mostra onde o "novo"
 * deveria parar. Duas leituras num objeto só, sem obrigar ninguém a fazer conta
 * de cabeça — que era o que aconteceria com três porcentagens soltas.
 */
function BarraDoMix({ novo, iteracao, variacao, metaPctNovo }: {
  novo: number; iteracao: number; variacao: number; metaPctNovo: number;
}) {
  const total = novo + iteracao + variacao;
  if (total === 0) return null;

  const pct = (n: number) => (100 * n) / total;
  const pctNovo = Math.round(pct(novo));
  const estourado = pctNovo > metaPctNovo;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-medium text-foreground">Mix do estoque</span>
        <span className="text-[10px] text-muted-foreground/60">
          meta: {metaPctNovo}% novo · {100 - metaPctNovo}% iteração e variação
        </span>
      </div>

      <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
        <div className="flex h-full">
          <div className={FAMILIA_COR.novo}     style={{ width: `${pct(novo)}%` }} />
          <div className={FAMILIA_COR.iteracao} style={{ width: `${pct(iteracao)}%` }} />
          <div className={FAMILIA_COR.variacao} style={{ width: `${pct(variacao)}%` }} />
        </div>
        {/* Onde o "novo" deveria parar */}
        <div className="absolute inset-y-0 w-px bg-foreground/70"
             style={{ left: `${metaPctNovo}%` }}
             title={`Meta: ${metaPctNovo}% de novo`} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {FAMILIAS.map(f => {
          const n = f === 'novo' ? novo : f === 'iteracao' ? iteracao : variacao;
          return (
            <span key={f} className="flex items-center gap-1 text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-sm', FAMILIA_COR[f])} />
              {FAMILIA_LABEL[f]} <span className="tabular-nums text-foreground">{Math.round(pct(n))}%</span>
            </span>
          );
        })}
        {estourado && (
          <span className="text-amber-300/90">
            novo está {pctNovo - metaPctNovo} pontos acima da meta
          </span>
        )}
      </div>
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
        <span className="truncate text-[10px] text-muted-foreground/60" title={ajuda}>{ajuda}</span>
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
          FAMILIA_SELO[l.familia] ?? 'bg-amber-500/15 text-amber-400')}>
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

function Chip({ ativo, onClick, apagado, children }: {
  ativo: boolean; onClick: () => void; apagado?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
            title={apagado ? 'Sem investimento nos últimos 7 dias' : undefined}
            className={cn('rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              ativo ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-secondary hover:text-foreground',
              !ativo && (apagado ? 'text-muted-foreground/40' : 'text-muted-foreground'))}>
      {children}
    </button>
  );
}
