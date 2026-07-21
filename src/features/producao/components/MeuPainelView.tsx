import type { ProducaoNivel } from './types';
import { CalendarioView } from './CalendarioView';

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

// Determina qual campo filtrar com base no setor operacional do usuário
function getFieldForSetor(setorNome: string | null | undefined): 'responsavel_id' | 'copy_id' | 'gestor_id' {
  if (setorNome === 'Copy') return 'copy_id';
  if (setorNome === 'Gestor de Tráfego') return 'gestor_id';
  return 'responsavel_id'; // Editor e padrão
}

export function MeuPainelView({ nivel, setorId, userId, setor }: Props) {
  const fixedField = nivel === 'socio' ? getFieldForSetor(setor?.nome) : getFieldForSetor(setor?.nome);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">
        {nivel === 'socio'
          ? `Suas atividades como ${setor?.nome ?? 'sócio'}.`
          : 'Apenas itens atribuídos a você.'}
      </p>
      <CalendarioView
        nivel={nivel}
        setorId={setorId}
        userId={userId}
        fixedField={fixedField}
        fixedValue={userId}
      />
    </div>
  );
}
