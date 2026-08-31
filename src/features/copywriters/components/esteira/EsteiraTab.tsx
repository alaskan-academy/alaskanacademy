import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useProjetosDaEmpresa } from '@/hooks/use-projetos-da-empresa';
import { FASES_MAP } from '@/features/producao/components/constants';
import { MultiFilter } from "@/features/producao/components/MultiFilter";
import { CriativoDrawer } from "@/features/producao/components/CriativoDrawer";
import type { ProducaoNivel } from "@/features/producao/components/types";
import { useAuth } from "@/contexts/AuthContext";
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

import { AlertaDefasagem } from './AlertaDefasagem';
import { FilaPedidos } from './FilaPedidos';
import {
  Defasagem, Lote, Familia, DIAS_PARA_VELHO, FAMILIA_LABEL,
  rotuloDoAd, rotuloDeDias,
} from './tipos';

/** As três famílias, na ordem em que a operação pensa nelas. */
const FAMILIAS: Familia[] = ['novo', 'iteracao', 'variacao'];


const FAMILIA_SELO: Record<string, string> = {
  novo:     'bg-primary/15 text-primary',
  iteracao: 'bg-emerald-500/15 text-emerald-400',
  variacao: 'bg-blue-500/15 text-blue-400',
};

/**
 * Quanto o Copy tem de estoque, por projeto, separado entre novo, iteração e
 * variação.
 *
 * Somente leitura, de propósito. Editar card continua na Produção — dois
 * caminhos de escrita sobre `producoes` divergiriam, e é literalmente a
 * primeira armadilha do CLAUDE.md.
 */
