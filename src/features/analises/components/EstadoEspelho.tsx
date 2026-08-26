import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Check, RefreshCw, AlertTriangle } from 'lucide-react';
import { ResultadoEspelho, reenviarTudoParaObsidian } from '../exportar';

/**
 * Onde foi parar o que acabou de ser salvo.
 *
 * As duas exportações falham em silêncio de propósito — o Obsidian roda na
 * máquina de quem está usando e pode simplesmente não estar aberto, e um erro
 * a cada tecla seria pior que a falta do espelho.
 *
 * Mas silêncio serve para não atrapalhar, não para esconder: com o Obsidian
 * fechado dava para percorrer uma rodada inteira sem nenhuma nota ser escrita
 * e sem nada na tela dizendo isso. Aqui a diferença aparece, e junto vem o
 * botão que resolve.
 *
 * O Sheets NÃO tem esse problema: roda numa edge function no servidor, falando
 * direto com a API do Google. Não depende do navegador nem da planilha aberta.
 */

interface Props {
  /** Null enquanto nada foi salvo ainda nesta sessão. */
  resultado: ResultadoEspelho | null;
  salvando: boolean;
  porSalvar: boolean;
}

export function EstadoEspelho({ resultado, salvando, porSalvar }: Props) {
  const [reenviando, setReenviando] = useState(false);

  async function reenviar() {
    setReenviando(true);
    try {
      const { notas } = await reenviarTudoParaObsidian();
      toast({
        title: 'Obsidian em dia',
        description: notas === 1 ? '1 nota reescrita.' : `${notas} notas reescritas.`,
      });
    } catch (e) {
      toast({
        title: 'O Obsidian continua fora',
        description: e instanceof Error && /chave/i.test(e.message)
          ? e.message
          : 'Abra o Obsidian e confira se o plugin Local REST API está ativo.',
        variant: 'destructive',
      });
    } finally {
      setReenviando(false);
    }
  }

  if (salvando) {
    return <span className="text-xs text-muted-foreground">salvando…</span>;
  }
  if (porSalvar) {
    return <span className="text-xs text-muted-foreground">não salvo</span>;
  }
  if (!resultado) {
    // Salvo em algum momento anterior, mas nada espelhado nesta sessão.
    return (
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Check className="h-3 w-3 text-emerald-400" />
        salvo
      </span>
    );
  }

  const obsidianOk = resultado.obsidian === 'ok';
  const sheetsOk = resultado.sheets === 'ok';

  return (
    <span className="text-xs inline-flex items-center gap-1.5 flex-wrap justify-end">
      <span className={cn(
        'inline-flex items-center gap-1',
        obsidianOk && sheetsOk ? 'text-muted-foreground' : 'text-amber-400/90',
      )}>
        {obsidianOk && sheetsOk
          ? <Check className="h-3 w-3 text-emerald-400" />
          : <AlertTriangle className="h-3 w-3" />}
        salvo
        {/* Diz o que ficou de fora, e só isso — listar o que deu certo em toda
            gravação vira ruído que ninguém lê. */}
        {obsidianOk && sheetsOk && ' no Obsidian e na planilha'}
        {!obsidianOk && sheetsOk && ' · Obsidian fechado'}
        {obsidianOk && !sheetsOk && (resultado.sheets === 'pulado'
          ? ' · sem planilha ligada'
          : ' · a planilha recusou')}
        {!obsidianOk && !sheetsOk && ' só no banco'}
      </span>

      {!obsidianOk && resultado.obsidian === 'fora' && (
        <Button
          size="sm" variant="ghost" className="h-6 px-1.5 text-xs gap-1"
          onClick={reenviar} disabled={reenviando}
        >
          <RefreshCw className={cn('h-3 w-3', reenviando && 'animate-spin')} />
          {reenviando ? 'reenviando…' : 'reenviar tudo'}
        </Button>
      )}
    </span>
  );
}
