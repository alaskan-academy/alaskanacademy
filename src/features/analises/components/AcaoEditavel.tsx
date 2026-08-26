import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Pencil, Target, Trash2 } from 'lucide-react';

/**
 * Uma ação que pode ser corrigida depois de escrita.
 *
 * Existe porque o registro que não se corrige envelhece torto: a pessoa escreve
 * "subir o preço" às pressas, descobre na semana seguinte que era do bump, e
 * sem edição a única saída é criar outra linha — ficando duas versões da mesma
 * decisão no histórico. É o mesmo defeito de dois campos dizendo a mesma coisa,
 * só que espalhado no tempo.
 *
 * O que NÃO se edita é `feita_em` e `feita_por`: são carimbo do que aconteceu,
 * não opinião sobre o que aconteceu. Quem quiser mudar desmarca e marca de
 * novo, e o carimbo se refaz sozinho pelo gatilho no banco.
 */

export interface AcaoEditavelDados {
  id: string;
  texto: string;
  expectativa: string | null;
  feita: boolean;
  feita_em: string | null;
  feita_por_nome: string | null;
}

interface Props {
  acao: AcaoEditavelDados;
  onSalvar: (id: string, texto: string, expectativa: string | null) => Promise<void>;
  onMarcar: (id: string, feita: boolean) => Promise<void>;
  onApagar: (id: string) => Promise<void>;
}

function quando(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às `
       + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function AcaoEditavel({ acao, onSalvar, onMarcar, onApagar }: Props) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(acao.texto);
  const [expectativa, setExpectativa] = useState(acao.expectativa ?? '');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!texto.trim() || salvando) return;
    setSalvando(true);
    await onSalvar(acao.id, texto.trim(), expectativa.trim() || null);
    setSalvando(false);
    setEditando(false);
  }

  if (editando) {
    return (
      <div className="rounded-md border border-primary/40 bg-secondary/20 p-2 space-y-2">
        <Input
          className="h-9 text-base" value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } }}
        />
        <Textarea
          className="h-20 resize-none text-base"
          placeholder="O que você esperava disso? Opcional."
          value={expectativa} onChange={e => setExpectativa(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7" onClick={salvar} disabled={!texto.trim() || salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => {
            setTexto(acao.texto); setExpectativa(acao.expectativa ?? ''); setEditando(false);
          }}>
            Cancelar
          </Button>
          <div className="flex-1" />
          <Button
            size="sm" variant="ghost" className="h-9 gap-1 text-destructive hover:text-destructive"
            onClick={() => onApagar(acao.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Apagar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 group">
      <Checkbox
        checked={acao.feita}
        onCheckedChange={c => onMarcar(acao.id, c === true)}
        className="mt-1 shrink-0"
        aria-label={`${acao.feita ? 'Desmarcar' : 'Marcar como feita'}: ${acao.texto}`}
      />
      <div className="flex-1 min-w-0">
        <p className={cn('text-base', acao.feita && 'line-through text-muted-foreground')}>
          {acao.texto}
        </p>
        {acao.expectativa && (
          <p className="text-[13px] text-muted-foreground mt-0.5 flex items-start gap-1">
            <Target className="h-3 w-3 mt-0.5 shrink-0" />
            {acao.expectativa}
          </p>
        )}
        {acao.feita && acao.feita_em && (
          // Carimbo, não opinião: quem quiser mudar desmarca e marca de novo.
          <p className="text-xs text-muted-foreground/80 mt-0.5">
            feita em {quando(acao.feita_em)}
            {acao.feita_por_nome && ` por ${acao.feita_por_nome}`}
          </p>
        )}
      </div>
      <Button
        size="sm" variant="ghost"
        className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={() => setEditando(true)}
        aria-label="Editar ação"
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  );
}
