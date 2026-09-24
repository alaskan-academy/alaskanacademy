import { useEffect, useMemo, useState } from 'react';
import { Loader2, ChevronRight, Search } from 'lucide-react';
import { supabase, todasAsLinhas } from '@/lib/supabase';
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CriativoDrawer } from '@/features/producao/components/CriativoDrawer';

interface Linha {
  producao_id: string;
  nome: string;
  projeto: string | null;
  angulo: string;
  metodo_video: string | null;
  formato: string | null;
  fase: string;
  avaliacao: string | null;
  responsavel: string | null;
  estado: 'pronto' | 'descartado' | 'validado' | 'arquivado' | 'rodou_sem_veredito' | 'em_producao';
}

/**
 * Os estados, na ordem em que a prateleira importa.
 *
 * `pronto` primeiro porque é a resposta à pergunta dela — "tem ad para rodar?".
 * `descartado` logo depois porque é a outra metade do pedido: o ad que foi mal
 * contra a página errada volta a ser candidato quando a página certa sobe.
 */
const ESTADO = {
  pronto:            { rotulo: 'prontos',    selo: 'bg-primary/15 text-primary' },
  descartado:        { rotulo: 'descartados', selo: 'bg-amber-500/15 text-amber-400' },
  validado:          { rotulo: 'validados',  selo: 'bg-emerald-500/15 text-emerald-400' },
  rodou_sem_veredito:{ rotulo: 'sem veredito', selo: 'bg-secondary text-muted-foreground' },
  em_producao:       { rotulo: 'em produção', selo: 'bg-secondary text-muted-foreground' },
  arquivado:         { rotulo: 'arquivados', selo: 'bg-secondary text-muted-foreground/70' },
} as const;

const ORDEM = ['pronto', 'descartado', 'validado', 'rodou_sem_veredito', 'em_producao', 'arquivado'] as const;

/**
 * O BANCO DE ÂNGULOS: o ad que já foi feito não pode se perder.
 *
 * O pedido dela: "quando for subir a página do ângulo correto, mostrar os ads
 * que já foram descartados ou usados". O cenário: fez ads de um funil, o funil
 * não foi testado, os ads rodaram contra outra página, foram mal por
 * incongruência de ângulo, e morreram. Quando a página certa subir, eles
 * deveriam voltar à mesa — e hoje ninguém lembra que existem.
 *
 * ELA PEDIU "ADS DAQUELE FUNIL", E ISSO NÃO DÁ PARA RESPONDER.
 *
 * A ligação card↔funil não existe: era `producoes.funil_id`, apagada em
 * 21/09/2026 por estar vazia em 4.098 de 4.098 linhas. Reconstruir por
 * `projeto_id + metodo` devolve o MESMO conjunto para REVs irmãos — REV9 e
 * REV5, ambos Saponaria/TSL, dão os mesmos 197 cards, o que responde "ads do
 * projeto com este método" e não "ads deste funil".
 *
 * Então a tela é por ÂNGULO, que é o eixo que o cenário dela realmente tem: a
 * incongruência que matou os ads era de ângulo, não de funil. Ela escolhe o
 * ângulo da página que vai subir e vê a prateleira inteira.
 *
 * `angulo_teste` é texto livre — 213 valores distintos, vazio em 2.010 de
 * 3.794. Por isso há busca, e por isso os sem ângulo aparecem num grupo
 * nomeado em vez de sumirem: card escondido é card perdido, que é o oposto do
 * que esta tela existe para fazer.
 */
