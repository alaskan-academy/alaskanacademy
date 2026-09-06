/**
 * Quanto tem em cada conta, e onde esse dinheiro mora.
 *
 * Substitui o bloco "Reserva de Caixa", que sabia de UM saldo por empresa e o
 * DEDUZIA do extrato da Conta Simples — somava, com o sinal invertido, tudo que
 * saía da CS categorizado como reserva. Enquanto havia um lugar só para o
 * dinheiro parado, dava certo. Com C6 e Inter, o saldo de um banco passaria a
 * depender do extrato de OUTRO, e a conta errava: dizia R$ 33.881,27 quando o
 * C6 e o Inter somados tinham R$ 28.692,61. R$ 5.188,66 de caixa que não
 * existia.
 *
 * Agora cada conta carrega a própria foto e o próprio saldo.
 *
 * AS DUAS CLASSES
 *
 *   fluxo   o dinheiro que gira — Conta Simples
 *   caixa   o dinheiro parado — C6 e Inter
 *
 * NA CONTA SIMPLES, O "LIMITE DOS CARTÕES" É DINHEIRO DELA
 *
 * Não é linha de crédito: é saldo da conta já carregado nos cartões. O app
 * mostra os dois separados (R$ 1.578,42 na conta, R$ 6.069,28 nos cartões) e
 * os dois são caixa. A soma do extrato inteiro decide a questão:
 *
 *   histórico somado          R$ 7.844,09
 *   contra a conta sozinha    erra por R$ 6.265,67
 *   contra conta + cartões    erra por R$   196,39
 *
 * Por isso a foto da conta é a SOMA dos dois, e as duas fontes
 * (`conta_simples` e `conta_simples_cartao`) alimentam o mesmo saldo.
 *
 * A soma é por `tipo`, não por nome: banco novo entra escolhendo o lado, sem
 * lista escrita aqui dentro.
 *
 * POR QUE O SALDO É UMA FOTO
 *
 * O extrato da Alaskan começa em 01/12/2025 sem saldo de abertura — somar o
 * histórico inteiro dá R$ 7.844,09 contra R$ 1.578,42 reais. O que falta é o
 * que existia antes do primeiro registro, e isso não está em lugar nenhum. Por
 * isso o número é ancorado no que o banco mostra hoje, e só o que se moveu
 * DEPOIS da foto soma: movimento anterior é o que produziu a foto.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, ArrowLeftRight, Pencil, PiggyBank, Wallet } from 'lucide-react';

export interface SaldoConta {
  id: string;
  empresa_id: string;
  nome: string;
  tipo: 'fluxo' | 'caixa';
  saldo_inicial: number;
  data_referencia: string;
  ordem: number;
  movimento: number;
  qtd_movimentos: number;
  saldo: number;
  empresa_nome: string;
  empresa_slug: string;
  /* Ate quando o extrato foi lido — o dia da fonte MAIS VELHA da conta.
     Nulo quer dizer que nao houve movimento nenhum depois da foto, e ai nao ha
     o que envelhecer. Vem da view, junto do calculo: quem soma e quem sabe ate
     onde somou. */
  lido_ate: string | null;
  /* Conta e cartao terminando em dias distintos. O saldo entao mistura datas e
     esta errado por construcao — foi assim que a Conta Simples apareceu com
     -R$ 3.208,94 enquanto o banco mostrava R$ 4.615,74. */
  fontes_em_dias_diferentes: boolean;
}

/** Quantos dias inteiros se passaram desde `iso`, no fuso de quem olha. */
function diasDesde(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(a, m - 1, d);
  const hoje = new Date();
  return Math.floor((new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()
                     - alvo.getTime()) / 86400000);
}

const CLASSES = [
  {
    tipo: 'caixa' as const,
    titulo: 'Caixa',
    descricao: 'o dinheiro parado, fora da operação do dia',
    icone: PiggyBank,
  },
  {
    tipo: 'fluxo' as const,
    titulo: 'Fluxo de caixa',
    descricao: 'a conta por onde a operação gira',
    icone: Wallet,
  },
];

function ddmm(iso: string) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