export function EsteiraTab({ defasagem, carregandoDefasagem, onRecarregar }: {
  defasagem: Defasagem[];
  carregandoDefasagem: boolean;
  onRecarregar?: () => void;
}) {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /* Multiselect: vazio = todos. Um array e não uma string porque a pergunta
     "como está Saponaria E Velas juntos?" não cabia num chip só. */
  const [projetos, setProjetos] = useState<string[]>([]);
  const [familia, setFamilia] = useState<string>('todas');
  const [soVelhos, setSoVelhos] = useState(false);

  /*
    Abrir o card sem sair da tela.

    O `CriativoDrawer` é montado aqui, e não apontando para o da Produção como
    faz o painel do Gestor: lá a página já monta um e basta pôr `?criativo=` na
    URL; aqui não há nenhum. É o mesmo caminho que Criativos Meta já usa —
    `funis` e `perfis` vazios, porque fora da Produção não há de onde tirá-los,
    e o drawer só os usa para o seletor de funil e as menções.
  */
  const { user, perfil } = useAuth();
  const [cardAberto, setCardAberto] = useState<string | null>(null);
  const nivel: ProducaoNivel = perfil?.is_admin ? 'socio'
    : perfil?.cargo?.pode_aprovar ? 'head' : 'membro';

  /*
    Recarregar NÃO apaga a tabela.

    Antes, `carregar` ligava `carregando` e a tabela virava "Carregando a
    esteira…". Ao fechar o drawer isso encolhia a página e o navegador jogava o
    scroll para o topo — depois de abrir um AD lá embaixo, voltava-se ao começo
    da lista. O `carregando` agora só vale na PRIMEIRA carga.
  */
  const projetosDaEmpresa = useProjetosDaEmpresa();

  const carregar = useCallback(async () => {
    /* undefined = ainda não sei de quem são os projetos; consultar agora
       mostraria as duas empresas por um instante. */
    if (projetosDaEmpresa === undefined) return;
    setErro(null);
    let q = supabase
      .from('vw_esteira_lotes')
      .select('*')
      .eq('projeto_ativo', true)
      .order('projeto', { ascending: true })
      .order('ad_num', { ascending: false });
    if (projetosDaEmpresa) q = q.in('projeto_id', projetosDaEmpresa);
    const { data, error } = await q;
    if (error) { setErro(error.message); setCarregando(false); return; }
    setLotes((data ?? []) as unknown as Lote[]);
    setCarregando(false);
  }, [projetosDaEmpresa]);

  useEffect(() => { void carregar(); }, [carregar]);

  /*
    A tabela mostra os projetos ATIVOS; o alerta mostra só os que têm verba.
    São coisas diferentes de propósito: o alerta cobra de quem está gastando, e
    a tabela deixa ver o que existe em qualquer projeto vivo. Os projetos com
    verba vêm primeiro na lista, e os outros levam a marca.
  */
  const comVerba = useMemo(
    () => new Set(defasagem.map(d => d.projeto).filter(Boolean) as string[]),
    [defasagem]);

  const opcoesDeProjeto = useMemo(() => {
    const s = new Set(lotes.map(l => l.projeto).filter(Boolean) as string[]);
    return Array.from(s)
      .sort((a, b) => {
        const va = comVerba.has(a) ? 0 : 1, vb = comVerba.has(b) ? 0 : 1;
        return va !== vb ? va - vb : a.localeCompare(b);
      })
      .map(p => ({ id: p, nome: comVerba.has(p) ? p : `${p} · sem verba` }));
  }, [lotes, comVerba]);

  const visiveis = useMemo(() => lotes.filter(l =>
    (projetos.length === 0 || (l.projeto != null && projetos.includes(l.projeto))) &&
    (familia === 'todas' || l.familia === familia) &&
    (!soVelhos || (l.dias_parado ?? 0) >= DIAS_PARA_VELHO)
  ), [lotes, projetos, familia, soVelhos]);

  /* A contagem do cabeçalho segue só o filtro de projeto: se seguisse o de
     família, clicar em "Novo" mudaria o total e o número deixaria de ser "o
     tamanho da esteira". */
  const noProjeto = useMemo(
    () => lotes.filter(l =>
      projetos.length === 0 || (l.projeto != null && projetos.includes(l.projeto))),
    [lotes, projetos]);

  const velhos = useMemo(
    () => noProjeto.filter(l => (l.dias_parado ?? 0) >= DIAS_PARA_VELHO).length,
    [noProjeto]);

  const naoClassificados = useMemo(
    () => noProjeto.filter(l => l.familia === 'sem_tipo' || l.familia === 'outro'),
    [noProjeto]);

  /*
    Projetos ativos que a `fn_esteira_defasagem` não devolveu — ela só traz quem
    gastou nos últimos 7 dias. Sai daqui e não de outra consulta porque `lotes`
    já tem todos os ativos: o que falta é só a diferença entre os dois conjuntos.

    Um projeto ativo sem NENHUM lote (Handify, Velarte) não aparece em `lotes`,
    então entra com zero — a lista vem de `defasagem` para o que tem verba e de
    `lotes` para o resto, e um projeto ativo e vazio não estaria em nenhum dos
    dois. É uma limitação conhecida: sem card e sem verba, ele é invisível aqui.
  */
  const semVerba = useMemo(() => {
    const porProjeto = new Map<string, number>();
    for (const l of lotes) {
      if (l.projeto == null || comVerba.has(l.projeto)) continue;
      porProjeto.set(l.projeto, (porProjeto.get(l.projeto) ?? 0) + 1);
    }
    return Array.from(porProjeto, ([projeto, ads]) => ({ projeto, ads }))
      .sort((a, b) => b.ads - a.ads);
  }, [lotes, comVerba]);

  return (
    <div className="space-y-5">
      {/*
        A tela não dizia o que era.

        Ela abria direto num quadro, e os três blocos seguintes tinham o mesmo
        cartão, a mesma borda e o mesmo título de 12px com ícone — três coisas
        de naturezas diferentes desenhadas igual, que é o que faz "tudo parecer
        a mesma coisa".

        Agora a página se apresenta e os blocos ganham peso conforme o que
        pedem de quem lê:

          O QUE FALTA    o quadro de defasagem — diagnóstico, o alarme
          PARA FAZER     os pedidos de variação — a fila de trabalho
          JÁ EM PRODUÇÃO o estoque — consulta, sem ação
      */}
      <div>
        <h2 className="text-base font-semibold text-foreground">Esteira de criativos</h2>
        {/*
          O subtítulo diz a ORDEM DE LEITURA, não o conteúdo.

          "O que falta produzir, o que foi pedido e o que já está em produção"
          descrevia os três blocos — e quem lê já vê os três blocos. O que
          faltava era dizer que eles são uma sequência: os dois primeiros são
          trabalho, o terceiro é consulta.
        */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          De cima para baixo: o que falta escrever, o que foi pedido, e o
          estoque que já existe.
        </p>
      </div>

      {/*
        Os rótulos de seção saíram.

        Cada bloco já se apresenta no próprio cabeçalho, e a etiqueta de 11px
        em maiúscula por cima repetia o nome com outras palavras — três pares
        de títulos empilhados, todos do mesmo tamanho e da mesma cor, que é
        exatamente o que fazia "tudo parecer a mesma coisa".

        A diferença entre os três agora está no peso de cada cabeçalho, e ele
        diz o que o bloco pede de quem lê:

          defasagem  alarme     — o que falta produzir
          pedidos    ação       — cabeçalho em cor de clique, o único com selo
          estoque    consulta   — cabeçalho miúdo e cinza
      */}
      <section>
        {carregandoDefasagem
          ? <div className="h-16 animate-pulse rounded-lg border border-border bg-card" />
          : <AlertaDefasagem linhas={defasagem} semVerba={semVerba} />}
      </section>

      {/*
        A fila é a única parte desta tela que pede AÇÃO — e estava com o mesmo
        peso do inventário logo abaixo. Ganha um cabeçalho próprio e uma borda
        de destaque no bloco: quem abre a Esteira para trabalhar vem para cá.
      */}
      <section>
        <FilaPedidos onMudou={onRecarregar} />
      </section>

      {/*
        Aqui havia três cartões (Novo 17 · Iteração 11 · Variação 10) e uma
        barra de mix. Saíram porque somavam TODOS os projetos e TODOS os funis —
        e desde que a unidade virou (projeto, funil), "17 ADs de novo no geral"
        não responde pergunta de ninguém: o Copy nunca trabalha "no geral". O
        mix por funil, que é o que decide, já está no quadro acima.

        O que ficou no lugar é o único número agregado que gera ação: quanto do
        estoque está velho — com o botão que filtra a tabela para eles.
      */}

      {/*
        Só aparece quando há o que mostrar — um cartão permanente para dizer que
        não há nada gasta espaço com silêncio. Ele existe para um `tipo_teste`
        novo APARECER em vez de sumir da conta: a família sai da tabela
        `criativo_tipos_teste`, e o que não estiver lá cai aqui.
      */}
      {naoClassificados.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90">
          {naoClassificados.length} lote(s) com tipo de teste que o painel não conhece:{' '}
          <span className="font-medium">
            {Array.from(new Set(naoClassificados.map(l => l.tipo_teste ?? 'vazio'))).join(', ')}
          </span>
          . Cadastre em <code className="rounded bg-secondary px-1">criativo_tipos_teste</code> para entrar na conta.
        </div>
      )}


      {/*
        A tabela precisava dizer o que é. Ela mostrava seis colunas sem título
        nenhum, e "Parado" ao lado de "Aprovado" dava a entender que o card
        estava travado — quando é só o tempo desde a última data de início.
      */}
      <section>
      <div className="rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-3.5 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">O que já está em produção</span>
            </div>
            {/*
              Uma linha, não duas. A versão anterior explicava "Hooks" e
              "Parado" em prosa aqui em cima — o que é sintoma de nome de coluna
              ruim, não de falta de texto. A definição foi para o cabeçalho da
              coluna, que é onde a dúvida aparece.
            */}
            {/*
              "do briefing à esteira de teste" estava errado: `briefing` não é
              uma fase do processo — é um valor que veio da carga de 29/07 e que
              o app nunca escreve. A primeira fase de verdade é Produção Copy.
            */}
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              ADs ainda não postados, da produção de copy à esteira de teste.
            </p>

            {/*
              O único número agregado que gera ação, e ele vira filtro em vez de
              cartão: metade do "estoque" é de ADs que não andam há meses, e sem
              poder isolá-los na tabela esse número seria só mais uma decoração.
            */}
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px]">
              <span className="tabular-nums text-muted-foreground">
                {noProjeto.length} {noProjeto.length === 1 ? 'AD' : 'ADs'} em produção
              </span>
              {velhos > 0 && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <button onClick={() => setSoVelhos(v => !v)}
                          className={cn('rounded px-1.5 py-px transition-colors',
                            soVelhos ? 'bg-amber-500/20 text-amber-200'
                                     : 'text-amber-300/90 underline-offset-2 hover:underline')}>
                    {velhos} parados há mais de {DIAS_PARA_VELHO} dias
                    {soVelhos ? ' — mostrando só eles' : ''}
                  </button>
                </>
              )}
            </div>
          </div>

          {/*
            Dois controles diferentes, dois formatos diferentes. Quando os chips
            de família ficavam na mesma linha dos de projeto, a fila quebrava e
            os seis liam como um grupo só — dava para "desmarcar" o projeto
            clicando em "Só novo". Lista e segmentado deixam claro que são duas
            perguntas.
          */}
          <div className="flex shrink-0 items-center gap-2">
            <MultiFilter
              label="Todos os projetos"
              options={opcoesDeProjeto}
              value={projetos}
              onChange={setProjetos}
              width="w-44"
              larguraDaLista="340px"
            />
            <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
              {([['todas', 'Todas'], ...FAMILIAS.map(f => [f, FAMILIA_LABEL[f]])] as [string, string][]).map(([k, r]) => (
                <button key={k} onClick={() => setFamilia(k)}
                        className={cn('px-2.5 py-1 text-[11px] transition-colors',
                          familia === k ? 'bg-primary text-primary-foreground'
                                        : 'bg-secondary text-muted-foreground hover:text-foreground')}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {erro ? (
          <div className="p-4 text-center text-sm text-destructive-foreground">
            Não foi possível carregar a esteira: {erro}
            <button onClick={() => void carregar()} className="ml-2 underline underline-offset-2">tentar de novo</button>
          </div>
        ) : carregando ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando a esteira…</div>
        ) : visiveis.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {lotes.length === 0
              ? 'Nenhum criativo em produção nos projetos ativos.'
              : 'Nenhum AD com esses filtros.'}
          </div>
        ) : (
          <Tabela lotes={visiveis} agrupar={projetos.length !== 1} onAbrir={setCardAberto} />
        )}
      </div>
      </section>

      {/* Ao fechar, recarrega: o drawer permite mudar fase e tipo de teste, e
          sem isto o lote continuaria na tabela como se nada tivesse mudado. */}
      <CriativoDrawer
        criativoId={cardAberto}
        onClose={() => { setCardAberto(null); void carregar(); }}
        onUpdate={() => void carregar()}
        nivel={nivel}
        userId={user?.id ?? ''}
        funis={[]}
        perfis={[]}
      />
    </div>
  );
}


