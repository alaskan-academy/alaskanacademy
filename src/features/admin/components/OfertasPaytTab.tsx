import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Cadastro das ofertas da Payt — o que liga o código de um produto ao produto e ao
 * tipo (principal, order bump, upsell).
 *
 * Existe porque essa tabela não tinha tela nenhuma. As duas telas que dizem "ofertas"
 * no menu apontam para outras tabelas: Editores → `ofertas_editores`, CopyTrack →
 * `copytrack_offers`. Sem cadastro aqui, a venda entra sem produto e some de todo
 * recorte por produto — e a única forma de arrumar era SQL.
 */

type Oferta = {
  id: string;
  code_payt: string;
  nome: string;
  produto: string | null;
  tipo: string | null;
  ativo: boolean;
};

const PRODUTOS = ['velas', 'saponaria', 'cosmeticos', 'hormonal', 'velaroma', 'handify'];
const TIPOS = ['oferta_principal', 'orderbump_1', 'orderbump_2', 'orderbump_3', 'orderbump_4', 'upsell'];

const TIPO_LABEL: Record<string, string> = {
  oferta_principal: 'Principal',
  orderbump_1: 'Order bump 1',
  orderbump_2: 'Order bump 2',
  orderbump_3: 'Order bump 3',
  orderbump_4: 'Order bump 4',
  upsell: 'Upsell',
};

const vazio = { code_payt: '', nome: '', produto: '', tipo: 'oferta_principal' };