export function PorAnguloView({ userId }: { userId: string }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [cardAberto, setCardAberto] = useState<string | null>(null);

  const projetosDaEmpresa = useProjetosDaEmpresa();

  useEffect(() => {
    /* undefined = ainda não sei de quem são os projetos. Quem chama espera:
       sem isto a primeira busca sai sem filtro e a tela mostra as duas
       empresas por um instante. */
    if (projetosDaEmpresa === undefined) return;

    const carregar = async () => {
      setCarregando(true);
      setErro(null);
      const { linhas: todas, erro: falha } = await todasAsLinhas<Linha>((de, ate) => {
        let q = supabase
          .from('vw_criativo_por_angulo')
          .select('producao_id,nome,projeto,angulo,metodo_video,formato,fase,avaliacao,responsavel,estado')
          .order('angulo')
          .range(de, ate);
        if (projetosDaEmpresa) q = q.in('projeto_id', projetosDaEmpresa);
        return q;
      });
      if (falha) { setErro(falha); setLinhas([]); setCarregando(false); return; }
      setLinhas(todas);
      setCarregando(false);
    };
    void carregar();
  }, [projetosDaEmpresa]);

  /** Projeto → ângulo → cards, já contados e ordenados por quem tem prateleira. */
  const grupos = useMemo(() => {
    const filtro = busca.trim().toLowerCase();
    const mapa = new Map<string, Map<string, Linha[]>>();
    for (const l of linhas) {
      if (filtro && !(`${l.angulo} ${l.projeto ?? ''} ${l.nome}`.toLowerCase().includes(filtro))) continue;
      const proj = l.projeto ?? '— sem projeto —';
      if (!mapa.has(proj)) mapa.set(proj, new Map());
      const porAngulo = mapa.get(proj)!;
      if (!porAngulo.has(l.angulo)) porAngulo.set(l.angulo, []);
      porAngulo.get(l.angulo)!.push(l);
    }
    return [...mapa.entries()]
      .map(([projeto, porAngulo]) => ({
        projeto,
        angulos: [...porAngulo.entries()]
          .map(([angulo, cards]) => ({
            angulo,
            cards,
            prontos: cards.filter(c => c.estado === 'pronto').length,
            contagem: ORDEM.map(e => ({ estado: e, n: cards.filter(c => c.estado === e).length }))
                           .filter(x => x.n > 0),
          }))
          /* Quem tem ad esperando vem primeiro: é a pergunta que traz alguém
             a esta tela. Empate, o ângulo com mais história. */
          .sort((a, b) => b.prontos - a.prontos || b.cards.length - a.cards.length),
      }))
      .sort((a, b) => {
        const pa = a.angulos.reduce((s, x) => s + x.prontos, 0);
        const pb = b.angulos.reduce((s, x) => s + x.prontos, 0);
        return pb - pa;
      });
  }, [linhas, busca]);

  if (erro) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-muted-foreground">Não consegui carregar os ângulos.</p>
        <p className="max-w-md text-xs text-muted-foreground/70">{erro}</p>
      </div>
    );
  }

  if (carregando) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />Carregando…
      </div>
    );
  }

  const totalProntos = linhas.filter(l => l.estado === 'pronto').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-foreground">
            {totalProntos} criativo(s) prontos e nunca testados
          </span>
          <span className="text-xs text-muted-foreground">
            agrupados pelo ângulo · quando a página de um ângulo subir, a prateleira dele está aqui
          </span>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar ângulo, projeto ou criativo…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {grupos.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          {busca ? 'Nenhum ângulo com esse texto.' : 'Nenhum criativo para mostrar.'}
        </div>
      ) : (
        grupos.map(g => (
          <div key={g.projeto} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-medium text-foreground">{g.projeto}</h3>
            </div>
            <div className="divide-y divide-border">
              {g.angulos.map(a => {
                const chave = `${g.projeto}|${a.angulo}`;
                const expandido = aberto === chave;
                return (
                  <div key={chave}>
                    <button
                      type="button"
                      onClick={() => setAberto(expandido ? null : chave)}
                      className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-left hover:bg-secondary/40"
                    >
                      <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                                                   expandido && 'rotate-90')} />
                      <span className="text-xs font-medium text-foreground">{a.angulo}</span>
                      {a.contagem.map(c => (
                        <span key={c.estado}
                              className={cn('rounded-full px-2 py-0.5 text-[11px] tabular-nums', ESTADO[c.estado].selo)}>
                          {c.n} {ESTADO[c.estado].rotulo}
                        </span>
                      ))}
                    </button>

                    {expandido && (
                      <div className="flex flex-col gap-0.5 bg-secondary/20 px-4 pb-2.5 pt-1">
                        {[...a.cards]
                          /* Dentro do ângulo, a mesma ordem: o que está pronto
                             para subir antes do que já teve veredito. */
                          .sort((x, y) => ORDEM.indexOf(x.estado) - ORDEM.indexOf(y.estado)
                                          || x.nome.localeCompare(y.nome))
                          .map(c => (
                            <button
                              key={c.producao_id}
                              type="button"
                              onClick={() => setCardAberto(c.producao_id)}
                              title="Abrir o card em Produção"
                              className="flex flex-wrap items-baseline gap-x-2 text-left text-[11px] hover:text-primary"
                            >
                              <span className={cn('rounded-full px-1.5 py-0.5', ESTADO[c.estado].selo)}>
                                {ESTADO[c.estado].rotulo.replace(/s$/, '')}
                              </span>
                              <span className="font-medium text-foreground">{c.nome}</span>
                              {c.metodo_video && <span className="text-muted-foreground/70">{c.metodo_video}</span>}
                              {c.formato && <span className="text-muted-foreground/70">{c.formato}</span>}
                              {c.responsavel && <span className="text-muted-foreground/50">{c.responsavel}</span>}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <CriativoDrawer
        criativoId={cardAberto}
        onClose={() => setCardAberto(null)}
        onUpdate={() => { /* a prateleira não muda ao editar o card */ }}
        nivel="socio"
        userId={userId}
        funis={[]}
        perfis={[]}
      />
    </div>
  );
}
