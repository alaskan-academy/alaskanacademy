import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { render, screen, renderHook, act } from '@testing-library/react';
import { useToast, toast } from '@/hooks/use-toast';

/**
 * O aviso que chega antes de alguém estar ouvindo.
 *
 * `toast()` guarda o aviso num estado de módulo e avisa quem já se inscreveu.
 * O `Toaster` lê esse estado UMA vez, no primeiro render, e só entra na lista
 * de ouvintes depois, no efeito. Quem despacha nessa fresta some: o aviso fica
 * no estado do módulo, não notifica ninguém, e o `Toaster` segue mostrando o
 * retrato vazio que pegou ao nascer.
 *
 * A fresta é fácil de cair dentro sem perceber, porque efeito de FILHO roda
 * antes de efeito de PAI. Uma tela que avisa algo ao montar — "não encontrei
 * esse registro", ao abrir um link — dispara antes de o `Toaster` acima dela
 * ter se inscrito. Foi assim que apareceu: o toast do link do Radar não saía,
 * e o mesmo toast atrasado em 1,5s saía.
 *
 * O primeiro teste é a reprodução: falha na versão antiga do hook, com o
 * ouvinte se inscrevendo tarde demais. Os outros dois guardam o que já
 * funcionava, para o conserto não custar nada em troca.
 */

/** O `Toaster`, reduzido ao que importa aqui: lê o estado e mostra os títulos. */
function Ouvinte({ children }: { children?: React.ReactNode }) {
  const { toasts } = useToast();
  return (
    <div>
      <ul data-testid="avisos">{toasts.map(t => <li key={t.id}>{String(t.title)}</li>)}</ul>
      {children}
    </div>
  );
}

function AvisaAoMontar({ texto }: { texto: string }) {
  useEffect(() => { toast({ title: texto }); }, [texto]);
  return null;
}

function limpar() {
  const { result } = renderHook(() => useToast());
  act(() => result.current.dismiss());
  act(() => { for (const t of result.current.toasts) t.onOpenChange?.(false); });
}

describe('useToast', () => {
  it('mostra o aviso que um filho despacha no efeito de montagem', () => {
    limpar();

    /* Efeito de filho roda antes de efeito de pai: o despacho acontece na
       fresta entre o primeiro render do Ouvinte e a inscrição dele. */
    render(<Ouvinte><AvisaAoMontar texto="cheguei na fresta" /></Ouvinte>);

    expect(screen.getByTestId('avisos')).toHaveTextContent('cheguei na fresta');
  });

  it('mostra o aviso que chega depois de todo mundo montado', () => {
    limpar();
    render(<Ouvinte />);

    act(() => { toast({ title: 'cheguei depois' }); });

    expect(screen.getByTestId('avisos')).toHaveTextContent('cheguei depois');
  });

  it('para de receber depois de desmontar', () => {
    limpar();
    const { result, unmount } = renderHook(() => useToast());
    const antes = result.current.toasts.length;

    unmount();
    act(() => { toast({ title: 'ninguém ouviu' }); });

    /* Se o desmontado ainda ganhasse estado, o ouvinte teria ficado na lista e
       vazaria a cada tela que monta e sai. */
    expect(result.current.toasts.length).toBe(antes);
  });
});
