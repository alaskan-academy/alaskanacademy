import { paraYmd } from '@/lib/datas';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { AlertTriangle, Ban, CalendarClock, Check, RotateCcw } from 'lucide-react';

/**
 * O que se repete todo mês, quanto custa e quando cai.
 *
 * Substitui a aba "Pagamentos" da planilha "Fluxo de Caixa Alaskan 2026", que
 * eram 24 linhas digitadas e atualizadas à mão. Os valores conferem com o que
 * ela mantinha: Google Workspace R$ 98 no dia 1, VTurb R$ 297 no dia 10,
 * Endereço Fiscal R$ 129,20 no dia 17.
 *
 * Mora no Caixa & DRE porque a pergunta é a mesma daquela tela — "o que ainda
 * vai sair da conta" — e não em Gastos, onde a pergunta é para trás.
 */

interface Recorrencia {
  chave: string;
  descricao: string;
  categoria: string | null;
  valor_tipico: number;
  desvio: number;
  dia_tipico: number;
  meses_vistos: number;
  ja_saiu: boolean;
  valor_no_mes: number;
  data_no_mes: string | null;
  encerrada: boolean;
  encerrada_em: string | null;
  /** Cobrou de novo depois de encerrada. */
  reativada: boolean;
  /** `chave` veio de apelido cadastrado, não da normalização do descritor. */
  apelidado: boolean;
  /** false = agrupamento provisório; o extrato não separou e falta decidir. */
  definido: boolean;
  nota: string | null;
}

/** Descritor de extrato é ruído legível: "EBN *CAPCUT CURITIBA BR" ou
 *  "60 063 431 JAQUELINE COELHO SILVA". Tira prefixo de adquirente, CPF
 *  mascarado, praça e telefone para sobrar o nome que ela reconhece. */
