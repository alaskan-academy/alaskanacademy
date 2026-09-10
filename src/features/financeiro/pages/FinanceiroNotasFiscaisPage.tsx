import { useCallback, useEffect, useRef, useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useFilters } from '@/contexts/FilterContext';
import { formatCurrency } from '@/lib/formatters';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { enviarDocumento, mensagemDeEnvio } from '@/lib/documentos';
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
  /** Todas as notas do fornecedor no mês. As três colunas acima são atalho
   *  para a primeira; esta é a lista inteira. */
  documentos: Documento[];
}

interface Documento {
  id: string;
  nome_arquivo: string | null;
  drive_url: string | null;
  storage_path: string;
}

/**
 * Um pedaço do nome ORIGINAL do arquivo, e é ele que separa uma nota da outra.
 *
 * O Meta Ads de agosto teve 129 lançamentos: são várias faturas, não uma. Sem
 * esta chave as duas virariam o mesmo nome de arquivo e a segunda apagaria a
 * primeira no Storage, em silêncio.
 *
 * Serve para duas coisas ao mesmo tempo, e de propósito: entra no nome gravado
 * e em `referencia_externa`, que é parte da unicidade da tabela. Assim
 * reenviar o MESMO arquivo corrige, e enviar outro acrescenta.
 */
function chaveDoArquivo(nomeOriginal: string): string {
  return nomeOriginal
    .replace(/\.[^.]+$/, '')                          // sem extensão
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sem acento
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase() || 'arquivo';
}

/** Nome do arquivo, sempre datado e sempre no mesmo formato — é o que permite
 *  achar a NF de dezembro passado sem abrir uma por uma.
 *  `2026-08_ElevenLabs_invoice_fatura-agosto.pdf` */
