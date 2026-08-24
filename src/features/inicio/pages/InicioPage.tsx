import { useState, useEffect, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useConfirm } from '@/hooks/use-confirm';
import { cn } from '@/lib/utils';
import { ocorrencias, toYMD, segundaDa } from '@/lib/recorrencia';
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react';
import { Agenda } from '../components/Agenda';
import { EventoDrawer } from '../components/EventoDrawer';
import { EventoFormModal } from '../components/EventoFormModal';
import { horaCurta, type Evento, type ItemAgenda } from '../types';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

interface Perfil { id: string; nome: string }

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
 * A tela mostra **o que a empresa combinou** — reunião, folga, feriado, marco —
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

  const [vista, setVista]   = useState<'semana' | 'mes'>('semana');
  const [ancora, setAncora] = useState(() => new Date());
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [atas, setAtas] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);

  const [aberto, setAberto] = useState<ItemAgenda | null>(null);
  const [editando, setEditando] = useState<Evento | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [dataSugerida, setDataSugerida] = useState<string | null>(null);

  // Janela consultada: a semana ou o mês na tela, com folga dos dois lados para
  // a grade do mês, que começa em dias do mês anterior.
  const [ini, fim] = useMemo(() => {
    if (vista === 'semana') {
      const seg = segundaDa(ancora);
      const dom = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 6);
      return [toYMD(seg), toYMD(dom)];
    }
    const a = new Date(ancora.getFullYear(), ancora.getMonth(), 1 - 7);
    const b = new Date(ancora.getFullYear(), ancora.getMonth() + 1, 7);
    return [toYMD(a), toYMD(b)];
  }, [vista, ancora]);

  const carregar = useCallback(async () => {
    setLoading(true);

    // Evento recorrente tem `data` na primeira ocorrência, que pode estar muito
    // atrás da janela — por isso ele vem sempre, e a expansão é que filtra.
    const [rEventos, rPerfis] = await Promise.all([
      supabase
        .from('eventos')
        .select('*')
        .lte('data', fim)
        .or(`recorrencia_tipo.not.is.null,data.gte.${ini}`),
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

  // ---- o que a agenda desenha ----
  const itens = useMemo<ItemAgenda[]>(() => {
    const lista: ItemAgenda[] = [];
    eventos.forEach(ev => {
      const datas = ocorrencias(
        {
          inicio: ev.data,
          recorrencia_tipo: ev.recorrencia_tipo,
          recorrencia_dias_semana: ev.recorrencia_dias_semana,
          recorrencia_fim: ev.recorrencia_fim,
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

  const mover = (passo: number) => {
    setAncora(a => vista === 'semana'
      ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + passo * 7)
      : new Date(a.getFullYear(), a.getMonth() + passo, 1));
  };

  const faixa = vista === 'semana'
    ? (() => {
        const s = segundaDa(ancora);
        const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
        return `${s.getDate()} – ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`;
      })()
    : `${MESES[ancora.getMonth()]} ${ancora.getFullYear()}`;

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

  const abrirNovo = (data: string | null) => {
    setEditando(null);
    setDataSugerida(data);
    setFormAberto(true);
  };

  return (
    <DashboardLayout title="Início" hideFilters>
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
                aria-label={vista === 'semana' ? 'Semana anterior' : 'Mês anterior'}
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[110px] text-center text-sm font-medium">{faixa}</span>
              <button
                type="button"
                onClick={() => mover(1)}
                aria-label={vista === 'semana' ? 'Próxima semana' : 'Próximo mês'}
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>

              <div className="ml-1.5 flex gap-0.5 rounded-lg bg-muted p-0.5">
                {(['semana', 'mes'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => { setVista(v); setAncora(new Date()); }}
                    aria-pressed={vista === v}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                      vista === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {v === 'semana' ? 'Semana' : 'Mês'}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando a agenda...
            </div>
          ) : (
            <Agenda
              vista={vista}
              ancora={ancora}
              itens={itens}
              hoje={hoje}
              onAbrir={setAberto}
              onNovoNoDia={vista === 'semana' ? abrirNovo : undefined}
            />
          )}

          <div className="mt-4 flex flex-wrap gap-3.5 border-t border-border pt-3">
            {[
              ['bg-primary', 'Reunião'],
              ['bg-teal-400', 'Folga'],
              ['bg-violet-400', 'Marco'],
              ['bg-muted-foreground', 'Feriado'],
            ].map(([cor, rotulo]) => (
              <span key={rotulo} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <i className={cn('h-2 w-2 rounded-sm', cor)} /> {rotulo}
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
