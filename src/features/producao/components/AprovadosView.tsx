import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase, linhas } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { ProducaoNivel, Perfil, Funil } from './types';
import { useFases, fasesQueAprova, rotuloDaFase } from '../useFases';
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
import { situacaoDe, rodaComoAnuncio } from '@/features/ads/situacao';
import { CriativoDrawer } from './CriativoDrawer';

/**
 * O que eu aprovei — e o que aconteceu com isso.
 *
 * POR QUE NÃO É UM FILTRO DO PAINEL DE APROVAÇÃO
 *
 * O Painel de Aprovação consulta `.in('fase', fasesVisiveis)`, e o card SAI da
 * consulta no instante em que a fase troca. É isso que faz a fila esvaziar, e é
 * a propriedade que a torna útil. Um botão "ver também os aprovados" obrigaria a
 * consulta a trazer cards fora daquela lista, e a fila deixaria de significar "o
 * que falta". São duas perguntas diferentes, e cada uma fica na sua aba.
 *
 * POR QUE NÃO É `.eq('fase', 'aprovado')`
 *
 * "Aprovado" não é onde o card fica: é o que aconteceu com ele. Depois da
 * aprovação o card ANDA — esteira_teste, postado, na_plataforma. Listar pela
 * fase `aprovado` mostraria exatamente os que NÃO andaram, que é o oposto do
 * pedido.
 *
 * A aprovação está gravada em `criativo_historico`, e a definição sai das duas
 * funções que escrevem lá:
 *
 *   fn_aprovar_criativo  → valor_anterior = a fase de revisão, valor_novo = a próxima
 *   fn_devolver_criativo → valor_novo = 'alteracao', SEMPRE
 *
 * Logo: saiu de uma fase com `e_revisao` e não foi para 'alteracao'. As fases de
 * revisão vêm de `producao_fases`, nunca de uma lista escrita aqui — foi assim
 * que nasceram as cinco listas que `useFases` substituiu.
 *
 * POR QUE A COLUNA DE RESULTADO NASCE JUNTO
 *
 * Uma lista de "o que eu aprovei" sem dizer o que aconteecu é cadastro sem
 * resultado — a segunda armadilha do CLAUDE.md. A pergunta que ninguém conseguia
 * responder é "virou anúncio?", e ela vem de `vw_producao_estado_ads`, nunca de
 * `producoes.status_veiculacao`, que é digitado à mão e erra em 32% dos cards
 * marcados "Pausado".
 *
 * E A COLUNA SÓ PERGUNTA A QUEM PODE RESPONDER
 *
 * Em 21/09/2026 esta tela dizia "nunca virou anúncio", em laranja, sobre uma
 * Aula. O vínculo anúncio↔card exige `tipo = 'criativo'`, então aula e VSL não
 * têm como ter anúncio — 0 de 221 e 0 de 98, contra 521 de 3.784 criativos.
 * O campo `tipo` já chegava aqui e nunca era lido: os 319 cards entravam no
 * denominador de "viraram anúncio (x%)" e na conta de "nunca subiram".
 *
 * Quem decide é `rodaComoAnuncio`, em `features/ads/situacao.ts`, ao lado da
 * regra de vínculo que ela espelha.
 */

interface Props {
  nivel: ProducaoNivel;
  setor: { id: string; nome: string } | null;
  userId: string;
  funis: Funil[];
  perfis: Perfil[];
}

interface Aprovado {
  id: string;
  nome: string;
  tipo: string;
  fase: string;
  projeto: string | null;
  responsavel: string | null;
  aprovado_em: string;
  de: string;
  para: string;
  /** De `vw_producao_estado_ads`. Nulo = nenhuma linha, ou seja, nenhum anúncio ligado. */
  estado: string | null;
  ads_ligados: number;
  ultimo_gasto: string | null;
}

/** Ids por consulta, para a URL do PostgREST não estourar. */
const BLOCO = 300;

/**
 * Quantos dias esperar antes de dizer que um card "nunca subiu".
 *
 * `fn_fixar_vinculo_ads` roda de hora em hora e só liga quando há EXATAMENTE um
 * card candidato. Um aprovado ontem pode simplesmente ainda não ter linha em
 * `producao_ads` — e a tela diria uma mentira sobre o trabalho de alguém.
 */
export const DIAS_DE_CARENCIA = 7;

function diaCurto(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a === String(new Date().getFullYear()) ? `${d}/${m}` : `${d}/${m}/${a.slice(2)}`;
}

