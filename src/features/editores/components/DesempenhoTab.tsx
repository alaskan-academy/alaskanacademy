import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { MultiFilter } from '@/features/producao/components/MultiFilter';
import { SeletorDeMeses } from '@/components/SeletorDeMeses';
import { cn } from '@/lib/utils';



import { Button } from '@/components/ui/button';

import { formatNumber, formatPercent } from '@/lib/formatters';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend,
} from 'recharts';

const TIPO_LABEL: Record<string, string> = { criativo: 'Criativo', vsl: 'VSL', aula: 'Aula' };

function ymToDateRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const endDate = new Date(y, m, 0);
  const end = `${ym}-${String(endDate.getDate()).padStart(2, '0')}`;
  return { start, end };
}

function currentYM(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Atalho para o que mais se pede. Escreve no MESMO par que a grade escreve,
 *  então nunca há um preset dizendo uma coisa e um par dizendo outra. */
function ChipMes({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
            className={cn(
              'h-8 rounded-md border px-3 text-xs transition-colors',
              ativo ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}>
      {children}
    </button>
  );
}

export function DesempenhoTab() {
  const [editores, setEditores] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [projetosAtivos, setProjetosAtivos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filterEditores, setFilterEditores] = useState<string[]>([]);
  const [filterOfertas, setFilterOfertas] = useState<string[]>([]);
  /**
   * O período é DOIS valores, e não três.
   *
   * Antes eram `monthPreset` mais `customStart`/`customEnd`: o preset dizia
   * qual par valia, e os dois campos guardavam um par que só era usado quando
   * o preset era 'custom'. Dois estados para um conceito — a armadilha que
   * este projeto já pagou cinco vezes. Agora o par É o período, e os atalhos
   * só escrevem nele.
   */
  const [mesDe, setMesDe]   = useState(currentYM(0));
  const [mesAte, setMesAte] = useState(currentYM(0));

  const { startStr, endStr } = useMemo(() => ({
    startStr: ymToDateRange(mesDe).start,
    endStr:   ymToDateRange(mesAte).end,
  }), [mesDe, mesAte]);

  /**
   * A agregação mudou de lado.
   *
   * Esta função puxava os 2.916 cards postados, disparava ~10 consultas em
   * blocos de 300 ids para achar a data de postagem em `criativo_historico`,
   * e só então agrupava em JavaScript — 2.916 linhas com relação embutida para
   * produzir 13 de resultado.
   *
   * `fn_desempenho_editores` faz isso no banco e devolve as duas metades já
   * unidas: `avaliacoes_criativos` até jun/2026, `producoes` depois. Some a
   * paginação, some o `criativo_historico` em pedaços, e a RLS passa a valer
   * sobre o número que a tela mostra em vez de sobre 2.916 linhas soltas.
   *
   * Conferido contra o que a tela dizia antes: agosto 143/0, junho 63/6,
   * jun→ago 364/20 — os três iguais.
   */
  const load = async () => {
    setLoading(true);
    setErro(null);

    const [eRes, dRes, pRes] = await Promise.all([
      /*
        Só editor ATIVO. Antes vinha a tabela inteira, e o que segurava quem
        saiu era a coincidência de `editores` ter só duas linhas, as duas
        ativas — no dia em que uma delas fosse desligada sem apagar o
        registro, ela voltaria a aparecer aqui.

        A produção de quem saiu não some do sistema: ela continua em
        Criativos → Desempenho, que mede o CRIATIVO. Esta tela mede a PESSOA,
        e pessoa que não está mais na casa não entra em comparação de
        desempenho.
      */
      supabase.from('editores').select('id, nome, usuario_id').eq('ativo', true).order('nome'),
      supabase.rpc('fn_desempenho_editores', { p_ini: startStr, p_fim: endStr }),
      supabase.from('ofertas_editores').select('nome').eq('ativo', true).order('nome'),
    ]);

    /**
     * Esta tela não tratava erro NENHUM: nem `error`, nem `catch`.
     *
     * Rede caída, RLS negando, timeout — qualquer um deles deixava os gráficos
     * vazios, e vazio aqui se lê como "esse mês não teve criativo". É a tela
     * que alimenta decisão de bônus, então a leitura errada não custa uma
     * recarga: custa um bônus calculado sobre zero.
     *
     * O mesmo defeito que o calendário da Produção tinha, e pelo mesmo motivo
     * — `|| []` em cada resposta transforma falha em lista vazia, calada.
     */
    const falha = eRes.error ?? dRes.error ?? pRes.error;
    if (falha) {
      setErro(falha.message);
      setLoading(false);
      return;
    }

    setProjetosAtivos((pRes.data || []).map((p: any) => p.nome));
    setEditores(eRes.data || []);
    setItems((dRes.data as any[]) || []);
    setLoading(false);
  };

  // Recarrega quando o período muda: agora é o BANCO que recorta, então a
  // janela faz parte da consulta e não mais de um filtro em memória.
  useEffect(() => { load(); }, [startStr, endStr]);


  const editorMap = Object.fromEntries(editores.map(x => [x.id, x.nome]));

  /** Quantos filtros peneiram a lista. O período não entra: ele define O QUE
   *  foi buscado, e zerá-lo não é limpar, é buscar outra coisa. */
  const filtrosAtivos = (filterEditores.length ? 1 : 0) + (filterOfertas.length ? 1 : 0);

  // O recorte por data saiu daqui: quem faz é a função no banco. Sobrou o que
  // de fato peneira o que já veio.
  const filtered = useMemo(() => items.filter(i => {
    if (filterEditores.length && !filterEditores.includes(i.editor_id)) return false;
    if (filterOfertas.length > 0 && !filterOfertas.includes(i.oferta)) return false;
    return true;
  }), [items, filterEditores, filterOfertas]);

  /**
   * Os quatro números do topo contam ANÚNCIO, e só anúncio.
   *
   * Somavam tudo: o cartão dizia "Total ADs testados 75" e os 75 eram 73
   * criativos mais 2 VSLs. Pior no "Validados": o único validado do período
   * era uma VSL, então o número que se lê como "anúncio que deu certo" era
   * inteiramente de outra coisa. A taxa herdava o erro nos dois lados.
   *
   * Anúncio e VSL não se comparam. Uma VSL é uma peça longa, testada aos
   * poucos e validada por outro critério; misturar as duas num denominador só
   * faz a taxa de validação de anúncio subir ou descer por motivo que não tem
   * a ver com anúncio.
   *
   * VSL e aula continuam na tabela de baixo, cada uma na sua linha.
   */
  const totals = useMemo(() => {
    const t = filtered
      .filter(i => (i.tipo || 'criativo') === 'criativo')
      .reduce((acc, i) => {
        acc.testados  += Number(i.ads_testados  || 0);
        acc.validados += Number(i.ads_validados || 0);
        acc.escalados += Number(i.ads_escalados || 0);
        return acc;
      }, { testados: 0, validados: 0, escalados: 0 });
    return { ...t, taxa: t.testados > 0 ? ((t.validados + t.escalados) / t.testados) * 100 : 0 };
  }, [filtered]);

  const porTipo = useMemo(() => {
    const map: Record<string, { tipo: string; testados: number; validados: number; escalados: number }> = {};
    filtered.forEach(i => {
      const tipo = i.tipo || 'criativo';
      if (!map[tipo]) map[tipo] = { tipo, testados: 0, validados: 0, escalados: 0 };
      map[tipo].testados  += Number(i.ads_testados  || 0);
      map[tipo].validados += Number(i.ads_validados || 0);
      map[tipo].escalados += Number(i.ads_escalados || 0);
    });
    return Object.values(map).map(v => ({
      ...v, taxa: v.testados > 0 ? ((v.validados + v.escalados) / v.testados) * 100 : 0,
    })).sort((a, b) => b.testados - a.testados);
  }, [filtered]);

  const porEditor = useMemo(() => {
    const map: Record<string, { nome: string; testados: number; validados: number; escalados: number; projetos: Set<string> }> = {};
    filtered.forEach(i => {
      const key = i.editor_id || 'sem-editor';
      const nome = editorMap[i.editor_id] || '—';
      if (!map[key]) map[key] = { nome, testados: 0, validados: 0, escalados: 0, projetos: new Set() };
      map[key].testados  += Number(i.ads_testados  || 0);
      map[key].validados += Number(i.ads_validados || 0);
      map[key].escalados += Number(i.ads_escalados || 0);
      if (i.oferta) map[key].projetos.add(i.oferta);
    });
    return Object.values(map).map(v => ({
      ...v,
      taxa: v.testados > 0 ? ((v.validados + v.escalados) / v.testados) * 100 : 0,
      projetos: v.projetos.size,
    })).sort((a, b) => b.taxa - a.taxa);
  }, [filtered, editorMap]);

  const porProjeto = useMemo(() => {
    const map: Record<string, { oferta: string; testados: number; validados: number; escalados: number }> = {};
    filtered.forEach(i => {
      const oferta = i.oferta || '—';
      if (!map[oferta]) map[oferta] = { oferta, testados: 0, validados: 0, escalados: 0 };
      map[oferta].testados  += Number(i.ads_testados  || 0);
      map[oferta].validados += Number(i.ads_validados || 0);
      map[oferta].escalados += Number(i.ads_escalados || 0);
    });
    return Object.values(map).map(v => ({
      ...v, taxa: v.testados > 0 ? ((v.validados + v.escalados) / v.testados) * 100 : 0,
    })).sort((a, b) => b.taxa - a.taxa);
  }, [filtered]);

  const evolucao = useMemo(() => {
    const map: Record<string, { mes: string; testados: number; validados: number; escalados: number }> = {};
    filtered.forEach(i => {
      const mes = String(i.mes_referencia).slice(0, 7);
      if (!map[mes]) map[mes] = { mes, testados: 0, validados: 0, escalados: 0 };
      map[mes].testados  += Number(i.ads_testados  || 0);
      map[mes].validados += Number(i.ads_validados || 0);
      map[mes].escalados += Number(i.ads_escalados || 0);
    });
    return Object.values(map)
      .map(v => ({ ...v, taxa: v.testados > 0 ? ((v.validados + v.escalados) / v.testados) * 100 : 0 }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }, [filtered]);

  // Falha não vira gráfico vazio: a tela diz o que houve e oferece a saída.
  if (erro) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">Não consegui carregar o desempenho.</p>
        <p className="max-w-md text-xs text-muted-foreground/70">{erro}</p>
        <Button size="sm" variant="outline" className="text-xs" onClick={load}>Tentar de novo</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        Terceiro desenho de barra de filtro da mesma página, agora igual aos
        outros dois. Era um cartão com borda, rótulo em cima de cada controle e
        larguras fixas de 180/200/220 — enquanto Criativos Meta usa controles
        soltos de altura 8 e Avaliações usa um "Filtrar por editor" avulso.
        Três desenhos numa página só fazem cada aba parecer um produto
        diferente.

        Os rótulos saíram porque cada controle já diz o que é: o seletor mostra
        "Este mês", o de editor mostra "Editor". Rótulo acima de um controle
        que se explica é ruído que ocupa altura.
      */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Eram um seletor de preset e dois `<input type="month">`: para ver
            junho a agosto, três controles e duas caixas de texto que não
            mostram que os meses são vizinhos. Agora é uma grade de doze — o
            ano inteiro de uma vez, com começo, fim e o que ficou de fora
            visíveis juntos. Os presets viraram atalhos ao lado, porque "este
            mês" continua sendo o que mais se pede. */}
        <SeletorDeMeses de={mesDe} ate={mesAte}
                        onChange={(a, b) => { setMesDe(a); setMesAte(b); }} />

        <ChipMes ativo={mesDe === currentYM(0) && mesAte === currentYM(0)}
                 onClick={() => { setMesDe(currentYM(0)); setMesAte(currentYM(0)); }}>
          Este mês
        </ChipMes>
        <ChipMes ativo={mesDe === currentYM(-1) && mesAte === currentYM(-1)}
                 onClick={() => { setMesDe(currentYM(-1)); setMesAte(currentYM(-1)); }}>
          Mês passado
        </ChipMes>

        <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" aria-hidden />

        {/* Eram um `Select` de editor e um Popover com Checkbox feito à mão —
            que é um MultiFilter reescrito. Os dois viram o MultiFilter de
            verdade, o mesmo da Produção e da Criativos Meta. */}
        <MultiFilter
          label="Editor"
          options={editores.map(e => ({ id: e.id, nome: e.nome }))}
          value={filterEditores}
          onChange={setFilterEditores}
          width="w-40"
        />
        <MultiFilter
          label="Projetos"
          options={projetosAtivos.map(p => ({ id: p, nome: p }))}
          value={filterOfertas}
          onChange={setFilterOfertas}
          width="w-40"
        />

        {filtrosAtivos > 0 && (
          <Button size="sm" variant="ghost"
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setFilterEditores([]); setFilterOfertas([]); }}>
            Limpar {filtrosAtivos}
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase">Anúncios testados</p>
          <p className="text-2xl font-semibold mt-1">{formatNumber(totals.testados)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase">Anúncios validados</p>
          <p className="text-2xl font-semibold mt-1">{formatNumber(totals.validados)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase">Anúncios escalados</p>
          <p className="text-2xl font-semibold mt-1">{formatNumber(totals.escalados)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground uppercase">Taxa de validação</p>
          <p className="text-xs text-muted-foreground/60 mb-1">(validados + escalados)</p>
          <p className="text-2xl font-semibold">{formatPercent(totals.taxa)}</p>
        </div>
      </div>

      {/* Por tipo */}
      {porTipo.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border"><h4 className="text-sm font-medium">Por tipo de peça</h4></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground uppercase">
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-right px-3 py-2">Testados</th>
                <th className="text-right px-3 py-2">Validados</th>
                <th className="text-right px-3 py-2">Escalados</th>
                <th className="text-right px-3 py-2">Taxa</th>
              </tr></thead>
              <tbody>
                {porTipo.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-3 py-2 font-medium">{TIPO_LABEL[r.tipo] ?? r.tipo}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(r.testados)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(r.validados)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(r.escalados)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.taxa >= 20 ? 'bg-emerald-500/10 text-emerald-500' : r.taxa >= 10 ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'}`}>
                        {formatPercent(r.taxa)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <h4 className="text-sm font-medium mb-3">Assertividade média por editor</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porEditor}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="nome" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} unit="%" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(v: any) => formatPercent(Number(v))} />
              <Bar dataKey="taxa" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h4 className="text-sm font-medium mb-3">Taxa média de assertividade por projeto</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porProjeto}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="oferta" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} unit="%" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(v: any) => formatPercent(Number(v))} />
              <Bar dataKey="taxa" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 lg:col-span-2">
          <h4 className="text-sm font-medium mb-3">Evolução da assertividade ao longo do tempo</h4>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={evolucao}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mes" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} unit="%" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(v: any) => formatPercent(Number(v))} />
              <Legend />
              <Line type="monotone" dataKey="taxa" name="Taxa de validação" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 lg:col-span-2">
          <h4 className="text-sm font-medium mb-3">Criativos testados vs Taxa de validação ao longo do tempo</h4>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={evolucao}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mes" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} unit="%" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} formatter={(v: any, name: any) => name === 'Taxa de validação' ? formatPercent(Number(v)) : formatNumber(Number(v))} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="testados" name="Criativos testados" stroke="#6366f1" strokeWidth={2} dot={{ r: 4 }} />
              <Line yAxisId="right" type="monotone" dataKey="taxa" name="Taxa de validação" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabela: Assertividade por editor */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border"><h4 className="text-sm font-medium">Assertividade por editor</h4></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground uppercase">
              <th className="text-left px-3 py-2">Editor</th>
              <th className="text-left px-3 py-2">Projetos</th>
              <th className="text-right px-3 py-2">Testados</th>
              <th className="text-right px-3 py-2">Validados</th>
              <th className="text-right px-3 py-2">Escalados</th>
              <th className="text-right px-3 py-2">Taxa</th>
            </tr></thead>
            <tbody>
              {porEditor.map((r, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-3 py-2 font-medium">{r.nome}</td>
                  <td className="px-3 py-2">{r.projetos}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.testados)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.validados)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.escalados)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.taxa >= 20 ? 'bg-emerald-500/10 text-emerald-500' : r.taxa >= 10 ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'}`}>
                      {formatPercent(r.taxa)}
                    </span>
                  </td>
                </tr>
              ))}
              {porEditor.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{loading ? 'Carregando...' : 'Sem dados'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
