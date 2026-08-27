import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CardDaFila, AdAgrupado, agruparEmAds, rotuloDoAd, rotuloDoHook, rotuloDeDias,
  FAMILIA_LABEL, FAMILIA_SELO, FAMILIA_ORDEM, DIAS_PARA_ESQUECIDO,
} from './tipos';

/**
 * A fila de aprovados, em árvore: projeto → funil → tipo.
 *
 * Nenhum nível depende de data. Era isso que faltava: para saber quantos ADs
 * de cada projeto e funil existiam, o gestor arrastava os cards para datas
 * diferentes e lia os "bloquinhos" que se formavam no calendário — o que
 * reescrevia o prazo de produção combinado com o editor, e desmontava sozinho
 * depois de duas semanas.
 *
 * Aqui a hierarquia é a própria estrutura, e a data só aparece na hora de
 * mandar para teste, que é o único momento em que ela significa algo.
 */
export function FilaParaTestar({ cards, selecionados, onToggle, onToggleVarios }: {
  cards: CardDaFila[];
  selecionados: Set<string>;
  onToggle: (id: string) => void;
  onToggleVarios: (ids: string[], marcar: boolean) => void;
}) {
  const arvore = useMemo(() => montarArvore(cards), [cards]);
  const [fechados, setFechados] = useState<Set<string>>(new Set());

  const alternar = (k: string) =>
    setFechados(s => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Nenhum criativo aprovado esperando teste.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {arvore.map(proj => (
        <div key={proj.chave} className="border-b border-border last:border-0">
          <Cabecalho
            nivel={0}
            aberto={!fechados.has(proj.chave)}
            onClick={() => alternar(proj.chave)}
            titulo={proj.nome}
            resumo={`${proj.ads} ${proj.ads === 1 ? 'AD' : 'ADs'} · ${proj.cards.length} cards`}
            inativo={!proj.ativo}
            selecionados={selecionados}
            ids={proj.cards.map(c => c.id)}
            onToggleVarios={onToggleVarios}
          />

          {!fechados.has(proj.chave) && proj.funis.map(fun => (
            <div key={fun.chave}>
              <Cabecalho
                nivel={1}
                aberto={!fechados.has(fun.chave)}
                onClick={() => alternar(fun.chave)}
                titulo={fun.nome}
                resumo={`${fun.ads} ${fun.ads === 1 ? 'AD' : 'ADs'}`}
                selecionados={selecionados}
                ids={fun.cards.map(c => c.id)}
                onToggleVarios={onToggleVarios}
              />

              {!fechados.has(fun.chave) && fun.familias.map(fam => (
                <div key={fam.chave}>
                  <Cabecalho
                    nivel={2}
                    aberto
                    titulo={FAMILIA_LABEL[fam.familia] ?? fam.familia}
                    resumo={`${fam.ads.length} ${fam.ads.length === 1 ? 'AD' : 'ADs'}`}
                    selo={FAMILIA_SELO[fam.familia]}
                    selecionados={selecionados}
                    ids={fam.ads.flatMap(a => a.cards.map(c => c.id))}
                    onToggleVarios={onToggleVarios}
                  />
                  {fam.ads.map(ad => (
                    <LinhaDoAd key={ad.chave} ad={ad} selecionados={selecionados}
                               onToggle={onToggle} onToggleVarios={onToggleVarios} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Cabecalho({
  nivel, aberto, onClick, titulo, resumo, selo, inativo, selecionados, ids, onToggleVarios,
}: {
  nivel: 0 | 1 | 2;
  aberto: boolean;
  onClick?: () => void;
  titulo: string;
  resumo: string;
  selo?: string;
  inativo?: boolean;
  selecionados: Set<string>;
  ids: string[];
  onToggleVarios: (ids: string[], marcar: boolean) => void;
}) {
  const marcados = ids.filter(i => selecionados.has(i)).length;
  const todos = marcados === ids.length && ids.length > 0;
  const algum = marcados > 0 && !todos;

  return (
    <div className={cn('flex items-center gap-2 border-b border-border/40 px-3 py-1.5',
      nivel === 0 && 'bg-secondary/40',
      nivel === 1 && 'bg-secondary/15 pl-7',
      nivel === 2 && 'pl-12')}>
      {/* Marcar o grupo marca os filhos: é como ele pensa — "manda o TSL da
          Saponaria inteiro" — e evita cinco cliques para um AD de cinco hooks. */}
      <Caixa marcada={todos} parcial={algum} onClick={() => onToggleVarios(ids, !todos)} />

      {onClick ? (
        <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {aberto ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
          <Titulo nivel={nivel} titulo={titulo} selo={selo} inativo={inativo} />
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-4">
          <Titulo nivel={nivel} titulo={titulo} selo={selo} inativo={inativo} />
        </span>
      )}

      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{resumo}</span>
    </div>
  );
}

function Titulo({ nivel, titulo, selo, inativo }: {
  nivel: number; titulo: string; selo?: string; inativo?: boolean;
}) {
  if (selo) {
    return <span className={cn('rounded px-1.5 py-px text-[10px] font-medium', selo)}>{titulo}</span>;
  }
  return (
    <span className={cn('truncate',
      nivel === 0 ? 'text-xs font-medium text-foreground'
                  : 'rounded bg-secondary px-1.5 py-px text-[10px] font-medium text-foreground')}>
      {titulo}
      {inativo && <span className="ml-1.5 font-normal text-muted-foreground/60">projeto inativo</span>}
    </span>
  );
}

function LinhaDoAd({ ad, selecionados, onToggle, onToggleVarios }: {
  ad: AdAgrupado;
  selecionados: Set<string>;
  onToggle: (id: string) => void;
  onToggleVarios: (ids: string[], marcar: boolean) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ids = ad.cards.map(c => c.id);
  const marcados = ids.filter(i => selecionados.has(i)).length;
  const todos = marcados === ids.length;
  const esquecido = ad.dias >= DIAS_PARA_ESQUECIDO;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border/25 py-1 pl-[68px] pr-3 last:border-0 hover:bg-secondary/20">
        <Caixa marcada={todos} parcial={marcados > 0 && !todos}
               onClick={() => onToggleVarios(ids, !todos)} />

        <span className="w-[72px] shrink-0 text-xs font-medium tabular-nums text-foreground">
          {rotuloDoAd(ad.ad_num)}
        </span>

        {/* `2 de 5` importa: mandar meio AD para teste é decisão, não descuido */}
        <button onClick={() => setAberto(a => !a)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          {aberto ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {marcados > 0 && !todos
            ? <span className="text-primary">{marcados} de {ids.length} hooks</span>
            : <span>{ids.length} {ids.length === 1 ? 'hook' : 'hooks'}</span>}
        </button>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {esquecido && <Clock className="h-3 w-3 text-amber-400" />}
          <span className={cn('text-[10px] tabular-nums',
            esquecido ? 'text-amber-300/90' : 'text-muted-foreground/60')}>
            aprovado {rotuloDeDias(ad.dias)}
          </span>
        </span>
      </div>

      {aberto && ad.cards.map(c => (
        <div key={c.id}
             className="flex items-center gap-2 border-b border-border/15 py-1 pl-[96px] pr-3 last:border-0 hover:bg-secondary/20">
          <Caixa marcada={selecionados.has(c.id)} onClick={() => onToggle(c.id)} />
          <span className="w-12 shrink-0 text-[11px] tabular-nums text-foreground">{rotuloDoHook(c)}</span>
          <span className="truncate text-[11px] text-muted-foreground">{c.nome}</span>
          {c.editor && (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">{c.editor}</span>
          )}
        </div>
      ))}
    </>
  );
}

function Caixa({ marcada, parcial, onClick }: {
  marcada: boolean; parcial?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-label={marcada ? 'Desmarcar' : 'Marcar'}
            className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors',
              marcada ? 'border-primary bg-primary'
              : parcial ? 'border-primary bg-primary/30'
              : 'border-border hover:border-muted-foreground')}>
      {marcada && <span className="text-[9px] leading-none text-primary-foreground">✓</span>}
      {parcial && !marcada && <span className="h-0.5 w-1.5 rounded bg-primary" />}
    </button>
  );
}

// ── A árvore ────────────────────────────────────────────────────────────────

interface NoFamilia { chave: string; familia: string; ads: AdAgrupado[] }
interface NoFunil { chave: string; nome: string; cards: CardDaFila[]; ads: number; familias: NoFamilia[] }
interface NoProjeto { chave: string; nome: string; ativo: boolean; cards: CardDaFila[]; ads: number; funis: NoFunil[] }

/**
 * Projeto → funil → família, e dentro os ADs.
 *
 * "Sem funil" vira um nó próprio em vez de sumir ou ser chutado para o TSL:
 * 33 dos cards da fila não têm funil informado, e escondê-los faria o gestor
 * mandar para teste sem saber para qual funil.
 */
function montarArvore(cards: CardDaFila[]): NoProjeto[] {
  const porProjeto = new Map<string, CardDaFila[]>();
  for (const c of cards) {
    const k = c.projeto ?? '(sem projeto)';
    if (!porProjeto.has(k)) porProjeto.set(k, []);
    porProjeto.get(k)!.push(c);
  }

  const contarAds = (cs: CardDaFila[]) =>
    new Set(cs.map(c => `${c.ad_num ?? 'x'}|${c.tipo_teste ?? ''}`)).size;

  return Array.from(porProjeto, ([nome, cs]) => {
    const porFunil = new Map<string, CardDaFila[]>();
    for (const c of cs) {
      const k = c.funil ?? 'Sem funil';
      if (!porFunil.has(k)) porFunil.set(k, []);
      porFunil.get(k)!.push(c);
    }

    const funis: NoFunil[] = Array.from(porFunil, ([fn, fcs]) => {
      const porFamilia = new Map<string, CardDaFila[]>();
      for (const c of fcs) {
        if (!porFamilia.has(c.familia)) porFamilia.set(c.familia, []);
        porFamilia.get(c.familia)!.push(c);
      }
      const familias: NoFamilia[] = Array.from(porFamilia, ([fam, fam_cs]) => ({
        chave: `${nome}|${fn}|${fam}`,
        familia: fam,
        ads: agruparEmAds(fam_cs),
      })).sort((a, b) => (FAMILIA_ORDEM[a.familia] ?? 9) - (FAMILIA_ORDEM[b.familia] ?? 9));

      return { chave: `${nome}|${fn}`, nome: fn, cards: fcs, ads: contarAds(fcs), familias };
    }).sort((a, b) => a.nome.localeCompare(b.nome));

    return {
      chave: nome,
      nome,
      ativo: cs[0].projeto_ativo,
      cards: cs,
      ads: contarAds(cs),
      funis,
    };
  })
    /* Projeto ativo primeiro: a fila é para agir, e o inativo está lá só para
       não sumir. */
    .sort((a, b) => (a.ativo === b.ativo ? b.cards.length - a.cards.length : a.ativo ? -1 : 1));
}