export function OfertasPaytTab() {
  const [ofertas, setOfertas] = useState<Oferta[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [soSemProduto, setSoSemProduto] = useState(false);
  const [nova, setNova] = useState(vazio);
  const [criando, setCriando] = useState(false);

  const carregar = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ofertas')
      .select('id, code_payt, nome, produto, tipo, ativo')
      .order('nome');
    if (error) toast({ title: 'Erro ao carregar', description: error.message, variant: 'destructive' });
    setOfertas(data || []);
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  /**
   * Toda gravação confere quantas linhas mudaram.
   *
   * O PostgREST devolve 200 com zero linhas quando a RLS barra a escrita, sem erro
   * nenhum — foi assim que as Configurações e o Caixa passaram meses dizendo "salvo"
   * sem gravar nada. Só checar `error` não basta.
   */
  const gravar = async (id: string, campos: Partial<Oferta>) => {
    setSalvando(id);
    const { data, error } = await supabase
      .from('ofertas').update(campos).eq('id', id).select('id');
    setSalvando(null);

    if (error) {
      toast({ title: 'Não salvou', description: error.message, variant: 'destructive' });
      return false;
    }
    if (!data || data.length === 0) {
      toast({
        title: 'Não salvou',
        description: 'Nenhuma linha alterada — provável falta de permissão.',
        variant: 'destructive',
      });
      return false;
    }
    setOfertas(atual => atual.map(o => (o.id === id ? { ...o, ...campos } : o)));
    return true;
  };

  const criar = async () => {
    const code = nova.code_payt.trim();
    const nome = nova.nome.trim();
    if (!code || !nome) {
      toast({ title: 'Faltou preencher', description: 'Código e nome são obrigatórios.', variant: 'destructive' });
      return;
    }
    setCriando(true);
    const { data, error } = await supabase
      .from('ofertas')
      .insert({
        code_payt: code,
        nome,
        produto: nova.produto || null,
        tipo: nova.tipo,
        ativo: true,
      })
      .select('id');
    setCriando(false);

    if (error) {
      // A colisão de código é o erro esperado aqui; vale dizer isso em vez de
      // devolver a mensagem crua do Postgres.
      const duplicado = error.message.includes('duplicate') || error.code === '23505';
      toast({
        title: 'Não criou',
        description: duplicado ? `Já existe uma oferta com o código ${code}.` : error.message,
        variant: 'destructive',
      });
      return;
    }
    if (!data || data.length === 0) {
      toast({ title: 'Não criou', description: 'Nenhuma linha inserida — provável falta de permissão.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Oferta criada' });
    setNova(vazio);
    carregar();
  };

  const semProduto = useMemo(() => ofertas.filter(o => !o.produto).length, [ofertas]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return ofertas.filter(o => {
      if (soSemProduto && o.produto) return false;
      if (!termo) return true;
      return o.nome.toLowerCase().includes(termo) || o.code_payt.toLowerCase().includes(termo);
    });
  }, [ofertas, busca, soSemProduto]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Ofertas Payt</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Liga o código do produto na Payt ao produto e ao tipo. Oferta sem produto faz a
          venda ficar de fora de todo recorte por produto no dashboard.
        </p>
      </div>

      {semProduto > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="flex-1">
            <p className="font-medium text-amber-200">
              {semProduto} oferta{semProduto > 1 ? 's' : ''} sem produto definido
            </p>
            <p className="mt-0.5 text-amber-200/70">
              Enquanto não tiverem produto, qualquer venda delas entra sem classificação.
            </p>
          </div>
          <button
            onClick={() => setSoSemProduto(v => !v)}
            className="shrink-0 rounded-md border border-amber-500/40 px-2 py-1 font-medium text-amber-200 hover:bg-amber-500/10"
          >
            {soSemProduto ? 'Ver todas' : 'Ver só essas'}
          </button>
        </div>
      )}

      {/* Nova oferta */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[130px] flex-1">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Código Payt
            </label>
            <Input
              value={nova.code_payt}
              onChange={e => setNova({ ...nova, code_payt: e.target.value })}
              placeholder="L9Q6EN"
              className="h-8 text-sm"
            />
          </div>
          <div className="min-w-[200px] flex-[2]">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Nome
            </label>
            <Input
              value={nova.nome}
              onChange={e => setNova({ ...nova, nome: e.target.value })}
              placeholder="Workshop Desafios na Sala de Aula"
              className="h-8 text-sm"
            />
          </div>
          <div className="min-w-[130px]">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Produto
            </label>
            <select
              value={nova.produto}
              onChange={e => setNova({ ...nova, produto: e.target.value })}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">— sem produto —</option>
              {PRODUTOS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Tipo
            </label>
            <select
              value={nova.tipo}
              onChange={e => setNova({ ...nova, tipo: e.target.value })}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {TIPOS.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
            </select>
          </div>
          <Button size="sm" className="h-8 gap-1.5" onClick={criar} disabled={criando}>
            <Plus className="h-3.5 w-3.5" />
            {criando ? 'Criando...' : 'Adicionar'}
          </Button>
        </div>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome ou código..."
          className="h-8 pl-8 pr-8 text-sm"
        />
        {busca && (
          <button
            onClick={() => setBusca('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
        ) : visiveis.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {ofertas.length === 0 ? 'Nenhuma oferta cadastrada' : 'Nenhuma oferta encontrada'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Nome', 'Código Payt', 'Produto', 'Tipo', 'Ativa'].map(c => (
                    <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiveis.map(o => (
                  <tr
                    key={o.id}
                    className={cn(
                      'border-b border-border/50 last:border-0',
                      salvando === o.id && 'opacity-60',
                      !o.ativo && 'opacity-50',
                    )}
                  >
                    <td className="px-3 py-2">{o.nome}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{o.code_payt}</td>
                    <td className="px-3 py-2">
                      <select
                        value={o.produto || ''}
                        onChange={e => gravar(o.id, { produto: e.target.value || null })}
                        className={cn(
                          'h-7 rounded-md border bg-background px-2 text-xs',
                          o.produto ? 'border-border' : 'border-amber-500/50 text-amber-300',
                        )}
                      >
                        <option value="">— sem produto —</option>
                        {PRODUTOS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={o.tipo || ''}
                        onChange={e => gravar(o.id, { tipo: e.target.value || null })}
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                      >
                        <option value="">—</option>
                        {TIPOS.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => gravar(o.id, { ativo: !o.ativo })}
                        className={cn(
                          'rounded px-2 py-0.5 text-xs font-medium',
                          o.ativo
                            ? 'bg-success/15 text-success'
                            : 'bg-secondary text-muted-foreground',
                        )}
                      >
                        {o.ativo ? 'Ativa' : 'Inativa'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {visiveis.length} de {ofertas.length} oferta{ofertas.length === 1 ? '' : 's'}
        {semProduto > 0 && ` · ${semProduto} sem produto`}
      </p>
    </div>
  );
}
