import { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, ExternalLink, Plus, Pencil, Trash2 } from 'lucide-react';

// ─── types ───────────────────────────────────────────────────────────────────

interface Ferramenta {
  id: string;
  nome: string;
  categoria: string | null;
  valor_mensal: number | null;
  moeda: string;
  renovacao_dia: number | null;
  ativo: boolean;
}

interface NotaFiscal {
  id: string;
  ferramenta_id: string;
  mes: string;
  status: 'pendente' | 'recebida' | 'enviada';
  drive_url: string | null;
  observacoes: string | null;
}

type StatusNF = 'pendente' | 'recebida' | 'enviada';

const STATUS_CONFIG: Record<StatusNF, { label: string; class: string }> = {
  pendente: { label: 'Pendente', class: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
  recebida: { label: 'Recebida', class: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  enviada:  { label: 'Enviada',  class: 'bg-green-500/10 text-green-400 border-green-500/30' },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function primeiroDiaMes(yyyy: number, mm: number) {
  return `${yyyy}-${String(mm).padStart(2, '0')}-01`;
}
function labelMes(yyyy: number, mm: number) {
  return new Date(yyyy, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function navegarMes(yyyy: number, mm: number, delta: number) {
  let m = mm + delta;
  let y = yyyy;
  if (m > 12) { m = 1;  y += 1; }
  if (m < 1)  { m = 12; y -= 1; }
  return { yyyy: y, mm: m };
}

// ─── component ───────────────────────────────────────────────────────────────

export default function FinanceiroNotasFiscaisPage() {
  const now = new Date();
  const [ano, setAno] = useState(now.getFullYear());
  const [mes, setMes] = useState(now.getMonth() + 1);

  const [ferramentas, setFerramentas] = useState<Ferramenta[]>([]);
  const [notas, setNotas]             = useState<NotaFiscal[]>([]);
  const [loading, setLoading]         = useState(true);

  // modais
  const [modalNF, setModalNF]             = useState<{ ferramenta: Ferramenta; nota: NotaFiscal | null } | null>(null);
  const [modalFerramenta, setModalFerramenta] = useState<Ferramenta | null | 'nova'>(null);
  const [salvando, setSalvando]           = useState(false);

  // form NF
  const [nfStatus, setNfStatus]       = useState<StatusNF>('pendente');
  const [nfDriveUrl, setNfDriveUrl]   = useState('');
  const [nfObs, setNfObs]             = useState('');

  // form ferramenta
  const [ftNome, setFtNome]           = useState('');
  const [ftCategoria, setFtCategoria] = useState('');
  const [ftValor, setFtValor]         = useState('');
  const [ftMoeda, setFtMoeda]         = useState('BRL');
  const [ftDia, setFtDia]             = useState('');

  // ── load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const mesStr = primeiroDiaMes(ano, mes);

    const [ftRes, nfRes] = await Promise.all([
      supabase.from('ferramentas_saas').select('*').eq('ativo', true).order('nome'),
      supabase.from('notas_fiscais').select('*').eq('mes', mesStr),
    ]);

    if (ftRes.error || nfRes.error) toast({ title: 'Erro ao carregar dados', variant: 'destructive' });
    setFerramentas(ftRes.data || []);
    setNotas(nfRes.data || []);
    setLoading(false);
  }, [ano, mes]);

  useEffect(() => { load(); }, [load]);

  // ── navegar mês ──────────────────────────────────────────────────────────

  function irMes(delta: number) {
    const { yyyy, mm } = navegarMes(ano, mes, delta);
    setAno(yyyy); setMes(mm);
  }

  // ── abrir modal NF ───────────────────────────────────────────────────────

  function abrirNF(ferramenta: Ferramenta) {
    const nota = notas.find(n => n.ferramenta_id === ferramenta.id) || null;
    setNfStatus(nota?.status || 'pendente');
    setNfDriveUrl(nota?.drive_url || '');
    setNfObs(nota?.observacoes || '');
    setModalNF({ ferramenta, nota });
  }

  async function salvarNF() {
    if (!modalNF) return;
    setSalvando(true);
    const mesStr = primeiroDiaMes(ano, mes);
    const payload = {
      ferramenta_id: modalNF.ferramenta.id,
      mes: mesStr,
      status: nfStatus,
      drive_url: nfDriveUrl.trim() || null,
      observacoes: nfObs.trim() || null,
    };

    let error;
    if (modalNF.nota) {
      ({ error } = await supabase.from('notas_fiscais').update(payload).eq('id', modalNF.nota.id));
    } else {
      ({ error } = await supabase.from('notas_fiscais').insert(payload));
    }

    if (error) toast({ title: 'Erro ao salvar', variant: 'destructive' });
    else toast({ title: 'Nota fiscal salva' });
    setSalvando(false);
    setModalNF(null);
    load();
  }

  // ── ferramenta CRUD ──────────────────────────────────────────────────────

  function abrirFerramenta(ft: Ferramenta | 'nova') {
    if (ft === 'nova') {
      setFtNome(''); setFtCategoria(''); setFtValor(''); setFtMoeda('BRL'); setFtDia('');
    } else {
      setFtNome(ft.nome);
      setFtCategoria(ft.categoria || '');
      setFtValor(ft.valor_mensal != null ? String(ft.valor_mensal) : '');
      setFtMoeda(ft.moeda);
      setFtDia(ft.renovacao_dia != null ? String(ft.renovacao_dia) : '');
    }
    setModalFerramenta(ft);
  }

  async function salvarFerramenta() {
    if (!modalFerramenta) return;
    setSalvando(true);
    const payload = {
      nome: ftNome.trim(),
      categoria: ftCategoria.trim() || null,
      valor_mensal: ftValor ? Number(ftValor.replace(',', '.')) : null,
      moeda: ftMoeda,
      renovacao_dia: ftDia ? Number(ftDia) : null,
      ativo: true,
    };
    let error;
    if (modalFerramenta === 'nova') {
      ({ error } = await supabase.from('ferramentas_saas').insert(payload));
    } else {
      ({ error } = await supabase.from('ferramentas_saas').update(payload).eq('id', modalFerramenta.id));
    }
    if (error) toast({ title: 'Erro ao salvar ferramenta', variant: 'destructive' });
    else toast({ title: modalFerramenta === 'nova' ? 'Ferramenta adicionada' : 'Ferramenta atualizada' });
    setSalvando(false);
    setModalFerramenta(null);
    load();
  }

  async function desativarFerramenta(ft: Ferramenta) {
    const { error } = await supabase.from('ferramentas_saas').update({ ativo: false }).eq('id', ft.id);
    if (error) toast({ title: 'Erro ao remover', variant: 'destructive' });
    else toast({ title: `${ft.nome} removida` });
    load();
  }

  // ── derivados ────────────────────────────────────────────────────────────

  const totalMensal = ferramentas.reduce((s, f) => {
    if (!f.valor_mensal || f.moeda !== 'BRL') return s;
    return s + f.valor_mensal;
  }, 0);
  const pendentes  = ferramentas.filter(f => !notas.find(n => n.ferramenta_id === f.id && n.status !== 'pendente')).length;

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <DashboardLayout title="Financeiro" hideFilters>
      <FinanceiroNav />

      {/* cabeçalho */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => irMes(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium capitalize w-44 text-center">{labelMes(ano, mes)}</span>
          <Button variant="ghost" size="icon" onClick={() => irMes(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{pendentes} pendente{pendentes !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>Total BRL: <strong className="text-foreground">{formatCurrency(totalMensal)}</strong></span>
          <Button size="sm" onClick={() => abrirFerramenta('nova')}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Ferramenta
          </Button>
        </div>
      </div>

      {/* tabela */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Ferramenta</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-36">Categoria</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-28">Valor/mês</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-28">Renova</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-28">NF</th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-24">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Carregando…</td></tr>
            )}
            {!loading && ferramentas.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhuma ferramenta cadastrada</td></tr>
            )}
            {ferramentas.map(ft => {
              const nota = notas.find(n => n.ferramenta_id === ft.id);
              const status = (nota?.status || 'pendente') as StatusNF;
              const cfg = STATUS_CONFIG[status];
              return (
                <tr key={ft.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{ft.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{ft.categoria || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {ft.valor_mensal != null ? `${ft.moeda !== 'BRL' ? ft.moeda + ' ' : ''}${ft.moeda === 'BRL' ? formatCurrency(ft.valor_mensal) : ft.valor_mensal.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground text-xs">
                    {ft.renovacao_dia != null ? `Dia ${ft.renovacao_dia}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Badge variant="outline" className={cn('text-[10px] cursor-pointer', cfg.class)} onClick={() => abrirNF(ft)}>
                        {cfg.label}
                      </Badge>
                      {nota?.drive_url && (
                        <a href={nota.drive_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirFerramenta(ft)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => desativarFerramenta(ft)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* modal NF */}
      <Dialog open={!!modalNF} onOpenChange={o => !o && setModalNF(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nota fiscal — {modalNF?.ferramenta.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={nfStatus} onValueChange={v => setNfStatus(v as StatusNF)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="recebida">Recebida</SelectItem>
                  <SelectItem value="enviada">Enviada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Link do Drive</Label>
              <Input value={nfDriveUrl} onChange={e => setNfDriveUrl(e.target.value)} placeholder="https://drive.google.com/…" />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Input value={nfObs} onChange={e => setNfObs(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalNF(null)}>Cancelar</Button>
            <Button onClick={salvarNF} disabled={salvando}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* modal ferramenta */}
      <Dialog open={!!modalFerramenta} onOpenChange={o => !o && setModalFerramenta(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{modalFerramenta === 'nova' ? 'Nova ferramenta' : 'Editar ferramenta'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Nome *</Label>
              <Input value={ftNome} onChange={e => setFtNome(e.target.value)} placeholder="Ex: Notion, Slack…" />
            </div>
            <div>
              <Label className="text-xs">Categoria</Label>
              <Input value={ftCategoria} onChange={e => setFtCategoria(e.target.value)} placeholder="Ex: Produtividade" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs">Valor mensal</Label>
                <Input value={ftValor} onChange={e => setFtValor(e.target.value)} placeholder="0,00" />
              </div>
              <div className="w-24">
                <Label className="text-xs">Moeda</Label>
                <Select value={ftMoeda} onValueChange={setFtMoeda}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRL">BRL</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Dia de renovação</Label>
              <Input value={ftDia} onChange={e => setFtDia(e.target.value)} placeholder="Ex: 15" type="number" min={1} max={31} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalFerramenta(null)}>Cancelar</Button>
            <Button onClick={salvarFerramenta} disabled={salvando || !ftNome.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