function nomeDoArquivo(item: Item, competencia: string, extensao: string, chave: string, subtipo?: string): string {
  const fornecedor = item.fornecedor
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sem acento
    .replace(/[^\w\s()-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  const sufixo = subtipo ?? (item.pais === 'BR' ? 'NF' : 'invoice');
  return `${competencia}_${fornecedor}_${sufixo}_${chave}.${extensao}`;
}

export default function FinanceiroNotasFiscaisPage() {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const [itens, setItens] = useState<Item[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState<string | null>(null);
  const confirm = useConfirm();

  // Um input por linha, e não um input com um `alvoRef` dizendo quem pediu.
  // Com a referência compartilhada, um segundo clique antes de o primeiro
  // terminar sobrescreve o alvo e o arquivo vai para o fornecedor errado — a NF
  // da ElevenLabs gravada como sendo da Spedy, sem nada denunciando na tela.
  // Input escondido é barato; 21 deles não pesam.
  const inputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  const competencia = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

  const { empresaId } = useFilters();

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc('fn_checklist_fiscal', { p_competencia: competencia, p_empresa: empresaId });
    if (error) toast({ title: 'Erro ao carregar', description: error.message, variant: 'destructive' });
    // `documentos` sempre vira lista: a função já devolve `[]`, mas a tela lê
    // `.length` em toda linha e um nulo aqui derrubaria a página inteira por
    // causa de um fornecedor.
    else setItens((data ?? []).map((x: Item) => ({
      ...x, valor: Number(x.valor), documentos: x.documentos ?? [],
    })));
    setCarregando(false);
  }, [competencia, empresaId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>, item: Item) {
    const arquivos = Array.from(e.target.files ?? []);
    e.target.value = '';                 // permite reenviar o mesmo arquivo
    if (arquivos.length === 0) return;
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
    let enviados = 0;
    const falhas: string[] = [];
    /*
      Os arquivos vão um de cada vez, e não em paralelo.

      Cada um são dois passos — sobe ao Storage, grava a linha — e o segundo
      desfaz o primeiro quando falha. Em paralelo, uma falha no meio deixaria
      arquivo órfão no bucket, que foi como quatro NFs sumiram em
      `ferramentas/2026-08`.

      Uma falha no meio da fila também não derruba o resto: o que deu certo
      fica, e o aviso no fim diz exatamente quantos e quais faltaram.
    */
    for (const arquivo of arquivos) {
    try {
      const extensao = arquivo.name.split('.').pop()?.toLowerCase() || 'pdf';
      const chave = chaveDoArquivo(arquivo.name);
      const nome = nomeDoArquivo(item, competencia.slice(0, 7), extensao, chave);
      const pasta = item.tipo === 'servico' ? 'servicos' : 'ferramentas';
      const caminho = `${pasta}/${competencia.slice(0, 7)}/${nome}`;

      // Arquivo e linha como uma coisa só: se a linha falhar, o arquivo que
      // acabou de subir é removido em vez de virar órfão no bucket. Foi assim
      // que quatro NFs ficaram perdidas em `ferramentas/2026-08`.
      await enviarDocumento(caminho, arquivo, async (destino) => {
        // `upsert` na tabela também: reenviar corrige em vez de duplicar.
        //
        // As CINCO colunas da constraint precisam aparecer no `onConflict` — o
        // PostgREST exige correspondência exata, e declarar quatro das cinco
        // devolvia "there is no unique or exclusion constraint matching the ON
        // CONFLICT specification". Nenhuma nota conseguia ser gravada.
        //
        // `referencia_externa` entrou na chave depois, quando os comprovantes
        // de PIX passaram a usar esta mesma tabela: comprovante é por
        // TRANSAÇÃO, e sem ela o segundo PIX do mês ao mesmo destinatário
        // sobrescrevia o primeiro. Esta tela não tem referência, mas precisa
        // declará-la assim mesmo, senão o PostgREST não acha a constraint.
        const { error } = await supabase
          .from('documentos_fiscais')
          .upsert({
            competencia,
            empresa_id: empresaId,
            fornecedor: item.fornecedor,
            tipo: item.tipo,
            // Vazio em ferramenta e comprovante; 'pagamento'/'comissao' são de
            // prestador, que manda duas por mês.
            subtipo: '',
            // A CHAVE DO ARQUIVO, e não vazio como antes: é ela que permite
            // duas notas do mesmo fornecedor no mesmo mês. Vazio fazia a
            // segunda sobrescrever a primeira, porque as cinco colunas do
            // `onConflict` ficavam idênticas.
            //
            // Nunca nulo: a coluna é `not null default ''` justamente para que
            // a unicidade funcione. Nulo não colide com nulo no Postgres, e
            // reenviar criaria uma segunda linha em vez de corrigir.
            referencia_externa: chave,
            storage_path: destino,
            nome_arquivo: nome,
            valor: item.valor,
          }, { onConflict: 'competencia,fornecedor,tipo,subtipo,referencia_externa' });
        return error;
      });

      enviados++;
    } catch (err) {
      falhas.push(`${arquivo.name}: ${mensagemDeEnvio(err)}`);
    }
    }

    setEnviando(null);
    await carregar();

    // O aviso conta os dois lados. "Enviado" sozinho, depois de três arquivos
    // e uma falha, esconderia justamente o que precisa de ação.
    if (falhas.length === 0) {
      toast({
        title: enviados === 1 ? 'Enviado' : `${enviados} arquivos enviados`,
        description: item.fornecedor,
      });
    } else {
      toast({
        title: enviados > 0
          ? `${enviados} de ${arquivos.length} enviados`
          : 'Não consegui enviar',
        description: falhas.join(' · '),
        variant: 'destructive',
      });
    }
  }

  /** O bucket é privado: link direto não abre. Gera uma URL que vale 1 minuto. */
  async function abrir(doc: Documento) {
    if (!doc.storage_path) {
      toast({ title: 'Arquivo não encontrado', variant: 'destructive' });
      return;
    }
    const { data: assinado } = await supabase.storage
      .from('documentos')
      .createSignedUrl(doc.storage_path, 60);
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

  /** Remove UMA nota. Com várias no mesmo fornecedor, apagar todas de uma vez
   *  seria destruir o que ela não pediu — a confirmação diz qual arquivo é. */
  async function remover(item: Item, doc: Documento) {
    // Pergunta antes: um clique aqui apaga em três lugares de uma vez, e a
    // cópia do Drive é a que a contabilidade usa. Não há desfazer.
    const ok = await confirm({
      title: `Remover a nota de ${item.fornecedor}?`,
      description: `${doc.nome_arquivo ?? 'O arquivo'} sai do dashboard e também da pasta do Drive que a contabilidade usa. Não dá para desfazer.`,
      confirmText: 'Remover',
    });
    if (!ok) return;

    if (doc.storage_path) await supabase.storage.from('documentos').remove([doc.storage_path]);
    const { error } = await supabase.from('documentos_fiscais').delete().eq('id', doc.id);
    if (error) {
      toast({ title: 'Não foi possível remover', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Nota removida', description: doc.nome_arquivo ?? item.fornecedor });
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

  // Separa o que é tarefa dela do que é espera. Um contador só, dizendo "23 de
  // 23 ainda sem documento", faz parecer que há 23 notas para ela buscar —
  // quando duas são de prestador e chegam sozinhas pela área dos editores.
  const faltamDela    = faltam.filter(i => i.tipo !== 'servico');
  const faltamEditores = faltam.filter(i => i.tipo === 'servico');

  return (
    <DashboardLayout title="Notas Fiscais" hideFilters hideTitle>
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
                : (
                  <>
                    {faltamDela.length > 0
                      ? `${faltamDela.length} de ${itens.length} para você buscar`
                      : 'Nada para você buscar'}
                    {faltamEditores.length > 0 && (
                      <span className="text-amber-400/80">
                        {' · '}
                        {faltamEditores.length === 1
                          ? '1 editor ainda não enviou a NF'
                          : `${faltamEditores.length} editores ainda não enviaram a NF`}
                      </span>
                    )}
                  </>
                )}
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
                  {/* O input mora FORA do ramo, e não dentro do "ainda falta".
                      Dentro, um fornecedor que já tem nota perdia o botão de
                      anexar — e com várias faturas por mês a segunda só entrava
                      apagando a primeira. */}
                  <input
                    ref={el => { inputsRef.current[item.fornecedor] = el; }}
                    type="file"
                    // Vários de uma vez: um fornecedor como o Meta Ads fecha o
                    // mês com várias faturas, e anexar uma por uma era o que
                    // fazia a tela render menos que a pasta.
                    multiple
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={e => aoEscolherArquivo(e, item)}
                  />
                  {item.tem_documento ? (
                    <span className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => abrir(item.documentos[0])}
                        className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline"
                        title={item.nome_arquivo ?? 'Abrir'}
                      >
                        <Check className="h-3 w-3 shrink-0" />
                        {/* Com mais de uma, o rótulo passa a ser a CONTAGEM: um
                            "recebido" sozinho esconderia que existem outras
                            três, e o que está escondido ninguém confere. */}
                        {item.documentos.length > 1 ? `${item.documentos.length} notas` : 'recebido'}
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
                        onClick={() => abrir(item.documentos[0])}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Baixar documento de ${item.fornecedor}`}
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      {/* Anexar MAIS uma. Com uma nota só, o lixo ao lado dá
                          conta de trocar; com várias, sem este botão a segunda
                          fatura do mês não teria por onde entrar. */}
                      <button
                        type="button"
                        onClick={() => inputsRef.current[item.fornecedor]?.click()}
                        disabled={enviando !== null}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                        title="Anexar mais um arquivo"
                        aria-label={`Anexar mais um documento de ${item.fornecedor}`}
                      >
                        <Upload className="h-3 w-3" />
                      </button>
                      {item.documentos.length === 1 && (
                        <button
                          type="button"
                          onClick={() => remover(item, item.documentos[0])}
                          className="text-muted-foreground hover:text-red-400"
                          aria-label={`Remover documento de ${item.fornecedor}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ) : (
                    <>
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
                        {enviando === item.fornecedor
                          ? 'enviando…'
                          : item.tipo === 'servico' ? 'anexar por ele' : 'anexar'}
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

                {/* As notas, uma a uma, quando há mais de uma.
                    Sem esta linha as outras existiriam sem aparecer: dava para
                    anexar quatro e ver "4 notas", mas não para saber QUAIS nem
                    remover a errada. Cadastro sem a leitura ao lado envelhece —
                    é a segunda armadilha do projeto. */}
                {item.documentos.length > 1 && (
                  <span className="flex w-full flex-wrap gap-1.5">
                    {item.documentos.map(doc => (
                      <span
                        key={doc.id}
                        className="inline-flex max-w-full items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        <button
                          type="button"
                          onClick={() => abrir(doc)}
                          className="truncate hover:text-foreground hover:underline"
                          title={doc.nome_arquivo ?? 'Abrir'}
                        >
                          {doc.nome_arquivo ?? 'sem nome'}
                        </button>
                        {doc.drive_url && (
                          <a
                            href={doc.drive_url}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 hover:text-foreground"
                            title="Abrir no Drive"
                            aria-label={`Abrir no Drive ${doc.nome_arquivo ?? 'o arquivo'}`}
                          >
                            <FolderOpen className="h-2.5 w-2.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => remover(item, doc)}
                          className="shrink-0 hover:text-red-400"
                          aria-label={`Remover ${doc.nome_arquivo ?? 'o arquivo'}`}
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </span>
                )}

                {/* Prestador manda a própria nota, na área dele em Editores.
                    Antes esta linha parecia trabalho dela — "anexar", igual às
                    ferramentas —, quando na verdade é espera. O botão continua
                    ali para o caso de o editor mandar por fora, mas agora diz
                    que é exceção. */}
                {item.tipo === 'servico' && !item.tem_documento && (
                  <span className="w-full text-[11px] text-amber-400/80">
                    Aguardando: o editor ainda não enviou a NF.
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
