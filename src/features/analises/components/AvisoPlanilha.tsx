import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Table2, Check } from 'lucide-react';

/**
 * O convite para configurar a planilha, no lugar onde a falta é sentida.
 *
 * A exportação falha em silêncio de propósito — o Obsidian pode estar fechado,
 * e um toast de erro a cada salvar seria pior que a falta do espelho. Mas
 * "nunca foi configurado" não é falha transitória: é um estado permanente que
 * ninguém descobre sozinho, e silêncio ali vira uma exportação que ela acha que
 * está rodando há três semanas e nunca rodou.
 *
 * Então some assim que o id existe. Configuração que aparece onde o problema
 * aparece e desaparece quando ele acaba não precisa de tela de configuração.
 */

export function AvisoPlanilha() {
  const [id, setId] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    supabase.from('configuracoes_texto').select('valor')
      .eq('chave', 'analises_spreadsheet_id').maybeSingle()
      .then(({ data }) => setId((data?.valor ?? '').trim() || null));
  }, []);

  // Já configurado: nada a dizer, o aviso some para sempre.
  if (id) return null;

  async function salvar() {
    // Aceita a URL inteira colada da barra do navegador: pedir para a pessoa
    // extrair o id do meio de uma URL é pedir para ela errar.
    const extraido = texto.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? texto.trim();
    if (!extraido) return;
    setSalvando(true);
    const { error } = await supabase.from('configuracoes_texto')
      .upsert({ chave: 'analises_spreadsheet_id', valor: extraido }, { onConflict: 'chave' });
    setSalvando(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }
    setId(extraido);
    toast({
      title: 'Planilha ligada',
      description: 'A partir do próximo salvar, a rodada aparece lá.',
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
        <Table2 className="h-3.5 w-3.5 shrink-0" />
        <span>
          Nenhuma planilha ligada — a rodada está indo só para o Obsidian.
        </span>
        {!abrindo && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2"
            onClick={() => setAbrindo(true)}>
            ligar uma
          </Button>
        )}
      </div>

      {abrindo && (
        <div className="flex items-center gap-2">
          <Input
            className="h-8 text-sm"
            placeholder="Cole a URL ou o ID da planilha do Google"
            value={texto} onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } }}
          />
          <Button size="sm" className="h-8 gap-1 shrink-0"
            onClick={salvar} disabled={!texto.trim() || salvando}>
            <Check className="h-3.5 w-3.5" />
            {salvando ? 'Ligando…' : 'Ligar'}
          </Button>
        </div>
      )}

      {abrindo && (
        <p className="text-[10px] text-muted-foreground/70">
          A planilha precisa estar compartilhada com a conta de serviço do Google
          que o dashboard já usa — a mesma do Radar.
        </p>
      )}
    </div>
  );
}
