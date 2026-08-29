import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/**
 * O alarme do sync da Meta.
 *
 * POR QUE ELE EXISTE
 *
 * Em 29/08/2026 duas contas pararam de sincronizar às 07:00 por perda de
 * permissão na API. O erro foi gravado em `meta_sync_estado` a cada execução
 * seguinte, fielmente — e NENHUMA tela do app lia essa tabela. O dashboard
 * seguiu mostrando lucro inflado em ~R$ 2.250 no dia, porque a mídia gasta
 * deixou de ser subtraída, e nada avisou ninguém.
 *
 * É a segunda armadilha do CLAUDE.md aplicada ao próprio sync: o registro do
 * erro existia, a tela de resultado não. Este componente é a tela.
 *
 * O QUE ELE MOSTRA, E POR QUÊ ASSIM
 *
 * Falha de sync não é erro técnico: é DINHEIRO que some da conta de lucro. Por
 * isso o alarme não diz "erro na API" — diz quanto por dia deixa de ser contado
 * e o que isso faz com o número na tela. "Erro 403" ninguém age; "o lucro está
 * R$ 2.264 por dia mais alto do que é" alguém age.
 *
 * A regra de o que conta como falha mora em `vw_meta_sync_saude`, no banco.
 * Escrevê-la também aqui seria a primeira armadilha.
 */

interface Saude {
  conta: string;
  account_id: string;
  saude: 'ok' | 'falhando' | 'parcial' | 'atrasado' | 'nunca_sincronizou' | 'fora_do_portfolio';
  horas_sem_sucesso: number | null;
  gasto_medio_dia: number | null;
  mensagem_erro: string | null;
  status_meta: string | null;
  cobranca_com_problema: boolean;
}

/**
 * Os `account_status` da Meta, em português.
 *
 * Mapa de EXIBIÇÃO, não de decisão: quem decide se há problema é a view, com
 * "diferente de 1". Um código que a Meta invente depois aparece cru na tela em
 * vez de sumir do alarme — terceira armadilha do CLAUDE.md.
 */
const STATUS_CONTA: Record<string, string> = {
  '2':   'desativada',
  '3':   'com pendência financeira',
  '7':   'em análise de risco',
  '8':   'aguardando acerto de pagamento',
  '9':   'em período de carência — cobrança recusada',
  '100': 'em processo de encerramento',
  '101': 'encerrada',
};

/** Quanto o imposto de mídia amplia o buraco no lucro (`imposto_meta_ads_pct`). */
const FALLBACK_IMPOSTO_META = 12.5;

