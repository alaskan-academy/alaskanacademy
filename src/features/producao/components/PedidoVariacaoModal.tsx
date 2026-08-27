import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const URGENCIAS = [
  { valor: 'alta',  rotulo: 'Alta',  cor: 'border-red-500 bg-red-500/15 text-red-400' },
  { valor: 'media', rotulo: 'Média', cor: 'border-amber-500 bg-amber-500/15 text-amber-400' },
  { valor: 'baixa', rotulo: 'Baixa', cor: 'border-border bg-secondary text-muted-foreground' },
];

interface Dinheiro { inv_30d: number | null; fat_30d: number | null; ultimo_dia: string | null }

/**
 * Pedir uma variação de um criativo, a partir de quem o avaliou.
 *
 * O formulário só pergunta o que o HUMANO sabe e o banco não: por que vale a
 * pena, o que melhorar, e qual variação ele imagina. O quanto o AD é importante
 * em dinheiro NÃO é perguntado — está logo acima, lido de
 * `vw_criativo_investimento`. Um campo digitado ao lado de um campo calculado
 * dizendo a mesma coisa é a primeira armadilha do CLAUDE.md, e os dois sempre
 * divergem.
 *
 * `urgencia` não é isso: é a informação de fora que o dado não tem — "vai
 * entrar a campanha de Natal". Por isso ela é selo na fila do Copy, e não a
 * ordenação: a fila ordena por dinheiro.
 */
export function PedidoVariacaoModal({ open, onClose, onSalvo, producaoId, nome }: {
  open: boolean;
  onClose: () => void;
  onSalvo?: () => void;
  producaoId: string;
  nome: string;
}) {
  const { user } = useAuth();
  const [porQue, setPorQue] = useState('');
  const [melhorar, setMelhorar] = useState('');
  const [urgencia, setUrgencia] = useState('media');
  const [tipo, setTipo] = useState('_');
  const [tipos, setTipos] = useState<string[]>([]);
  const [dinheiro, setDinheiro] = useState<Dinheiro | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      /* Os tipos de variação vêm da TABELA, não de uma lista aqui — para um tipo
         novo aparecer sozinho em vez de precisar de deploy. */
      const [t, d] = await Promise.all([
        supabase.from('criativo_tipos_teste').select('nome,ordem')
          .eq('familia', 'variacao').order('ordem'),
        supabase.from('vw_criativo_investimento').select('inv_30d,fat_30d,ultimo_dia')
          .eq('producao_id', producaoId).maybeSingle(),
      ]);
      setTipos(((t.data ?? []) as { nome: string }[]).map(x => x.nome));
      setDinheiro((d.data as Dinheiro | null) ?? null);
    })();
  }, [open, producaoId]);

  async function salvar() {
    if (!porQue.trim()) {
      toast({ title: 'Diga por que vale a pena variar', variant: 'destructive' });
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from('pedidos_variacao').insert({
      producao_id: producaoId,
      solicitado_por: user?.id ?? null,
      por_que: porQue.trim(),
      o_que_melhorar: melhorar.trim() || null,
      urgencia,
      tipo_sugerido: tipo === '_' ? null : tipo,
    });
    setSalvando(false);

    if (error) {
      /* O índice parcial `uq_pedido_variacao_aberto` deixa só um pedido aberto
         por card — pedir duas vezes a mesma coisa é ruído na fila do Copy. */
      const jaExiste = error.code === '23505';
      toast({
        title: jaExiste ? 'Já existe um pedido aberto para este criativo'
                        : 'Não foi possível registrar o pedido',
        description: jaExiste ? 'Ele já está na fila do Copy.' : error.message,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Pedido enviado para a esteira do Copy' });
    setPorQue(''); setMelhorar(''); setUrgencia('media'); setTipo('_');
    onSalvo?.();
    onClose();
  }

  const roas = dinheiro?.inv_30d && dinheiro.inv_30d > 0 && dinheiro.fat_30d != null
    ? (dinheiro.fat_30d / dinheiro.inv_30d).toFixed(2) : null;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Pedir variação de {nome}</DialogTitle>
          <DialogDescription className="text-xs">
            O pedido entra na esteira do Copy com o histórico de verba deste anúncio ao lado.
          </DialogDescription>
        </DialogHeader>

        {/*
          O dinheiro fica no topo e não é editável: é a resposta para "qual o
          grau de importância", e o banco já a tem. Quem pede lê e decide; não
          digita de novo.
        */}
        <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
          {dinheiro?.inv_30d != null ? (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tabular-nums text-emerald-400">
                {formatCurrency(dinheiro.inv_30d)} <span className="text-muted-foreground">em 30 dias</span>
              </span>
              {roas && <span className="tabular-nums text-foreground">ROAS {roas}x</span>}
              {dinheiro.ultimo_dia && (
                <span className="text-muted-foreground/70">
                  último gasto em {new Date(dinheiro.ultimo_dia + 'T12:00:00').toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground/70">
              Sem investimento registrado nos últimos 30 dias — vale conferir se ainda faz sentido variar.
            </span>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Por que vale a pena variar<span className="text-red-400"> *</span></Label>
            <Textarea className="mt-1 resize-none text-xs" rows={3} value={porQue}
                      onChange={e => setPorQue(e.target.value)}
                      placeholder="O que este anúncio fez que justifica insistir nele" />
          </div>

          <div>
            <Label className="text-xs">O que melhorar</Label>
            <Textarea className="mt-1 resize-none text-xs" rows={2} value={melhorar}
                      onChange={e => setMelhorar(e.target.value)}
                      placeholder="O que mudar na próxima versão" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Urgência</Label>
              <div className="mt-1 flex gap-1">
                {URGENCIAS.map(u => (
                  <button key={u.valor} type="button" onClick={() => setUrgencia(u.valor)}
                          className={cn('flex-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                            urgencia === u.valor ? u.cor
                              : 'border-border bg-background text-muted-foreground hover:text-foreground')}>
                    {u.rotulo}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground/60">
                Para o que o número não mostra — sazonalidade, campanha entrando.
              </p>
            </div>

            <div>
              <Label className="text-xs">Variação sugerida</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">Deixar o Copy decidir</SelectItem>
                  {tipos.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button size="sm" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Enviando…' : 'Enviar para a esteira'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
