import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ProducaoNivel } from './types';
import { CalendarioView } from './CalendarioView';
import { HojeView } from './HojeView';
import { useFases, campoDonoDoSetor, fasesDoSetor } from '../useFases';
import { PainelGestorView } from './gestor/PainelGestorView';

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

/*
 * `getFieldForSetor` e `FASES_MEUPAINEL` moravam aqui — dois dos quatro mapas
 * de setor→trabalho que existiam nesta área, ambos chaveados pelo NOME do
 * setor. Agora vêm da tabela `producao_fases`, ligados por id.
 */

export function MeuPainelView({ nivel, setorId, userId, setor }: Props) {
  const { fases, carregou } = useFases();
  const [hojeOpen, setHojeOpen] = useState(true);

  const campoDono   = campoDonoDoSetor(fases, setorId);
  const minhasFases = fasesDoSetor(fases, setorId);

  // Sem setor, nada é "meu" — e mostrar tudo faria a tela mentir no título.
  const semSetor = !setorId;

  if (!carregou) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Carregando…</p>;
  }

  /*
    O Gestor de Tráfego tem um painel próprio.

    O genérico — "Hoje" mais calendário pessoal, filtrados por `gestor_id = eu`
    — não servia para ele: só 1 dos 69 cards em `esteira_teste` tem `gestor_id`
    preenchido, então a tela ficava vazia; e a fila de aprovados, que é o
    trabalho dele, nem entrava, porque `aprovado` estava sem setor dono.

    Para saber quantos ADs tinha de cada projeto e funil, ele arrastava os
    aprovados para datas diferentes no calendário e lia os "bloquinhos" — o que
    reescrevia o prazo combinado com o editor e se desmanchava em duas semanas.

    A comparação é pelo NOME do setor, e não pelo id, porque o id muda entre
    ambientes; `producao_fases` já liga por id, e é de lá que vem a fase.
  */
  if (setor?.nome === 'Gestor de Tráfego') {
    return <PainelGestorView userId={userId} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* O painel se chama "Meu", então precisa dizer quando não consegue
          cumprir isso. Conta sem setor via tudo — e antes via em silêncio,
          com o trabalho dos outros sob um título que dizia "meu". */}
      {semSetor && (
        <p className="text-xs text-amber-500/90 border border-amber-500/25 bg-amber-500/5 rounded-md px-3 py-2">
          Seu perfil não tem setor, então este painel mostra o trabalho de
          todo mundo — e não só o seu. Defina um setor em Acessos para filtrar.
        </p>
      )}

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
            fixedField={semSetor ? undefined : (campoDono as never)}
            fixedValue={semSetor ? undefined : userId}
            fases={minhasFases.length ? minhasFases : undefined}
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
          fixedField={semSetor ? undefined : (campoDono as never)}
          fixedValue={semSetor ? undefined : userId}
          fasesVisiveis={minhasFases.length ? minhasFases : undefined}
        />
      </div>
    </div>
  );
}
