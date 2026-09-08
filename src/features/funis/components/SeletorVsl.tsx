import { useCallback, useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Loader2, RefreshCw, Video } from 'lucide-react';

/**
 * Escolhe as VSLs que estão rodando no REV, a partir do espelho do VTurb.
 *
 * Não é campo de texto de propósito. A mesma VSL roda em vários REVs, e a
 * pergunta que ela faz é "onde está rodando a h07" — com chave estrangeira isso
 * é uma busca exata; com texto digitado, erra na primeira divergência de grafia.
 *
 * Busca em vez de lista: são 88 VSLs. E os nomes REPETEM entre players
 * diferentes — "Cópia de VSL 02 Saponaria final.mp4" existe 3× com ids
 * distintos, porque o VTurb duplica o player para montar teste A/B. Por isso
 * duração e data aparecem embaixo do nome: sem elas, ela escolheria entre três
 * linhas idênticas no escuro.
 *
 * VÁRIAS, E NÃO UMA
 *
 * Num teste A/B o VTurb alterna dois players na MESMA página, então enquanto o
 * teste corre o REV roda duas VSLs de verdade. Guardar só uma escondia metade
 * do teste justamente em Análises, que é onde se decide qual das duas fica.
 *
 * A ordem de escolha é preservada: a primeira marcada é o lado "A" da
 * comparação. Trocar a ordem é desmarcar e marcar de novo — mais simples que
 * arrastar, e a decisão de qual é A raramente muda depois de escolhida.
 */

export interface Vsl {
  id: string;
  nome: string;
  duracao_seg: number | null;
  pitch_seg: number | null;
  criado_em_vturb: string | null;
  sincronizado_em: string | null;
}

