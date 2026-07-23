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
  const urgency    = getUrgency(criativo.data_prazo);
  const missingLink = !criativo.video_editado_url && FASES_REQUER_LINK.has(criativo.fase);
  const isVsl      = criativo.tipo === 'vsl';

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left bg-card border rounded-md p-2.5 hover:border-primary/50 transition-colors',
        urgency === 'late' && 'border-l-2 border-l-red-500',
        urgency === 'warn' && 'border-l-2 border-l-amber-500',
      )}
    >
      <div className="flex items-start gap-1 mb-2">
        <p className="text-[12.5px] font-medium text-foreground leading-tight line-clamp-2 flex-1">
          {criativo.nome}
        </p>
        {missingLink && (
          <Link2Off className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" title="Sem link de vídeo editado" />
        )}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <TipoBadge tipo={criativo.tipo} />
        {isVsl && (
          <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
            {FASES_MAP[criativo.fase] ?? criativo.fase}
          </span>
        )}
        {criativo.tipo === 'criativo' && criativo.funil_video && (
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {criativo.funil_video}
          </span>
        )}
        {criativo.projeto && (
          <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded truncate max-w-[90px]">
            {criativo.projeto.nome}
          </span>
        )}
      </div>
      {(criativo.responsavel || criativo.data_prazo || isVsl) && (
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10.5px] text-muted-foreground truncate flex-1">
            {criativo.responsavel?.nome ?? '—'}
          </span>
          {criativo.data_prazo && (
            <span className={cn(
              'text-[10px] font-medium shrink-0',
              urgency === 'late' ? 'text-red-400' :
              urgency === 'warn' ? 'text-amber-400' : 'text-muted-foreground',
            )}>
              {new Date(criativo.data_prazo + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
            </span>
          )}
        </div>
      )}
      {criativo.notas && (
        <p className="mt-1.5 text-[10.5px] text-muted-foreground/70 line-clamp-2 leading-relaxed border-t border-border/40 pt-1.5">
          {criativo.notas}
        </p>
      )}
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
