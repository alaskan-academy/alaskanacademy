import { hoje, ultimoDiaDoMes } from '@/lib/datas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, AlertCircle, CheckCircle2, Clock, Plus, Check, CheckCheck, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useConfirm } from '@/hooks/use-confirm';
import { CENTROS_CUSTO } from '@/features/financeiro/constants';
import { CampoCategoria } from '@/features/financeiro/components/CampoCategoria';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import { AvisoDivergencias } from '@/features/financeiro/components/AvisoDivergencias';
import { aoClicarSemArrastar } from '@/lib/clique';

interface Transacao {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  categoria: string | null;
  /** O centro cru que o CS mandou. Erra com frequência — as cobranças de
   *  WhatsApp vinham como "Softwares e Ferramentas". Fica porque é o registro
   *  do que a Conta Simples disse, mas não é o que se mostra. */
  centro_custo: string | null;
  /** O grupo de verdade, resolvido por `categorias_centro` — o mesmo que o
   *  relatório usa. É este que aparece na tabela. */
  grupo: string | null;
  status_revisao: string;
  /** Nome resolvido pelo apelido; cai no descritor normalizado sem apelido. */
  fornecedor: string;
  /** false = agrupamento provisório, ainda precisa de decisão humana. */
  fornecedor_definido: boolean | null;
  /** O recorte que a regra deve usar. Ver comentário em `openModal`. */
  padrao_sugerido: string;
  cartao: string | null;
}

/**
 * O que uma linha de CSV pode trazer.
 *
 * São as colunas da TABELA `transacoes`. `Omit<Transacao, ...>` parecia servir e
 * não servia: `Transacao` é a forma da VIEW `vw_transacoes_revisao`, que inclui
 * `fornecedor`, `fornecedor_definido`, `padrao_sugerido` e `cartao` — todos
 * derivados na leitura, nenhum deles importável de planilha. O tsc reclamava
 * disso desde que a view ganhou esses campos.
 */
type LinhaImportada = {
  data: string;
  descricao: string;
  valor: number;
  categoria: string | null;
  centro_custo: string | null;
};

type Filtro = 'pendentes' | 'todas';

/** Teto de linhas por carga.
 *
 *  Era 500 e a fila de pendentes tinha 524 — cortava 24 sem dizer nada, o mesmo
 *  defeito que já havia escondido 700 transações na aba "Todas" e que o
 *  comentário de `load` diz ter sido corrigido (foi, só ali).
 *
 *  Continua existindo teto: uma importação grande pode trazer milhares, e
 *  carregar tudo travaria a tela. O que muda é que agora a tela DIZ quando
 *  cortou, em vez de mostrar um número redondo e mentiroso. */
const TETO = 1000;

/** Minúsculas e sem acento, para os dois lados da busca. Quem digita "anuncios"
 *  com pressa tem de achar "Anúncios". */