/** 1347 → "22:27". A duração é o que distingue players de nome igual. */
function duracao(seg: number | null): string {
  if (!seg) return '—';
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function dataCurta(iso: string | null): string {
  if (!iso) return '';
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano.slice(2)}`;
}

interface Props {
  /** Na ordem: a primeira é o lado "A" da comparação em Análises. */
  value: string[];
  onChange: (ids: string[]) => void;
}

export function SeletorVsl({ value, onChange }: Props) {
  const [vsls, setVsls]   = useState<Vsl[]>([]);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from('vsls')
      .select('id,nome,duracao_seg,pitch_seg,criado_em_vturb,sincronizado_em')
      .order('criado_em_vturb', { ascending: false });
    setVsls((data ?? []) as Vsl[]);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  /*
    Buscar os players do VTurb de novo.

    Este botão existe porque o espelho já congelou: nasceu de uma rodada única
    em 25/08/2026 e ficou 14 dias parado, sem nada na tela dizendo. Uma VSL que
    subiu depois — inclusive uma em teste A/B — simplesmente não aparecia aqui,
    e sem ela o REV ficava sem `vsl_id`, e sem `vsl_id` o teste do VTurb nunca
    se ligava ao REV. O botão fica AQUI, e não numa tela de configuração, porque
    é aqui que a falta é descoberta.
  */
  async function sincronizar() {
    setSincronizando(true);
    const { data, error } = await supabase.functions.invoke('vturb', {
      body: { acao: 'sincronizar' },
    });
    setSincronizando(false);

    if (error || data?.erro) {
      toast({
        title: 'Não consegui falar com o VTurb',
        description: data?.erro ?? error?.message,
        variant: 'destructive',
      });
      return;
    }
    const d = data?.dados ?? {};
    toast({
      title: `${d.vsls_gravadas ?? 0} VSLs no espelho`,
      description: `${d.players_no_vturb ?? 0} players no VTurb`
        + (d.so_por_estarem_em_teste ? ` · ${d.so_por_estarem_em_teste} entraram por estarem em teste A/B` : ''),
    });
    await carregar();
  }

  /* Na ORDEM ESCOLHIDA, não na ordem da lista: é ela que define A e B. */
  const escolhidas = useMemo(
    () => value.map(id => vsls.find(v => v.id === id)).filter(Boolean) as Vsl[],
    [vsls, value],
  );

  function alternar(id: string) {
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  }

  /* A data do espelho, não a de agora: é o que denuncia lista velha. */
  const ultimaSync = useMemo(() => {
    const datas = vsls.map(v => v.sincronizado_em).filter(Boolean) as string[];
    return datas.length ? datas.sort().at(-1)! : null;
  }, [vsls]);

  const diasParado = useMemo(() => {
    if (!ultimaSync) return null;
    return Math.floor((Date.now() - new Date(ultimaSync).getTime()) / 86400000);
  }, [ultimaSync]);

  // `modal` porque este Popover vive DENTRO de um Dialog.
  //
  // O Dialog usa `react-remove-scroll`, que trava a rolagem de tudo o que está
  // fora dele — e o Popover renderiza em portal, ou seja, fora. Sem isto a
  // lista rola pela barra mas IGNORA A RODA DO MOUSE. Com `modal`, o Popover
  // instala a própria trava e libera o próprio conteúdo.
  return (
    <Popover open={aberto} onOpenChange={setAberto} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 h-8 w-full flex items-center gap-2 px-3 rounded-md border border-input bg-background hover:bg-accent transition-colors text-left text-sm min-w-0"
        >
          <Video className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {/* Com uma, o nome. Com duas ou mais, os nomes juntos — o botão tem de
              dizer QUAIS, não só quantas: "2 VSLs" obrigaria a abrir para saber
              se o teste A/B tem os dois lados certos. */}
          <span className={cn('flex-1 truncate', escolhidas.length === 0 && 'text-muted-foreground')}>
            {carregando
              ? 'Carregando…'
              : escolhidas.length === 0
                ? 'Nenhuma VSL'
                : escolhidas.map(v => v.nome).join(' · ')}
          </span>
          {escolhidas.length === 1 && (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {duracao(escolhidas[0].duracao_seg)}
            </span>
          )}
          {escolhidas.length > 1 && (
            <span className="shrink-0 text-[11px] text-primary tabular-nums">
              {escolhidas.length} VSLs
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[26rem] p-0" align="start">
        <Command
          // O filtro padrão do cmdk pontua por similaridade e reordena; aqui a
          // ordem por data importa (a VSL nova é quase sempre a procurada), e
          // "h07" precisa casar como substring simples.
          filter={(valor, busca) =>
            valor.toLowerCase().includes(busca.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Buscar VSL… (ex: h07, saponaria)" className="h-9" />
          <CommandList className="max-h-72">
            <CommandEmpty>
              {carregando
                ? 'Carregando…'
                : vsls.length === 0
                  ? 'Nenhuma VSL espelhada ainda — use "Buscar do VTurb" abaixo.'
                  : 'Nenhuma VSL com esse nome. Se ela é nova, busque do VTurb abaixo.'}
            </CommandEmpty>

            <CommandGroup>
              {/* Limpar tudo, e não "escolher nenhuma": com seleção múltipla a
                  linha vira uma ação, não uma opção da lista. */}
              <CommandItem
                value="nenhuma vsl limpar"
                onSelect={() => { onChange([]); setAberto(false); }}
              >
                <Check className={cn('mr-2 h-3.5 w-3.5', value.length ? 'opacity-0' : 'opacity-100')} />
                <span className="text-muted-foreground">
                  {value.length ? 'Limpar seleção' : 'Nenhuma VSL'}
                </span>
              </CommandItem>

              {vsls.map(v => (
                <CommandItem
                  // O id entra no texto de busca para permitir colar um id do
                  // VTurb e achar o player direto.
                  key={v.id}
                  value={`${v.nome} ${v.id}`}
                  // NÃO fecha ao escolher: marcar duas é o caso normal agora, e
                  // reabrir o popover a cada clique dobraria o trabalho.
                  onSelect={() => alternar(v.id)}
                >
                  <Check className={cn('mr-2 h-3.5 w-3.5 shrink-0', value.includes(v.id) ? 'opacity-100' : 'opacity-0')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{v.nome}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {duracao(v.duracao_seg)}
                      {/* Sem pitch marcado no VTurb a retenção no pitch não tem
                          como ser calculada — vale dizer aqui, e não só no bloco
                          de Análises, onde já seria tarde. */}
                      {v.pitch_seg ? ` · pitch ${duracao(v.pitch_seg)}` : ' · sem pitch'}
                      {v.criado_em_vturb ? ` · ${dataCurta(v.criado_em_vturb)}` : ''}
                    </div>
                  </div>
                  {/* A ordem só aparece quando há comparação: com uma VSL só,
                      "A" seria um rótulo sem contraparte. */}
                  {value.length > 1 && value.includes(v.id) && (
                    <span className="ml-2 shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                      {String.fromCharCode(65 + value.indexOf(v.id))}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>

        {/* O rodapé diz a idade da lista ANTES de alguém procurar o que não
            está nela. Sem isto, uma lista de 14 dias atrás parece completa. */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="text-[11px] text-muted-foreground truncate">
            {carregando
              ? 'Carregando…'
              : ultimaSync
                ? <>
                    {vsls.length} VSLs · lista de{' '}
                    <span className={cn(diasParado !== null && diasParado >= 7 && 'text-warning')}>
                      {dataCurta(ultimaSync)}
                      {diasParado ? ` (${diasParado} dia${diasParado > 1 ? 's' : ''})` : ''}
                    </span>
                  </>
                : 'Espelho vazio'}
          </span>
          <button
            type="button"
            onClick={sincronizar}
            disabled={sincronizando}
            className="shrink-0 flex items-center gap-1.5 text-[11px] text-primary hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {sincronizando
              ? <><Loader2 className="h-3 w-3 animate-spin" />Buscando…</>
              : <><RefreshCw className="h-3 w-3" />Buscar do VTurb</>}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
