import { useCallback, useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Loader2, RefreshCw, Video } from 'lucide-react';

/**
 * Escolhe a VSL que está rodando no REV, a partir do espelho do VTurb.
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
  value: string;
  onChange: (id: string) => void;
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

  const atual = useMemo(() => vsls.find(v => v.id === value), [vsls, value]);

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
          <span className={cn('flex-1 truncate', !atual && 'text-muted-foreground')}>
            {carregando ? 'Carregando…' : atual ? atual.nome : 'Nenhuma VSL'}
          </span>
          {atual && (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {duracao(atual.duracao_seg)}
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
              <CommandItem
                value="nenhuma vsl"
                onSelect={() => { onChange(''); setAberto(false); }}
              >
                <Check className={cn('mr-2 h-3.5 w-3.5', value ? 'opacity-0' : 'opacity-100')} />
                <span className="text-muted-foreground">Nenhuma VSL</span>
              </CommandItem>

              {vsls.map(v => (
                <CommandItem
                  // O id entra no texto de busca para permitir colar um id do
                  // VTurb e achar o player direto.
                  key={v.id}
                  value={`${v.nome} ${v.id}`}
                  onSelect={() => { onChange(v.id); setAberto(false); }}
                >
                  <Check className={cn('mr-2 h-3.5 w-3.5 shrink-0', value === v.id ? 'opacity-100' : 'opacity-0')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{v.nome}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {duracao(v.duracao_seg)}
                      {v.pitch_seg ? ` · pitch ${duracao(v.pitch_seg)}` : ''}
                      {v.criado_em_vturb ? ` · ${dataCurta(v.criado_em_vturb)}` : ''}
                    </div>
                  </div>
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
