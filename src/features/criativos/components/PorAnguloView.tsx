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
  funil_alvo_id: string | null;
  funil_alvo: string | null;
  funil_alvo_produto: string | null;
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
 * POR QUE O AGRUPAMENTO É POR ÂNGULO, E NÃO POR FUNIL
 *
 * Quando esta tela nasceu não havia ligação card↔funil: `producoes.funil_id`
 * tinha sido apagada em 21/09/2026, vazia em 4.098 de 4.098 linhas. E
 * reconstruí-la por `projeto_id + metodo` não servia — REV9 e REV5, ambos
 * Saponaria/TSL, devolvem os MESMOS 197 cards, o que responde "ads do projeto
 * com este método" e não "ads deste funil".
 *
 * Em 24/09/2026 ela autorizou recriar a ligação, e ela existe: `funil_alvo_id`,
 * preenchida no formulário ao criar o card. O agrupamento continua por ÂNGULO
 * por dois motivos: é o eixo que o cenário dela tem — a incongruência que matou
 * os ads era de ângulo —, e o alvo é nulo nos 3.794 cards antigos, que não
 * foram backfilled de propósito (ver 20260924e). Agrupar pelo alvo hoje jogaria
 * quase tudo num balde "sem funil".
 *
 * O alvo aparece no card (⌖) e entra na busca: digitar "REV5" acha os cards
 * feitos para ele. E a contagem de quantos já têm alvo fica no topo, que é o
 * que denuncia se o campo voltar a não ser preenchido.
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
          .select('producao_id,nome,projeto,angulo,metodo_video,formato,fase,avaliacao,responsavel,estado,funil_alvo_id,funil_alvo,funil_alvo_produto')
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
      /* O funil alvo entra na busca: digitar "REV5" tem de achar os cards
         feitos para ele — que é a pergunta original dela, e a única forma de
         respondê-la enquanto o alvo não for um agrupamento próprio. */
      if (filtro && !(`${l.angulo} ${l.projeto ?? ''} ${l.nome} ${l.funil_alvo ?? ''} ${l.funil_alvo_produto ?? ''}`
                        .toLowerCase().includes(filtro))) continue;
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
  const comAlvo      = linhas.filter(l => l.funil_alvo_id).length;

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

        {/*
          A COLUNA DE RESULTADO DO CAMPO NOVO.

          `funil_alvo_id` nasceu em 24/09/2026 e a coluna que ele substitui
          morreu com 0 de 4.098 preenchidas. Mostrar a adesão aqui é o que faz
          alguém PERCEBER se ela não está subindo — sem isto, o campo voltaria a
          ser um lugar vazio, e o vazio só apareceria quando alguém procurasse.
          Segunda armadilha do CLAUDE.md: nenhum cadastro sem o resultado ao lado.
        */}
        <p className="mt-1 text-xs text-muted-foreground/70">
          {comAlvo === 0
            ? 'Nenhum card diz ainda para qual funil foi feito — o campo é novo, e aparece ao criar o card.'
            : `${comAlvo} de ${linhas.length} dizem para qual funil foram feitos.`}
        </p>
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
                              {/* Para qual funil o card foi FEITO. Não é de onde
                                  veio a venda — isso é `vw_criativo_funil`, e os
                                  dois discordarem é o caso que interessa. */}
                              {c.funil_alvo && (
                                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-primary/80">
                                  {/* O produto junto: "REV5" sozinho não
                                      identifica funil nenhum — há cinco
                                      "REV1 - Original", um por produto. */}
                                  ⌖ {c.funil_alvo}
                                  {c.funil_alvo_produto && (
                                    <span className="text-primary/50"> · {c.funil_alvo_produto}</span>
                                  )}
                                </span>
                              )}
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
