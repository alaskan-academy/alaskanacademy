import { useCallback, useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Check, Upload, Download, Trash2, FolderOpen } from 'lucide-react';
import { FinanceiroNav } from '@/features/financeiro/components/FinanceiroNav';
import { cn } from '@/lib/utils';

/**
 * De quem falta nota fiscal neste mês.
 *
 * A versão anterior amarrava cada NF a um cadastro de ferramentas mantido à mão
 * e guardava o Drive como URL colada. As duas tabelas terminaram com ZERO
 * linhas: o recurso exigia trabalho antes de devolver qualquer coisa, então
 * ninguém usou.
 *
 * Aqui a lista sai do extrato. Se saiu dinheiro da conta para um fornecedor no
 * mês, ele aparece — nada para cadastrar, e fornecedor novo entra sozinho no dia
 * seguinte. O país do descritor decide se o que se cobra é NF (nacional) ou
 * invoice (estrangeiro).
 */

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface Item {
  fornecedor: string;
  pais: string;
  categoria: string | null;
  tipo: 'ferramenta' | 'servico';
  valor: number;
  lancamentos: number;
  primeiro_dia: string;
  tem_documento: boolean;
  documento_id: string | null;
  /** Preenchido quando o espelho no Drive já rodou. */
  drive_url: string | null;
  nome_arquivo: string | null;
}

/** Nome do arquivo, sempre datado e sempre no mesmo formato — é o que permite
 *  achar a NF de dezembro passado sem abrir uma por uma.
 *  `2026-08_ElevenLabs_invoice.pdf`, `2026-08_Jaqueline-Coelho_pagamento.pdf` */