export function SaldosDasContas({
  aoMudar, aoTotalizar,
}: {
  aoMudar?: () => void;
  /** Os totais por classe, para o cabeçalho da página não repetir a consulta.
      Dois lugares perguntando ao banco a mesma coisa é o começo de dois
      números diferentes na mesma tela. */
  aoTotalizar?: (t: { caixa: number; fluxo: number }) => void;
}) {
  const { empresaId } = useFilters();
  const [contas, setContas] = useState<SaldoConta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<SaldoConta | null>(null);
  const [novoSaldo, setNovoSaldo] = useState('');
  const [novaData, setNovaData] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [transferindo, setTransferindo] = useState(false);
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const [valorTransf, setValorTransf] = useState('');
  const [dataTransf, setDataTransf] = useState(new Date().toISOString().slice(0, 10));

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from('vw_saldo_contas').select('*').eq('ativo', true).order('ordem');
    if (empresaId) q = q.eq('empresa_id', empresaId);
    const { data, error } = await q;
    if (error) {
      toast({ title: 'Erro ao carregar os saldos', variant: 'destructive' });
      setCarregando(false);
      return;
    }
    const linhas = (data ?? []).map(l => ({
      ...l,
      saldo_inicial: Number(l.saldo_inicial ?? 0),
      movimento: Number(l.movimento ?? 0),
      qtd_movimentos: Number(l.qtd_movimentos ?? 0),
      saldo: Number(l.saldo ?? 0),
      lido_ate: (l.lido_ate as string | null) ?? null,
      fontes_em_dias_diferentes: Boolean(l.fontes_em_dias_diferentes),
    })) as SaldoConta[];
    setContas(linhas);
    const soma = (t: 'caixa' | 'fluxo') =>
      linhas.filter(c => c.tipo === t).reduce((s, c) => s + c.saldo, 0);
    aoTotalizar?.({ caixa: soma('caixa'), fluxo: soma('fluxo') });
    setCarregando(false);
  }, [empresaId, aoTotalizar]);

  useEffect(() => { carregar(); }, [carregar]);

  /* Marcar a empresa em toda linha, mesmo com uma empresa so selecionada,
     seria repetir em cada linha o que o cabecalho ja diz uma vez. */
  const mostrarEmpresa = new Set(contas.map(c => c.empresa_id)).size > 1;

  async function salvarFoto() {
    if (!editando) return;
    const valor = parseFloat(novoSaldo.replace(/\./g, '').replace(',', '.'));
    if (isNaN(valor)) {
      toast({ title: 'Saldo inválido', variant: 'destructive' });
      return;
    }
    if (!novaData) {
      toast({ title: 'Informe a data do saldo', variant: 'destructive' });
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from('contas')
      .update({ saldo_inicial: valor, data_referencia: novaData, updated_at: new Date().toISOString() })
      .eq('id', editando.id);
    setSalvando(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `${editando.nome} atualizada` });
    setEditando(null);
    carregar();
    aoMudar?.();
  }


  /**
   * Transferir entre contas: UM evento, DOIS lados.
   *
   * O dinheiro sai de uma conta e entra na outra. Lançar isso à mão seriam dois
   * lançamentos, e esquecer um faz os dois saldos mentirem em direções opostas
   * sem nada denunciar — a origem parece mais rica, o destino mais pobre, e as
   * duas continuam com cara de número certo.
   *
   * As duas linhas dividem a MESMA `referencia_externa`. Dá para fazer porque a
   * chave única é (fonte, referência) e as fontes são diferentes: o par fica
   * encontrável sem coluna nova, e a deduplicação continua valendo dentro de
   * cada conta.
   *
   * As categorias são as de reserva, que `ehCustoOperacional` e `ehReceita`
   * excluem as duas. Transferir dinheiro de bolso não é custo nem receita, e
   * contar como qualquer um dos dois inventaria movimento que não houve.
   */
  async function transferir() {
    const valor = parseFloat(valorTransf.replace(/\./g, '').replace(',', '.'));
    if (!origem || !destino) {
      toast({ title: 'Escolha as duas contas', variant: 'destructive' });
      return;
    }
    if (origem === destino) {
      toast({ title: 'Origem e destino são a mesma conta', variant: 'destructive' });
      return;
    }
    if (isNaN(valor) || valor <= 0) {
      toast({ title: 'Valor inválido', variant: 'destructive' });
      return;
    }

    const de = contas.find(c => c.id === origem);
    const para = contas.find(c => c.id === destino);
    if (!de || !para) return;

    /* A fonte PRINCIPAL de cada conta — na Conta Simples isso é a conta, nunca
       o cartão. Ver `conta_fontes.principal`. */
    const { data: fontes, error: erroFontes } = await supabase
      .from('conta_fontes').select('conta_id, fonte')
      .eq('principal', true).in('conta_id', [origem, destino]);
    const fonteDe = fontes?.find(f => f.conta_id === origem)?.fonte;
    const fontePara = fontes?.find(f => f.conta_id === destino)?.fonte;
    if (erroFontes || !fonteDe || !fontePara) {
      toast({ title: 'Não achei a fonte de uma das contas', variant: 'destructive' });
      return;
    }

    setSalvando(true);
    const ref = `transf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const descricao = `Transferência ${de.nome} → ${para.nome}`;
    const { error } = await supabase.from('transacoes').insert([
      {
        referencia_externa: ref, data: dataTransf, descricao,
        valor: -Math.abs(valor), categoria: 'Reserva de Caixa',
        status_revisao: 'confirmado', fonte: fonteDe, empresa_id: de.empresa_id,
      },
      {
        referencia_externa: ref, data: dataTransf, descricao,
        valor: Math.abs(valor), categoria: 'Retirada do Caixa',
        status_revisao: 'confirmado', fonte: fontePara, empresa_id: para.empresa_id,
      },
    ]);
    setSalvando(false);
    if (error) {
      toast({ title: 'Erro ao transferir', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `${formatCurrency(valor)} de ${de.nome} para ${para.nome}` });
    setTransferindo(false);
    setValorTransf(''); setOrigem(''); setDestino('');
    carregar();
    aoMudar?.();
  }

  if (carregando) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        Carregando os saldos…
      </div>
    );
  }

  if (contas.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        Nenhuma conta cadastrada {empresaId ? 'para esta empresa' : ''}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {CLASSES.map(classe => {
        const doTipo = contas.filter(c => c.tipo === classe.tipo);
        if (doTipo.length === 0) return null;
        const total = doTipo.reduce((s, c) => s + c.saldo, 0);
        const Icone = classe.icone;

        return (
          <div key={classe.tipo} className="rounded-lg border border-border bg-card p-5">
            <div className="mb-1 flex items-center gap-2">
              <Icone className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {classe.titulo}
              </h2>
            </div>
            <p className="mb-4 text-[11px] text-muted-foreground/60">{classe.descricao}</p>

            <div className="space-y-3">
              {doTipo.map(c => (
                <div key={c.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {/* Em "Ambas" as duas empresas tem uma "Conta Simples", e sem
                          isto as linhas ficam identicas. O ponto de 6px com a cor da
                          marca e o mesmo do seletor de empresa no cabecalho. */}
                      {mostrarEmpresa && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: `hsl(var(--empresa-${c.empresa_slug}))` }}
                          aria-hidden
                        />
                      )}
                      <span className="text-sm font-medium text-foreground">{c.nome}</span>
                      {mostrarEmpresa && (
                        <span className="text-xs text-muted-foreground">{c.empresa_nome}</span>
                      )}
                      <Button
                        variant="ghost" size="icon" className="h-5 w-5 shrink-0"
                        onClick={() => {
                          setEditando(c);
                          setNovoSaldo(String(c.saldo_inicial).replace('.', ','));
                          setNovaData(c.data_referencia);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                    {/* De onde o número sai, sempre visível. Quando ele não bater
                        com o aplicativo do banco, é aqui que se olha primeiro:
                        ou a foto envelheceu, ou entrou lançamento que não devia. */}
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      foto de {ddmm(c.data_referencia)}: {formatCurrency(c.saldo_inicial)}
                      {c.qtd_movimentos > 0 && (
                        <>
                          {' · '}
                          <span className={c.movimento >= 0 ? 'text-success' : 'text-destructive'}>
                            {c.movimento >= 0 ? '+' : '−'}{formatCurrency(Math.abs(c.movimento))}
                          </span>
                          {' em '}{c.qtd_movimentos} movimento{c.qtd_movimentos > 1 ? 's' : ''} desde então
                        </>
                      )}
                      {/* A data da foto sozinha enganava: parecia dizer a idade do
                          saldo, mas so diz a idade do PONTO DE PARTIDA. O que
                          envelhece e o extrato, e ele nao aparecia em lugar nenhum. */}
                      {c.lido_ate && (
                        <>
                          {' · '}
                          <span className={diasDesde(c.lido_ate) >= 2 ? 'text-warning' : undefined}>
                            lido até {ddmm(c.lido_ate)}
                            {diasDesde(c.lido_ate) >= 1 &&
                              ` (${diasDesde(c.lido_ate)} dia${diasDesde(c.lido_ate) > 1 ? 's' : ''} atrás)`}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Somar conta de um dia com cartao de outro nao da saldo
                        nenhum. Vale um aviso proprio, e nao um detalhe na linha
                        de cima: e a diferenca entre "esta velho" e "esta errado". */}
                    {c.fontes_em_dias_diferentes && (
                      <div className="mt-1 flex items-start gap-1.5 text-[11px] text-warning">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                        <span>
                          A conta e o cartão foram lidos em dias diferentes — este saldo
                          mistura datas. Importe o extrato antes de usar o número.
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {formatCurrency(c.saldo)}
                  </span>
                </div>
              ))}
            </div>

            {/* O total só aparece quando há mais de uma conta: repetir o mesmo
                número duas vezes seguidas não informa, só ocupa linha. */}
            {doTipo.length > 1 && (
              <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-sm font-semibold">Total em {classe.titulo.toLowerCase()}</span>
                <span className="text-base font-bold tabular-nums text-primary">
                  {formatCurrency(total)}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* Uma transferencia move dinheiro sem criar nem destruir: o total de
          Caixa + Fluxo nao muda, so a distribuicao. Por isso ela e uma acao
          propria e nao dois lancamentos. */}
      {contas.length > 1 && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setTransferindo(true)}>
          <ArrowLeftRight className="mr-2 h-3.5 w-3.5" />
          Transferir entre contas
        </Button>
      )}

      <Dialog open={transferindo} onOpenChange={o => !o && setTransferindo(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir entre contas</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Lança os dois lados de uma vez — sai de uma conta e entra na outra. Não conta
            como custo nem como receita: o dinheiro só mudou de lugar.
          </p>
          <div className="space-y-3">
            {/* Lista suspensa, não os botões todos abertos: com quatro contas eram
                oito botões ocupando o diálogo inteiro, e cresceria com cada banco
                novo. A conta já escolhida do outro lado some da lista — não dá
                para transferir de uma conta para ela mesma. */}
            {(['origem', 'destino'] as const).map(lado => {
              const escolhida = lado === 'origem' ? origem : destino;
              const oOutroLado = lado === 'origem' ? destino : origem;
              const definir = lado === 'origem' ? setOrigem : setDestino;
              return (
                <div key={lado}>
                  <Label>{lado === 'origem' ? 'Sai de' : 'Entra em'}</Label>
                  <Select value={escolhida} onValueChange={definir}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Escolha a conta" />
                    </SelectTrigger>
                    <SelectContent>
                      {contas.filter(c => c.id !== oOutroLado).map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex items-center gap-1.5">
                            {mostrarEmpresa && (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ background: `hsl(var(--empresa-${c.empresa_slug}))` }}
                                aria-hidden
                              />
                            )}
                            {c.nome}
                            {mostrarEmpresa && (
                              <span className="text-xs text-muted-foreground">{c.empresa_nome}</span>
                            )}
                            <span className="text-xs text-muted-foreground tabular-nums">
                              · {formatCurrency(c.saldo)}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="valor-transf">Valor</Label>
                <Input
                  id="valor-transf" inputMode="decimal" value={valorTransf}
                  onChange={e => setValorTransf(e.target.value)} placeholder="1500,00"
                />
              </div>
              <div>
                <Label htmlFor="data-transf">Data</Label>
                <Input
                  id="data-transf" type="date" value={dataTransf}
                  onChange={e => setDataTransf(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTransferindo(false)}>Cancelar</Button>
            <Button onClick={transferir} disabled={salvando}>
              {salvando ? 'Lançando…' : 'Transferir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editando} onOpenChange={o => !o && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Saldo de {editando?.nome}</DialogTitle>
          </DialogHeader>
          {/* A foto é o que o banco mostra NA DATA informada. Movimentos
              anteriores a ela não somam de novo — eles são o que produziu esse
              número. Dizer isso aqui evita a pergunta "por que não mudou?". */}
          <p className="text-xs text-muted-foreground">
            Informe o saldo que o banco mostra e a data em que ele foi visto. Lançamentos
            anteriores a essa data não entram na conta — eles já estão dentro desse número.
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="saldo-conta">Saldo</Label>
              <Input
                id="saldo-conta" inputMode="decimal" value={novoSaldo}
                onChange={e => setNovoSaldo(e.target.value)} placeholder="24680,49"
              />
            </div>
            <div>
              <Label htmlFor="data-conta">Data do saldo</Label>
              <Input
                id="data-conta" type="date" value={novaData}
                onChange={e => setNovaData(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button onClick={salvarFoto} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