const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pendente:          { label: 'Pendente',       cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  auto_categorizado: { label: 'Auto',           cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  confirmado:        { label: 'Confirmado',     cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
  revisado:          { label: 'Revisado',       cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
};

function parseCsv(text: string): LinhaImportada[] {
  const linhas = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (linhas.length < 2) return [];

  const sep = linhas[0].includes(';') ? ';' : ',';
  const header = linhas[0].split(sep).map(h => h.toLowerCase().replace(/['"]/g, '').trim());

  const idx = (candidates: string[]) =>
    candidates.map(c => header.findIndex(h => h.includes(c))).find(i => i >= 0) ?? -1;

  const iData    = idx(['data', 'date']);
  const iDesc    = idx(['descri', 'historico', 'lançamento', 'lancamento', 'memo']);
  const iValor   = idx(['valor', 'value', 'amount', 'quantia']);
  const iCateg   = idx(['categ']);
  const iCentro  = idx(['centro']);

  if (iData < 0 || iDesc < 0 || iValor < 0) return [];

  const rows: LinhaImportada[] = [];

  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(sep).map(c => c.replace(/^["']|["']$/g, '').trim());
    if (cols.length < 3) continue;

    const rawData  = cols[iData]  || '';
    const rawDesc  = cols[iDesc]  || '';
    const rawValor = cols[iValor] || '';

    // parse date: dd/mm/yyyy or yyyy-mm-dd
    let data = '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawData)) {
      const [d, m, y] = rawData.split('/');
      data = `${y}-${m}-${d}`;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(rawData)) {
      data = rawData.slice(0, 10);
    } else {
      continue;
    }

    // parse value: "1.234,56" → 1234.56 or "-1234.56"
    const cleanValor = rawValor.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const valor = parseFloat(cleanValor);
    if (isNaN(valor)) continue;

    rows.push({
      data,
      descricao: rawDesc,
      valor,
      categoria:   iCateg  >= 0 ? (cols[iCateg]  || null) : null,
      centro_custo: iCentro >= 0 ? (cols[iCentro] || null) : null,
    });
  }

  return rows;
}

export default function FinanceiroRevisaoPage() {
  const [transacoes, setTransacoes]   = useState<Transacao[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filtro, setFiltro]           = useState<Filtro>('pendentes');
  const [busca, setBusca]             = useState('');
  const [anoRev, setAnoRev]           = useState(new Date().getFullYear());
  const [mesRev, setMesRev]           = useState(new Date().getMonth());
  const [selected, setSelected]       = useState<Transacao | null>(null);
  const [saving, setSaving]           = useState(false);
  const [importing, setImporting]     = useState(false);
  const fileRef                       = useRef<HTMLInputElement>(null);

  // form state inside modal (edição)
  const [formCateg,    setFormCateg]   = useState('');
  const [formCentro,   setFormCentro]  = useState('');
  const [formNome,     setFormNome]    = useState('');
  const [criarRegra,   setCriarRegra]  = useState(true);
  const [padraoRegra,  setPadraoRegra] = useState('');

  // form state — novo lançamento manual
  const [novoModal,   setNovoModal]   = useState(false);
  const [novoData,    setNovoData]    = useState(hoje());
  const [novoTipo,    setNovoTipo]    = useState<'entrada' | 'saida'>('saida');
  const [novoValor,   setNovoValor]   = useState('');
  const [novoDesc,    setNovoDesc]    = useState('');
  const [novoCateg,   setNovoCateg]   = useState('');
  const [novoCentro,  setNovoCentro]  = useState('');
  const [criandoNovo, setCriandoNovo] = useState(false);

  // Muda a cada salvamento, para o aviso de divergencias recarregar sozinho.
  const [versao, setVersao] = useState(0);

  /** Abre no modal uma transacao vinda do aviso de divergencias. Busca a linha
   *  completa porque a lista de divergencias so traz o resumo. */
  const abrirPorId = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('vw_transacoes_revisao')
      .select('id,data,descricao,valor,categoria,centro_custo,grupo,status_revisao,fornecedor,fornecedor_definido,padrao_sugerido,cartao')
      .eq('id', id)
      .maybeSingle();
    if (data) openModal(data as Transacao);
  }, []);

  const confirm = useConfirm();
  const [confirmandoLote, setConfirmandoLote] = useState(false);

  /** Quantas existem de verdade, contadas no banco — não quantas couberam na
   *  tela. O contador vinha de `transacoes.length`, então com 524 pendentes e
   *  teto de 500 ele dizia "500" e ninguém ficava sabendo das outras 24. */
  const [totalNoBanco, setTotalNoBanco] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('vw_transacoes_revisao')
      .select(
        'id,data,descricao,valor,categoria,centro_custo,grupo,status_revisao,fornecedor,fornecedor_definido,padrao_sugerido,cartao',
        { count: 'exact' },
      )
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(TETO);

    if (filtro === 'pendentes') {
      query = query.in('status_revisao', ['pendente', 'auto_categorizado']);
    } else {
      // "Todas" recortado por mês. Sem isto o limite de 500 cortava em silêncio
      // uma base de 1.206: setecentas transações que ela acreditava ter revisado
      // simplesmente não estavam na tela — o oposto de "garantir que nada passe".
      const inicio = `${anoRev}-${String(mesRev + 1).padStart(2, '0')}-01`;
      const fim = ultimoDiaDoMes(new Date(anoRev, mesRev, 1));
      query = query.gte('data', inicio).lte('data', fim);
    }

    const { data, error, count } = await query;
    if (error) toast({ title: 'Erro ao carregar transações', variant: 'destructive' });
    setTransacoes(data || []);
    setTotalNoBanco(count ?? null);
    setLoading(false);
  }, [filtro, anoRev, mesRev]);

  useEffect(() => { load(); }, [load]);

  const openModal = (t: Transacao) => {
    setSelected(t);
    setFormCateg(t.categoria || '');
    // `grupo`, e não `centro_custo`.
    //
    // A tabela mostra o grupo resolvido por `categorias_centro`; o modal
    // mostrava o `centro_custo` cru que a Conta Simples mandou. Os dois
    // discordam com frequência — o DARF do Ministério da Fazenda aparecia como
    // "Impostos" na linha e "Outros" ao abrir. A mesma transação, dois grupos,
    // conforme onde se olhasse.
    //
    // Vale o resolvido: é o que o relatório soma.
    setFormCentro(t.grupo || t.centro_custo || '');
    setFormNome(t.fornecedor);
    setCriarRegra(true);
    // O padrão do apelido, não o descritor inteiro. Com o descritor, cada
    // cobrança do Facebook geraria uma regra própria e inútil — e um clique
    // errado viraria lei com confiança 1,00 — foi assim que a regra
    // "LUCAS DOS SANTOS VEIGA → Aplicativos e Ferramentas" desviou R$ 13.940.
    setPadraoRegra(t.padrao_sugerido);
  };

  const salvar = async () => {
    if (!selected || !formCateg) return;
    setSaving(true);
    try {
      // `revisado_por` é o que separa "alguém leu esta linha" de "alguém aceitou
      // 440 de uma vez". Sem ele, as duas ficavam iguais no banco e as
      // confirmadas em lote viravam intocáveis pela recategorização — inclusive
      // as erradas.
      const { data: sessao } = await supabase.auth.getUser();
      await supabase
        .from('transacoes')
        .update({
          categoria: formCateg,
          centro_custo: formCentro || null,
          status_revisao: 'confirmado',
          revisado_em: new Date().toISOString(),
          revisado_por: sessao.user?.id ?? null,
        })
        .eq('id', selected.id);

      // O nome é do FORNECEDOR, não desta linha: renomear aqui arruma o
      // histórico inteiro dele e todas as cobranças futuras. Editar a descrição
      // da transação seria adulterar o que o banco mandou, e consertaria uma
      // linha só — as outras 106 do Facebook continuariam ilegíveis.
      const nome = formNome.trim();
      if (nome && nome !== selected.fornecedor) {
        const { error } = await supabase.from('fornecedores').upsert({
          nome,
          padrao: padraoRegra.trim() || selected.descricao,
          tipo_match: 'contains',
          prioridade: 50,
          definido: true,
          nota: null,
        }, { onConflict: 'nome,padrao' });
        if (error) throw error;
      }

      if (criarRegra && padraoRegra.trim()) {
        // `upsert` e não `insert`: confirmar duas vezes o mesmo fornecedor
        // criava duas regras concorrentes com confiança 1,00, e qual ganhava
        // dependia do comprimento do padrão. Agora a segunda corrige a primeira.
        await supabase.from('regras_categoria').upsert({
          padrao: padraoRegra.trim(),
          tipo_match: 'contains',
          categoria: formCateg,
          centro_custo: formCentro || null,
          confianca: 1.0,
          ativo: true,
        }, { onConflict: 'padrao,tipo_match' });
      }

      toast({ title: 'Transação categorizada' });
      setSelected(null);
      setVersao(v => v + 1);
      load();
    } catch {
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast({ title: 'Nenhuma linha válida encontrada no arquivo', variant: 'destructive' });
        return;
      }

      // busca regras para auto-categorizar
      const { data: regras } = await supabase
        .from('regras_categoria')
        .select('padrao,tipo_match,categoria,centro_custo,confianca')
        .eq('ativo', true)
        .order('confianca', { ascending: false });

      const aplicarRegras = (desc: string) => {
        for (const r of regras || []) {
          const d = desc.toLowerCase();
          const p = r.padrao.toLowerCase();
          const match =
            r.tipo_match === 'exact'    ? d === p :
            r.tipo_match === 'regex'    ? new RegExp(p).test(d) :
                                          d.includes(p);
          if (match) return { categoria: r.categoria, centro_custo: r.centro_custo, status_revisao: 'auto_categorizado' };
        }
        return { categoria: null, centro_custo: null, status_revisao: 'pendente' };
      };

      // A categoria do ARQUIVO vence a das regras.
      //
      // Antes era `{...r, ...aplicarRegras(...)}`, e o espalhamento das regras
      // vinha depois — sobrescrevendo com `null` a categoria que a planilha
      // trazia. Quem importasse um extrato já categorizado à mão via tudo
      // entrar como "pendente", e o trabalho de categorizar era jogado fora em
      // silêncio. A coluna `categoria` do CSV era lida e descartada.
      const inserts = rows.map(r => {
        const daRegra = aplicarRegras(r.descricao);
        const temDoArquivo = !!r.categoria;
        return {
          ...r,
          categoria:    r.categoria ?? daRegra.categoria,
          centro_custo: r.centro_custo ?? daRegra.centro_custo,
          // Veio categorizado do arquivo: já nasce como auto, e não pendente.
          status_revisao: temDoArquivo ? 'auto_categorizado' : daRegra.status_revisao,
          fonte: 'conta_simples',
        };
      });

      const { error } = await supabase.from('transacoes').insert(inserts);
      if (error) throw error;

      const pendentes = inserts.filter(r => r.status_revisao === 'pendente').length;
      const auto      = inserts.filter(r => r.status_revisao === 'auto_categorizado').length;
      toast({ title: `${inserts.length} transações importadas`, description: `${auto} auto-categorizadas · ${pendentes} pendentes` });
      load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      toast({ title: 'Erro ao importar', description: msg, variant: 'destructive' });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const criarLancamento = async () => {
    if (!novoDesc.trim() || !novoCateg || !novoValor) return;
    setCriandoNovo(true);
    try {
      const valorNum = parseFloat(novoValor.replace(',', '.'));
      if (isNaN(valorNum) || valorNum <= 0) throw new Error('Valor inválido');
      const valorFinal = novoTipo === 'saida' ? -Math.abs(valorNum) : Math.abs(valorNum);
      const refExt = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const { error } = await supabase.from('transacoes').insert({
        referencia_externa: refExt,
        data: novoData,
        descricao: novoDesc.trim(),
        valor: valorFinal,
        categoria: novoCateg,
        centro_custo: novoCentro || null,
        status_revisao: 'confirmado',
        fonte: 'manual',
      });
      if (error) throw error;
      toast({ title: 'Lançamento criado com sucesso' });
      setNovoModal(false);
      setNovoDesc(''); setNovoValor(''); setNovoCateg(''); setNovoCentro('');
      setNovoTipo('saida'); setNovoData(hoje());
      load();
    } catch (err: unknown) {
      toast({ title: 'Erro ao criar lançamento', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally {
      setCriandoNovo(false);
    }
  };

  /**
   * Busca por nome ou por valor, na lista já carregada.
   *
   * Sem acento e sem caixa dos dois lados: quem procura "anuncios" tem de achar
   * "Anúncios", e ninguém digita acento numa caixa de busca com pressa.
   *
   * O valor aceita as duas grafias. "1.745,88" e "1745.88" são o mesmo número, e
   * digitar só "1745" tem de achar também — por isso a comparação é por prefixo
   * do valor formatado, e não igualdade exata.
   */
  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    if (!termo) return transacoes;

    return transacoes.filter(t => {
      if (semAcento(t.descricao ?? '').includes(termo)) return true;
      if (semAcento(t.fornecedor ?? '').includes(termo)) return true;
      if (semAcento(t.categoria ?? '').includes(termo)) return true;

      // Final do cartão. Guardado como "•••• 5187", então a comparação é só
      // entre dígitos — assim funciona tanto digitando "5187" quanto colando
      // "•••• 5187" da própria tela.
      //
      // A partir de 3 dígitos: com menos, "12" casaria com metade dos cartões e
      // a busca viraria ruído.
      //
      // Um termo numérico é testado contra o cartão E contra o valor, sem
      // escolher um. "6896" pode ser o cartão ou um lançamento de R$ 6.896 —
      // mostrar os dois é melhor do que exigir que ela adivinhe qual busca a
      // tela decidiu fazer.
      const soDigitos = termo.replace(/\D/g, '');
      if (soDigitos.length >= 3 && (t.cartao ?? '').replace(/\D/g, '').includes(soDigitos)) return true;

      // O valor é guardado como "1745.88" e pode ser digitado de três jeitos:
      // "1.745,88" (como a tela mostra), "1745.88" (como o banco guarda) e
      // "1745" (só o começo, que é como se busca com pressa). Testa as leituras
      // possíveis em vez de escolher uma — tirar todo ponto fazia "1745.88"
      // virar "174588" e não achar nada, calado.
      if (/^[\d.,]+$/.test(termo)) {
        const guardado = Math.abs(t.valor).toFixed(2);
        const leituras = [
          termo.replace(/\./g, '').replace(',', '.'),  // 1.745,88 -> 1745.88
          termo.replace(',', '.'),                     // 1745.88  -> 1745.88
        ];
        if (leituras.some(n => n && guardado.startsWith(n))) return true;
      }
      return false;
    });
  }, [transacoes, busca]);

  const carregadas = transacoes.filter(t => t.status_revisao === 'pendente' || t.status_revisao === 'auto_categorizado').length;
  /** Na aba "Pendentes" o filtro do banco já é exatamente esse, então a
   *  contagem exata vale. Em "Todas" o recorte é por mês e a contagem do banco
   *  inclui as confirmadas — aí o número da tela é o certo. */
  const pendentes = filtro === 'pendentes' && totalNoBanco !== null ? totalNoBanco : carregadas;
  /** Quantas o teto deixou de fora. Dizer isso é o mínimo: revisar acreditando
   *  ter visto tudo é pior do que saber que faltam. */
  const foraDaTela = Math.max(0, pendentes - carregadas);

  /**
   * As que as regras já classificaram sozinhas.
   *
   * Confirmar uma por uma no modal só faz sentido para quem precisa DECIDIR a
   * categoria. Quando a regra já decidiu, o modal vira um clique de carimbo — e
   * o backfill da Conta Simples de 24/08 trouxe 439 pendentes de uma vez, das
   * quais 412 já vinham categorizadas. Sem isto aqui, revisar julho e agosto
   * seria abrir 439 modais.
   *
   * Sai de `visiveis` e não de `transacoes`: com a busca ativa, confirmar em
   * lote passa a valer só para o que está na tela. É o que deixa a busca ser
   * ferramenta de revisão — filtra "Meta Ads", confere as 292, confirma
   * aquelas. Confirmar 524 quando a tela mostra 12 seria uma armadilha.
   */
  const prontasParaLote = visiveis.filter(
    t => (t.status_revisao === 'pendente' || t.status_revisao === 'auto_categorizado') && !!t.categoria,
  );

  /** Qual linha está sendo confirmada agora, para o botão dela virar spinner
   *  sem travar as outras. */
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);

  /**
   * Confirma uma transação direto na linha, sem abrir o modal.
   *
   * A categoria já veio da regra; o modal só serviria para carimbar. Ela pediu
   * isto depois de olhar as 524: quando a categoria está certa, o caminho é um
   * clique, e o modal fica para quando há decisão a tomar.
   *
   * Some da lista na hora em vez de esperar o `carregar()`: a aba "Pendentes"
   * não mostra confirmadas, e recarregar 524 linhas a cada clique deixaria a
   * revisão insuportável.
   */
  const confirmarUma = async (t: Transacao) => {
    setConfirmandoId(t.id);
    const { error } = await supabase
      .from('transacoes')
      .update({ status_revisao: 'confirmado' })
      .eq('id', t.id);
    setConfirmandoId(null);

    if (error) {
      toast({ title: 'Não consegui confirmar', description: error.message, variant: 'destructive' });
      return;
    }

    setTransacoes(prev =>
      filtro === 'pendentes'
        ? prev.filter(x => x.id !== t.id)
        : prev.map(x => (x.id === t.id ? { ...x, status_revisao: 'confirmado' } : x)),
    );
    if (filtro === 'pendentes') setTotalNoBanco(n => (n === null ? n : n - 1));
    setVersao(v => v + 1);
  };

  const confirmarLote = async () => {
    const ids = prontasParaLote.map(t => t.id);
    if (ids.length === 0) return;

    const ok = await confirm({
      title: `Confirmar ${ids.length} transações`,
      description:
        'Todas já têm categoria definida pelas regras automáticas. Confirmar marca as ' +
        'transações como revisadas e elas passam a contar no Caixa. As que estão sem ' +
        'categoria continuam pendentes para você decidir uma a uma.',
      confirmText: `Confirmar ${ids.length}`,
      destructive: false,
    });
    if (!ok) return;

    setConfirmandoLote(true);
    // Em blocos: uma cláusula `in` com centenas de ids vira URL longa demais
    // para o PostgREST engolir de uma vez.
    let feitas = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const bloco = ids.slice(i, i + 100);
      const { error } = await supabase
        .from('transacoes')
        .update({ status_revisao: 'confirmado' })
        .in('id', bloco);
      if (error) {
        setConfirmandoLote(false);
        toast({
          title: 'Parou no meio',
          description: `${feitas} confirmadas antes do erro: ${error.message}`,
          variant: 'destructive',
        });
        load();
        return;
      }
      feitas += bloco.length;
    }
    setConfirmandoLote(false);
    toast({ title: `${feitas} transações confirmadas` });
    load();
  };
  const hojeStr = hoje();
  const categorizadasHoje = transacoes.filter(t => t.status_revisao === 'confirmado' && t.data === hojeStr).length;

  return (
    <DashboardLayout title="Financeiro" hideFilters hideTitle>
      <FinanceiroNav />

      <AvisoDivergencias onAbrir={abrirPorId} recarregarEm={versao} />

      {/* summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0" />
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Pendentes</p>
            <p className="text-xl font-semibold">{loading ? '—' : pendentes}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Categorizadas hoje</p>
            <p className="text-xl font-semibold">{loading ? '—' : categorizadasHoje}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3 col-span-2 sm:col-span-1">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total visíveis</p>
            <p className="text-xl font-semibold">{loading ? '—' : visiveis.length}</p>
          </div>
        </div>
      </div>

      {/* O teto cortou. Dizer isso é o mínimo: revisar acreditando ter visto
          tudo é pior do que saber que faltam. */}
      {!loading && foraDaTela > 0 && (
        <div className="mb-5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm">
          <span className="font-medium">
            {foraDaTela} {foraDaTela === 1 ? 'transação não cabe' : 'transações não cabem'} nesta tela.
          </span>{' '}
          <span className="text-muted-foreground">
            São {pendentes} no total e a tela carrega {TETO} por vez. Confirme ou categorize as
            visíveis e {foraDaTela === 1 ? 'ela aparece' : 'elas aparecem'} na próxima carga.
          </span>
        </div>
      )}

      {/* toolbar — `flex-wrap` porque sem ele os botões da direita eram
           cortados na borda em vez de descer para a linha de baixo. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-1 bg-secondary rounded-lg p-1">
          {(['pendentes', 'todas'] as Filtro[]).map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
                filtro === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {f === 'pendentes' ? `Pendentes${pendentes > 0 ? ` (${pendentes})` : ''}` : 'Todas'}
            </button>
          ))}
        </div>

        {/* Só em "Todas": em "Pendentes" a lista é curta por natureza e um
            recorte por mês esconderia pendência de outro mês. */}
        {filtro === 'todas' && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" aria-label="Mês anterior"
              onClick={() => {
                if (mesRev === 0) { setMesRev(11); setAnoRev(a => a - 1); }
                else setMesRev(m => m - 1);
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium w-28 text-center tabular-nums">
              {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][mesRev]} {anoRev}
            </span>
            <Button
              variant="ghost" size="icon" aria-label="Próximo mês"
              onClick={() => {
                if (mesRev === 11) { setMesRev(0); setAnoRev(a => a + 1); }
                else setMesRev(m => m + 1);
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-1 text-xs text-muted-foreground tabular-nums">
              {visiveis.length} {visiveis.length === 1 ? 'lançamento' : 'lançamentos'}
            </span>
          </div>
        )}
        {/* Busca por nome ou valor. Fica na barra, ao lado das abas, porque é
            usada junto com elas — e não escondida atrás de um ícone. */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar nome, valor ou cartão…"
            aria-label="Buscar por nome, valor ou final do cartão"
            className="h-9 pl-8 pr-8"
          />
          {busca && (
            <button
              onClick={() => setBusca('')}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {prontasParaLote.length > 0 && (
            <Button size="sm" variant="outline" onClick={confirmarLote} disabled={confirmandoLote}>
              <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
              {confirmandoLote ? 'Confirmando…' : `Confirmar ${prontasParaLote.length} automáticas`}
            </Button>
          )}
          <Button size="sm" onClick={() => setNovoModal(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Novo lançamento
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.txt,.ofx" className="hidden" onChange={handleImport} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            <Upload className="h-3.5 w-3.5 mr-2" />
            {importing ? 'Importando…' : 'Importar extrato'}
          </Button>
        </div>
      </div>

      {/* table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-28">Data</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Descrição</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-32">Valor</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-40">Grupo</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-44">Categoria</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-24">Status</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider w-24">
                  <span className="sr-only">Confirmar</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Carregando…</td></tr>
              )}
              {!loading && visiveis.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  {/* Com busca ativa, "Nenhuma transação pendente 🎉" seria
                      mentira comemorativa: as pendências existem, o termo é que
                      não achou nada. */}
                  {busca
                    ? `Nada encontrado para "${busca}".`
                    : filtro === 'pendentes' ? 'Nenhuma transação pendente 🎉' : 'Nenhuma transação encontrada'}
                </td></tr>
              )}
              {visiveis.map(t => {
                const s = STATUS_LABEL[t.status_revisao] ?? STATUS_LABEL.pendente;
                const isPendente = t.status_revisao === 'pendente';
                const podeConfirmar =
                  (t.status_revisao === 'pendente' || t.status_revisao === 'auto_categorizado') && !!t.categoria;
                return (
                  <tr
                    key={t.id}
                    onClick={aoClicarSemArrastar(() => openModal(t))}
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-muted/30',
                      isPendente && 'bg-yellow-500/5'
                    )}
                  >
                    <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">
                      {t.data.split('-').reverse().join('/')}
                    </td>
                    {/* Nome do fornecedor em cima, descritor cru embaixo.
                        Conferir 1.100 linhas de "FACEBK *ZXLVNXDAY2 SAO PAULO
                        BR" é conferir ruído; o nome é onde um erro se denuncia.
                        O descritor fica porque é o que ela vê no extrato do
                        banco quando precisa cruzar. */}
                    <td className="px-4 py-3 max-w-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{t.fornecedor}</span>
                        {t.fornecedor_definido === false && (
                          <span
                            className="shrink-0 text-amber-400/80"
                            title="Agrupamento provisório — abra para dar o nome certo"
                          >
                            •
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground/70 truncate" title={t.descricao}>
                        {t.descricao}
                        {t.cartao && ` · ${t.cartao}`}
                      </div>
                    </td>
                    <td className={cn('px-4 py-3 text-right tabular-nums font-medium', t.valor < 0 ? 'text-red-400' : 'text-green-400')}>
                      {formatCurrency(Math.abs(t.valor))}
                    </td>
                    {/* O grupo vem resolvido por `categorias_centro`, e não do
                        `centro_custo` cru do CS — que erra: as cobranças de
                        WhatsApp chegavam marcadas como "Softwares e
                        Ferramentas". Aqui a tela mostra o mesmo que o relatório
                        soma, senão conferir uma coisa e somar outra. */}
                    <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[9rem]">
                      {t.grupo || <span className="italic opacity-50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[10rem]">
                      {t.categoria || <span className="italic opacity-50">sem categoria</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border', s.cls)}>
                        {s.label}
                      </span>
                    </td>
                    {/* Confirmar sem abrir o modal.
                        `stopPropagation` porque a linha inteira abre o modal —
                        sem isso, um clique aqui confirmaria E abriria a janela
                        de algo que acabou de sair da lista.
                        Só aparece quando há categoria: sem ela não existe o que
                        confirmar, e o caminho é o modal mesmo. */}
                    <td className="px-4 py-3 text-right">
                      {podeConfirmar && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Confirmar ${t.fornecedor} de ${formatCurrency(Math.abs(t.valor))}`}
                          disabled={confirmandoId === t.id}
                          onClick={e => { e.stopPropagation(); confirmarUma(t); }}
                          className="h-7 px-2 text-muted-foreground hover:text-green-400 hover:bg-green-500/10"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* modal */}
      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Categorizar transação</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="font-medium truncate">{selected.descricao}</span>
                  <span className={cn('font-semibold tabular-nums shrink-0', selected.valor < 0 ? 'text-red-400' : 'text-green-400')}>
                    {formatCurrency(Math.abs(selected.valor))}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selected.data.split('-').reverse().join('/')}
                  {selected.cartao && ` · ${selected.cartao}`}
                </p>
              </div>

              {/* O nome vale para o fornecedor inteiro, não para esta linha. É
                  o que faz uma correção arrumar o histórico todo em vez de uma
                  transação — e é por isso que o rótulo diz "fornecedor". */}
              <div className="space-y-1.5">
                <Label>
                  Nome do fornecedor
                  {selected.fornecedor_definido === false && (
                    <span className="ml-1.5 text-xs font-normal text-amber-400">
                      agrupamento provisório
                    </span>
                  )}
                </Label>
                <Input
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                  placeholder={selected.fornecedor}
                />
                <p className="text-xs text-muted-foreground">
                  Vale para todas as cobranças que casam com o padrão abaixo, passadas e futuras.
                </p>
              </div>

              {/* O componente traz os dois níveis com os próprios rótulos —
                  grupo em cima, categoria embaixo, e o de cima filtra o outro. */}
              <div className="space-y-1.5">
                <CampoCategoria
                  valor={formCateg}
                  centro={formCentro}
                  onChange={setFormCateg}
                  onCentroChange={setFormCentro}
                />
                {formCentro && (
                  <p className="text-xs text-muted-foreground">
                    Centro de custo: <span className="text-foreground">{formCentro}</span>
                  </p>
                )}
              </div>

              <div className="space-y-2 border border-border rounded-lg p-3 bg-muted/20">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="criar-regra"
                    checked={criarRegra}
                    onCheckedChange={v => setCriarRegra(!!v)}
                  />
                  <Label htmlFor="criar-regra" className="cursor-pointer font-normal text-sm">
                    Criar regra automática para futuras importações
                  </Label>
                </div>
                {criarRegra && (
                  <div className="space-y-1.5 pt-1">
                    <Label className="text-xs text-muted-foreground">Padrão de texto</Label>
                    <Input
                      value={padraoRegra}
                      onChange={e => setPadraoRegra(e.target.value)}
                      placeholder="Texto que aparece na descrição…"
                      className="text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">Qualquer descrição que contenha este texto será auto-categorizada.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSelected(null)}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving || !formCateg}>
              {saving ? 'Salvando…' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* modal — novo lançamento manual */}
      <Dialog open={novoModal} onOpenChange={open => { if (!open) setNovoModal(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo lançamento manual</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* tipo entrada/saída */}
            <div className="flex gap-2">
              {(['saida', 'entrada'] as const).map(tipo => (
                <button
                  key={tipo}
                  onClick={() => setNovoTipo(tipo)}
                  className={cn(
                    'flex-1 py-2 rounded-lg text-sm font-medium border transition-colors',
                    novoTipo === tipo
                      ? tipo === 'saida'
                        ? 'bg-red-500/20 border-red-500/50 text-red-400'
                        : 'bg-green-500/20 border-green-500/50 text-green-400'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tipo === 'saida' ? '↓ Saída' : '↑ Entrada'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={novoData} onChange={e => setNovoData(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input
                  placeholder="0,00"
                  value={novoValor}
                  onChange={e => setNovoValor(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Input
                placeholder="Descrição do lançamento…"
                value={novoDesc}
                onChange={e => setNovoDesc(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <CampoCategoria
                valor={novoCateg}
                centro={novoCentro}
                onChange={setNovoCateg}
                onCentroChange={setNovoCentro}
              />
            </div>

            {/* Centro vem da categoria, não se escolhe à parte — este select
                tinha ficado para trás quando o campo de categoria passou a
                trazer o pai junto. */}
            {novoCentro && (
              <p className="text-xs text-muted-foreground">
                Centro de custo: <span className="text-foreground">{novoCentro}</span>
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNovoModal(false)}>Cancelar</Button>
            <Button
              onClick={criarLancamento}
              disabled={criandoNovo || !novoDesc.trim() || !novoCateg || !novoValor}
            >
              {criandoNovo ? 'Salvando…' : 'Criar lançamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
