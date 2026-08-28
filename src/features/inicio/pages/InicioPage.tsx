import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import { diasOcupados, toYMD, daYMD } from '@/lib/recorrencia';
import { ChevronLeft, ChevronRight, Plus, Loader2, PartyPopper } from 'lucide-react';
import { Agenda } from '../components/Agenda';
import { EventoDrawer } from '../components/EventoDrawer';
import { EventoFormModal } from '../components/EventoFormModal';
import { SaudeSistema } from '../components/SaudeSistema';
import { MuralRecados } from '../components/MuralRecados';
import { horaCurta, ROTULO_TIPO, TIPOS_EVENTO, TIPOS_QUE_PARAM, type Evento, type ItemAgenda } from '../types';

const DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * Com quantos dias de antecedência o feriado é anunciado.
 *
 * Quatro: dá para remarcar a reunião, avisar cliente e fechar o que vence, e
 * ainda é perto o bastante para a pessoa se importar. Um aviso de trinta dias
 * vira paisagem e ninguém age.
 */
const AVISO_PARADA_DIAS = 4;

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

interface Perfil { id: string; nome: string }

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `2026-12-24` vira `24 de dez`. */
function diaCurto(ymd: string): string {
  const d = daYMD(ymd);
  return `${d.getDate()} de ${MES_CURTO[d.getMonth()]}`;
}