function diasAtras(iso: string): number {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  return Math.round((Date.now() - d.getTime()) / 86_400_000);
}

/** O que a coluna "Virou anúncio?" tem a dizer sobre um card. */
export type RespostaDoAnuncio =
  /** O tipo do card não ganha vínculo de anúncio — a pergunta não se aplica. */
  | 'nao_se_aplica'
  /** Pode virar, ainda está na carência: o vínculo é automático e demora. */
  | 'cedo_demais'
  /** Podia ter virado, passou da carência, e não virou. */
  | 'nunca_subiu'
  | 'tem_anuncio';

/**
 * A ÚNICA decisão desta coluna — e também a do resumo lá em cima.
 *
 * Nasceu como função em 21/09/2026 porque a mesma regra estava escrita duas
 * vezes, uma na célula e outra no `useMemo` do resumo, e as duas discordavam:
 * a célula já sabia esperar a carência, e a conta de "nunca subiram" contava
 * aula e VSL. Dois lugares decidindo a mesma coisa é a primeira armadilha do
 * CLAUDE.md, e ela aparecia como a tela dizendo um número e a lista abaixo
 * mostrando outro.
 *
 * A ORDEM DOS TESTES IMPORTA. `nao_se_aplica` vem primeiro porque os dois
 * casos seguintes partem de `ads_ligados === 0`, que numa aula é a regra de
 * vínculo (`tipo = 'criativo'`) refletida de volta — nunca um sintoma.
 */
export function respostaDoAnuncio(
  tipo: string | null | undefined,
  adsLigados: number,
  dias: number,
): RespostaDoAnuncio {
  if (!rodaComoAnuncio(tipo)) return 'nao_se_aplica';
  if (adsLigados > 0) return 'tem_anuncio';
  return dias <= DIAS_DE_CARENCIA ? 'cedo_demais' : 'nunca_subiu';
}

