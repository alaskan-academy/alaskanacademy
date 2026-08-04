import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RotinaCalendar } from './RotinaCalendar';
import { RotinaCardModal, type RotinaCard } from './RotinaCardModal';
import { useAuth } from '@/contexts/AuthContext';

export function RotinaCal() {
  const { user } = useAuth();
  const [modalOpen, setModalOpen]     = useState(false);
  const [editCard, setEditCard]       = useState<RotinaCard | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | undefined>();
  const [refresh, setRefresh]         = useState(0);
  const [modalKey, setModalKey]       = useState(0);

  const openNew = (date?: string) => {
    setEditCard(null);
    setDefaultDate(date);
    setModalKey(k => k + 1);
    setModalOpen(true);
  };

  const openEdit = (card: RotinaCard) => {
    setEditCard(card);
    setDefaultDate(undefined);
    setModalKey(k => k + 1);
    setModalOpen(true);
  };

  const handleSaved = () => setRefresh(r => r + 1);

  if (!user) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Rotina de Produção</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Organize suas tarefas recorrentes no calendário</p>
        </div>
        <Button size="sm" className="h-8" onClick={() => openNew()}>
          <Plus className="h-3.5 w-3.5 mr-1" />Novo card
        </Button>
      </div>

      <RotinaCalendar
        userId={user.id}
        onEditCard={openEdit}
        onNewCard={openNew}
        refresh={refresh}
      />

      <RotinaCardModal
        key={modalKey}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
        userId={user.id}
        card={editCard}
        defaultDate={defaultDate}
      />
    </div>
  );
}