/** `24 a 26 de dez` quando o mês é o mesmo, `28 de dez a 2 de jan` quando não. */
function periodoCurto(de: string, ate: string): string {
  if (de === ate) return diaCurto(de);
  const a = daYMD(de);
  const b = daYMD(ate);
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${a.getDate()} a ${diaCurto(ate)}`
    : `${diaCurto(de)} a ${diaCurto(ate)}`;
}

/** "na quinta", "no sábado" — domingo e sábado são os dois masculinos. */
function diaDaSemana(ymd: string): string {
  const n = daYMD(ymd).getDay();
  return `${n === 0 || n === 6 ? 'no' : 'na'} ${DIA_SEMANA[n]}`;
}

/** A data de daqui a `n` dias, em `yyyy-MM-dd`. */
function emDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toYMD(d);
}

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Início — a porta de entrada do dash.
 *
 * Antes desta página, quem entrava caía no Resumo financeiro; quem não tinha
 * permissão para ele era jogado na primeira página da lista que pudesse acessar
 * (`PAGINAS.find(p => canAccess(p.key))`). Ninguém tinha decidido isso.
 *
 * A tela mostra **o que a empresa combinou** — reunião, folga, feriado, recesso, marco —
 * e nada mais. Nem número de faturamento, que é o Resumo, nem fila de trabalho,
 * que é o Produção. A primeira versão trazia prazos de criativo e contadores de
 * aprovação pendente, e o dado real mostrou por que não: uma leva de nove
 * variações do mesmo anúncio caía toda numa segunda e virava um paredão que
 * escondia a reunião do dia. Demanda tem página própria.
 *
 * É a única página sem o filtro global de data: ela é sobre agora, não sobre um
 * período.
 */
export default function InicioPage() {
  const { user, perfil } = useAuth();
  const confirm = useConfirm();

  const ehAdmin = !!perfil?.is_admin;
  const hoje = toYMD(new Date());
  const ateParada = emDias(AVISO_PARADA_DIAS);

  const [ancora, setAncora] = useState(() => new Date());
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [atas, setAtas] = useState<Evento[]>([]);
  const [paradas, setParadas] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);

  const [aberto, setAberto] = useState<ItemAgenda | null>(null);
  const [editando, setEditando] = useState<Evento | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [dataSugerida, setDataSugerida] = useState<string | null>(null);

  /*
    A janela consultada: o mês na tela, com uma semana de folga dos dois lados,
    porque a grade começa em dias do mês anterior e termina no seguinte.
  */
  const [ini, fim] = useMemo(() => {
    const a = new Date(ancora.getFullYear(), ancora.getMonth(), 1 - 7);
    const b = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 7);
    return [toYMD(a), toYMD(b)];
  }, [ancora]);

  const carregar = useCallback(async () => {
    setLoading(true);

    // Evento recorrente tem `data` na primeira ocorrência, que pode estar muito
    // atrás da janela — por isso ele vem sempre, e a expansão é que filtra.
    const [rEventos, rPerfis] = await Promise.all([
      supabase
        .from('eventos')
        .select('*')
        .lte('data', fim)
        .or(`recorrencia_tipo.not.is.null,data.gte.${ini},data_fim.gte.${ini}`),
      supabase.from('perfis').select('id, nome').eq('ativo', true).order('nome'),
    ]);

    setEventos((rEventos.data as Evento[]) ?? []);
    setPerfis((rPerfis.data as Perfil[]) ?? []);
    setLoading(false);
  }, [ini, fim]);

  useEffect(() => { carregar(); }, [carregar]);

  // Atas: reuniões que já passaram e têm ata escrita. Consulta própria porque
  // não dependem da janela que está na tela.
  useEffect(() => {
    supabase
      .from('eventos')
      .select('*')
      .eq('tipo', 'reuniao')
      .not('ata', 'is', null)
      .lte('data', hoje)
      .order('data', { ascending: false })
      .limit(4)
      .then(({ data }) => setAtas((data as Evento[]) ?? []));
  }, [hoje, eventos]);

  /*
    O que para a empresa nos próximos dias — feriado e recesso.

    Consulta própria, e não uma leitura de `itens`: `itens` é o mês que está na
    tela, então navegar para dezembro faria o aviso da semana que vem sumir ou
    aparecer parada que ainda está longe. O aviso é sobre os próximos dias,
    não sobre o mês aberto.

    Sai do calendário e de mais nada — nenhuma lista de datas no código. Apagar
    o evento apaga o aviso, criar um cria; e recesso que a empresa inventar
    avisa igual aos feriados oficiais, porque para o código não há diferença
    entre eles. O `eventos` na dependência é o que faz isso valer já no mesmo
    instante: qualquer mexida na agenda recarrega esta consulta.

    Quais tipos param sai de `TIPOS_QUE_PARAM`, e não de uma lista escrita
    aqui: um tipo novo com `paraTodos` entra no aviso sozinho.
  */
  useEffect(() => {
    supabase
      .from('eventos')
      .select('*')
      .in('tipo', TIPOS_QUE_PARAM)
      .lte('data', ateParada)
      .or(`recorrencia_tipo.not.is.null,data.gte.${hoje},data_fim.gte.${hoje}`)
      .then(({ data }) => setParadas((data as Evento[]) ?? []));
  }, [hoje, ateParada, eventos]);

  // ---- o que a agenda desenha ----
  const itens = useMemo<ItemAgenda[]>(() => {
    const lista: ItemAgenda[] = [];
    eventos.forEach(ev => {
      const datas = diasOcupados(
        {
          inicio: ev.data,
          recorrencia_tipo: ev.recorrencia_tipo,
          recorrencia_dias_semana: ev.recorrencia_dias_semana,
          recorrencia_puladas: ev.recorrencia_puladas,
          recorrencia_fim: ev.recorrencia_fim,
          data_fim: ev.data_fim,
        },
        ini, fim,
      );
      datas.forEach(d => lista.push({
        chave: `${ev.id}@${d}`,
        data: d,
        tipo: ev.tipo,
        titulo: ev.titulo,
        hora: horaCurta(ev.hora_inicio),
        evento: ev,
      }));
    });
    return lista;
  }, [eventos, ini, fim]);

  const nomes = useMemo(() => {
    const m: Record<string, string> = {};
    perfis.forEach(p => { m[p.id] = p.nome; });
    return m;
  }, [perfis]);

  /**
   * Quem está fora no período aberto.
   *
   * Sai dos mesmos eventos que a agenda já desenhou — nenhuma consulta a mais.
   * Existe porque folga é a informação que todo mundo usa e que se perde no meio
   * da grade: saber que a quinta não tem a Jaqueline muda o que se combina na
   * segunda.
   */
  const fora = useMemo(() => {
    /*
      Uma linha por folga, e não por dia dela.

      Desde que folga pode durar mais de um dia, listar dia a dia faria uma
      semana de férias virar "Ana na segunda, Ana na terça, Ana na quarta…" e
      empurrar todo mundo para fora da faixa. Agrupado pelo evento, sai
      "Ana de 24 a 28 de dez", que é o que a pessoa diria.
    */
    const porEvento = new Map<string, { item: ItemAgenda; de: string; ate: string }>();

    itens.filter(i => i.tipo === 'folga').forEach(i => {
      const id = i.evento?.id ?? i.chave;
      const atual = porEvento.get(id);
      if (!atual) { porEvento.set(id, { item: i, de: i.data, ate: i.data }); return; }
      // O item guardado é o do primeiro dia: é ele que o clique deve abrir.
      if (i.data < atual.de)  { atual.de = i.data; atual.item = i; }
      if (i.data > atual.ate) { atual.ate = i.data; }
    });

    return [...porEvento.values()]
      .sort((a, b) => a.de.localeCompare(b.de))
      .map(({ item, de, ate }) => {
        const id = item.evento?.pessoa_id;
        const cheio = (id && nomes[id]) || item.titulo.replace(/^Folga\s*[—-]\s*/, '');
        return {
          chave: item.chave,
          item,
          quem: cheio.split(' ')[0],
          quando: de === ate ? diaDaSemana(de) : `de ${periodoCurto(de, ate)}`,
        };
      });
  }, [itens, nomes]);

  /**
   * As paradas que chegam nos próximos dias, com o "quando" já escrito.
   *
   * Passa pela mesma expansão de recorrência da agenda: parada cadastrada como
   * série avisa em cada ocorrência, e um dia pulado não avisa — a regra é uma
   * só, e não uma segunda cópia aqui dentro.
   */
  const paradasAVista = useMemo(() => {
    const lista: { chave: string; item: ItemAgenda; quando: string }[] = [];

    paradas.forEach(ev => {
      const dias = diasOcupados(
        {
          inicio: ev.data,
          recorrencia_tipo: ev.recorrencia_tipo,
          recorrencia_dias_semana: ev.recorrencia_dias_semana,
          recorrencia_puladas: ev.recorrencia_puladas,
          recorrencia_fim: ev.recorrencia_fim,
          data_fim: ev.data_fim,
        },
        hoje, ateParada,
      );
      if (dias.length === 0) return;

      // Um aviso por parada, não por dia dela: um recesso de três dias
      // apareceria três vezes na mesma faixa dizendo a mesma coisa.
      const de  = dias[0];
      const ate = dias[dias.length - 1];
      const faltam = Math.round((daYMD(de).getTime() - daYMD(hoje).getTime()) / 86_400_000);

      const inicio =
        faltam === 0 ? 'é hoje'
        : faltam === 1 ? 'é amanhã'
        : `${diaDaSemana(de)}, em ${faltam} dias`;

      lista.push({
        chave: `${ev.id}@${de}`,
        item: { chave: `${ev.id}@${de}`, data: de, tipo: ev.tipo, titulo: ev.titulo, hora: null, evento: ev },
        quando: de === ate ? inicio : `${periodoCurto(de, ate)} — começa ${inicio.replace(/^é /, '')}`,
      });
    });

    return lista.sort((a, b) => a.item.data.localeCompare(b.item.data));
  }, [paradas, hoje, ateParada]);

  const mover = (passo: number) =>
    setAncora(a => new Date(a.getFullYear(), a.getMonth() + passo, 1));

  const faixa = `${MESES[ancora.getMonth()]} ${ancora.getFullYear()}`;

  /*
    Pular um dia de uma série.

    Escreve a data em `recorrencia_puladas` e recarrega. Não apaga nada: a
    série continua, e o dia volta tirando a data pela edição do evento.
  */
  const pular = async (item: ItemAgenda) => {
    const ev = item.evento;
    if (!ev) return;
    if (!(await confirm({
      title: 'Pular este dia?',
      description: 'A série continua. Este dia sai da agenda e pode voltar pela edição do evento.',
      /* Sem isto o botão diz "Excluir", que é o padrão do hook — e um diálogo
         que pergunta "pular?" com um botão "excluir" faz qualquer um hesitar. */
      confirmText: 'Pular este dia',
    }))) return;

    const { data, error } = await supabase
      .from('eventos')
      .update({ recorrencia_puladas: [...(ev.recorrencia_puladas ?? []), item.data] })
      .eq('id', ev.id)
      .select('id');

    if (error) {
      toast({ title: 'Não pulou', description: error.message, variant: 'destructive' });
      return;
    }
    if (!data?.length) {
      toast({ title: 'Sem permissão para mexer neste evento', variant: 'destructive' });
      return;
    }
    setAberto(null);
    carregar();
  };

  const excluir = async (item: ItemAgenda) => {
    const ev = item.evento;
    if (!ev) return;
    const ok = await confirm({
      title: 'Excluir evento',
      description: ev.recorrencia_tipo
        ? 'Este evento se repete. Excluir remove todas as ocorrências, não só esta.'
        : `"${ev.titulo}" será removido da agenda.`,
      confirmText: 'Excluir',
      destructive: true,
    });
    if (!ok) return;

    const { error } = await supabase.from('eventos').delete().eq('id', ev.id);
    if (error) {
      toast({ title: 'Não excluiu', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Evento excluído' });
    setAberto(null);
    carregar();
  };

  /*
    O recado apontado pela notificação, se veio um.

    Na URL e não em `location.state`: o state morre num F5, e a notificação
    que a pessoa deixou aberta numa aba deixaria de apontar para nada. Mesma
    razão do `?criativo=` da Produção.
  */
  const [params] = useSearchParams();
  const recadoDaNotificacao = params.get('recado');

  const abrirNovo = (data: string | null) => {
    setEditando(null);
    setDataSugerida(data);
    setFormAberto(true);
  };

  return (
    <DashboardLayout title="Início" hideFilters hideAvisos={ehAdmin} hideTitle>
      <div className="flex flex-col gap-4">

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">
            {saudacao()}{perfil?.nome ? `, ${perfil.nome.split(' ')[0]}` : ''}
          </h2>
          <Button size="sm" onClick={() => abrirNovo(null)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {ehAdmin ? 'Novo evento' : 'Registrar folga'}
          </Button>
        </div>

        {/* ---- saúde do sistema: só admin e sócio ---- */}
        {ehAdmin && <SaudeSistema />}

        {/* ---- feriado ou recesso à vista ---- */}
        {paradasAVista.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-2.5 text-sm">
            <PartyPopper className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
              a empresa para
            </span>
            {paradasAVista.map((f, i) => (
              <button
                key={f.chave}
                type="button"
                onClick={() => setAberto(f.item)}
                className="text-amber-100/90 hover:text-amber-50 hover:underline"
              >
                <span className="text-amber-300/55">{ROTULO_TIPO[f.item.tipo]}:</span>{' '}
                {f.item.titulo} <span className="text-amber-300/70">{f.quando}</span>
                {i < paradasAVista.length - 1 && <span className="text-amber-300/40">,</span>}
              </button>
            ))}
          </div>
        )}

        {/* ---- quem está fora ---- */}
        {fora.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-teal-400/25 bg-teal-400/[0.06] px-4 py-2.5 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-wider text-teal-300/80">
              fora neste mês
            </span>
            {fora.map((f, i) => (
              <button
                key={f.chave}
                type="button"
                onClick={() => setAberto(f.item)}
                className="text-teal-100/90 hover:text-teal-50 hover:underline"
              >
                {f.quem} <span className="text-teal-300/70">{f.quando}</span>
                {i < fora.length - 1 && <span className="text-teal-300/40">,</span>}
              </button>
            ))}
          </div>
        )}

        {/*
          ---- mural ----

          Ele ficava no FIM da página, depois da agenda e das atas. Recado é a
          coisa mais perecível do Início — vale hoje e não vale mês que vem —,
          e estava no lugar onde só chega quem rola até embaixo. Pior: a
          notificação "Fulano no mural" levava para cá e a pessoa caía no topo,
          sem ver o recado.

          Agora ele abre a página, junto dos avisos que também são de hoje.
        */}
        <MuralRecados ehAdmin={ehAdmin} userId={user?.id ?? ''} destacarId={recadoDaNotificacao} />

        {/* ---- agenda ---- */}
        <section className="rounded-xl border border-border bg-card p-4 md:p-5">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Agenda
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => mover(-1)}
                aria-label="Mês anterior"
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[110px] text-center text-sm font-medium">{faixa}</span>
              <button
                type="button"
                onClick={() => mover(1)}
                aria-label="Próximo mês"
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>

              {/*
                O seletor Semana/Mês saiu: a agenda é o mês, e só. O que ele
                tinha de útil era voltar para hoje ao trocar de vista — isso
                virou um botão que diz o que faz.
              */}
              <button
                type="button"
                onClick={() => setAncora(new Date())}
                className="ml-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Hoje
              </button>
            </div>
          </header>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando a agenda...
            </div>
          ) : (
            <Agenda
              ancora={ancora}
              itens={itens}
              hoje={hoje}
              onAbrir={setAberto}
              onNovoNoDia={abrirNovo}
            />
          )}

          <div className="mt-4 flex flex-wrap gap-3.5 border-t border-border pt-3">
            {TIPOS_EVENTO.map(t => (
              <span key={t.chave} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <i className={cn('h-2 w-2 rounded-sm', t.ponto)} /> {t.rotulo}
              </span>
            ))}
          </div>
        </section>

        {/* ---- atas ---- */}
        <section className="rounded-xl border border-border bg-card p-4 md:p-5">
          <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Últimas atas
          </h3>
          {atas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma ata escrita ainda. A ata de uma reunião aparece aqui depois que alguém a preenche.
            </p>
          ) : (
            <div className="flex flex-col">
              {atas.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAberto({
                    chave: `${a.id}@${a.data}`, data: a.data, tipo: 'reuniao',
                    titulo: a.titulo, hora: horaCurta(a.hora_inicio), evento: a,
                  })}
                  className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent/40"
                >
                  <span className="min-w-0 flex-1 text-sm">
                    {a.titulo}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      · {a.data.slice(8, 10)}/{a.data.slice(5, 7)}
                    </span>
                  </span>
                  {a.link_gravacao && (
                    <span className="shrink-0 rounded-full border border-teal-400/35 bg-teal-400/10 px-2 py-0.5 font-mono text-[10px] text-teal-300">
                      gravação
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <EventoDrawer
        item={aberto}
        nomes={nomes}
        podeEditar={ehAdmin || (!!aberto?.evento && aberto.evento.criado_por === user?.id)}
        onFechar={() => setAberto(null)}
        onEditar={item => { setEditando(item.evento ?? null); setDataSugerida(null); setFormAberto(true); setAberto(null); }}
        onExcluir={excluir}
        onPular={pular}
      />

      {formAberto && (
        <EventoFormModal
          aberto
          evento={editando}
          ehAdmin={ehAdmin}
          userId={user?.id ?? ''}
          perfis={perfis}
          dataSugerida={dataSugerida}
          onFechar={() => setFormAberto(false)}
          onSalvo={() => { setFormAberto(false); carregar(); }}
        />
      )}
    </DashboardLayout>
  );
}
