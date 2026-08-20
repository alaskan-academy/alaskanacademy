import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AlertTriangle } from 'lucide-react';

interface FonteSaude {
  fonte: string;
  rotulo: string;
  ultimo_evento: string | null;
  horas_atras: number | null;
  defasado: boolean;
}

function formatarAtraso(horas: number | null) {
  if (horas === null) return 'nunca';
  if (horas < 48) return `${Math.round(horas)}h`;
  const dias = Math.round(horas / 24);
  return dias < 60 ? `${dias} dias` : `${Math.round(dias / 30)} meses`;
}

/**
 * Avisa quando alguma fonte de dados parou de atualizar.
 *
 * Existe porque as três fontes do dashboard já morreram em silêncio por 3 meses:
 * as páginas seguiam exibindo números velhos sem sinal nenhum, o que leva a decidir
 * com dado errado achando que está certo. Não renderiza nada quando está tudo em dia.
 */
export function IngestStatusBanner() {
  const [fontes, setFontes] = useState<FonteSaude[]>([]);

  useEffect(() => {
    let ativo = true;

    const carregar = async () => {
      const { data } = await supabase
        .from('vw_ingest_health')
        .select('fonte, rotulo, ultimo_evento, horas_atras, defasado');
      if (ativo) setFontes((data as FonteSaude[]) || []);
    };

    carregar();
    const intervalo = setInterval(carregar, 5 * 60 * 1000);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, []);

  const defasadas = fontes.filter(f => f.defasado);
  if (defasadas.length === 0) return null;

  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 text-xs">
        <p className="font-medium text-amber-200">
          {defasadas.length === 1 ? 'Uma fonte de dados está desatualizada' : `${defasadas.length} fontes de dados estão desatualizadas`}
        </p>
        <p className="mt-0.5 text-amber-200/70">
          {defasadas
            .map(f => `${f.rotulo} — sem atualização há ${formatarAtraso(f.horas_atras)}`)
            .join(' · ')}
          . Os números abaixo podem não refletir a operação atual.
        </p>
      </div>
    </div>
  );
}