export function AlertaSyncMeta({ className }: { className?: string }) {
  const [problemas, setProblemas] = useState<Saude[]>([]);
  const [impostoPct, setImpostoPct] = useState(FALLBACK_IMPOSTO_META);

  useEffect(() => {
    void (async () => {
      const [{ data: saude }, { data: cfg }] = await Promise.all([
        supabase.from('vw_meta_sync_saude').select('*'),
        supabase.from('configuracoes').select('valor').eq('chave', 'imposto_meta_ads_pct').maybeSingle(),
      ]);
      /* O imposto sai da tabela, nunca da constante: `imposto_meta_ads_pct` é
         parâmetro que muda em Configurações, e um número fixo aqui discordaria
         do Resumo no dia seguinte à mudança. A constante é só o socorro para
         quando a leitura falhar. */
      if (cfg?.valor) setImpostoPct(Number(cfg.valor) || FALLBACK_IMPOSTO_META);
      /* Duas perguntas diferentes na mesma tarja: o sync consegue ler, e a
         conta está de pé na Meta. Filtrar só por `saude` deixaria de fora a
         conta que sincroniza perfeitamente e está com o cartão recusado. */
      setProblemas(((saude ?? []) as Saude[])
        .filter(s => s.saude !== 'ok' || s.cobranca_com_problema));
    })();
  }, []);

  if (problemas.length === 0) return null;

  /*
    "parcial" é a conta cuja métrica passou e cujo ESTADO falhou: o dinheiro na
    tela continua certo, só não se sabe o que está ligado. Separar as duas
    naturezas importa — misturá-las faria um aviso de configuração parecer um
    erro de dinheiro, e o alarme perderia o peso quando o erro fosse de verdade.
  */
  const semDinheiro = problemas.filter(p => p.saude === 'parcial');
  const semTudo     = problemas.filter(p => p.saude !== 'parcial' && p.saude !== 'ok');
  const cobranca    = problemas.filter(p => p.cobranca_com_problema);

  const naoContado = semTudo.reduce((s, p) => s + (p.gasto_medio_dia ?? 0), 0);
  const lucroInflado = naoContado * (1 + impostoPct / 100);

  return (
    <div className={cn(
      'rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3',
      className,
    )}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          {semTudo.length > 0 && (
            <>
              <p className="text-sm font-semibold text-foreground">
                {semTudo.length === 1
                  ? '1 conta de anúncio parou de sincronizar'
                  : `${semTudo.length} contas de anúncio pararam de sincronizar`}
                {naoContado > 0 && (
                  <> — {formatCurrency(naoContado)} de mídia por dia sem ser contada</>
                )}
              </p>
              {/*
                A consequência, em dinheiro e com sinal. Falta de gasto não
                aparece como buraco: aparece como lucro a mais, que é pior,
                porque um número bom não levanta suspeita.
              */}
              {lucroInflado > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  O lucro no Resumo está cerca de{' '}
                  <span className="font-semibold text-destructive">
                    {formatCurrency(lucroInflado)} por dia mais alto
                  </span>{' '}
                  do que a realidade, porque a mídia gasta não está sendo subtraída.
                  Os anúncios continuam rodando — quem parou de enxergar foi o dashboard.
                </p>
              )}
            </>
          )}

          {/*
            A conta em si, que é outro problema e outra urgência: sync quebrado
            atrapalha a leitura; conta em carência para de entregar quando a
            carência acaba. A primeira custa visibilidade, a segunda custa venda.
          */}
          {cobranca.length > 0 && (
            <p className={cn('text-xs', semTudo.length > 0 && 'mt-1.5')}>
              <span className="font-semibold text-foreground">
                {cobranca.length === 1
                  ? '1 conta de anúncio está com problema na Meta'
                  : `${cobranca.length} contas de anúncio estão com problema na Meta`}
              </span>{' '}
              <span className="text-muted-foreground">
                — isso não é o sync: é a conta. Quando a carência acaba, os anúncios param.
              </span>
            </p>
          )}

          {semDinheiro.length > 0 && (
            <p className={cn('text-xs text-muted-foreground', semTudo.length > 0 && 'mt-1.5')}>
              {semDinheiro.length === 1 ? '1 conta está' : `${semDinheiro.length} contas estão`}{' '}
              com a métrica em dia mas sem leitura de configuração: o dinheiro na tela
              está certo, o que não dá para saber é o que está ligado ou pausado.
            </p>
          )}

          <ul className="mt-2 space-y-1">
            {problemas.map(p => (
              <li key={p.account_id} className="text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{p.conta}</span>
                <span className="text-muted-foreground/60"> · {p.account_id}</span>
                {p.horas_sem_sucesso != null && p.saude !== 'parcial' && p.saude !== 'ok' && (
                  <> · sem sincronizar há {rotuloHoras(p.horas_sem_sucesso)}</>
                )}
                {p.gasto_medio_dia != null && p.gasto_medio_dia > 0 && (
                  <> · gasta {formatCurrency(p.gasto_medio_dia)}/dia</>
                )}
                {p.cobranca_com_problema && (
                  <> · <span className="font-medium text-destructive">
                    conta {STATUS_CONTA[p.status_meta ?? ''] ?? `com status ${p.status_meta}`}
                  </span></>
                )}
                {p.saude !== 'ok' && (
                  <span className="block text-muted-foreground/60">{motivo(p)}</span>
                )}
              </li>
            ))}
          </ul>

          {/*
            A janela de recuperação, que decide se isso é urgente ou fatal: o
            sync reprocessa D-1 a D-7 todo dia, então consertar dentro de uma
            semana corrige o passado sozinho. Passando disso o buraco fica, e
            só um backfill manual resolve.
          */}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/70">
            No Business Manager, reatribuir essas contas ao usuário do sistema com{' '}
            <code className="rounded bg-secondary px-1">ads_read</code> resolve. Consertando em
            até 7 dias os números se corrigem sozinhos — o sync reprocessa a última semana todo
            dia; passando disso, o buraco fica até alguém rodar um backfill.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * O motivo, em uma frase, e a diferenca que muda onde procurar.
 *
 * "Saiu do portfolio" e "a API recusou a leitura" mandam a pessoa para lugares
 * diferentes do Business Manager: no primeiro caso a conta nao esta mais
 * atribuida ao usuario do sistema e precisa ser adicionada de volta; no segundo
 * ela esta atribuida com permissao insuficiente. Dizer so "erro 403" faz
 * procurar no lugar errado.
 *
 * A mensagem crua da Meta vem com um paragrafo de documentacao e uma URL. Fica
 * so a primeira frase: o resto e ruido numa tarja que precisa ser lida em
 * dois segundos.
 */
function motivo(p: Saude): string {
  if (p.saude === 'fora_do_portfolio') {
    return 'A conta saiu do portfólio do token — não está mais atribuída ao usuário do sistema.';
  }
  if (p.saude === 'nunca_sincronizou') return 'Nunca sincronizou.';
  if (!p.mensagem_erro) return 'Sem detalhe do erro.';
  return p.mensagem_erro.split(', refer to')[0].split('. See')[0].trim();
}

function rotuloHoras(h: number) {
  if (h < 1) return 'menos de 1 hora';
  if (h < 24) return `${Math.round(h)} ${Math.round(h) === 1 ? 'hora' : 'horas'}`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'dia' : 'dias'}`;
}
