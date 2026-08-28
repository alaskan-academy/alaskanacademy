import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PermissoesTab } from './PermissoesTab';
import { UsuarioPerfisTab } from './UsuarioPerfisTab';

/*
  A aba se chamava "Acessos", e /acessos é o cofre de senhas — duas coisas com
  o mesmo nome, e quem procurava uma achava a outra. Esta aqui diz quem enxerga
  quais páginas: é Permissões, que é até o nome da tabela por trás
  (`permissoes_paginas`).
*/
type SubTab = 'permissoes' | 'perfis';

export function GerenciarUsuariosTab() {
  const [active, setActive] = useState<SubTab>('permissoes');

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Usuários</h3>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg w-fit">
        {([
          { id: 'permissoes', label: 'Permissões' },
          { id: 'perfis',  label: 'Perfis' },
        ] as { id: SubTab; label: string }[]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              'px-4 py-1.5 text-sm rounded-md transition-colors font-medium',
              active === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'permissoes' && <PermissoesTab />}
      {active === 'perfis'  && <UsuarioPerfisTab />}
    </div>
  );
}
