import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Upload } from 'lucide-react';

// ─── parsers ──────────────────────────────────────────────────────────────────

function detectSep(line: string) {
  // conta ocorrências de cada separador candidato — o mais frequente vence
  const counts = { '\t': 0, ';': 0, ',': 0 };
  for (const ch of line) if (ch in counts) (counts as any)[ch]++;
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as string;
}

// normaliza header para matching robusto: lowercase, sem BOM, sem espaços duplos
function normalizeHeader(h: string) {
  return h
    .replace(/^﻿/, '')   // BOM
    .replace(/ /g, ' ')  // non-breaking space
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function parseCSV(text: string) {
  // remove BOM do início do arquivo
  const clean = text.replace(/^﻿/, '');
  const lines = clean.trim().split(/\r?\n/);
  const sep = detectSep(lines[0]);
  const headers = splitLine(lines[0], sep).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1)
    .map(l => splitLine(l, sep).map(c => c.replace(/^"|"$/g, '').trim()))
    .filter(r => r.length > 1 && r[0]);
  return { headers, rows, sep };
}

function splitLine(line: string, sep: string) {
  const cols: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === sep && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

function parseValor(raw: string): number {
  const s = raw.replace(/R\$\s*/g, '').trim();
  // BR format: 1.234,56 → remove pontos de milhar, vírgula → ponto
  const br = s.replace(/\./g, '').replace(',', '.');
  const v = parseFloat(br);
  return isNaN(v) ? 0 : v;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const m1 = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m2) return m2[1];
  return null;
}

function normalizeStatus(raw: string): string {
  const s = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove acentos corretamente
    .trim();

  // Pago / aprovado / completo (PT e EN)
  if (
    s === 'pago' || s === 'paid' ||
    s.includes('aprovad') || s.includes('approved') ||
    s.includes('complet') || s.includes('confirmad') ||
    s.includes('concluid') || s.includes('sucesso') || s.includes('success')
  ) return 'paid';

  // Reembolso
  if (
    s.includes('reembolso') || s.includes('reembolsad') ||
    s.includes('estorno') || s.includes('chargeback') || s.includes('refund')
  ) return 'refunded';

  // Cancelado
  if (s.includes('cancel')) return 'cancelled';

  // Aguardando / pendente
  if (
    s.includes('aguard') || s.includes('pendente') || s.includes('pending') ||
    s.includes('analise') || s.includes('processand')
  ) return 'pending';

  // fallback: armazena original em lowercase para não perder informação
  return s || 'unknown';
}

// ─── types ────────────────────────────────────────────────────────────────────

type Record_ = {
  payt_id: string;
  data: string | null;
  valor: number;
  status: string;
  tipo_venda: string | null;
  produto: string | null;
  utm_content: string | null;
  utm_ad_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
};

// ─── component ────────────────────────────────────────────────────────────────

