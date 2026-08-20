import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { CopyOfferTracking } from '@/features/copywriters/types';
import { Plus, Trash2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
  });
}

function hoje() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Histórico de anúncios ativos de uma oferta. Aceita quantos registros forem
 * necessários — um por dia de observação. O número do dia é calculado a partir
 * da data mais antiga já registrada, para que a sequência continue certa mesmo
 * quando um dia é lançado fora de ordem.
 */
export function OfferTracking({
  offerId,
  tracking,
  onChanged,
}: {
  offerId: string;
  tracking: CopyOfferTracking[];
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [data, setData] = useState(hoje());
  const [ads, setAds] = useState('');
  const [notas, setNotas] = useState('');
  const [salvando, setSalvando] = useState(false);

  const ordenado = [...tracking].sort((a, b) =>
    (a.tracked_date ?? '').localeCompare(b.tracked_date ?? ''),
  );

  async function adicionar() {
    const qtd = Number(ads);
    if (!data) {
      toast({ title: 'Informe a data', variant: 'destructive' });
      return;
    }
    if (!ads.trim() || Number.isNaN(qtd) || qtd < 0) {
      toast({ title: 'Informe a quantidade de anúncios', variant: 'destructive' });
      return;
    }
    if (ordenado.some(t => t.tracked_date === data)) {
      toast({
        title: 'Já existe registro nesta data',
        description: 'Exclua o registro anterior para lançar outro valor no mesmo dia.',
        variant: 'destructive',
      });
      return;
    }

    setSalvando(true);
    // Dia 1 é a data mais antiga do histórico; a nova data pode ser anterior a ela.
    const primeira = ordenado[0]?.tracked_date;
    const base = primeira && primeira < data ? primeira : data;
    const dias = Math.round(
      (new Date(data + 'T00:00:00').getTime() - new Date(base + 'T00:00:00').getTime()) / 86_400_000,
    );

    const { error } = await supabase.from('copytrack_offer_tracking').insert({
      offer_id: offerId,
      tracked_date: data,
      active_ads_count: qtd,
      day_number: dias + 1,
      notes: notas.trim() || null,
    });
    setSalvando(false);

    if (error) {
      toast({ title: 'Erro ao registrar', description: error.message, variant: 'destructive' });
      return;
    }
    setAds('');
    setNotas('');
    setData(hoje());
    onChanged();
  }

  async function excluir(t: CopyOfferTracking) {
    const ok = await confirm({
      title: 'Excluir registro?',
      description: `O registro de ${fmtDate(t.tracked_date)} com ${t.active_ads_count ?? 0} anúncios será removido.`,
    });
    if (!ok) return;

    const { error } = await supabase.from('copytrack_offer_tracking').delete().eq('id', t.id);
    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
      return;
    }
    onChanged();
  }

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Histórico de anúncios
      </p>

      {ordenado.length > 0 && (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1 pr-4 text-left font-medium">Dia</th>
                <th className="py-1 pr-4 text-left font-medium">Data</th>
                <th className="py-1 pr-4 text-left font-medium">Ads ativos</th>
                <th className="py-1 pr-4 text-left font-medium">Variação</th>
                <th className="py-1 text-left font-medium">Notas</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {ordenado.map((t, i) => {
                const anterior = i > 0 ? (ordenado[i - 1].active_ads_count ?? 0) : null;
                const atual = t.active_ads_count ?? 0;
                const delta = anterior === null ? null : atual - anterior;
                return (
                  <tr key={t.id} className="group border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-4 tabular-nums text-muted-foreground">#{t.day_number ?? '—'}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{fmtDate(t.tracked_date)}</td>
                    <td className="py-1.5 pr-4 font-medium tabular-nums">{atual}</td>
                    <td className="py-1.5 pr-4">
                      {delta === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 tabular-nums',
                            delta > 0 ? 'text-emerald-500' : delta < 0 ? 'text-red-500' : 'text-muted-foreground',
                          )}
                        >
                          {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                          {delta > 0 ? `+${delta}` : delta}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-muted-foreground">{t.notes ?? '—'}</td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => excluir(t)}
                        title="Excluir registro"
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Data</label>
          <Input
            type="date"
            value={data}
            onChange={e => setData(e.target.value)}
            className="mt-0.5 h-8 w-36 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Ads ativos</label>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={ads}
            onChange={e => setAds(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionar()}
            placeholder="0"
            className="mt-0.5 h-8 w-24 text-xs"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Notas (opcional)</label>
          <Input
            value={notas}
            onChange={e => setNotas(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && adicionar()}
            placeholder="Ex: escalou criativo novo"
            className="mt-0.5 h-8 text-xs"
          />
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={adicionar} disabled={salvando}>
          <Plus className="h-3.5 w-3.5" />
          {salvando ? 'Salvando...' : 'Registrar'}
        </Button>
      </div>

      {ordenado.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Nenhum registro ainda. Lance o primeiro dia acima.
        </p>
      )}
    </div>
  );
}
