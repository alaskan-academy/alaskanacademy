import { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
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
  collapsed: boolean;
}

export function NotificacoesPopover({ userId, collapsed }: Props) {
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

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v) marcarTodasLidas();
  };

  const handleClick = (n: Notificacao) => {
    setOpen(false);
    const isCriativo =
      n.referencia_tipo === 'criativo' ||
      (!!n.referencia_id && ['criativo_alteracao', 'mencao_comentario'].includes(n.tipo));
    if (isCriativo && n.referencia_id) {
      navigate('/producao', { state: { criativoId: n.referencia_id } });
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
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
        side={collapsed ? 'right' : 'top'}
        align={collapsed ? 'start' : 'end'}
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
