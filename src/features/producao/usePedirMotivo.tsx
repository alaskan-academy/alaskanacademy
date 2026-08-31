import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import type { Fase } from './useFases';

/**
 * Pergunta POR QUÊ antes de mover um card para uma fase que exige explicação.
 *
 * ── Por que existe ─────────────────────────────────────────────────────────
 *
 * 741 cards estão arquivados e não há como saber o motivo de nenhum deles.
 * "Arquivamos 741" não é informação; "arquivamos 741, sendo 300 por conta
 * bloqueada e 180 por oferta descontinuada" é. Sem o motivo, o arquivo vira o
 * lugar onde o card some — a segunda armadilha do CLAUDE.md.
 *
 * ── Por que um hook e não quatro diálogos ──────────────────────────────────
 *
 * A fase é gravada em três caminhos: o seletor do drawer, a mudança em lote do
 * Calendário e o arraste do Kanban (que hoje nenhuma rota renderiza, mas que
 * grava do mesmo jeito no dia em que voltar). Escrever o diálogo em cada um
 * garantiria que eles divergissem — foi assim que nasceram as cinco listas de
 * fase que `useFases` veio substituir. Pior: pedir o motivo em dois dos três é
 * pior do que não pedir em nenhum, porque aí o campo existe, parece confiável,
 * e está vazio de vez em quando.
 *
 * ── Como se usa ────────────────────────────────────────────────────────────
 *
 *     const { pedirMotivo, dialogoMotivo } = usePedirMotivo();
 *     ...
 *     const motivo = await pedirMotivo(faseDestino, quantosCards);
 *     if (motivo === null) return;              // desistiu
 *     ... grava, passando `motivo` para o histórico
 *     ...
 *     return <>{dialogoMotivo}...</>
 *
 * `null` é desistência e `''` é "esta fase não pede motivo" — quem chama trata
 * os dois com a mesma linha, e o caminho normal não paga nada.
 */

/** Curto demais não é motivo: "x" e "-" preenchem o campo sem dizer nada. */
const MINIMO = 3;

export function usePedirMotivo() {
  const [alvo, setAlvo]       = useState<Fase | null>(null);
  const [quantos, setQuantos] = useState(1);
  const [texto, setTexto]     = useState('');
  const resolver              = useRef<((v: string | null) => void) | null>(null);

  const fechar = useCallback((valor: string | null) => {
    resolver.current?.(valor);
    resolver.current = null;
    setAlvo(null);
    setTexto('');
  }, []);

  const pedirMotivo = useCallback(
    (fase: Fase | undefined, quantidade = 1): Promise<string | null> => {
      if (!fase?.exige_motivo) return Promise.resolve('');
      setAlvo(fase);
      setQuantos(quantidade);
      setTexto('');
      return new Promise<string | null>(res => { resolver.current = res; });
    },
    [],
  );

  const valido = texto.trim().length >= MINIMO;

  const dialogoMotivo: ReactNode = (
    <AlertDialog open={!!alvo} onOpenChange={v => { if (!v) fechar(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {quantos > 1
              ? `Mover ${quantos} cards para ${alvo?.rotulo ?? ''}`
              : `Mover para ${alvo?.rotulo ?? ''}`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {quantos > 1
              ? 'Por que estes cards estão saindo do fluxo?'
              : 'Por que este card está saindo do fluxo?'}
            {' '}Fica registrado no histórico.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Textarea
          autoFocus
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder="Ex.: conta bloqueada / oferta descontinuada / gravação não aprovada"
          className="min-h-24 text-sm"
        />

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => fechar(null)}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!valido}
            onClick={e => {
              /* Sem o preventDefault o Radix fecha o diálogo mesmo com o botão
                 desabilitado quando se aperta Enter, e o card iria sem motivo. */
              if (!valido) { e.preventDefault(); return; }
              fechar(texto.trim());
            }}
          >
            Confirmar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { pedirMotivo, dialogoMotivo };
}
