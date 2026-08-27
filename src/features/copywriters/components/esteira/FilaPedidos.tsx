import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Check, Inbox, Flame, X } from 'lucide-react';
import { Pedido, rotuloDoAdHook, rotuloDeDias, URGENCIA_LABEL } from './tipos';

const URGENCIA_COR: Record<string, string> = {
  alta:  'bg-red-500/15 text-red-400',
  media: 'bg-amber-500/15 text-amber-400',
  baixa: 'bg-secondary text-muted-foreground',
};

/**
 * A fila de pedidos de variação, como o Copy precisa ler.
 *
 * Ordenada por DINHEIRO por padrão, não pela urgência digitada: um pedido
 * "alta" num AD de R$ 10 não vale um "média" num de R$ 6.659. A urgência é o
 * desempate humano — a informação de fora que o dado não tem — e aparece como
 * selo, não como ordenação.
 *
 * O fechamento é manual, por decisão. Então duas coisas seguram a fila de
 * apodrecer: cada pedido mostra há quantos dias está aberto, e quando já surgiu
 * uma variação daquele AD depois do pedido, a linha avisa. Avisa, não fecha.
 */
export function FilaPedidos({ onMudou }: { onMudou?: () => void }) {
  const { user } = useAuth();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [verFechados, setVerFechados] = useState(false);
  const [fechando, setFechando] = useState<Pedido | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase
      .from('vw_pedidos_variacao')
      .select('*')
      .order('inv_30d', { ascending: false, nullsFirst: false })
      .order('criado_em', { ascending: true });
    if (error) { setErro(error.message); setCarregando(false); return; }
    setPedidos((data ?? []) as unknown as Pedido[]);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const abertos  = useMemo(() => pedidos.filter(p => p.status === 'aberto'), [pedidos]);
  const fechados = useMemo(() => pedidos.filter(p => p.status !== 'aberto'), [pedidos]);

  /*
    A coluna de resultado, que a segunda armadilha do CLAUDE.md exige: sem ela
    ninguém volta para a fila, e a fila vira ficção. Mediana e não média porque
    um pedido esquecido por seis meses distorce a média inteira.
  */
  const medianaDias = useMemo(() => {
    const ds = fechados
      .filter(p => p.status === 'atendido' && p.atendido_em)
      .map(p => Math.round(
        (new Date(p.atendido_em!).getTime() - new Date(p.criado_em).getTime()) / 86400000));
    if (ds.length === 0) return null;
    ds.sort((a, b) => a - b);
    return ds[Math.floor(ds.length / 2)];
  }, [fechados]);

  if (carregando) {
    return <div className="h-20 animate-pulse rounded-lg border border-border bg-card" />;
  }

  if (erro) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-center text-sm text-destructive-foreground">
        Não foi possível carregar os pedidos: {erro}
        <button onClick={() => void carregar()} className="ml-2 underline underline-offset-2">tentar de novo</button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">
          Pedidos de variação
        </span>
        <span className="text-[11px] text-muted-foreground">
          {abertos.length === 0 ? 'nenhum aberto'
            : abertos.length === 1 ? '1 aberto' : `${abertos.length} abertos`}
        </span>

        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground/70">
          {fechados.length > 0 && (
            <>
              <span>
                {fechados.filter(p => p.status === 'atendido').length} atendidos
                {medianaDias != null && ` · mediana de ${medianaDias} ${medianaDias === 1 ? 'dia' : 'dias'}`}
              </span>
              <button onClick={() => setVerFechados(v => !v)}
                      className="underline-offset-2 hover:underline">
                {verFechados ? 'esconder' : 'ver'}
              </button>
            </>
          )}
        </span>
      </div>

      {abertos.length === 0 && !verFechados ? (
        <p className="px-3.5 py-6 text-center text-xs text-muted-foreground/60">
          Nenhum pedido aberto. Quem avalia um criativo em Produção pode pedir uma variação a partir dele.
        </p>
      ) : (
        <div className="divide-y divide-border/40">
          {abertos.map(p => (
            <LinhaPedido key={p.id} p={p} onFechar={() => setFechando(p)} />
          ))}
          {verFechados && fechados.map(p => (
            <LinhaPedido key={p.id} p={p} onFechar={() => setFechando(p)} />
          ))}
        </div>
      )}

      {fechando && (
        <ModalFechar
          pedido={fechando}
          perfilId={user?.id ?? null}
          onClose={() => setFechando(null)}
          onSalvo={() => { setFechando(null); void carregar(); onMudou?.(); }}
        />
      )}
    </div>
  );
}

