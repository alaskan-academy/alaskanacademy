import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * As iniciais do nome, no máximo duas.
 *
 * "Academy Alaskan" vira "AA"; "Jessica" vira "J". Nomes com preposição —
 * "Maria de Souza" — pegam a primeira e a última palavra COM letra maiúscula,
 * senão sairia "MD".
 */
function iniciais(nome: string | undefined) {
  const partes = (nome ?? '')
    .split(/\s+/)
    .filter((p) => p.length > 0 && p[0] === p[0].toUpperCase());
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 1).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * A conta, no canto superior direito.
 *
 * POR QUE ELA SAIU DO RODAPÉ DA SIDEBAR
 *
 * Lá embaixo moravam três botões só de ícone, do mesmo tamanho e da mesma cor,
 * a oito pixels um do outro: notificações, sair e recolher a barra. São três
 * CLASSES de ação diferentes desenhadas igual — e a do meio custa a sessão
 * inteira, sem confirmação e sem desfazer, enquanto as outras duas não custam
 * nada. Com a barra recolhida viravam três glifos quase idênticos numa coluna
 * de 64px.
 *
 * A CLAUDE.md já pedia passo de confirmação para ação destrutiva. Aqui o passo
 * é o próprio menu: "Sair da conta" agora é um item ESCRITO, alcançado em dois
 * gestos deliberados, em vez de uma seta anônima ao lado do sininho.
 *
 * E o lugar certo é o cabeçalho porque a sidebar responde "onde eu vou" —
 * conta não é um lugar para ir, é um dado que vale em qualquer tela.
 *
 * O QUE ESTE MENU NÃO TEM, DE PROPÓSITO
 *
 * Nada além de quem você é e como sair. Não há tema claro/escuro (o app é
 * escuro por decisão) nem atalho para Configurações (já está na sidebar, e só
 * para admin). Menu de conta que nasce com item inventado envelhece igual à
 * tela de cadastro sem coluna de resultado.
 *
 * "Meu perfil" entra quando a tela existir — item que abre o nada é pior do
 * que item que falta.
 */
export function ContaMenu() {
  const { perfil, signOut } = useAuth();
  const navigate = useNavigate();

  const sair = async () => {
    await signOut();
    navigate('/login');
  };

  const papel = [perfil?.cargo?.nome, perfil?.setor?.nome].filter(Boolean).join(' · ');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/*
          O anel diz o perfil sem gastar uma palavra: admin em roxo (a cor de
          destaque do sistema), o resto em cinza da borda. Num sistema em que a
          permissão muda por pessoa, "estou logada como quem?" é pergunta que
          se faz, e ela some quando o nome fica em 10px truncado no rodapé.
        */}
        <button
          title={perfil?.nome ?? 'Conta'}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
            'ring-2 ring-offset-2 ring-offset-background',
            perfil?.is_admin
              ? 'bg-primary/15 text-primary ring-primary/40'
              : 'bg-secondary text-foreground ring-border',
          )}
        >
          {iniciais(perfil?.nome)}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium text-foreground">{perfil?.nome ?? '—'}</p>
          {/*
            Cargo e setor já existiam no `Perfil` e não apareciam em lugar
            nenhum: o rodapé mostrava só o nome truncado e um "Admin" de 10px.
          */}
          {papel && <p className="truncate text-xs text-muted-foreground">{papel}</p>}
          {perfil?.is_admin && (
            <span className="mt-1 inline-block rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Admin
            </span>
          )}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={sair} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sair da conta
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
