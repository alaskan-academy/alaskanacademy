import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowDownCircle, ArrowUpCircle, Scale, X, Download } from 'lucide-react';
import { CATEGORIAS, CENTROS_CUSTO } from '@/features/financeiro/constants';

interface Transacao {
  id: string;
  data: string;
  /** O nome que ela deu ao fornecedor — ou o descritor, quando não há apelido. */
  nome: string;
  /** O descritor cru do banco, como aparece no extrato. Os dois convivem: a
   *  contabilidade concilia pelo original, ela reconhece pelo nome. */
  descricao_original: string;
  /** "Cartão •••• 6896", "PIX Enviado", "Recebimento via PIX"… */
  meio_pagamento: string;
  valor: number;
  categoria: string | null;
  /** Grupo resolvido pelo plano de contas, não o centro cru do CS. */
  grupo: string | null;
  status_revisao: string;
}

const TODOS = '__todos__';

function primeiroDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function ultimoDiaMes(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

export default function FinanceiroConciliacaoPage() {
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);

  const [dataInicio, setDataInicio] = useState(primeiroDiaMes());
  const [dataFim, setDataFim]       = useState(ultimoDiaMes());
  const [fCategoria, setFCategoria] = useState(TODOS);
  const [fCentro, setFCentro]       = useState(TODOS);
  const [fStatus, setFStatus]       = useState(TODOS);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('vw_conciliacao')
      .select('id,data,nome,descricao_original,meio_pagamento,valor,categoria,grupo,status_revisao')
      .gte('data', dataInicio)
      .lte('data', dataFim)
      .order('data', { ascending: false });

    if (fCategoria !== TODOS) query = query.eq('categoria', fCategoria);
    if (fCentro    !== TODOS) query = query.eq('grupo', fCentro);
    if (fStatus    !== TODOS) query = query.eq('status_revisao', fStatus);

    const { data, error } = await query.limit(1000);
    if (error) toast({ title: 'Erro ao carregar extrato', variant: 'destructive' });
    setTransacoes(data || []);
    setLoading(false);
  }, [dataInicio, dataFim, fCategoria, fCentro, fStatus]);

  useEffect(() => { load(); }, [load]);

  const limparFiltros = () => {
    setDataInicio(primeiroDiaMes());
    setDataFim(ultimoDiaMes());
    setFCategoria(TODOS);
    setFCentro(TODOS);
    setFStatus(TODOS);
  };

  const temFiltroAtivo = fCategoria !== TODOS || fCentro !== TODOS || fStatus !== TODOS;

  /**
   * Exporta o que está na tela para a contabilidade.
   *
   * Ponto e vírgula e não vírgula: o Excel em português usa `;` como separador,
   * e com `,` a planilha abre tudo espremido numa coluna só.
   *
   * Valor com vírgula decimal e sem separador de milhar — é o formato que o
   * Excel brasileiro entende como número. Com ponto ele lê como texto e a
   * contabilidade não consegue somar.
   *
   * BOM (U+FEFF) na frente: sem ele o Excel abre o arquivo em Latin-1 e todo
   * acento vira caractere quebrado.
   */
  function exportarCsv() {
    if (transacoes.length === 0) {
      toast({ title: 'Nada para exportar', description: 'Nenhuma transação no período e nos filtros escolhidos.' });
      return;
    }

    const escapa = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [
      ['Data', 'Nome', 'Descrição original', 'Meio de pagamento', 'Categoria', 'Grupo', 'Valor'].join(';'),
      ...transacoes.map(t => [
        escapa(t.data.split('-').reverse().join('/')),
        escapa(t.nome),
        escapa(t.descricao_original),
        escapa(t.meio_pagamento),
        escapa(t.categoria ?? ''),
        escapa(t.grupo ?? ''),
        escapa(t.valor.toFixed(2).replace('.', ',')),
      ].join(';')),
    ].join('\r\n');

    const blob = new Blob(['﻿' + linhas], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conciliacao_${dataInicio}_a_${dataFim}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: `${transacoes.length} lançamentos exportados`, description: a.download });
  }

  const totais = useMemo(() => {
    const entradas = transacoes.filter(t => t.valor > 0).reduce((s, t) => s + t.valor, 0);
    const saidas   = transacoes.filter(t => t.valor < 0).reduce((s, t) => s + t.valor, 0);
    return { entradas, saidas, saldo: entradas + saidas };
  }, [transacoes]);

  const porCategoria = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of transacoes) {
      if (t.valor >= 0) continue; // só custos
      const key = t.categoria || 'Sem categoria';
      map.set(key, (map.get(key) || 0) + Math.abs(t.valor));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [transacoes]);

  return (
    <DashboardLayout title="Financeiro" hideFilters>
      <FinanceiroNav />

      {/* filtros */}
      <div className="bg-card border border-border rounded-xl p-4 mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="w-[150px]" />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="w-[150px]" />
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={fCategoria} onValueChange={setFCategoria}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value={TODOS}>Todas</SelectItem>
                {CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Centro de custo</Label>
            <Select value={fCentro} onValueChange={setFCentro}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                {CENTROS_CUSTO.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="auto_categorizado">Auto</SelectItem>
                <SelectItem value="confirmado">Confirmado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {temFiltroAtivo && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-muted-foreground">
              <X className="h-3.5 w-3.5 mr-1.5" /> Limpar filtros
            </Button>
          )}
          {/* Exporta o que está na tela, com os filtros aplicados — é o que faz
              o botão ser útil: filtra o mês, confere, manda para a contabilidade. */}
          <Button variant="outline" size="sm" onClick={exportarCsv} disabled={loading}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Exportar CSV{!loading && transacoes.length > 0 ? ` (${transacoes.length})` : ''}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* extrato */}
        <div className="lg:col-span-3 bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-28">Data</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Nome / descrição original</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-40">Meio de pagamento</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-44">Categoria</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-36">Grupo</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-32">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {loading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Carregando…</td></tr>
                )}
                {!loading && transacoes.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Nenhuma transação no período</td></tr>
                )}
                {transacoes.map(t => (
                  <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">{t.data.split('-').reverse().join('/')}</td>
                    {/* Os dois nomes juntos: o apelido em cima porque é o que
                        ela reconhece, o descritor embaixo porque é por ele que
                        a contabilidade concilia com o extrato do banco. */}
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-medium truncate">{t.nome}</div>
                      {t.descricao_original !== t.nome && (
                        <div className="text-[11px] text-muted-foreground/70 truncate" title={t.descricao_original}>
                          {t.descricao_original}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs truncate">{t.meio_pagamento}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs truncate">{t.categoria || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs truncate">{t.grupo || '—'}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums font-medium', t.valor < 0 ? 'text-red-400' : 'text-green-400')}>
                      {formatCurrency(Math.abs(t.valor))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* totais */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <ArrowUpCircle className="h-4 w-4 text-green-400 shrink-0" />
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Entradas</p>
                <p className="text-base font-semibold text-green-400">{formatCurrency(totais.entradas)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <ArrowDownCircle className="h-4 w-4 text-red-400 shrink-0" />
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Saídas</p>
                <p className="text-base font-semibold text-red-400">{formatCurrency(Math.abs(totais.saidas))}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 pt-2 border-t border-border">
              <Scale className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Saldo</p>
                <p className={cn('text-base font-semibold', totais.saldo >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {formatCurrency(totais.saldo)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Top categorias (custos)</p>
            {porCategoria.length === 0 && <p className="text-xs text-muted-foreground">Sem dados no período</p>}
            <div className="space-y-2">
              {porCategoria.map(([categoria, valor]) => {
                const pct = totais.saidas !== 0 ? (valor / Math.abs(totais.saidas)) * 100 : 0;
                return (
                  <div key={categoria}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="truncate text-foreground/80">{categoria}</span>
                      <span className="tabular-nums text-muted-foreground shrink-0 ml-2">{formatCurrency(valor)}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