function nomeLimpo(descricao: string): string {
  const limpo = descricao
    .replace(/^(DM\*|PG\*|PAG\*|EC\*|MP\*|ASA\*|IG\*|EBN\s+\*?)/i, '')
    .replace(/^[\d\s.\-*]{6,}/, '')
    .replace(/\s+\+?\d[\d\s]*[A-Z]{2}\s*$/i, '')
    .replace(/\s+(SAO PAULO|CURITIBA|CUIABA|GUARATUBA|BARUERI|OSASCO)\s+[A-Z]{2}\s*$/i, '')
    .replace(/\s+[A-Z]{2}\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return limpo || descricao;
}

/** Com apelido cadastrado a chave JÁ é o nome — "Hostinger (domínio)" no lugar
 *  das seis grafias que o extrato usa. Sem apelido, limpa o descritor. */
function nomeExibido(r: Recorrencia): string {
  return r.apelidado ? r.chave : nomeLimpo(r.descricao);
}

export function RecorrentesAVencer({ ano, mes }: { ano: number; mes: number }) {
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const mesIso = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);

    supabase
      .rpc('fn_recorrencias', { p_mes: mesIso, p_meses_base: 6, p_min_meses: 3 })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(error.message);
        else setRecorrencias((data ?? []).map((x: Recorrencia) => ({
          ...x,
          valor_tipico: Number(x.valor_tipico),
          desvio: Number(x.desvio),
          valor_no_mes: Number(x.valor_no_mes),
        })));
        setCarregando(false);
      });

    return () => { vivo = false; };
  }, [mesIso]);

  const hoje = new Date();
  const mesCorrente = hoje.getFullYear() === ano && hoje.getMonth() === mes;
  const diaHoje = hoje.getDate();

  const { aSair, pendentes, ativas, encerradas, aDefinir } = useMemo(() => {
    // Encerrada não é pendência. Membify e Lovable foram cancelados e ficavam
    // em "não veio" para sempre — o detector acertava o fato (o histórico
    // previa, o extrato não tem) e errava a conclusão, porque a diferença entre
    // cartão recusado e contrato encerrado não está no banco.
    const p = recorrencias.filter(r => !r.ja_saiu && !r.encerrada);
    return {
      pendentes: p,
      aSair: p.reduce((a, r) => a + r.valor_tipico, 0),
      ativas: recorrencias.filter(r => !r.encerrada),
      encerradas: recorrencias.filter(r => r.encerrada),
      aDefinir: recorrencias.filter(r => !r.definido),
    };
  }, [recorrencias]);

  /** Alterna "paramos de pagar". Atualiza a lista em memória em vez de refazer
   *  a consulta: a linha muda de seção na hora e o resumo acompanha. */
  async function alternarEncerrada(r: Recorrencia) {
    const encerrando = !r.encerrada;
    const hojeIso = paraYmd(hoje);

    const { error } = encerrando
      ? await supabase.from('recorrencias_encerradas')
          .insert({ chave: r.chave, descricao: r.descricao, encerrada_em: hojeIso })
      : await supabase.from('recorrencias_encerradas')
          .delete().eq('chave', r.chave);

    if (error) { setErro(error.message); return; }

    setRecorrencias(lista => lista.map(x =>
      x.chave === r.chave
        ? { ...x, encerrada: encerrando, encerrada_em: encerrando ? hojeIso : null, reativada: false }
        : x,
    ));
  }

  /** Renomeia o agrupamento e o dá por resolvido. */
  async function renomear(r: Recorrencia, nomeNovo: string) {
    const nome = nomeNovo.trim();
    if (!nome || nome === r.chave) return;

    const { error } = await supabase
      .from('fornecedores')
      .update({ nome, definido: true, nota: null })
      .eq('nome', r.chave);

    if (error) { setErro(error.message); return; }

    // `recorrencias_encerradas` guarda o nome como chave. Sem arrastar junto, um
    // fornecedor encerrado voltaria a alarmar assim que fosse renomeado.
    await supabase.from('recorrencias_encerradas')
      .update({ chave: nome }).eq('chave', r.chave);

    setRecorrencias(lista => lista.map(x =>
      x.chave === r.chave ? { ...x, chave: nome, definido: true, nota: null } : x,
    ));
  }

  if (carregando) {
    return <Moldura><p className="text-sm text-muted-foreground text-center py-8">Carregando…</p></Moldura>;
  }
  if (erro) {
    return <Moldura><p className="text-sm text-red-400 text-center py-8">Não consegui carregar: {erro}</p></Moldura>;
  }
  if (recorrencias.length === 0) {
    return (
      <Moldura>
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhum custo se repetiu por três meses ou mais até aqui.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-muted/30 px-3 py-2.5">
        <span className="text-xs text-muted-foreground">
          {pendentes.length === 0
            ? 'Todas as recorrências do mês já caíram'
            : `${pendentes.length} ${pendentes.length === 1 ? 'recorrência ainda não caiu' : 'recorrências ainda não caíram'}`}
        </span>
        <span className="text-lg font-bold tabular-nums text-amber-400 whitespace-nowrap">
          {formatCurrency(aSair)}
        </span>
      </div>

      {/* Diz o que ainda não foi resolvido, em vez de deixar um agrupamento
          provisório passando por definitivo. */}
      {aDefinir.length > 0 && (
        <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
          <strong className="font-medium text-amber-200">
            {aDefinir.length === 1
              ? '1 fornecedor ainda sem nome definido'
              : `${aDefinir.length} fornecedores ainda sem nome definido`}
          </strong>
          {' — '}o extrato não separa o que são, então agrupei provisoriamente.
          Clique no nome para corrigir.
        </p>
      )}

      <ul className="space-y-0">
        {ativas.map(r => (
          <Linha
            key={r.chave}
            r={r}
            atrasado={mesCorrente && !r.ja_saiu && r.dia_tipico < diaHoje}
            onAlternar={() => alternarEncerrada(r)}
            onRenomear={nome => renomear(r, nome)}
          />
        ))}
      </ul>

      {/* Encerradas ficam à vista, apagadas, e não somem. Escondê-las esconderia
          junto o caso perigoso: serviço cancelado que volta a cobrar sozinho. */}
      {encerradas.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1">
            Paramos de pagar
          </p>
          <ul className="space-y-0">
            {encerradas.map(r => (
              <Linha
                key={r.chave}
                r={r}
                atrasado={false}
                onAlternar={() => alternarEncerrada(r)}
                onRenomear={nome => renomear(r, nome)}
              />
            ))}
          </ul>
        </div>
      )}
    </Moldura>
  );
}