function LinhaPedido({ p, onFechar }: { p: Pedido; onFechar: () => void }) {
  const aberto = p.status === 'aberto';

  return (
    <div className={cn('px-3.5 py-2.5', !aberto && 'opacity-60')}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-medium tabular-nums text-foreground">
          {p.ad_num != null ? rotuloDoAdHook(p.ad_num, p.hook) : p.criativo}
        </span>
        <span className="text-[11px] text-muted-foreground">{p.projeto ?? '—'}</span>

        {p.funil && (
          <span className="rounded bg-secondary px-1.5 py-px text-[10px] text-muted-foreground">{p.funil}</span>
        )}

        {/* O dinheiro, que é o que ordena a fila */}
        {p.inv_30d != null && (
          <span className="text-[11px] tabular-nums text-emerald-400/90">
            {formatCurrency(p.inv_30d)} em 30d
          </span>
        )}
        {p.roas_30d != null && (
          <span className="text-[11px] tabular-nums text-muted-foreground/70">ROAS {p.roas_30d}x</span>
        )}

        {/* A urgência é selo, não ordenação: é o desempate humano */}
        <span className={cn('rounded px-1.5 py-px text-[10px]', URGENCIA_COR[p.urgencia])}>
          {p.urgencia === 'alta' && <Flame className="mr-0.5 inline h-2.5 w-2.5" />}
          {URGENCIA_LABEL[p.urgencia]}
        </span>

        {p.tipo_sugerido && (
          <span className="rounded bg-blue-500/15 px-1.5 py-px text-[10px] text-blue-400">
            sugerido: {p.tipo_sugerido}
          </span>
        )}

        <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground/60">
          {aberto ? `aberto ${rotuloDeDias(p.dias_aberto)}` : (
            p.status === 'atendido'
              ? `atendido${p.card_que_atendeu ? ` por ${p.card_que_atendeu}` : ''}`
              : 'descartado'
          )}
          {aberto && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onFechar}>
              Fechar
            </Button>
          )}
        </span>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">{p.por_que}</p>
      {p.o_que_melhorar && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          <span className="text-muted-foreground/60">melhorar: </span>{p.o_que_melhorar}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground/50">
        {p.solicitado_por_nome && <span>pedido por {p.solicitado_por_nome}</span>}
        {p.atendido_por_nome && <span>· fechado por {p.atendido_por_nome}</span>}
      </div>

      {/*
        O fechamento é manual, então este aviso é o que impede a fila de virar
        ficção: já apareceu uma variação deste AD depois do pedido.
      */}
      {aberto && p.ja_tem_variacao && (
        <p className="mt-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300/90">
          Já existe uma variação deste AD criada depois do pedido — talvez ele já esteja atendido.
        </p>
      )}
    </div>
  );
}

interface Candidato { id: string; nome: string; fase: string; tipo_teste: string | null }

function ModalFechar({ pedido, perfilId, onClose, onSalvo }: {
  pedido: Pedido; perfilId: string | null; onClose: () => void; onSalvo: () => void;
}) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [cardId, setCardId] = useState<string>('_');
  const [nota, setNota] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    /*
      Os candidatos a "quem atendeu": cards de variação do MESMO projeto e do
      mesmo número de AD, criados depois do pedido. Escolher da lista em vez de
      digitar evita o `ad_code` de texto livre que já nos custou o vínculo do
      CopyTrack.
    */
    if (pedido.ad_num == null) { setCandidatos([]); return; }
    void (async () => {
      const { data } = await supabase
        .from('producoes')
        .select('id,nome,fase,tipo_teste,projeto_id,criado_em')
        .eq('tipo', 'criativo')
        .eq('projeto_id', pedido.projeto_id ?? '')
        .gt('criado_em', pedido.criado_em)
        .order('criado_em', { ascending: false })
        .limit(200);
      const so = (data ?? []).filter(c =>
        ['Vertical', 'Horizontal', 'Formato', 'Corpo'].includes((c as Candidato).tipo_teste ?? ''));
      setCandidatos(so as unknown as Candidato[]);
    })();
  }, [pedido]);

  async function salvar(status: 'atendido' | 'descartado') {
    setSalvando(true);
    const { error } = await supabase.from('pedidos_variacao').update({
      status,
      atendido_por: perfilId,
      atendido_em: new Date().toISOString(),
      atendido_por_producao_id: cardId === '_' ? null : cardId,
      nota_fechamento: nota.trim() || null,
    }).eq('id', pedido.id);
    setSalvando(false);
    if (error) { toast({ title: 'Não foi possível fechar o pedido', description: error.message, variant: 'destructive' }); return; }
    toast({ title: status === 'atendido' ? 'Pedido marcado como atendido' : 'Pedido descartado' });
    onSalvo();
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Fechar o pedido de {pedido.ad_num != null ? rotuloDoAdHook(pedido.ad_num, pedido.hook) : pedido.criativo}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Qual card atendeu</Label>
            <Select value={cardId} onValueChange={setCardId}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Não vincular a um card</SelectItem>
                {candidatos.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} {c.tipo_teste ? `· ${c.tipo_teste}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {candidatos.length === 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground/60">
                Nenhuma variação deste projeto criada depois do pedido.
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">Nota (opcional)</Label>
            <Textarea className="mt-1 resize-none text-xs" rows={2}
                      value={nota} onChange={e => setNota(e.target.value)}
                      placeholder="Por que está sendo fechado" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" disabled={salvando}
                  onClick={() => void salvar('descartado')}>
            <X className="mr-1 h-3 w-3" /> Descartar
          </Button>
          <Button size="sm" disabled={salvando} onClick={() => void salvar('atendido')}>
            <Check className="mr-1 h-3 w-3" /> Marcar atendido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