function nomeDoArquivo(item: Item, competencia: string, extensao: string, subtipo?: string): string {
  const fornecedor = item.fornecedor
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sem acento
    .replace(/[^\w\s()-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  const sufixo = subtipo ?? (item.pais === 'BR' ? 'NF' : 'invoice');
  return `${competencia}_${fornecedor}_${sufixo}.${extensao}`;
}

export default function FinanceiroNotasFiscaisPage() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const [itens, setItens] = useState<Item[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState<string | null>(null);

  // Um input por linha, e não um input com um `alvoRef` dizendo quem pediu.
  // Com a referência compartilhada, um segundo clique antes de o primeiro
  // terminar sobrescreve o alvo e o arquivo vai para o fornecedor errado — a NF
  // da ElevenLabs gravada como sendo da Spedy, sem nada denunciando na tela.
  // Input escondido é barato; 21 deles não pesam.
  const inputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  const competencia = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc('fn_checklist_fiscal', { p_competencia: competencia });
    if (error) toast({ title: 'Erro ao carregar', description: error.message, variant: 'destructive' });
    else setItens((data ?? []).map((x: Item) => ({ ...x, valor: Number(x.valor) })));
    setCarregando(false);
  }, [competencia]);

  useEffect(() => { carregar(); }, [carregar]);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>, item: Item) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';                 // permite reenviar o mesmo arquivo
    if (!arquivo) return;
    // Um envio por vez: dois em paralelo fariam a lista recarregar por cima de
    // si mesma, e a segunda leitura poderia chegar antes da primeira gravar.
    // Avisa em vez de ignorar — falhar em silêncio é o pior jeito de funcionar.
    if (enviando) {
      toast({
        title: 'Um envio de cada vez',
        description: 'Espere o anterior terminar e anexe o próximo.',
      });
      return;
    }

    setEnviando(item.fornecedor);
    try {
      const extensao = arquivo.name.split('.').pop()?.toLowerCase() || 'pdf';
      const nome = nomeDoArquivo(item, competencia.slice(0, 7), extensao);
      const pasta = item.tipo === 'servico' ? 'servicos' : 'ferramentas';
      const caminho = `${pasta}/${competencia.slice(0, 7)}/${nome}`;

      const { error: erroUpload } = await supabase.storage
        .from('documentos')
        .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type });
      if (erroUpload) throw erroUpload;

      // `upsert` na tabela também: reenviar corrige em vez de duplicar.
      //
      // As QUATRO colunas da constraint precisam aparecer no `onConflict` — o
      // PostgREST exige correspondência exata, e declarar três das quatro
      // devolvia "there is no unique or exclusion constraint matching the ON
      // CONFLICT specification". Nenhuma nota conseguia ser gravada.
      const { error: erroLinha } = await supabase
        .from('documentos_fiscais')
        .upsert({
          competencia,
          fornecedor: item.fornecedor,
          tipo: item.tipo,
          // Vazio em ferramenta e comprovante; 'pagamento'/'comissao' são de
          // prestador, que manda duas por mês.
          subtipo: '',
          storage_path: caminho,
          nome_arquivo: nome,
          valor: item.valor,
        }, { onConflict: 'competencia,fornecedor,tipo,subtipo' });
      if (erroLinha) throw erroLinha;

      toast({ title: 'Enviado', description: nome });
      await carregar();
    } catch (err) {
      toast({
        title: 'Não consegui enviar',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setEnviando(null);
    }
  }

  /** O bucket é privado: link direto não abre. Gera uma URL que vale 1 minuto. */
  async function abrir(item: Item) {
    const { data, error } = await supabase
      .from('documentos_fiscais')
      .select('storage_path')
      .eq('id', item.documento_id!)
      .single();
    if (error || !data?.storage_path) {
      toast({ title: 'Arquivo não encontrado', variant: 'destructive' });
      return;
    }
    const { data: assinado } = await supabase.storage
      .from('documentos')
      .createSignedUrl(data.storage_path, 60);
    if (assinado?.signedUrl) window.open(assinado.signedUrl, '_blank', 'noopener');
  }

  /** Pergunta pelo `drive_url` até ele aparecer ou o tempo acabar. Devolve se
   *  chegou, para a mensagem dizer a verdade em vez de prometer. */
  async function esperarEspelho(documentoId: string, tetoMs: number): Promise<boolean> {
    const ate = Date.now() + tetoMs;
    while (Date.now() < ate) {
      await new Promise(r => setTimeout(r, 1200));
      const { data } = await supabase
        .from('documentos_fiscais').select('drive_url').eq('id', documentoId).maybeSingle();
      if (data?.drive_url) return true;
    }
    return false;
  }

  /** Reenvia ao Drive um documento cujo espelho falhou. Quem chama a função de
   *  borda é o banco: o segredo não pode estar no navegador. */
  async function reenviarEspelho(item: Item) {
    if (!item.documento_id) return;
    setEnviando(item.fornecedor);
    const { data, error } = await supabase.rpc('fn_reenviar_espelho', { p_documento_id: item.documento_id });
    if (error) {
      toast({ title: 'Não consegui reenviar', description: error.message, variant: 'destructive' });
    } else if (data !== 'reenviado') {
      toast({ title: 'Não deu para reenviar', description: String(data), variant: 'destructive' });
    } else {
      // O espelho é assíncrono e não avisa quando termina. Esperar um tempo
      // fixo é chute: com 2,5s a tela recarregava antes e mostrava o mesmo
      // estado, como se o clique não tivesse feito nada. Aqui se espera o
      // RESULTADO, com teto para não travar caso o Drive esteja fora.
      const chegou = await esperarEspelho(item.documento_id, 15000);
      await carregar();
      toast(chegou
        ? { title: 'Reenviado ao Drive' }
        : { title: 'Reenviado, mas ainda não confirmou', description: 'Recarregue em instantes para conferir.' });
    }
    setEnviando(null);
  }

  async function remover(item: Item) {
    const { data } = await supabase
      .from('documentos_fiscais').select('storage_path').eq('id', item.documento_id!).single();
    if (data?.storage_path) await supabase.storage.from('documentos').remove([data.storage_path]);
    await supabase.from('documentos_fiscais').delete().eq('id', item.documento_id!);
    await carregar();
  }

  function avancar() {
    if (mes === 11) { setMes(0); setAno(a => a + 1); } else setMes(m => m + 1);
  }
  function voltar() {
    if (mes === 0) { setMes(11); setAno(a => a - 1); } else setMes(m => m - 1);
  }

  const faltam = itens.filter(i => !i.tem_documento);
  const valorFaltante = faltam.reduce((a, i) => a + i.valor, 0);

  return (
    <DashboardLayout title="Notas Fiscais" hideFilters>
      <FinanceiroNav />

      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" onClick={voltar} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-lg font-semibold w-32 text-center">{MESES[mes]} {ano}</span>
        <Button variant="ghost" size="icon" onClick={avancar} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            De quem falta documento
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            A lista vem de quem foi pago no mês — nada para cadastrar. Fornecedor nacional deve
            NF; estrangeiro, invoice.
          </p>
        </div>

        {!carregando && itens.length > 0 && (
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-muted/30 px-3 py-2.5">
            <span className="text-xs text-muted-foreground">
              {faltam.length === 0
                ? `Todos os ${itens.length} documentos do mês foram recebidos`
                : `${faltam.length} de ${itens.length} ainda sem documento`}
            </span>
            {faltam.length > 0 && (
              <span className="text-lg font-bold tabular-nums text-amber-400 whitespace-nowrap">
                {formatCurrency(valorFaltante)}
              </span>
            )}
          </div>
        )}

        {carregando ? (
          <p className="text-sm text-muted-foreground text-center py-8">Carregando…</p>
        ) : itens.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Nenhum pagamento a fornecedor neste mês.
          </p>
        ) : (
          <ul className="space-y-0">
            {itens.map(item => (
              <li
                key={`${item.fornecedor}-${item.tipo}`}
                className={cn(
                  'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/50 py-2 last:border-0',
                  item.tem_documento && 'opacity-60',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-foreground" title={item.categoria ?? ''}>
                  {item.fornecedor}
                </span>

                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[11px]',
                    item.pais === 'BR'
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-blue-500/15 text-blue-300',
                  )}
                  title={item.pais === 'BR' ? 'Fornecedor nacional' : `Fornecedor em ${item.pais}`}
                >
                  {item.pais === 'BR' ? 'NF' : 'invoice'}
                </span>

                <span className="tabular-nums whitespace-nowrap text-foreground">
                  {formatCurrency(item.valor)}
                </span>

                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground whitespace-nowrap">
                  {item.lancamentos > 1 ? `${item.lancamentos} lanç.` : ''}
                </span>

                <span className="w-28 shrink-0 text-right whitespace-nowrap">
                  {item.tem_documento ? (
                    <span className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => abrir(item)}
                        className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline"
                        title={item.nome_arquivo ?? 'Abrir'}
                      >
                        <Check className="h-3 w-3 shrink-0" />
                        recebido
                      </button>
                      {/* O Drive é cópia, não fonte — se o espelho falhar o
                          arquivo continua no Storage e a tela segue funcionando.
                          Por isso o estado aparece discreto e não como erro. */}
                      {item.drive_url ? (
                        <a
                          href={item.drive_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          title="Abrir no Drive"
                          aria-label={`Abrir no Drive a nota de ${item.fornecedor}`}
                        >
                          <FolderOpen className="h-3 w-3" />
                        </a>
                      ) : (
                        // Falha de espelho não pode ser só um ícone apagado: o
                        // arquivo está salvo, mas a contabilidade não o vê, e
                        // sem um botão ninguém descobre nem conserta.
                        <button
                          type="button"
                          onClick={() => reenviarEspelho(item)}
                          disabled={enviando === item.fornecedor}
                          className="text-amber-400/70 hover:text-amber-300 disabled:opacity-50"
                          title="Não chegou ao Drive — clique para reenviar"
                          aria-label={`Reenviar ao Drive a nota de ${item.fornecedor}`}
                        >
                          <FolderOpen className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => abrir(item)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Baixar documento de ${item.fornecedor}`}
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remover(item)}
                        className="text-muted-foreground hover:text-red-400"
                        aria-label={`Remover documento de ${item.fornecedor}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ) : (
                    <>
                      <input
                        ref={el => { inputsRef.current[item.fornecedor] = el; }}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={e => aoEscolherArquivo(e, item)}
                      />
                      <button
                        type="button"
                        onClick={() => inputsRef.current[item.fornecedor]?.click()}
                        // Desabilita durante QUALQUER envio, não só o desta
                        // linha: dois em paralelo fariam a lista recarregar por
                        // cima de si mesma.
                        disabled={enviando !== null}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        <Upload className="h-3 w-3 shrink-0" />
                        {enviando === item.fornecedor ? 'enviando…' : 'anexar'}
                      </button>
                    </>
                  )}
                </span>

                {item.categoria && (
                  <span className="w-full text-[11px] text-muted-foreground/70">
                    {item.categoria}
                    {item.tipo === 'servico' && ' · prestador'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}