function Linha({
  r, atrasado, onAlternar, onRenomear,
}: {
  r: Recorrencia;
  atrasado: boolean;
  onAlternar: () => void;
  onRenomear: (nome: string) => void;
}) {
  const fixo = r.desvio < r.valor_tipico * 0.05;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(r.chave);

  function confirmar() {
    setEditando(false);
    onRenomear(rascunho);
  }

  return (
    <li
      className={cn(
        'group flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/50 py-2 last:border-0',
        r.encerrada && !r.reativada && 'opacity-50',
      )}
    >
      {editando ? (
        <input
          autoFocus
          value={rascunho}
          onChange={e => setRascunho(e.target.value)}
          onBlur={confirmar}
          onKeyDown={e => {
            if (e.key === 'Enter') confirmar();
            if (e.key === 'Escape') { setRascunho(r.chave); setEditando(false); }
          }}
          className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-foreground"
          aria-label={`Nome de ${r.chave}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => { setRascunho(r.chave); setEditando(true); }}
          className={cn(
            'min-w-0 flex-1 truncate text-left hover:underline decoration-dotted underline-offset-2',
            r.encerrada ? 'text-muted-foreground' : 'text-foreground',
            // Provisório se anuncia. Sem isto, "Hostinger (a definir)" passaria
            // por nome de verdade e ninguém saberia que falta decidir.
            !r.definido && 'text-amber-300',
          )}
          title={r.nota ?? r.descricao}
        >
          {nomeExibido(r)}
          {!r.definido && <span className="ml-1 text-amber-400/80">•</span>}
        </button>
      )}

      <span className={cn('tabular-nums whitespace-nowrap', r.encerrada ? 'text-muted-foreground' : 'text-foreground')}>
        {formatCurrency(r.valor_tipico)}
        {!fixo && (
          <span
            className="ml-0.5 text-muted-foreground"
            title={`Varia entre os meses — desvio de ${formatCurrency(r.desvio)}`}
          >
            ~
          </span>
        )}
      </span>

      <span className="w-14 shrink-0 text-right text-xs text-muted-foreground whitespace-nowrap">
        dia {r.dia_tipico}
      </span>

      <span className="w-24 shrink-0 text-right whitespace-nowrap">
        {r.reativada ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-red-400 font-medium"
            title={`Marcada como encerrada em ${r.encerrada_em} e voltou a cobrar`}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            cobrou
          </span>
        ) : r.encerrada ? (
          <span className="text-xs text-muted-foreground">encerrada</span>
        ) : r.ja_saiu ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-green-400"
            title={`Saiu ${r.data_no_mes ? `em ${r.data_no_mes.split('-').reverse().join('/')}` : 'neste mês'}`}
          >
            <Check className="h-3 w-3 shrink-0" />
            {formatCurrency(r.valor_no_mes)}
          </span>
        ) : atrasado ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-amber-400"
            title="Costuma cair antes de hoje e ainda não apareceu no extrato"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            não veio
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarClock className="h-3 w-3 shrink-0" />
            previsto
          </span>
        )}
      </span>

      {/* Sempre no DOM, visível no hover e no foco. Se aparecesse só no hover
          via montagem condicional, ninguém chegaria nele pelo teclado. */}
      <button
        type="button"
        onClick={onAlternar}
        className={cn(
          'w-6 shrink-0 text-center text-muted-foreground opacity-0 transition-opacity',
          'group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded',
        )}
        title={r.encerrada ? 'Voltamos a pagar' : 'Paramos de pagar'}
        aria-label={r.encerrada ? `Voltamos a pagar ${nomeExibido(r)}` : `Paramos de pagar ${nomeExibido(r)}`}
      >
        {r.encerrada ? <RotateCcw className="h-3 w-3 mx-auto" /> : <Ban className="h-3 w-3 mx-auto" />}
      </button>

      {r.categoria && (
        <span className="w-full text-[11px] text-muted-foreground/70">{r.categoria}</span>
      )}
    </li>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Ainda deve sair
      </h2>
      <p className="text-xs text-muted-foreground/70 mb-4">
        Custos que se repetem, detectados no extrato dos últimos 6 meses. Valor típico é a
        mediana do mês; o dia é o mais frequente.
      </p>
      {children}
    </div>
  );
}
