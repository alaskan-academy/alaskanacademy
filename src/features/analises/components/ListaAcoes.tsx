import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Plus, Clock, Target, ChevronDown } from 'lucide-react';
import { formatarData } from '../periodo';

/**
 * As ações do REV, marcáveis.
 *
 * Era um campo de texto solto por rodada. Texto solto não se marca, não se
 * cobra e some da vista na quinzena seguinte — e ação que ninguém revisita é o
 * Google Chat de novo, que é o que este módulo veio substituir.
 *
 * A ação pertence ao REV, não à rodada: escrita numa quinzena, ela continua
 * aparecendo até alguém marcar. É isto que transforma a análise em ciclo —
 * "o que eu disse que ia fazer" vira uma pergunta que a tela responde sozinha.
 */

export interface Acao {
  id: string;
  texto: string;
  expectativa: string | null;
  feita: boolean;
  feita_em: string | null;
  feita_por_nome: string | null;
  criada_em: string;
  /** Da rodada em que nasceu, para dizer "em aberto desde 12/08". */
  data_origem: string | null;
}

interface Props {
  acoes: Acao[];
  onAdicionar: (texto: string, expectativa: string) => Promise<void>;
  onMarcar: (id: string, feita: boolean) => Promise<void>;
  /** Data da rodada em foco, para saber o que é herdado e o que é desta. */
  dataRodada: string | null;
}

/** "23/08 às 14:02" — a hora importa quando duas ações do mesmo dia se cruzam. */
function quandoFoiFeita(iso: string): string {
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} às ${hora}`;
}

export function ListaAcoes({ acoes, onAdicionar, onMarcar, dataRodada }: Props) {
  const [texto, setTexto] = useState('');
  const [expectativa, setExpectativa] = useState('');
  const [abrindoExpectativa, setAbrindo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function adicionar() {
    const t = texto.trim();
    if (!t || salvando) return;
    setSalvando(true);
    await onAdicionar(t, expectativa.trim());
    setSalvando(false);
    setTexto(''); setExpectativa(''); setAbrindo(false);
  }

  // Só as abertas moram aqui: as feitas viram histórico e sobem para o bloco de
  // resultado, ao lado dos números que elas deveriam ter mexido.
  const abertas = acoes.filter(a => !a.feita)
    .sort((a, b) => a.criada_em.localeCompare(b.criada_em));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Próximas ações
        </h3>
        <div className="h-px flex-1 min-w-4 bg-border" />
        <span className="text-[10px] text-muted-foreground/80">
          {abertas.length === 0 ? 'nenhuma em aberto'
            : abertas.length === 1 ? '1 em aberto' : `${abertas.length} em aberto`}
        </span>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border/40">
        {abertas.map(a => {
          // Herdada de outra rodada: é a dívida que o módulo existe para cobrar.
          const deOutraRodada = a.data_origem != null && a.data_origem !== dataRodada;
          return (
            <div key={a.id} className="flex items-start gap-2.5 px-3 py-2 hover:bg-secondary/30">
              <Checkbox
                checked={false}
                onCheckedChange={c => onMarcar(a.id, c === true)}
                className="mt-1 shrink-0"
                aria-label={`Marcar como feita: ${a.texto}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm">{a.texto}</p>
                {a.expectativa && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
                    <Target className="h-3 w-3 mt-0.5 shrink-0" />
                    {a.expectativa}
                  </p>
                )}
              </div>
              {deOutraRodada && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-amber-400/90 mt-1">
                  <Clock className="h-3 w-3" />
                  desde {formatarData(a.data_origem!)}
                </span>
              )}
            </div>
          );
        })}

        <div className="px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              className="h-8 text-sm border-0 bg-transparent px-0 focus-visible:ring-0"
              placeholder="O que fazer a respeito…"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !abrindoExpectativa) { e.preventDefault(); adicionar(); }
              }}
            />
            <Button
              size="sm" variant="ghost" className="h-8 gap-1 shrink-0 text-[11px]"
              onClick={() => setAbrindo(v => !v)}
              disabled={!texto.trim()}
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', abrindoExpectativa && 'rotate-180')} />
              Expectativa
            </Button>
            <Button
              size="sm" variant="ghost" className="h-8 gap-1 shrink-0"
              onClick={adicionar} disabled={!texto.trim() || salvando}
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar
            </Button>
          </div>

          {abrindoExpectativa && (
            <Textarea
              className="h-16 resize-none text-sm"
              // Opcional de propósito: obrigar a escrever faria escrever
              // qualquer coisa, e campo preenchido por obrigação vira ficção.
              placeholder="O que você espera disso? Meta, hipótese ou motivo — opcional, mas é o que permite dizer depois se deu certo."
              value={expectativa}
              onChange={e => setExpectativa(e.target.value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * As ações que já foram feitas, ao lado dos números do período.
 *
 * Fica ANTES da leitura, e não junto das pendentes, de propósito: é a pergunta
 * que a rodada existe para responder — "mexemos nisto, o que aconteceu?". Com
 * a expectativa escrita antes e a data de execução do lado, dá para ver se o
 * período já tem dados suficientes para julgar, em vez de decidir no escuro.
 */
export function AcoesFeitas({
  acoes, fimDaJanela, onMarcar,
}: { acoes: Acao[]; fimDaJanela: string; onMarcar: (id: string, feita: boolean) => Promise<void> }) {
  const feitas = acoes.filter(a => a.feita && a.feita_em)
    .sort((a, b) => (b.feita_em ?? '').localeCompare(a.feita_em ?? ''));

  if (feitas.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          O que já foi feito
        </h3>
        <div className="h-px flex-1 min-w-4 bg-border" />
        <span className="text-[10px] text-muted-foreground/80">
          desmarque para devolver às pendentes
        </span>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border/40">
        {feitas.map(a => {
          const dias = diasDeDados(a.feita_em!, fimDaJanela);
          return (
            <div key={a.id} className="flex items-start gap-2.5 px-3 py-2">
              <Checkbox
                checked
                onCheckedChange={c => onMarcar(a.id, c === true)}
                className="mt-1 shrink-0"
                aria-label={`Desmarcar: ${a.texto}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm">{a.texto}</p>
                {a.expectativa && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
                    <Target className="h-3 w-3 mt-0.5 shrink-0" />
                    {a.expectativa}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                  feita em {quandoFoiFeita(a.feita_em!)}
                  {a.feita_por_nome && ` por ${a.feita_por_nome}`}
                </p>
              </div>
              {/* A análise de 24/08 dizia "não saberemos muito bem o impacto,
                  poucos dias". A tela diz isso sozinha agora. */}
              <span className={cn(
                'shrink-0 text-[10px] mt-1 tabular-nums',
                dias < 7 ? 'text-amber-400/90' : 'text-muted-foreground',
              )}>
                {dias <= 0 ? 'sem dados ainda'
                  : dias === 1 ? '1 dia de dados'
                  : `${dias} dias de dados`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Dias entre a execução e o fim da janela analisada. */
function diasDeDados(feitaEm: string, fimDaJanela: string): number {
  const fim = new Date(`${fimDaJanela}T23:59:59`).getTime();
  const feita = new Date(feitaEm).getTime();
  return Math.max(0, Math.floor((fim - feita) / 86_400_000));
}
