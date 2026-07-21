import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ProducaoNivel } from './types';
import { CalendarioView } from './CalendarioView';
import { HojeView } from './HojeView';

interface SetorInfo {
  id: string;
  nome: string;
}

interface Props {
  nivel: ProducaoNivel;
  setorId: string | null;
  userId: string;
  setor: SetorInfo | null;
}

function getFieldForSetor(setorNome: string | null | undefined): 'responsavel_id' | 'copy_id' | 'gestor_id' {
  if (setorNome === 'Copy') return 'copy_id';
  if (setorNome === 'Gestor de Tráfego') return 'gestor_id';
  return 'responsavel_id';
}

export function MeuPainelView({ nivel, setorId, userId, setor }: Props) {
  const fixedField = getFieldForSetor(setor?.nome);
  const [hojeOpen, setHojeOpen] = useState(true);

  return (
    <div className="flex flex-col gap-6">
      {/* Seção Hoje */}
      <div>
        <button
          onClick={() => setHojeOpen(o => !o)}
          className="flex items-center gap-1.5 text-sm font-semibold text-foreground mb-3 hover:text-primary transition-colors"
        >
          {hojeOpen
            ? <ChevronDown  className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          Hoje
        </button>
        {hojeOpen && (
          <HojeView
            nivel={nivel}
            setorId={setorId}
            userId={userId}
            fixedField={fixedField}
            fixedValue={userId}
          />
        )}
      </div>

      {/* Calendário pessoal */}
      <div>
        <p className="text-sm font-semibold text-foreground mb-3">Calendário</p>
        <CalendarioView
          nivel={nivel}
          setorId={setorId}
          userId={userId}
          fixedField={fixedField}
          fixedValue={userId}
        />
      </div>
    </div>
  );
}
