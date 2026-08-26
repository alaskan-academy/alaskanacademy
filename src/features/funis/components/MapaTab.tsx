import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';
import { Search, Video, Globe, ShoppingCart, FileText } from 'lucide-react';

/**
 * Responde "onde está rodando a h07?".
 *
 * Era a pergunta que a área de Funis não sabia responder: a informação existia
 * espalhada entre o cadastro do REV, a tabela de domínios e o nome do vídeo no
 * VTurb, e descobrir exigia abrir REV por REV — ou lembrar.
 *
 * Um campo de busca só, que varre tudo ao mesmo tempo: nome do REV, projeto,
 * VSL, domínio, checkout, página. Quem procura não sabe de antemão em qual
 * campo a resposta está — se soubesse, não precisaria procurar.
 *
 * O trabalho pesado está em `vw_mapa_revs`; aqui só filtra os 23 em memória.
 */

interface LinhaMapa {
  id: string;
  rev: string;
  status: string;
  metodo: string | null;
  url_page: string | null;
  projeto: string | null;
  vsl_id: string | null;
  vsl: string | null;
  vsl_duracao: number | null;
  dominios: string[] | null;
  checkouts: string[] | null;
  vendas: number;
  ultima_venda: string | null;
  busca: string;
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  ativo:           { label: 'Ativo',      cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  planejado:       { label: 'Planejado',  cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  pausado:         { label: 'Pausado',    cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  pausado_analise: { label: 'Em análise', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  arquivado:       { label: 'Arquivado',  cls: 'bg-muted text-muted-foreground border-border' },
};

/** Mesma normalização da coluna `busca` da view: sem acento, minúsculas. */
function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function duracao(seg: number | null): string {
  if (!seg) return '';
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
}

/**
 * O nome do REV diz um método e o campo diz outro.
 *
 * Dois REVs se chamam "REV5 - VSL" e têm `metodo = 'TSL'`. Ninguém sabe qual
 * dos dois vale, e nada no dash apontava para isso — a contradição só aparecia
 * para quem lesse as duas coisas lado a lado e reparasse.
 *
 * Não dá para corrigir automaticamente (não há como saber qual está certo), mas
 * dá para parar de esconder.
 */
function metodoContradizNome(rev: string, metodo: string | null): boolean {
  if (!metodo) return false;
  const nome = rev.toUpperCase();
  const m = metodo.toUpperCase();
  if (nome.includes('VSL') && m === 'TSL') return true;
  if (nome.includes('TSL') && m === 'VSL') return true;
  return false;
}

export function MapaTab() {
  const [linhas, setLinhas]   = useState<LinhaMapa[]>([]);
  const [busca, setBusca]     = useState('');
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('vw_mapa_revs').select('*');
    if (error) {
      toast({ title: 'Erro ao carregar o mapa', description: error.message, variant: 'destructive' });
    }
    setLinhas((data ?? []) as LinhaMapa[]);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(() => {
    const q = semAcento(busca.trim());
    const filtradas = q ? linhas.filter(l => (l.busca ?? '').includes(q)) : linhas;
    return filtradas.slice().sort((a, b) =>
      (b.vendas - a.vendas) ||
      (a.projeto ?? 'zzz').localeCompare(b.projeto ?? 'zzz') ||
      a.rev.localeCompare(b.rev));
  }, [linhas, busca]);

  /**
   * Quais campos casaram com a busca.
   *
   * Sem isto, procurar "h07" devolve uma linha e a pessoa fica sem saber POR QUE
   * ela apareceu — se foi o nome do REV, a VSL ou o domínio. O rótulo responde
   * antes de ela perguntar.
   */
  function ondeCasou(l: LinhaMapa): string[] {
    const q = semAcento(busca.trim());
    if (!q) return [];
    const campos: [string, string | null | undefined][] = [
      ['REV', l.rev],
      ['projeto', l.projeto],
      ['VSL', l.vsl],
      ['página', l.url_page],
      ['método', l.metodo],
      ['domínio', l.dominios?.join(' ')],
      ['checkout', l.checkouts?.join(' ')],
    ];
    return campos.filter(([, v]) => v && semAcento(v).includes(q)).map(([k]) => k);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const semVsl = linhas.filter(l => !l.vsl_id).length;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Onde está rodando a h07? Busque por VSL, domínio, checkout, página, REV…"
          className="pl-9 h-10"
          autoFocus
        />
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{visiveis.length} de {linhas.length} REVs</span>
        {semVsl > 0 && !busca && (
          <span className="text-amber-400/80">
            · {semVsl} ainda sem VSL escolhida
          </span>
        )}
      </div>

      {visiveis.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Nada com &ldquo;{busca}&rdquo;. A busca cobre REV, projeto, VSL, domínio, checkout e página.
        </div>
      ) : (
        <div className="space-y-2">
          {visiveis.map(l => {
            const st = STATUS_CFG[l.status] ?? STATUS_CFG.arquivado;
            const casou = ondeCasou(l);

            return (
              <div key={l.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {l.projeto ?? 'sem projeto'}
                      </span>
                      <span className="text-sm font-medium">{l.rev}</span>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', st.cls)}>
                        {st.label}
                      </span>
                      {casou.map(c => (
                        <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                          achou em {c}
                        </span>
                      ))}
                      {metodoContradizNome(l.rev, l.metodo) && (
                        <span
                          title={`O nome diz uma coisa e o método diz "${l.metodo}". Um dos dois está errado.`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30"
                        >
                          nome × método: {l.metodo}
                        </span>
                      )}
                    </div>
                  </div>

                  {l.vendas > 0 && (
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums">{formatNumber(l.vendas)}</div>
                      <div className="text-[10px] text-muted-foreground">vendas</div>
                    </div>
                  )}
                </div>

                <div className="mt-2 grid gap-1.5 sm:grid-cols-2 text-xs">
                  <Campo Icon={Video} vazio="sem VSL escolhida">
                    {l.vsl && (
                      <>
                        {l.vsl}
                        {l.vsl_duracao ? (
                          <span className="text-muted-foreground tabular-nums"> · {duracao(l.vsl_duracao)}</span>
                        ) : null}
                      </>
                    )}
                  </Campo>

                  <Campo Icon={Globe} vazio="sem domínio">
                    {l.dominios?.join(', ')}
                  </Campo>

                  <Campo Icon={ShoppingCart} vazio="nenhum checkout atribuído">
                    {l.checkouts?.join(', ')}
                  </Campo>

                  <Campo Icon={FileText} vazio="sem página">
                    {l.url_page}
                  </Campo>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Uma linha de atributo do REV.
 *
 * O estado vazio é escrito, e não omitido: "sem VSL escolhida" é informação —
 * some junto com o campo, a pessoa não distingue "não tem" de "não carregou".
 */
function Campo({ Icon, vazio, children }: {
  Icon: React.ElementType;
  vazio: string;
  children: React.ReactNode;
}) {
  const temConteudo = children !== null && children !== undefined && children !== '' && children !== false;
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <Icon className={cn('h-3.5 w-3.5 shrink-0 mt-0.5', temConteudo ? 'text-muted-foreground' : 'text-muted-foreground/40')} />
      <span className={cn('truncate', !temConteudo && 'text-muted-foreground/50 italic')}>
        {temConteudo ? children : vazio}
      </span>
    </div>
  );
}
