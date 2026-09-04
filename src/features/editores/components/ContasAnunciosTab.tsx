import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/hooks/use-confirm';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/**
 * O que as vendas da conta dizem que ela vende.
 *
 * Substituiu o campo `produto_payt`, que era digitado à mão e cabia um produto só. A
 * "Workshop Buquê - TSL" vende dois — Workshop Buquê (490) e Kit Completo (33) —, e as
 * 33 sumiam da atribuição da aba Criativos por não baterem com o texto configurado.
 * Uma CA também pode simplesmente passar a vender outra coisa, e ninguém lembra de vir
 * aqui trocar.
 */
type Derivado = { conta_id: string; produtos: { produto: string; vendas: number }[]; total: number };

type Conta = {
  id: string;
  account_id: string;
  nome: string;
  ativo: boolean;
  roas_meta: number | null;
  cpa_meta: number | null;
};

/**
 * Meta derivada da estrutura de custo real, devolvida por `fn_metas_sugeridas`.
 *
 * Existe porque uma meta digitada uma vez envelhece calada: o Simples muda de faixa,
 * a taxa da Payt muda com o mix de parcelamento, o custo fixo sobe — e o número na
 * tela segue cobrando a conta por um alvo que não corresponde mais a nada.
 */
type Sugestao = {
  conta_id: string;
  ticket_medio: number;
  /** Marginal: vale a pena mais um real nesta conta? Custo fixo não entra. */
  roas_equilibrio: number;
  roas_alvo: number;
  /** Operação: o negócio inteiro se paga? Custo fixo rateado sobre o investimento. */
  roas_equilibrio_op: number;
  roas_alvo_op: number;
  roas_atual: number | null;
  cpa_atual: number | null;
  taxa_pct: number;
  simples_pct: number;
  imposto_meta_pct: number;
  custo_fixo_periodo: number;
  investimento_periodo: number;
  dias: number;
};

/** PostgREST devolve `numeric` como string; somar isso dá concatenação. */
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

type Base = 'campanha' | 'operacao' | 'margem';

const BASES: { chave: Base; rotulo: string; ajuda: string }[] = [
  { chave: 'campanha', rotulo: 'Equilíbrio da campanha',
    ajuda: 'Abaixo disso a campanha perde dinheiro sozinha. Não inclui custo fixo, porque ele não muda se a campanha ligar ou desligar.' },
  { chave: 'operacao', rotulo: 'Equilíbrio da operação',
    ajuda: 'Inclui o custo fixo rateado sobre o investimento do período: é o ROAS que paga a conta de luz.' },
  { chave: 'margem',   rotulo: 'Margem de 30%',
    ajuda: 'Lucro de 30% sobre o faturamento, já com custo fixo. Margem de verdade — não é o equilíbrio multiplicado por 1,30, que daria só 19%.' },
];

