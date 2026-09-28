import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * A faixa que denuncia quem tem perfil de editor e não tem linha em `editores`.
 *
 * ── Por que esta tela existe antes da correção ─────────────────────────────
 *
 * A ligação entre `perfis` e `editores` sumiu num merge em 18/07/2026, e o
 * problema durou **69 dias** — a Bruna Leopoldo fez 709 cards e recebeu
 * R$ 3.677,50 sem nunca aparecer na tela de Editores. Não durou tanto por ser
 * difícil: durou porque **nada na tela mostrava a ausência**. É a armadilha 2
 * do CLAUDE.md na forma mais cara — o cadastro existe, o resultado não, e sem
 * resultado ninguém volta para conferir.
 *
 * Por isso esta faixa vem ANTES do gatilho que resolve. Consertar sem ela
 * resolveria o Gabriel e não resolveria o próximo.
 *
 * ── O canário ──────────────────────────────────────────────────────────────
 *
 * `setores_marcados` é a parte que mais importa e a menos óbvia. A lista de
 * pendentes sai de `setores.pagina_key = 'editores'`. Se alguém limpar essa
 * configuração, a lista fica **vazia** — e vazio aqui se lê como "está tudo
 * certo", que é exatamente a leitura errada. Então quando nenhum setor está
 * marcado, a faixa grita em vez de sumir.
 */
type Saude = {
  setores_marcados: number;
  perfis_elegiveis: number;
  sem_linha: number;
  editores_sem_perfil: number;
  editores_orfaos: number;
};

type Pendente = {
  perfil_id: string;
  nome: string;
  setor: string;
  cargo: string | null;
  ativo: boolean;
  cards: number;
  primeiro_card: string | null;
};

export function PonteEditoresAviso() {
  const [saude, setSaude] = useState<Saude | null>(null);
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from('vw_ponte_editores_saude').select('*').maybeSingle(),
        supabase.from('vw_ponte_editores_pendente').select('*').order('cards', { ascending: false }),
      ]);
      if (!vivo) return;
      /* Erro não pode virar faixa escondida: esta tela existe justamente para
         não ficar quieta quando algo está faltando. */
      const falha = s.error ?? p.error;
      if (falha) { setErro(falha.message); setLoading(false); return; }
      setSaude((s.data as Saude) ?? null);
      setPendentes((p.data as Pendente[]) ?? []);
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Conferindo a ponte com Editores...
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Não deu para conferir a ponte com Editores
        </div>
        <p className="text-xs text-muted-foreground mt-1">{erro}</p>
      </div>
    );
  }

  if (!saude) return null;

  /* O canário. Vem antes do caso normal de propósito: sem setor marcado, o
     `sem_linha = 0` abaixo seria verdadeiro pelo motivo errado. */
  if (saude.setores_marcados === 0) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Nenhum setor está marcado como sendo de editores
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Sem isso, a conferência abaixo fica vazia por falta de configuração, e não
          porque está tudo certo. Marque o setor em Setores &amp; Cargos.
        </p>
      </div>
    );
  }

  if (saude.sem_linha === 0 && saude.editores_orfaos === 0) {
    return (
      <p className="text-xs text-muted-foreground py-1">
        Ponte com Editores em dia · {saude.perfis_elegiveis} perfis de editor, todos com ficha.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-500">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {saude.sem_linha === 1
          ? '1 pessoa tem perfil de editor e não aparece em Editores'
          : `${saude.sem_linha} pessoas têm perfil de editor e não aparecem em Editores`}
      </div>

      <div className="space-y-1">
        {pendentes.map(p => (
          <div key={p.perfil_id} className="flex items-baseline gap-2 text-xs flex-wrap">
            <span className="font-medium">{p.nome}</span>
            <span className="text-muted-foreground">
              {p.setor}{p.cargo ? ` · ${p.cargo}` : ''}
              {!p.ativo && ' · inativa'}
            </span>
            {p.cards > 0 && (
              <span className="text-muted-foreground">
                — {p.cards} card{p.cards > 1 ? 's' : ''}
                {p.primeiro_card && ` desde ${p.primeiro_card.split('-').reverse().join('/')}`}
              </span>
            )}
          </div>
        ))}
      </div>

      {saude.editores_orfaos > 0 && (
        <p className="text-xs text-muted-foreground">
          E {saude.editores_orfaos} ficha(s) de editor apontando para um perfil que não existe mais.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        A ficha de editor ainda não nasce sozinha junto com o perfil. Enquanto não nascer,
        quem está nesta lista não entra em avaliação, desempenho nem nota fiscal.
      </p>
    </div>
  );
}
