import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, Check, Upload, Download, Trash2, FolderOpen } from 'lucide-react';

/**
 * As notas fiscais que cada editor manda por mês.
 *
 * São duas, e a razão é dela: o PAGAMENTO do mês trabalhado, que cai no dia 5 do
 * mês seguinte, e a COMISSÃO relativa à assertividade do mês ANTERIOR, paga na
 * semana em que a NF chega. Vão juntas, mas são competências diferentes — em
 * agosto o editor manda o pagamento de agosto e a comissão de julho.
 *
 * Por isso a tela mostra as duas competências lado a lado em vez de um mês só:
 * quem envia precisa ver que são períodos distintos, senão emite as duas com a
 * mesma data e a contabilidade recusa.
 *
 * Cada editor vê apenas a sua. A NF tem CPF e valor de pagamento dentro, e um
 * editor não deve saber quanto o outro recebe — isso é garantido pela RLS, no
 * banco, e não por esconder o seletor na tela.
 */

interface NotaEsperada {
  subtipo: 'pagamento' | 'comissao';
  competencia: string;
  rotulo: string;
  quando_paga: string;
  documento_id: string | null;
  nome_arquivo: string | null;
  drive_url: string | null;
  enviada_em: string | null;
}

interface Editor { id: string; nome: string }

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function rotuloCompetencia(iso: string): string {
  const [ano, mes] = iso.split('-');
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
}

/** `2026-08_Jaqueline-Coelho_pagamento.pdf` — datado e sempre igual, que é o que
 *  permite achar a NF de meses atrás sem abrir uma por uma. */
function nomeDoArquivo(competencia: string, editor: string, subtipo: string, extensao: string): string {
  const quem = editor
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  return `${competencia.slice(0, 7)}_${quem}_${subtipo}.${extensao}`;
}