export function ContasAnunciosTab() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [metas, setMetas] = useState<Record<string, { roas: string; cpa: string }>>({});
  const [sugestoes, setSugestoes] = useState<Record<string, Sugestao>>({});
  const [economia, setEconomia] = useState<Sugestao | null>(null);
  const [base, setBase] = useState<Base>('operacao');
  const [derivados, setDerivados] = useState<Record<string, Derivado>>({});
  const [verParadas, setVerParadas] = useState(false);
  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    const [{ data }, { data: sug }, { data: der }] = await Promise.all([
      /* De `vw_ad_accounts`, nao de `ad_accounts`: o nome vem com a BM na
         frente. Duas contas se chamam "Guia do Comportamento - TSL" em BMs
         diferentes, e duas linhas identicas numa tela de midia sao convite
         para pausar a campanha errada. A gravacao continua indo para a tabela;
         so a LEITURA passa pela view. */
      supabase
        .from('vw_ad_accounts')
        .select('id, account_id, nome:nome_exibicao, ativo, roas_meta, cpa_meta')
        .order('nome_exibicao'),
      supabase.rpc('fn_metas_sugeridas', { p_dias: 30, p_margem: 0.3 }),
      supabase.rpc('fn_produto_derivado', { p_dias: 60 }),
    ]);
    setContas(data || []);

    const porDerivado: Record<string, Derivado> = {};
    (der as Derivado[] | null)?.forEach(d => { porDerivado[d.conta_id] = d; });
    setDerivados(porDerivado);

    const porConta: Record<string, Sugestao> = {};
    (sug as Sugestao[] | null)?.forEach(s => {
      porConta[s.conta_id] = {
        ...s,
        ticket_medio: num(s.ticket_medio),
        roas_equilibrio: num(s.roas_equilibrio),
        roas_alvo: num(s.roas_alvo),
        roas_equilibrio_op: num(s.roas_equilibrio_op),
        roas_alvo_op: num(s.roas_alvo_op),
        roas_atual: s.roas_atual === null ? null : num(s.roas_atual),
        cpa_atual: s.cpa_atual === null ? null : num(s.cpa_atual),
        taxa_pct: num(s.taxa_pct),
        simples_pct: num(s.simples_pct),
        imposto_meta_pct: num(s.imposto_meta_pct),
        custo_fixo_periodo: num(s.custo_fixo_periodo),
        investimento_periodo: num(s.investimento_periodo),
        dias: num(s.dias),
      };
    });
    setSugestoes(porConta);
    // Os campos de economia são iguais em toda linha; a primeira serve de amostra.
    setEconomia(Object.values(porConta)[0] ?? null);
    const metasIniciais: Record<string, { roas: string; cpa: string }> = {};
    (data || []).forEach(c => {
      metasIniciais[c.id] = {
        roas: c.roas_meta != null ? String(c.roas_meta) : '',
        cpa:  c.cpa_meta  != null ? String(c.cpa_meta)  : '',
      };
    });
    setMetas(metasIniciais);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const roasDaBase = (s: Sugestao) =>
    base === 'campanha' ? s.roas_equilibrio
      : base === 'operacao' ? s.roas_equilibrio_op
      : s.roas_alvo_op;

  /**
   * Preenche os campos, não grava.
   *
   * A meta é decisão de mídia, não consequência de uma fórmula: a tela sugere o
   * número e a gravação continua sendo um clique consciente no "Salvar".
   */
  const aplicar = (c: Conta) => {
    const s = sugestoes[c.id];
    if (!s) return;
    const roas = roasDaBase(s);
    setMetas(prev => ({
      ...prev,
      [c.id]: {
        roas: roas.toFixed(2).replace('.', ','),
        // O CPA sai do ROAS pelo ticket da própria conta: o alvo que serve para um
        // ticket de R$ 116 não serve para um de R$ 287.
        cpa: roas > 0 && s.ticket_medio > 0
          ? (s.ticket_medio / roas).toFixed(2).replace('.', ',')
          : '',
      },
    }));
  };

  const save = async (c: Conta) => {
    setSaving(c.id);
    const m = metas[c.id] ?? { roas: '', cpa: '' };

    // O `.select()` no fim devolve as linhas afetadas. Sem ele, um UPDATE barrado por
    // RLS retorna 200 com zero linhas e o código comemora — foi assim que os parâmetros
    // fiscais e o Caixa passaram meses "salvando" sem gravar.
    const { data, error } = await supabase
      .from('ad_accounts')
      .update({
        // Campo vazio significa "sem meta", não zero: zero seria uma meta impossível
        // de bater e a tela cobraria a conta por ela.
        roas_meta: m.roas.trim() === '' ? null : Number(m.roas.replace(',', '.')),
        cpa_meta:  m.cpa.trim()  === '' ? null : Number(m.cpa.replace(',', '.')),
      })
      .eq('id', c.id)
      .select('id');
    setSaving(null);

    if (error) {
      toast({ title: 'Não salvou', description: error.message, variant: 'destructive' });
    } else if (!data || data.length === 0) {
      toast({
        title: 'Não salvou',
        description: 'Nenhuma linha alterada — provável falta de permissão.',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Salvo' });
    }
  };

  /**
   * Liga e desliga a coleta de dados da conta — não é um rótulo.
   *
   * `meta-insights-sync` só busca métrica de conta ativa. Desligada, a conta some das
   * telas por CA sem nada indicar que foi um clique que a apagou, e o histórico do
   * período desligado não volta sozinho quando alguém religa. Por isso confirma.
   */
  const toggleAtivo = async (c: Conta) => {
    const desligando = c.ativo;
    const ok = await confirm({
      title: desligando ? `Parar de coletar dados de "${c.nome}"?` : `Voltar a coletar dados de "${c.nome}"?`,
      description: desligando
        ? 'O Meta deixa de trazer métricas desta conta. Ela some do filtro de CA, do Resumo e das Tendências, e os dias em que ficar desligada não são recuperados ao religar.'
        : 'O Meta volta a trazer métricas desta conta a partir da próxima sincronização. Os dias em que ficou desligada não voltam.',
      confirmText: desligando ? 'Parar coleta' : 'Voltar a coletar',
      destructive: desligando,
    });
    if (!ok) return;

    const { data, error } = await supabase
      .from('ad_accounts')
      .update({ ativo: !c.ativo })
      .eq('id', c.id)
      .select('id');
    if (error) toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    else if (!data || data.length === 0) {
      toast({ title: 'Não salvou', description: 'Nenhuma linha alterada — provável falta de permissão.', variant: 'destructive' });
    } else load();
  };

  /**
   * Conta parada é a que nunca gastou e está desligada.
   *
   * Onze das dezoito nunca tiveram uma única métrica, e a ordem alfabética as jogava
   * para o topo — a tela abria com "CA2, CA3, CA4" e campos de exemplo. Ficam atrás de
   * um clique, não removidas: uma conta parada pode voltar a rodar.
   */
  const emUso = (c: Conta) => !!sugestoes[c.id] || c.ativo;
  const paradas = contas.filter(c => !emUso(c));
  const visiveis = verParadas ? contas : contas.filter(emUso);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Contas de Anúncios</h3>
        {/* O texto antigo dizia que esta tela configurava a atribuição de vendas. Não
            configura: a atribuição vai por `ad_id` → `metricas_meta` → conta, e nenhuma
            função do banco lê `produto_payt`. Uma tela que se explica errado manda
            procurar problema no lugar errado. */}
        <p className="text-xs text-muted-foreground mt-0.5">
          As contas chegam sozinhas pela API do Meta e o que cada uma vende sai das
          próprias vendas. Aqui ficam as duas decisões que são suas: coletar ou não os
          dados da conta, e o alvo de ROAS e CPA que as Tendências cobram.
        </p>
      </div>

      {/* O número vem da estrutura de custo, não do meu chute. E os insumos ficam à
          vista: uma meta cujo cálculo não se pode conferir é um número para acreditar. */}
      {economia && (
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-medium text-foreground">Meta sugerida pelos seus custos</h4>
            <p className="text-[11px] tabular-nums text-muted-foreground">
              últimos {economia.dias} dias · taxa Payt medida {economia.taxa_pct.toFixed(2)}% ·
              Simples {economia.simples_pct.toFixed(0)}% ·
              imposto Meta {economia.imposto_meta_pct.toFixed(1)}% ·
              custo fixo {formatCurrency(economia.custo_fixo_periodo)} sobre{' '}
              {formatCurrency(economia.investimento_periodo)} investidos
            </p>
          </div>

          <div className="flex flex-wrap gap-1">
            {BASES.map(b => {
              const s = economia;
              const valor = b.chave === 'campanha' ? s.roas_equilibrio
                : b.chave === 'operacao' ? s.roas_equilibrio_op : s.roas_alvo_op;
              return (
                <button
                  key={b.chave}
                  onClick={() => setBase(b.chave)}
                  title={b.ajuda}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-left transition-colors',
                    base === b.chave
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border hover:bg-secondary',
                  )}
                >
                  <span className="block text-[11px] text-muted-foreground">{b.rotulo}</span>
                  <span className="block text-sm font-medium tabular-nums text-foreground">
                    ROAS {valor.toFixed(2)}x
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {BASES.find(b => b.chave === base)?.ajuda} O CPA de cada conta sai deste ROAS
            dividido pelo ticket dela, por isso muda de linha para linha.
          </p>
        </div>
      )}

      {/* `overflow-x-auto`, não `overflow-hidden`: a tabela tem 1.100px e o painel de
          Configurações dá 374px de largura. Escondido, o corte engolia os campos de
          meta e o próprio botão Salvar — o recurso existia e não dava para alcançar. */}
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {loading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Carregando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground uppercase">
                {/* O `account_id` saiu de coluna própria para a linha de baixo do nome:
                    ocupava largura fixa de tabela para um dado que só serve de
                    referência cruzada com o Gerenciador, e a largura foi para o que se
                    edita. */}
                <th className="px-4 py-2 text-left">Conta (CA)</th>
                <th className="px-4 py-2 text-left">Vende (60 dias)</th>
                {/* Metas alimentam a página de Tendências. Vazio = sem meta: a tela
                    simplesmente não compara, em vez de assumir um alvo inventado. */}
                <th className="px-4 py-2 text-left">ROAS mín.</th>
                <th className="px-4 py-2 text-left">CPA máx.</th>
                <th className="px-4 py-2 text-center">Ativo</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map(c => (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="px-4 py-2">
                    <div className="font-medium">{c.nome}</div>
                    {/* O desempenho real ao lado do alvo: sem ele, a meta é um número
                        no vazio e não dá para saber se cobra pouco ou o impossível. */}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] tabular-nums text-muted-foreground">
                      <span className="font-mono">{c.account_id}</span>
                      {sugestoes[c.id] && (
                        <span>
                          · 30 dias: ROAS {(sugestoes[c.id].roas_atual ?? 0).toFixed(2)}x ·
                          CPA {formatCurrency(sugestoes[c.id].cpa_atual ?? 0)} ·
                          AOV {formatCurrency(sugestoes[c.id].ticket_medio)}
                        </span>
                      )}
                    </div>
                  </td>
                  {/* Somente leitura: sai das vendas da própria conta. Aceita mais de um
                      produto porque as contas de fato vendem mais de um, e acompanha
                      sozinha quando a CA troca de oferta. */}
                  <td className="px-4 py-2 w-72">
                    {derivados[c.id] ? (
                      <div className="space-y-0.5">
                        {derivados[c.id].produtos.slice(0, 3).map(p => (
                          <div key={p.produto} className="flex items-baseline gap-2 text-xs">
                            <span className="min-w-0 flex-1 truncate" title={p.produto}>{p.produto}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{p.vendas}</span>
                          </div>
                        ))}
                        {derivados[c.id].produtos.length > 3 && (
                          <div className="text-[10px] text-muted-foreground/60">
                            + {derivados[c.id].produtos.length - 3} outros
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">sem venda atribuída em 60 dias</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      value={metas[c.id]?.roas ?? ''}
                      onChange={e => setMetas(prev => ({
                        ...prev, [c.id]: { ...(prev[c.id] ?? { roas: '', cpa: '' }), roas: e.target.value },
                      }))}
                      placeholder="2,0"
                      inputMode="decimal"
                      className="h-8 w-20 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      value={metas[c.id]?.cpa ?? ''}
                      onChange={e => setMetas(prev => ({
                        ...prev, [c.id]: { ...(prev[c.id] ?? { roas: '', cpa: '' }), cpa: e.target.value },
                      }))}
                      placeholder="50,00"
                      inputMode="decimal"
                      className="h-8 w-24 text-xs"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => toggleAtivo(c)}
                      className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                        c.ativo
                          ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                          : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                      }`}
                    >
                      {c.ativo ? 'Ativo' : 'Inativo'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {sugestoes[c.id] && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() => aplicar(c)}
                          title={`Preenche com ROAS ${roasDaBase(sugestoes[c.id]).toFixed(2)}x e o CPA correspondente ao ticket desta conta`}
                        >
                          Sugerir
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={saving === c.id}
                        onClick={() => save(c)}
                      >
                        {saving === c.id ? 'Salvando...' : 'Salvar'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && paradas.length > 0 && (
        <button
          onClick={() => setVerParadas(v => !v)}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {verParadas
            ? `Esconder as ${paradas.length} contas paradas`
            : `Mostrar ${paradas.length} contas paradas (sem gasto e com coleta desligada)`}
        </button>
      )}

      <div className="bg-secondary/30 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
        {/* O texto anterior descrevia a atribuição do dashboard como se dependesse do
            produto configurado aqui. Não depende — e mandava conferir o campo errado
            quando uma venda não aparecia na conta certa. */}
        <p className="font-medium text-foreground">Onde cada campo é usado</p>
        <p>
          <strong>Vende (60 dias)</strong> — leitura, não configuração: sai das vendas com
          <span className="font-mono"> ad_id</span> da própria conta. Substituiu um campo de
          texto digitado à mão que cabia um produto só e descartava as vendas dos outros.
        </p>
        <p>
          <strong>ROAS mín. e CPA máx.</strong> — o selo de meta nas Tendências. Vazio significa
          sem meta: a tela deixa de comparar, em vez de cobrar um alvo inventado.
        </p>
        <p>
          <strong>Ativo</strong> — liga e desliga a coleta de métricas do Meta. Desligada, a
          conta some das telas por CA e os dias parados não voltam ao religar.
        </p>
      </div>
    </div>
  );
}
