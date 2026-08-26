import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Table2, Check, Copy } from 'lucide-react';

/**
 * O convite para ligar a planilha, no lugar onde a falta é sentida.
 *
 * A exportação falha em silêncio de propósito — o Obsidian pode estar fechado,
 * e um toast de erro a cada salvar seria pior que a falta do espelho. Mas
 * "nunca foi ligada" não é falha transitória: é um estado permanente que
 * ninguém descobre sozinho, e silêncio ali vira uma exportação que ela acha que
 * está rodando há três semanas e nunca rodou.
 *
 * O e-mail da conta de serviço aparece aqui dentro, com botão de copiar, porque
 * é o passo que trava tudo: sem compartilhar a planilha com ela, colar o id não
 * adianta e o erro do Google não diz isso com clareza. Pedir o e-mail em outro
 * canal, achar, copiar e voltar é onde a configuração morre.
 *
 * Some assim que o id existe. Configuração que aparece onde o problema aparece
 * e desaparece quando ele acaba não precisa de tela própria.
 */

export function AvisoPlanilha() {
  const [ligada, setLigada] = useState<boolean | null>(null);
  const [conta, setConta] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    supabase.from('configuracoes_texto').select('valor')
      .eq('chave', 'analises_spreadsheet_id').maybeSingle()
      .then(({ data }) => setLigada(Boolean((data?.valor ?? '').trim())));
  }, []);

  // Busca o e-mail só quando ela abre o formulário: é uma chamada de função, e
  // não vale gastá-la em toda visita à rodada.
  useEffect(() => {
    if (!abrindo || conta) return;
    supabase.functions.invoke('analises-sheets-sync', { body: { acao: 'conta' } })
      .then(({ data }) => setConta(data?.conta ?? null))
      .catch(() => { /* sem conta na tela: o resto do fluxo continua */ });
  }, [abrindo, conta]);

  // Já ligada, ou ainda carregando: nada a dizer.
  if (ligada !== false) return null;

  async function salvar() {
    // Aceita a URL inteira colada da barra do navegador: pedir para extrair o
    // id do meio de uma URL é pedir para a pessoa errar.
    const extraido = texto.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? texto.trim();
    if (!extraido) return;
    setSalvando(true);
    const { error } = await supabase.from('configuracoes_texto')
      .upsert({ chave: 'analises_spreadsheet_id', valor: extraido }, { onConflict: 'chave' });
    if (error) {
      setSalvando(false);
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }

    // Sincroniza na hora para o erro aparecer AGORA, e não daqui a três
    // semanas: é o único momento em que vale quebrar o silêncio da exportação.
    const { data } = await supabase.functions.invoke('analises-sheets-sync', { body: {} });
    setSalvando(false);

    if (data?.erro) {
      toast({
        title: 'A planilha não aceitou',
        description: `${data.erro} — confira se ela foi compartilhada com a conta acima.`,
        variant: 'destructive',
      });
      return;
    }
    setLigada(true);
    toast({
      title: 'Planilha ligada',
      description: data?.abas
        ? `${data.abas} ${data.abas === 1 ? 'aba' : 'abas'} de REV atualizadas.`
        : 'A partir do próximo salvar, a rodada aparece lá.',
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[13px] text-muted-foreground">
        <Table2 className="h-3.5 w-3.5 shrink-0" />
        <span>Nenhuma planilha ligada — a rodada está indo só para o Obsidian.</span>
        {!abrindo && (
          <Button size="sm" variant="ghost" className="h-7 text-[13px] px-2"
            onClick={() => setAbrindo(true)}>
            ligar uma
          </Button>
        )}
      </div>

      {abrindo && (
        <div className="space-y-2">
          <div className="text-[13px] text-muted-foreground space-y-1">
            <p className="text-muted-foreground/80">
              Uma planilha só, para todas as análises — isto se configura uma
              vez e nunca mais.
            </p>
            <p>
              <strong className="text-foreground">1.</strong> Crie a planilha e
              compartilhe com esta conta, como <strong>Editor</strong>:
            </p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 min-w-0 truncate rounded bg-secondary px-2 py-1 text-[13px] text-foreground">
                {conta ?? 'carregando…'}
              </code>
              <Button
                size="sm" variant="outline" className="h-9 gap-1 shrink-0 text-[13px]"
                disabled={!conta}
                onClick={() => {
                  if (!conta) return;
                  navigator.clipboard.writeText(conta);
                  toast({ title: 'E-mail copiado' });
                }}
              >
                <Copy className="h-3 w-3" />
                copiar
              </Button>
            </div>
            <p>
              <strong className="text-foreground">2.</strong> Cole aqui a URL da
              planilha:
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Input
              className="h-9 text-base"
              placeholder="https://docs.google.com/spreadsheets/d/…"
              value={texto} onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } }}
            />
            <Button size="sm" className="h-9 gap-1 shrink-0"
              onClick={salvar} disabled={!texto.trim() || salvando}>
              <Check className="h-3.5 w-3.5" />
              {salvando ? 'Ligando…' : 'Ligar'}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground/70">
            Cada REV vira uma aba própria, com uma linha por rodada. As ações
            ficam numa aba só, com a coluna do REV.
          </p>
        </div>
      )}
    </div>
  );
}