export function NotasFiscaisTab() {
  const { perfil } = useAuth();
  const ehAdmin = perfil?.is_admin === true;

  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth());
  const [editores, setEditores] = useState<Editor[]>([]);
  const [editorId, setEditorId] = useState<string>('');
  const [notas, setNotas] = useState<NotaEsperada[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState<string | null>(null);
  const confirm = useConfirm();

  // Um input por linha, e não um input com um `alvoRef` dizendo quem pediu.
  // Com a referência compartilhada, um segundo clique antes de o primeiro
  // terminar sobrescreve o alvo e o arquivo vai para a linha errada — a nota de
  // comissão gravada como pagamento, sem nada na tela denunciando.
  const inputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  const mesEnvio = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
  const editorAtual = editores.find(e => e.id === editorId);

  // Quem sou eu aqui. Admin escolhe; editor não escolhe nada, porque só existe
  // um "eu" — e um seletor de uma opção só é ruído.
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (ehAdmin) {
        const { data } = await supabase
          .from('editores').select('id, nome').eq('ativo', true).order('nome');
        if (!vivo) return;
        setEditores((data ?? []) as Editor[]);
        setEditorId(prev => prev || (data?.[0]?.id ?? ''));
      } else {
        const { data } = await supabase.rpc('fn_meu_editor');
        if (!vivo) return;
        const meu = (data ?? [])[0] as Editor | undefined;
        setEditores(meu ? [meu] : []);
        setEditorId(meu?.id ?? '');
      }
    })();
    return () => { vivo = false; };
  }, [ehAdmin]);

  const carregar = useCallback(async () => {
    if (!editorId) { setNotas([]); setCarregando(false); return; }
    setCarregando(true);
    const { data, error } = await supabase.rpc('fn_nfs_do_editor', {
      p_editor_id: editorId, p_mes: mesEnvio,
    });
    if (error) toast({ title: 'Erro ao carregar', description: error.message, variant: 'destructive' });
    else setNotas((data ?? []) as NotaEsperada[]);
    setCarregando(false);
  }, [editorId, mesEnvio]);

  useEffect(() => { carregar(); }, [carregar]);

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>, nota: NotaEsperada) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';                 // permite reenviar o mesmo arquivo
    if (!arquivo || !editorAtual) return;
    // Um envio por vez: as duas notas gravam na mesma tabela e um segundo
    // upsert no meio do primeiro deixaria a lista recarregando por cima de si
    // mesma. Mas AVISA em vez de ignorar — falhar em silêncio é o pior jeito de
    // funcionar, e foi assim que descobri este caminho: a nota não subia e a
    // tela não dizia nada.
    if (enviando) {
      toast({
        title: 'Um envio de cada vez',
        description: 'Espere o anterior terminar e mande a outra nota.',
      });
      return;
    }

    setEnviando(nota.subtipo);
    try {
      const extensao = arquivo.name.split('.').pop()?.toLowerCase() || 'pdf';
      const nome = nomeDoArquivo(nota.competencia, editorAtual.nome, nota.subtipo, extensao);
      const caminho = `servicos/${nota.competencia.slice(0, 7)}/${nome}`;

      const { error: erroUpload } = await supabase.storage
        .from('documentos').upload(caminho, arquivo, { upsert: true, contentType: arquivo.type });
      if (erroUpload) throw erroUpload;

      // As cinco colunas da chave única: declarar menos devolve "there is no
      // unique or exclusion constraint matching the ON CONFLICT specification".
      const { error: erroLinha } = await supabase.from('documentos_fiscais').upsert({
        competencia: nota.competencia,
        fornecedor: editorAtual.nome,
        tipo: 'servico',
        subtipo: nota.subtipo,
        referencia_externa: '',
        editor_id: editorAtual.id,
        storage_path: caminho,
        nome_arquivo: nome,
      }, { onConflict: 'competencia,fornecedor,tipo,subtipo,referencia_externa' });
      if (erroLinha) throw erroLinha;

      toast({ title: 'Nota enviada', description: nome });
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
  async function abrir(nota: NotaEsperada) {
    const { data } = await supabase
      .from('documentos_fiscais').select('storage_path').eq('id', nota.documento_id!).maybeSingle();
    if (!data?.storage_path) { toast({ title: 'Arquivo não encontrado', variant: 'destructive' }); return; }
    const { data: assinado } = await supabase.storage
      .from('documentos').createSignedUrl(data.storage_path, 60);
    if (assinado?.signedUrl) window.open(assinado.signedUrl, '_blank', 'noopener');
  }

  async function remover(nota: NotaEsperada) {
    // Pergunta antes: some do dashboard e da pasta do Drive de uma vez, e quem
    // clica aqui costuma ser o próprio editor querendo trocar o arquivo — não
    // apagá-lo e ficar sem nenhum.
    const ok = await confirm({
      title: `Remover a nota de ${nota.rotulo.toLowerCase()}?`,
      description: 'Sai do dashboard e também da pasta do Drive. Para corrigir uma nota errada, anexe a certa por cima — não precisa remover antes.',
      confirmText: 'Remover',
    });
    if (!ok) return;

    const { data } = await supabase
      .from('documentos_fiscais').select('storage_path').eq('id', nota.documento_id!).maybeSingle();
    if (data?.storage_path) await supabase.storage.from('documentos').remove([data.storage_path]);
    const { error } = await supabase.from('documentos_fiscais').delete().eq('id', nota.documento_id!);
    if (error) {
      toast({ title: 'Não foi possível remover', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Nota removida' });
    await carregar();
  }

  function avancar() { if (mes === 11) { setMes(0); setAno(a => a + 1); } else setMes(m => m + 1); }
  function voltar()  { if (mes === 0)  { setMes(11); setAno(a => a - 1); } else setMes(m => m - 1); }

  if (!carregando && !editorId) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {ehAdmin
            ? 'Nenhum editor ativo cadastrado.'
            : 'Seu login ainda não está ligado a um cadastro de editor. Peça para a administração vincular.'}
        </p>
      </div>
    );
  }

  const faltam = notas.filter(n => !n.documento_id).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={voltar} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-lg font-semibold w-32 text-center">{MESES[mes]} {ano}</span>
          <Button variant="ghost" size="icon" onClick={avancar} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-1 text-xs text-muted-foreground">mês do envio</span>
        </div>

        {/* Só admin escolhe. Para o editor existe um "eu" só, e um seletor de
            uma opção seria ruído — a RLS já garante que ele não veria outro. */}
        {ehAdmin && editores.length > 0 && (
          <Select value={editorId} onValueChange={setEditorId}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {editores.map(e => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Notas fiscais do mês
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            São duas e de competências diferentes: o pagamento é do mês trabalhado, a comissão é
            do mês anterior. Emita cada uma com a sua data.
          </p>
        </div>

        {carregando ? (
          <p className="text-sm text-muted-foreground text-center py-8">Carregando…</p>
        ) : (
          <>
            {faltam > 0 && (
              <p className="mb-4 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {faltam === 2 ? 'As duas notas ainda não chegaram' : 'Falta uma das duas notas'}
              </p>
            )}

            <ul className="space-y-0">
              {notas.map(n => (
                <li
                  key={n.subtipo}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border/50 py-3 last:border-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground">{n.rotulo}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      competência {rotuloCompetencia(n.competencia)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground/70">
                      pago {n.quando_paga}
                    </span>
                  </span>

                  <span className="shrink-0 whitespace-nowrap">
                    {n.documento_id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => abrir(n)}
                          className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline"
                          title={n.nome_arquivo ?? 'Abrir'}
                        >
                          <Check className="h-3 w-3 shrink-0" />
                          enviada
                        </button>
                        <button
                          type="button" onClick={() => abrir(n)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Baixar ${n.rotulo}`}
                        >
                          <Download className="h-3 w-3" />
                        </button>
                        {n.drive_url ? (
                          <a
                            href={n.drive_url} target="_blank" rel="noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            title="Abrir no Drive"
                          >
                            <FolderOpen className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground/40" title="Ainda não espelhada no Drive">
                            <FolderOpen className="h-3 w-3" />
                          </span>
                        )}
                        <button
                          type="button" onClick={() => remover(n)}
                          className="text-muted-foreground hover:text-red-400"
                          aria-label={`Remover ${n.rotulo}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    ) : (
                      <>
                        <input
                          ref={el => { inputsRef.current[n.subtipo] = el; }}
                          type="file"
                          accept="application/pdf,image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={e => aoEscolherArquivo(e, n)}
                        />
                        <button
                          type="button"
                          onClick={() => inputsRef.current[n.subtipo]?.click()}
                          // Desabilita durante QUALQUER envio, não só o desta
                          // linha: as duas gravam na mesma tabela, e um segundo
                          // envio no meio do primeiro faria a lista recarregar
                          // por cima de si mesma.
                          disabled={enviando !== null}
                          className={cn(
                            'inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs',
                            'text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50',
                          )}
                        >
                          <Upload className="h-3 w-3 shrink-0" />
                          {enviando === n.subtipo ? 'enviando…' : 'enviar nota'}
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
