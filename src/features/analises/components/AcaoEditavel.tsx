import { ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Ban, CheckCircle2, Pencil, RotateCcw, Target, Trash2 } from 'lucide-react';

/**
 * Uma ação que pode ser corrigida depois de escrita.
 *
 * Existe porque o registro que não se corrige envelhece torto: a pessoa escreve
 * "subir o preço" às pressas, descobre na semana seguinte que era do bump, e
 * sem edição a única saída é criar outra linha — ficando duas versões da mesma
 * decisão no histórico. É o mesmo defeito de dois campos dizendo a mesma coisa,
 * só que espalhado no tempo.
 *
 * O que NÃO se edita é `feita_em` e `feita_por`: são carimbo do que aconteceu,
 * não opinião sobre o que aconteceu. Quem quiser mudar desmarca e marca de
 * novo, e o carimbo se refaz sozinho pelo gatilho no banco.
 */

export interface AcaoEditavelDados {
  id: string;
  texto: string;
  expectativa: string | null;
  /**
   * O que ficou dessa ação. Par de `expectativa`, escrito depois.
   *
   * Serve aos dois destinos: "fizemos e deu nisso" e "não fizemos por isso".
   * Um campo separado de motivo-do-cancelamento seria o mesmo fato em dois
   * lugares, e os dois divergiriam.
   */
  resultado?: string | null;
  feita: boolean;
  feita_em: string | null;
  feita_por_nome: string | null;
  /** Quando se decidiu NÃO fazer. Excludente com `feita`, por CHECK no banco. */
  cancelada_em?: string | null;
  cancelada_por_nome?: string | null;
}

interface Props {
  acao: AcaoEditavelDados;
  onSalvar: (id: string, texto: string, expectativa: string | null) => Promise<void>;
  onMarcar: (id: string, feita: boolean) => Promise<void>;
  onApagar: (id: string) => Promise<void>;
  /**
   * Gravar o resultado. Separado de `onSalvar` de propósito: escrever o que
   * aconteceu não pode arrastar junto o texto e a expectativa, que são o
   * registro de ANTES e não se reescrevem ao avaliar.
   *
   * Sem ele o campo não aparece, e é assim que o Histórico fica só de leitura.
   */
  onResultado?: (id: string, resultado: string | null) => Promise<void>;
  /**
   * Cancelar, ou desfazer o cancelamento.
   *
   * Terceiro destino da ação, ao lado de feita e apagada. Apagar diz na
   * própria confirmação que "a decisão some do histórico e não volta" — e
   * desistir de uma alteração é uma decisão que vale guardar, com o motivo.
   */
  onCancelar?: (id: string, cancelada: boolean) => Promise<void>;
  /**
   * O selo da direita, que muda com o lugar: "desde 12/08" nas pendentes da
   * Rodada, "14 dias de dados" nas feitas, nada no Histórico.
   *
   * É uma fresta e não três componentes de propósito. A linha existia desenhada
   * à mão em três lugares, e a versão da Rodada tinha ficado sem edição — foi
   * assim que uma ação escrita às pressas ficou sem jeito de ganhar a
   * expectativa depois, a não ser indo até o Histórico.
   */
  direita?: ReactNode;
}

