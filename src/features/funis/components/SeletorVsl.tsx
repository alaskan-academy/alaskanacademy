import { useEffect, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Video } from 'lucide-react';

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

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data } = await supabase
        .from('vsls')
        .select('id,nome,duracao_seg,pitch_seg,criado_em_vturb')
        .order('criado_em_vturb', { ascending: false });
      if (cancelado) return;
      setVsls((data ?? []) as Vsl[]);
      setCarregando(false);
    })();
    return () => { cancelado = true; };
  }, []);

  const atual = useMemo(() => vsls.find(v => v.id === value), [vsls, value]);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
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
                  ? 'Nenhuma VSL espelhada ainda. Sincronize com o VTurb.'
                  : 'Nenhuma VSL com esse nome.'}
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
      </PopoverContent>
    </Popover>
  );
}
