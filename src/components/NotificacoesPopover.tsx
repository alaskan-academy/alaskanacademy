import { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Notificacao {
  id: string;
  tipo: string;
  mensagem: string;
  referencia_id: string | null;
  referencia_tipo: string | null;
  lida: boolean;
  criado_em: string;
}

interface Props {
  userId: string;
  /*
    O `collapsed` saiu junto com o rodapé da sidebar.

    Ele existia só para decidir de que lado o painel abria: no rodapé, o sino
    ficava embaixo e o painel tinha que subir (`side="top"`), e recolhida a
    barra ele tinha que sair pela direita. No cabeçalho a resposta é sempre a
    mesma — abre para baixo, alinhado à direita — e a prop deixou de ter para
    que existir.
  */
}

export function NotificacoesPopover({ userId }: Props) {
  const navigate = useNavigate();
  const [open, setOpen]                     = useState(false);
  const [notificacoes, setNotificacoes]     = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas]             = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('notificacoes')
      .select('*')
      .eq('usuario_id', userId)
      .order('criado_em', { ascending: false })
      .limit(30);
    if (!data) return;
    setNotificacoes(data);
    setNaoLidas(data.filter(n => !n.lida).length);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription for instant badge update
  useEffect(() => {
    const channel = supabase
      .channel(`notificacoes:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  const marcarTodasLidas = async () => {
    const ids = notificacoes.filter(n => !n.lida).map(n => n.id);
    if (!ids.length) return;
    await supabase.from('notificacoes').update({ lida: true }).in('id', ids);
    setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })));
    setNaoLidas(0);
  };

  /*
    Abrir o sino NÃO marca tudo como lido.

    Marcava — e o efeito estava no banco: das 47 notificações que já existiram,
    47 constavam como lidas, nenhuma pendente. A bolinha e o contador sumiam
    antes de a pessoa ler qualquer coisa, e o botão "Marcar todas como lidas"
    virava inalcançável, porque ele só aparece quando há algo não lido — o que
    deixava de ser verdade no instante seguinte ao clique.

    Agora lido é o que foi clicado. O resto continua esperando, e quem quiser
    limpar de uma vez tem o botão, que voltou a ter função.
  */
  const marcarLida = async (n: Notificacao) => {
    if (n.lida) return;
    await supabase.from('notificacoes').update({ lida: true }).eq('id', n.id);
    setNotificacoes(prev => prev.map(x => (x.id === n.id ? { ...x, lida: true } : x)));
    setNaoLidas(c => Math.max(0, c - 1));
  };

  const handleClick = (n: Notificacao) => {
    marcarLida(n);
    setOpen(false);

    /*
      Recado mora no Inicio -- e agora leva ao recado, e nao so a pagina.

      Antes ia para "/" e parava ali: o mural ficava no FIM do Inicio, entao a
      pessoa caia no topo e tinha que procurar. Pior, o mural mostra tres
      recados e esconde os vencidos, entao o recado da notificacao podia nao
      estar na tela.

      Com `?recado=<id>` o mural garante aquele recado na lista, rola ate ele e
      o acende. Na URL e nao em `location.state` para sobreviver a um F5.
    */
    if (n.referencia_tipo === 'recado') {
      navigate(n.referencia_id ? `/?recado=${n.referencia_id}` : '/');
      return;
    }

    /*
      Para onde ir sai de `referencia_tipo`, e de mais nada.

      Havia uma lista de tipos aqui ao lado — `['criativo_alteracao',
      'mencao_comentario']` — que já não incluía `criativo_aprovado` (45 linhas
      no banco) e não incluiria `resposta_comentario`, que é novo. Lista de
      tipos escrita no código é a terceira armadilha do CLAUDE.md: envelhece em
      silêncio, e a linha que ela esquece vira um clique que não leva a lugar
      nenhum. `referencia_tipo` já responde a pergunta, e é gravado junto.
    */
    if (n.referencia_tipo === 'criativo' && n.referencia_id) {
      navigate(`/producao?criativo=${n.referencia_id}`);
      return;
    }

    /*
      Nenhum destino conhecido: avisa em vez de nao fazer nada.

      Clique morto e o pior desfecho possivel -- a pessoa acha que a tela
      travou e tenta de novo. Aqui ela ao menos fica sabendo que a notificacao
      nao tem para onde levar, e o `console` diz qual tipo faltou mapear para
      quem for consertar.
    */
    console.warn('notificacao sem destino:', n.referencia_tipo, n.referencia_id);
    toast({
      title: 'Essa notificação não tem para onde levar',
      description: 'Marquei como lida. Se ela devia abrir alguma tela, me avise qual.',
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Notificações"
          className="relative text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
        >
          <Bell className="h-4 w-4" />
          {naoLidas > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center leading-none">
              {naoLidas > 9 ? '9+' : naoLidas}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        className="w-80 p-0"
        sideOffset={8}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <p className="text-xs font-semibold">Notificações</p>
          {notificacoes.some(n => !n.lida) && (
            <button
              onClick={marcarTodasLidas}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Marcar todas como lidas
            </button>
          )}
        </div>

        {notificacoes.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            Nenhuma notificação.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notificacoes.map(n => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  'w-full text-left px-3 py-2.5 hover:bg-accent transition-colors flex gap-2.5',
                  !n.lida && 'bg-primary/5',
                )}
              >
                {!n.lida && (
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                )}
                <div className={cn('flex-1 min-w-0', n.lida && 'pl-4')}>
                  <p className="text-xs text-foreground leading-snug">{n.mensagem}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(n.criado_em), { addSuffix: true, locale: ptBR })}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
