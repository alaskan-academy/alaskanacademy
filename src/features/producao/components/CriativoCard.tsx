import { Link2Off } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Criativo, CriativoTipo } from './types';
import { TIPOS_LABEL, TIPO_COR, FASES_MAP, getUrgency } from './constants';

const FASES_REQUER_LINK = new Set(['edicao', 'revisao_edicao', 'alteracao', 'aprovado', 'esteira_teste', 'postado']);

interface Props {
  criativo: Criativo;
  onClick: () => void;
}

export function CriativoCard({ criativo, onClick }: Props) {
  const urgency     = getUrgency(criativo.data_prazo, criativo.fase);
  const missingLink = !criativo.video_editado_url && FASES_REQUER_LINK.has(criativo.fase);
  const fase        = FASES_MAP[criativo.fase] ?? criativo.fase;
  const funil       = criativo.funil?.nome ?? criativo.funil_video ?? null;
  const projeto     = criativo.projeto?.nome ?? null;
  const editor      = criativo.responsavel?.nome ?? criativo.editor_nome_historico ?? null;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left bg-card border rounded-md p-2.5 hover:border-primary/50 transition-colors',
        urgency === 'late' && 'border-l-2 border-l-red-500',
        urgency === 'warn' && 'border-l-2 border-l-amber-500',
      )}
    >
      {/* Nome */}
      <div className="flex items-start gap-1 mb-1.5">
        <p className="text-[12.5px] font-medium text-foreground leading-tight line-clamp-2 flex-1">
          {criativo.nome}
        </p>
        {/* O `title` fica no wrapper, não no ícone: o Lucide não aceita `title`
            como prop e o atributo se perdia — a dica ao passar o mouse
            simplesmente não aparecia. Num span funciona, e o `aria-label` faz
            leitores de tela anunciarem o aviso. */}
        {missingLink && (
          <span title="Sem link de vídeo editado" className="shrink-0 mt-0.5">
            <Link2Off className="h-3 w-3 text-amber-400" aria-label="Sem link de vídeo editado" />
          </span>
        )}
      </div>

      {/* Tipo + Fase */}
      <div className="flex items-center gap-1 flex-wrap mb-1">
        <TipoBadge tipo={criativo.tipo} />
        <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">{fase}</span>
      </div>

      {projeto && <p className="text-[10.5px] text-muted-foreground truncate mb-0.5">{projeto}</p>}
      {funil   && <p className="text-[10.5px] text-muted-foreground/70 truncate mb-0.5">{funil}</p>}
      {criativo.tipo_teste && <p className="text-[10px] text-muted-foreground/50 truncate mb-0.5">{criativo.tipo_teste}</p>}
      {criativo.especialista?.nome && <p className="text-[10px] text-muted-foreground/50 truncate mb-0.5">{criativo.especialista.nome}</p>}

      {/* Editor + Prazo */}
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] text-muted-foreground/70 truncate flex-1">
          {editor ?? '—'}
        </span>
        {criativo.data_prazo && (
          <span className={cn(
            'text-[10px] font-medium shrink-0 ml-1',
            urgency === 'late' ? 'text-red-400' :
            urgency === 'warn' ? 'text-amber-400' : 'text-muted-foreground',
          )}>
            {new Date(criativo.data_prazo + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
          </span>
        )}
      </div>
    </button>
  );
}

export function TipoBadge({ tipo }: { tipo: string }) {
  return (
    <span className={cn(
      'text-[10px] font-semibold px-1.5 py-0.5 rounded border',
      TIPO_COR[tipo] ?? 'bg-muted text-muted-foreground border-transparent',
    )}>
      {TIPOS_LABEL[tipo as CriativoTipo] ?? tipo}
    </span>
  );
}