export function ImportarPaytModal({ onImported }: { onImported?: () => void }) {
  const [open, setOpen]           = useState(false);
  const [parsed, setParsed]       = useState<Record_[]>([]);
  const [rawStatuses, setRawStatuses]   = useState<string[]>([]);
  const [rawTipos, setRawTipos]         = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parseFile = (text: string): { records: Record_[]; statuses: string[]; tipos: string[] } => {
    const { headers, rows } = parseCSV(text);

    // matching robusto: normaliza tanto o nome buscado quanto o header real
    const colIdx = (name: string) => {
      const norm = normalizeHeader(name);
      return headers.findIndex(h => normalizeHeader(h) === norm);
    };

    const records: Record_[] = [];
    const statusSet = new Set<string>();
    const tipoSet   = new Set<string>();

    for (const r of rows) {
      const get = (name: string) => {
        const i = colIdx(name);
        return i >= 0 ? r[i]?.trim() || null : null;
      };

      const payt_id = get('Código da Venda');
      if (!payt_id) continue;

      const rawStatus = get('Status da Venda') ?? '';
      statusSet.add(rawStatus);
      const status = normalizeStatus(rawStatus);

      const rawTipo = get('Tipo de Venda') ?? '';
      if (rawTipo) tipoSet.add(rawTipo);

      // UTM: tenta (Campanha) primeiro, cai em (URL) se vazio — Meta envia pelo URL
      const utm_raw =
        get('Utm Content (Campanha)') ||
        get('Utm Content (URL)');
      // utm_content formato: "Nome do Ad|ad_id::token" — extrai nome e ad_id
      const utm_content = utm_raw ? utm_raw.split('|')[0].trim() || null : null;
      const utm_ad_id = utm_raw?.includes('|')
        ? (utm_raw.split('|')[1]?.split('::')[0]?.trim() || null)
        : null;

      records.push({
        payt_id,
        data:         parseDate(get('Data') ?? ''),
        valor:        parseValor(get('Valor da Venda') ?? '0'),
        status,
        tipo_venda:   rawTipo || null,
        produto:      get('Produto'),
        utm_content,
        utm_ad_id,
        utm_source:   get('Utm Source (Campanha)')   || get('Utm Source (URL)'),
        utm_medium:   get('Utm Medium (Campanha)')   || get('Utm Medium (URL)'),
        utm_campaign: get('Utm Campaign (Campanha)') || get('Utm Campaign (URL)'),
        utm_term:     get('Utm Term (Campanha)')     || get('Utm Term (URL)'),
      });
    }

    return { records, statuses: [...statusSet], tipos: [...tipoSet] };
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const allRecords: Record_[] = [];
    const allStatuses = new Set<string>();
    const allTipos    = new Set<string>();
    let done = 0;

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = ev => {
        const { records, statuses, tipos } = parseFile(ev.target?.result as string);
        allRecords.push(...records);
        statuses.forEach(s => allStatuses.add(s));
        tipos.forEach(t => allTipos.add(t));
        done++;
        if (done === files.length) {
          const seen = new Set<string>();
          const unique = allRecords.filter(r => {
            if (seen.has(r.payt_id)) return false;
            seen.add(r.payt_id);
            return true;
          });
          setParsed(unique);
          setRawStatuses([...allStatuses]);
          setRawTipos([...allTipos]);
          if (inputRef.current) inputRef.current.value = '';
        }
      };
      reader.readAsText(file, 'UTF-8');
    }
  };

  const handleImport = async () => {
    setImporting(true);
    const BATCH = 200;
    let total = 0;
    let failed = 0;

    for (let i = 0; i < parsed.length; i += BATCH) {
      const { error } = await supabase
        .from('vendas_payt')
        .upsert(parsed.slice(i, i + BATCH), { onConflict: 'payt_id' });
      if (error) { failed++; console.error(error.message); }
      else total += Math.min(BATCH, parsed.length - i);
    }

    setImporting(false);

    if (failed === 0) {
      toast({ title: `${total} vendas importadas` });
      setOpen(false);
      setParsed([]);
      setRawStatuses([]);
      setRawTipos([]);
      onImported?.();
    } else {
      toast({
        title: 'Importação com erros',
        description: `${total} ok · ${failed} lotes com falha`,
        variant: 'destructive',
      });
    }
  };

  const preview  = parsed.slice(0, 6);
  const paid     = parsed.filter(r => r.status === 'paid').length;
  const withAd   = parsed.filter(r => r.utm_content).length;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-1" />
        Importar histórico
      </Button>

      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) { setParsed([]); setRawStatuses([]); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar histórico de vendas — Payt</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Exporte o relatório de pedidos da Payt em CSV. Pode selecionar vários arquivos de uma vez.
              Registros duplicados são ignorados automaticamente.
            </p>

            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Clique para selecionar os CSVs</p>
              <p className="text-xs text-muted-foreground mt-1">Pode selecionar vários arquivos de uma vez</p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.txt,.tsv"
                multiple
                className="hidden"
                onChange={handleFile}
              />
            </div>

            {parsed.length > 0 && (
              <div className="space-y-3">
                {/* resumo */}
                <div className="flex items-center gap-4 text-sm flex-wrap">
                  <span className="font-medium">{parsed.length} registros</span>
                  <span className="text-emerald-400">{paid} pagos</span>
                  <span className="text-muted-foreground">{withAd} com anúncio</span>
                  <span className="text-muted-foreground">{parsed.length - paid} outros</span>
                </div>

                {/* debug — status e tipos encontrados */}
                <div className="text-xs bg-secondary/50 rounded-md px-3 py-2 space-y-1">
                  {rawStatuses.length > 0 && (
                    <>
                      <p className="text-muted-foreground font-medium">Status encontrados no CSV:</p>
                      {rawStatuses.map(s => (
                        <p key={s} className="font-mono">
                          <span className="text-foreground">"{s}"</span>
                          <span className="text-muted-foreground ml-2">→ {normalizeStatus(s)}</span>
                        </p>
                      ))}
                    </>
                  )}
                  {rawTipos.length > 0 && (
                    <>
                      <p className="text-muted-foreground font-medium mt-2">Tipos de venda encontrados:</p>
                      {rawTipos.map(t => (
                        <p key={t} className="font-mono text-foreground">"{t}"</p>
                      ))}
                    </>
                  )}
                </div>

                {/* prévia */}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30 text-muted-foreground uppercase">
                        <th className="px-3 py-2 text-left">ID Payt</th>
                        <th className="px-3 py-2 text-left">Data</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-right">Valor</th>
                        <th className="px-3 py-2 text-left">Anúncio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="px-3 py-2 font-mono">{r.payt_id}</td>
                          <td className="px-3 py-2">{r.data ?? '—'}</td>
                          <td className="px-3 py-2">{r.status}</td>
                          <td className="px-3 py-2 text-right">R$ {r.valor.toFixed(2)}</td>
                          <td className="px-3 py-2 max-w-48 truncate text-muted-foreground" title={r.utm_content ?? ''}>
                            {r.utm_content ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.length > 6 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      + {parsed.length - 6} registros não exibidos
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setParsed([]); setRawStatuses([]); setRawTipos([]); }}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={parsed.length === 0 || importing}>
              {importing ? 'Importando...' : `Importar ${parsed.length} registros`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