function quando(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às `
       + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function AcaoEditavel({
  acao, onSalvar, onMarcar, onApagar, onResultado, onCancelar, direita,
}: Props) {
  const cancelada = acao.cancelada_em != null;
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(acao.texto);
  const [expectativa, setExpectativa] = useState(acao.expectativa ?? '');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!texto.trim() || salvando) return;
    setSalvando(true);
    await onSalvar(acao.id, texto.trim(), expectativa.trim() || null);
    setSalvando(false);
    setEditando(false);
  }

  if (editando) {
    return (
      <div className="rounded-md border border-primary/40 bg-secondary/20 p-2 space-y-2">
        <Input
          className="h-9 text-base" value={texto}
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } }}
        />
        <Textarea
          className="h-20 resize-none text-base"
          placeholder="O que você esperava disso? Opcional."
          value={expectativa} onChange={e => setExpectativa(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7" onClick={salvar} disabled={!texto.trim() || salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => {
            setTexto(acao.texto); setExpectativa(acao.expectativa ?? ''); setEditando(false);
          }}>
            Cancelar
          </Button>
          <div className="flex-1" />
          <Button
            size="sm" variant="ghost" className="h-9 gap-1 text-destructive hover:text-destructive"
            onClick={() => onApagar(acao.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Apagar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 group">
      {cancelada ? (
        /* A caixinha some: marcar como feita o que foi cancelado precisaria
           desfazer o cancelamento antes, e uma caixinha que faz duas coisas
           num clique é a que ninguém entende. Reabrir é explícito, no botão. */
        <Ban className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      ) : (
        <Checkbox
          checked={acao.feita}
          onCheckedChange={c => onMarcar(acao.id, c === true)}
          className="mt-1 shrink-0"
          aria-label={`${acao.feita ? 'Desmarcar' : 'Marcar como feita'}: ${acao.texto}`}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-base',
          (acao.feita || cancelada) && 'line-through text-muted-foreground',
        )}>
          {acao.texto}
        </p>
        {acao.expectativa ? (
          <p className="text-[13px] text-muted-foreground mt-0.5 flex items-start gap-1">
            <Target className="h-3 w-3 mt-0.5 shrink-0" />
            {acao.expectativa}
          </p>
        ) : (
          // Sem expectativa a linha fica muda, e um campo que não aparece não é
          // preenchido: não havia nada dizendo que ele existia depois que a ação
          // já estava escrita. Só no hover, porque é convite e não cobrança —
          // a expectativa é opcional de propósito.
          <button
            type="button"
            onClick={() => setEditando(true)}
            // `hidden` e não `opacity-0`: invisível por transparência continua
            // ocupando a linha, e o vão aparecia entre a ação e o carimbo de
            // quem a fez. `group-focus-within` mantém o convite alcançável por
            // teclado, que `hidden` sozinho tiraria da ordem de tabulação.
            className="text-[13px] text-muted-foreground/70 hover:text-foreground mt-0.5
                       hidden group-hover:flex group-focus-within:flex items-center gap-1"
          >
            <Target className="h-3 w-3 shrink-0" />
            o que você espera disso?
          </button>
        )}
        {acao.feita && acao.feita_em && (
          // Carimbo, não opinião: quem quiser mudar desmarca e marca de novo.
          <p className="text-xs text-muted-foreground/80 mt-0.5">
            feita em {quando(acao.feita_em)}
            {acao.feita_por_nome && ` por ${acao.feita_por_nome}`}
          </p>
        )}
        {cancelada && (
          <p className="text-xs text-muted-foreground/80 mt-0.5">
            cancelada em {quando(acao.cancelada_em!)}
            {acao.cancelada_por_nome && ` por ${acao.cancelada_por_nome}`}
          </p>
        )}
        {(acao.feita || cancelada) && onResultado && (
          <Resultado acao={acao} onResultado={onResultado} cancelada={cancelada} />
        )}
      </div>
      {direita}
      {onCancelar && !acao.feita && (
        /* Ao lado do lápis, no mesmo canto que já aparece no hover. Não é
           destrutivo e por isso não leva vermelho: o vermelho desta linha é
           do Apagar, que some do histórico. */
        <Button
          size="sm" variant="ghost"
          className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={() => onCancelar(acao.id, !cancelada)}
          aria-label={cancelada ? `Reabrir: ${acao.texto}` : `Cancelar: ${acao.texto}`}
          title={cancelada ? 'Reabrir esta ação' : 'Cancelar: decidimos não fazer'}
        >
          {cancelada ? <RotateCcw className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
        </Button>
      )}
      <Button
        size="sm" variant="ghost"
        className="h-6 w-6 p-0 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
        onClick={() => setEditando(true)}
        aria-label={`Editar: ${acao.texto}`}
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  );
}

/**
 * O resultado da ação feita.
 *
 * Editor próprio, e não o formulário de edição da ação, por dois motivos. O
 * formulário abre texto e expectativa juntos, que são o registro de ANTES e
 * não se reescrevem ao avaliar; e ele traz o botão Apagar, que não tem nada
 * que fazer no caminho de quem só quer anotar o que deu.
 *
 * O convite fica VISÍVEL quando está vazio, ao contrário do convite da
 * expectativa, que só aparece no hover. A diferença é de propósito: a
 * expectativa é opcional, o resultado é a razão de a ação estar nesta lista.
 * Era isso que ia parar na leitura solta da rodada, escrito como
 * "- Testar Headline: sem aumento significativo" — e some junto com ela.
 */
function Resultado({ acao, onResultado, cancelada }: {
  acao: AcaoEditavelDados;
  onResultado: (id: string, resultado: string | null) => Promise<void>;
  /** Muda só a pergunta: feita pergunta o que deu, cancelada pergunta por quê. */
  cancelada?: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(acao.resultado ?? '');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    await onResultado(acao.id, texto.trim() || null);
    setSalvando(false);
    setEditando(false);
  }

  if (editando) {
    return (
      <div className="mt-1.5 space-y-1.5">
        <Textarea
          className="h-20 resize-none text-base"
          autoFocus
          placeholder={cancelada
            ? "Por que vocês decidiram não fazer? É isto que evita a mesma ideia voltar daqui a dois meses."
            : "O que aconteceu? O número mexeu, não mexeu, e o que vocês decidiram a partir disso."}
          value={texto}
          onChange={e => setTexto(e.target.value)}
          /* Ctrl+Enter salva: o campo é multilinha, então o Enter sozinho
             precisa continuar quebrando linha. */
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); salvar(); } }}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar resultado'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => {
            setTexto(acao.resultado ?? ''); setEditando(false);
          }}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  if (acao.resultado) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="mt-1 flex w-full items-start gap-1 rounded text-left text-[13px]
                   text-foreground/90 hover:bg-secondary/40"
        aria-label={`Editar o resultado de: ${acao.texto}`}
      >
        <CheckCircle2 className={cn("mt-0.5 h-3 w-3 shrink-0", cancelada ? "text-muted-foreground/70" : "text-emerald-400/90")} />
        <span className="whitespace-pre-wrap">{acao.resultado}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditando(true)}
      className="mt-1 flex items-center gap-1 text-[13px] text-amber-400/90 hover:text-amber-300"
    >
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      {cancelada ? "por que não?" : "o que aconteceu?"}
    </button>
  );
}