export function AprovadosView({ nivel, setor, userId, funis, perfis }: Props) {
  const { fases, carregou } = useFases();
  const [itens, setItens] = useState<Aprovado[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [recarregar, setRecarregar] = useState(0);
  /* Sócio aprova em todos os setores, e às vezes quer ver o que os heads
     aprovaram. O padrão continua sendo "o meu", que é o que a aba promete. */
  const [deTodos, setDeTodos] = useState(false);

  const projetosDaEmpresa = useProjetosDaEmpresa();
  const fasesDeRevisao = useMemo(
    () => fasesQueAprova(fases, setor?.id ?? null, nivel === 'socio'),
    [fases, setor?.id, nivel],
  );

  const carregar = useCallback(async () => {
    /* undefined = ainda não sei de quem são os projetos — quem chama espera.
       Sem isto a primeira busca sai sem filtro e a tela mostra as duas empresas
       por um instante. */
    if (projetosDaEmpresa === undefined || !carregou) return;
    if (!fasesDeRevisao.length) { setItens([]); setLoading(false); return; }
    setLoading(true);
    setErro(null);

    let q = supabase
      .from('criativo_historico')
      .select('criativo_id,usuario_id,criado_em,valor_anterior,valor_novo')
      .eq('campo_alterado', 'fase')
      .in('valor_anterior', fasesDeRevisao)
      .neq('valor_novo', 'alteracao')
      .order('criado_em', { ascending: false })
      .limit(500);
    if (!deTodos) q = q.eq('usuario_id', userId);

    const { data: hist, error: erroHist } = await q;
    if (erroHist) {
      console.error('criativo_historico:', erroHist.message);
      setErro(erroHist.message); setItens([]); setLoading(false); return;
    }

    type Linha = { criativo_id: string; criado_em: string; valor_anterior: string; valor_novo: string };
    /* Uma linha por CARD: aprovar duas vezes o mesmo card (voltou e subiu de
       novo) não são dois itens na lista, é o mesmo trabalho. Fica a aprovação
       mais recente, que é a que vale. A consulta já vem ordenada. */
    const porCard = new Map<string, Linha>();
    for (const h of linhas<Linha>(hist)) if (!porCard.has(h.criativo_id)) porCard.set(h.criativo_id, h);
    const ids = [...porCard.keys()];
    if (!ids.length) { setItens([]); setLoading(false); return; }

    let qc = supabase
      .from('producoes')
      .select('id,nome,tipo,fase,projeto_id,responsavel:perfis!responsavel_id(nome),projeto:ofertas_editores!projeto_id(nome)')
      .in('id', ids);
    if (projetosDaEmpresa) qc = qc.in('projeto_id', projetosDaEmpresa);
    const { data: cards, error: erroCards } = await qc;
    if (erroCards) {
      console.error('producoes:', erroCards.message);
      setErro(erroCards.message); setItens([]); setLoading(false); return;
    }

    /* O estado dos anúncios, em blocos — o mesmo padrão de `AvaliacaoView`. */
    const estados = new Map<string, { estado: string; ads_ligados: number; ultimo_gasto: string | null }>();
    const blocos = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / BLOCO) }, (_, i) =>
        supabase.from('vw_producao_estado_ads')
          .select('producao_id,estado,ads_ligados,ultimo_gasto')
          .in('producao_id', ids.slice(i * BLOCO, (i + 1) * BLOCO)),
      ),
    );
    for (const b of blocos) {
      if (b.error) { console.error('vw_producao_estado_ads:', b.error.message); continue; }
      for (const e of (b.data ?? []) as
           { producao_id: string; estado: string; ads_ligados: number; ultimo_gasto: string | null }[]) {
        estados.set(e.producao_id, { estado: e.estado, ads_ligados: e.ads_ligados, ultimo_gasto: e.ultimo_gasto });
      }
    }

    type Card = {
      id: string; nome: string; tipo: string; fase: string;
      responsavel: { nome: string } | null; projeto: { nome: string } | null;
    };
    const lista: Aprovado[] = linhas<Card>(cards).map(c => {
      const h = porCard.get(c.id)!;
      const e = estados.get(c.id);
      return {
        id: c.id, nome: c.nome, tipo: c.tipo, fase: c.fase,
        projeto: c.projeto?.nome ?? null,
        responsavel: c.responsavel?.nome ?? null,
        aprovado_em: h.criado_em, de: h.valor_anterior, para: h.valor_novo,
        estado: e?.estado ?? null,
        ads_ligados: e?.ads_ligados ?? 0,
        ultimo_gasto: e?.ultimo_gasto ?? null,
      };
    }).sort((a, b) => b.aprovado_em.localeCompare(a.aprovado_em));

    setItens(lista);
    setLoading(false);
  }, [projetosDaEmpresa, carregou, fasesDeRevisao, userId, deTodos]);

  /* `recarregar` fica aqui e não nas deps do `carregar`: ele não é lido dentro
     da função, é só o sinal que o drawer manda depois de gravar. */
  useEffect(() => { carregar(); }, [carregar, recarregar]);

  /*
    A CONTA DO ANÚNCIO SÓ CORRE SOBRE QUEM PODE TER ANÚNCIO.

    `total` continua sendo tudo que ela aprovou — é o que a aba promete. Mas
    numerador de anúncio com denominador de "todo card" é conta errada: aula e
    VSL nunca ganham vínculo (ver `rodaComoAnuncio`), então cada uma delas só
    empurrava a porcentagem para baixo e engordava "nunca subiram" com uma
    acusação impossível de responder.
  */
  const resumo = useMemo(() => {
    const respostas = itens.map(i => respostaDoAnuncio(i.tipo, i.ads_ligados, diasAtras(i.aprovado_em)));
    const base = itens.filter((_, n) => respostas[n] !== 'nao_se_aplica');
    const virou = respostas.filter(r => r === 'tem_anuncio').length;
    return {
      total: itens.length,
      base: base.length,
      foraDaConta: itens.length - base.length,
      virou,
      pct: base.length ? Math.round((100 * virou) / base.length) : 0,
      noAr: base.filter(i => i.estado === 'rodando').length,
      nuncaSubiu: respostas.filter(r => r === 'nunca_subiu').length,
    };
  }, [itens]);

  if (!carregou || loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Não deu para carregar: {erro}
      </div>
    );
  }

  if (!fasesDeRevisao.length) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        Seu setor não tem fase de revisão — não há aprovações para listar.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        Os três números são a razão da aba existir. Sem eles ela é só uma lista
        do passado; com eles, responde "o que eu aprovo vira anúncio?" — que era
        a pergunta que ninguém conseguia responder sem abrir o Gerenciador.
      */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3">
        <span className="text-sm">
          <b className="tabular-nums">{resumo.total}</b>{' '}
          <span className="text-muted-foreground">aprovados</span>
        </span>
        {/* O denominador aparece escrito quando não é `total` — número de
            porcentagem sem base visível é como o erro passou despercebido. */}
        <span className="text-sm">
          <b className="tabular-nums">{resumo.virou}</b>{' '}
          <span className="text-muted-foreground">
            viraram anúncio ({resumo.pct}%
            {resumo.foraDaConta > 0 && ` dos ${resumo.base} criativos`})
          </span>
        </span>
        <span className="text-sm">
          <b className="tabular-nums text-emerald-400">{resumo.noAr}</b>{' '}
          <span className="text-muted-foreground">ainda no ar</span>
        </span>
        {resumo.nuncaSubiu > 0 && (
          <span className="text-sm">
            <b className="tabular-nums text-warning">{resumo.nuncaSubiu}</b>{' '}
            <span className="text-muted-foreground">
              nunca subiram (aprovados há mais de {DIAS_DE_CARENCIA} dias)
            </span>
          </span>
        )}
        {nivel === 'socio' && (
          <button
            type="button"
            onClick={() => setDeTodos(v => !v)}
            className={cn(
              'ml-auto rounded-full border px-3 py-1 text-xs transition-colors',
              deTodos
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {deTodos ? 'De todo mundo' : 'Só o que eu aprovei'}
          </button>
        )}
      </div>

      {itens.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nada aprovado ainda. O que você aprovar no Painel de Aprovação aparece aqui.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Criativo</th>
                <th className="px-3 py-2 text-left font-medium">Aprovei</th>
                <th className="px-3 py-2 text-left font-medium">Fase agora</th>
                <th className="px-3 py-2 text-left font-medium">Virou anúncio?</th>
              </tr>
            </thead>
            <tbody>
              {itens.map(i => {
                const dias = diasAtras(i.aprovado_em);
                const s = i.estado ? situacaoDe(i.estado) : null;
                /* A mesma função que alimenta o resumo — ver `respostaDoAnuncio`.
                   Sem linha na view não é "sem anúncio": ou é sem VÍNCULO ainda
                   (o vínculo é automático e leva até uma hora), ou é um tipo de
                   card que nunca ganha vínculo. Dizer "nunca virou anúncio" nos
                   dois casos afirma algo sobre o trabalho de alguém sem ter
                   como saber. */
                const resposta = respostaDoAnuncio(i.tipo, i.ads_ligados, dias);
                return (
                  <tr
                    key={i.id}
                    onClick={() => setAbertoId(i.id)}
                    className="cursor-pointer border-t border-border/60 hover:bg-secondary/30"
                  >
                    <td className="px-3 py-2">
                      <span className="text-foreground">{i.nome}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[i.projeto, i.responsavel].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {diaCurto(i.aprovado_em)}
                      <span className="block text-xs text-muted-foreground/60">
                        {dias === 0 ? 'hoje' : dias === 1 ? 'ontem' : `há ${dias} dias`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {rotuloDaFase(fases, i.fase)}
                    </td>
                    <td className="px-3 py-2">
                      {resposta === 'nao_se_aplica' ? (
                        <span
                          className="text-muted-foreground/50"
                          title={'Este tipo de card não roda como anúncio: o vínculo automático só liga anúncio a card do tipo Criativo. Ele fica fora da conta de "viraram anúncio".'}
                        >
                          não roda como anúncio
                        </span>
                      ) : resposta === 'cedo_demais' ? (
                        <span className="text-muted-foreground/60" title="O vínculo anúncio↔card é automático e roda de hora em hora. Ainda pode aparecer.">
                          ainda não subiu
                        </span>
                      ) : resposta === 'nunca_subiu' ? (
                        <span className="text-warning" title={`Aprovado há ${dias} dias e sem nenhum anúncio ligado a este card.`}>
                          nunca virou anúncio
                        </span>
                      ) : (
                        <span className={s?.texto} title={s?.explica}>
                          {s?.rotulo.toLowerCase() ?? '—'}
                          {i.ads_ligados > 1 && (
                            <span className="text-muted-foreground/60"> · {i.ads_ligados} anúncios</span>
                          )}
                          {i.ultimo_gasto && (
                            <span className="text-muted-foreground/60"> · {diaCurto(i.ultimo_gasto)}</span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Trocar de fase é o drawer que já existe — ele pede o motivo quando a
          fase exige e grava em `criativo_historico`. Um segundo caminho de
          gravar fase seria o quarto do produto, e os três anteriores divergiram. */}
      {abertoId && (
        <CriativoDrawer
          criativoId={abertoId}
          onClose={() => setAbertoId(null)}
          onUpdate={() => setRecarregar(n => n + 1)}
          nivel={nivel}
          userId={userId}
          funis={funis}
          perfis={perfis}
        />
      )}
    </div>
  );
}