function Tabela({ lotes, agrupar, onAbrir }: {
  lotes: Lote[]; agrupar: boolean; onAbrir: (id: string) => void;
}) {
  const grupos = useMemo(() => {
    if (!agrupar) return [{ chave: '', itens: lotes }];
    const mapa = new Map<string, Lote[]>();
    for (const l of lotes) {
      const k = l.projeto ?? '(sem projeto)';
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k)!.push(l);
    }
    return Array.from(mapa, ([chave, itens]) => ({ chave, itens }));
  }, [lotes, agrupar]);

  return (
    <div className="max-h-[65vh] overflow-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20 border-b border-border bg-secondary text-xs">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">AD</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Tipo</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Funil</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground"
                title="Quantos dos hooks deste AD já entraram na esteira">Hooks</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Fase</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground"
                title="Tempo desde a última data de início — não quer dizer que o card esteja travado">Parado</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map(g => (
            <Fragment key={g.chave}>
              {agrupar && (
                <tr className="border-b border-border/60 bg-secondary/20">
                  <td colSpan={6} className="px-3 py-1.5 text-xs font-medium text-foreground">
                    {g.chave}
                    <span className="ml-2 font-normal text-muted-foreground/60">
                      {g.itens.length} {g.itens.length === 1 ? 'AD' : 'ADs'}
                    </span>
                  </td>
                </tr>
              )}
              {g.itens.map(l => (
                <LinhaLote key={`${l.projeto_id}-${l.ad_num}-${l.tipo_teste}`}
                           l={l} onAbrir={onAbrir} />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinhaLote({ l, onAbrir }: { l: Lote; onAbrir: (id: string) => void }) {
  const velho = (l.dias_parado ?? 0) >= DIAS_PARA_VELHO;
  const parcial = l.hooks < l.hooks_totais;

  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="px-3 py-1.5">
        <button onClick={() => onAbrir(l.card_id)} title="Abrir o card"
                className="font-medium tabular-nums text-foreground hover:text-primary hover:underline">
          {rotuloDoAd(l.ad_num)}
        </button>
      </td>
      <td className="px-3 py-1.5">
        <span className={cn('rounded px-1.5 py-px text-[10px]',
          FAMILIA_SELO[l.familia] ?? 'bg-amber-500/15 text-amber-400')}>
          {l.tipo_teste ?? FAMILIA_LABEL[l.familia] ?? '—'}
        </span>
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">
        {l.funil ?? <span className="text-muted-foreground/40">não informado</span>}
      </td>
      <td className="px-3 py-1.5 text-right text-xs tabular-nums">
        {/*
          `2 de 5` e não `2`: um lote entra na esteira com UM hook pronto, e sem
          o denominador "AD 052" leria como pronto quando três quintos dele
          ainda nem existem.
        */}
        <span className={parcial ? 'text-amber-300/90' : 'text-muted-foreground'}>
          {l.hooks} de {l.hooks_totais}
        </span>
      </td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">
        {FASES_MAP[l.fase] ?? l.fase}
        {l.fases.length > 1 && (
          <span className="ml-1 text-muted-foreground/50"
                title={l.fases.map(f => FASES_MAP[f] ?? f).join(' · ')}>
            +{l.fases.length - 1}
          </span>
        )}
      </td>
      <td className={cn('px-3 py-1.5 text-right text-xs tabular-nums',
        velho ? 'text-amber-300/90' : 'text-muted-foreground')}>
        {rotuloDeDias(l.dias_parado)}
      </td>
    </tr>
  );
}

