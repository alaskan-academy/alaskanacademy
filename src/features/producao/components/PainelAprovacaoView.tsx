import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, CornerDownLeft, Loader2 } from 'lucide-react';
import { supabase, linhas, linha } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Criativo, ProducaoNivel, Perfil } from './types';
import { useFases, fasesQueAprova, rotuloDaFase } from '../useFases';
import { CriativoDrawer } from './CriativoDrawer';

interface SetorInfo { id: string; nome: string }

interface Props {
  nivel: ProducaoNivel;
  setor: SetorInfo | null;
  userId: string;
}

/*
 * `FASES_APROVACAO` e `TODAS_FASES_REVISAO` moravam aqui, chaveados pelo NOME
 * do setor — o quarto mapa da mesma coisa nesta área. E ele contradizia os
 * outros: dizia que "Gestor de Tráfego" aprova revisão de EDIÇÃO e de COPY,
 * fases que pertencem a Editor e a Copy.
 *
 * Agora a pergunta é feita à tabela: um head aprova as revisões do próprio
 * setor; sócio aprova todas. Uma regra, escrita uma vez.
 */

export function PainelAprovacaoView({ nivel, setor, userId }: Props) {
  const { fases, carregou } = useFases();
  const [criativos, setCriativos] = useState<Criativo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [devolvendoId, setDevolvendoId] = useState<string | null>(null);
  const [notaDevolucao, setNotaDevolucao] = useState('');
  const [saving, setSaving] = useState(false);
  // `Perfil` pede `is_admin`, entao a consulta traz `is_admin` -- em vez de
  // mascarar o desencontro com um cast. O drawer nao usa o campo hoje, mas o
  // tipo passa a descrever o que realmente chega.
  const [perfis, setPerfis] = useState<Perfil[]>([]);

  useEffect(() => {
    supabase.from('perfis').select('id,nome,is_admin').then(({ data }) => setPerfis(linhas<Perfil>(data)));
  }, []);

  const fasesVisiveis = fasesQueAprova(fases, setor?.id ?? null, nivel === 'socio');

  const loadCriativos = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('producoes')
      .select('*, funil:funis(id,nome,produto), responsavel:perfis!responsavel_id(id,nome), copy:perfis!copy_id(id,nome), gestor:perfis!gestor_id(id,nome)')
      .in('fase', fasesVisiveis)
      .order('data_prazo', { ascending: true, nullsFirst: false });
    setCriativos(data ?? []);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nivel, setor?.id, fasesVisiveis.join(',')]);

  useEffect(() => { loadCriativos(); }, [loadCriativos]);

  /**
   * Aprovar é UMA operação, e não quatro escritas soltas.
   *
   * Antes eram duas chamadas seguidas — muda a fase, grava o histórico — sem
   * transação e sem checar erro. Se a primeira falhasse, a tela dizia que
   * aprovou; se a segunda falhasse, o criativo andava sem deixar rastro. Agora
   * ou as duas acontecem ou nenhuma, e o erro chega a quem clicou.
   *
   * A próxima fase também vem do banco: ela é decidida pela ordem em
   * `producao_fases`, e não por um array no frontend que podia discordar dela.
   */
  const handleAprovar = async (c: Criativo) => {
    setSaving(true);
    const { data, error } = await supabase.rpc('fn_aprovar_criativo', {
      p_criativo_id: c.id,
      p_usuario_id:  userId,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Não consegui aprovar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `"${c.nome}" foi para ${rotuloDaFase(fases, data as string)}` });
    loadCriativos();
  };

  /**
   * Devolver eram CINCO escritas soltas: fase, histórico, comentário, aviso a
   * quem foi mencionado, aviso ao responsável. Nenhuma checava erro, e não
   * havia transação — o pior caso silencioso era o criativo voltar para
   * alteração e o editor nunca ficar sabendo.
   *
   * Quem é mencionado continua sendo decidido AQUI, e não no banco: depende da
   * lista de perfis que a tela já carregou, e mandar os nomes para o SQL só
   * para ele reencontrá-los seria trabalho a mais para o mesmo resultado.
   */
  const handleDevolver = async (c: Criativo) => {
    const texto = notaDevolucao.trim();
    if (!texto) return;

    const mentions = texto.match(/@(\S+)/g)?.map(m => m.slice(1).toLowerCase()) ?? [];
    const mencionados = perfis
      .filter(p => {
        const first = p.nome.split(' ')[0].toLowerCase();
        return mentions.includes(first) || mentions.includes(p.nome.toLowerCase());
      })
      .map(p => p.id);

    setSaving(true);
    const { error } = await supabase.rpc('fn_devolver_criativo', {
      p_criativo_id: c.id,
      p_usuario_id:  userId,
      p_nota:        texto,
      p_mencionados: mencionados,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Não consegui devolver', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `"${c.nome}" voltou para alteração` });
    setDevolvendoId(null);
    setNotaDevolucao('');
    loadCriativos();
  };

  if (loading || !carregou) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
      </div>
    );
  }

  if (!criativos.length) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Nenhum item aguardando aprovação.
      </div>
    );
  }

  // Agrupa por fase
  const porFase = fasesVisiveis.reduce<Record<string, Criativo[]>>((acc, fase) => {
    acc[fase] = criativos.filter(c => c.fase === fase);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      {fasesVisiveis.map(fase => {
        const items = porFase[fase] ?? [];
        if (!items.length) return null;

        // Agrupa por funil dentro da fase
        const funilOrder: string[] = [];
        const porFunil: Record<string, Criativo[]> = {};
        for (const c of items) {
          const key = c.funil?.nome ?? '— Sem funil —';
          if (!porFunil[key]) { porFunil[key] = []; funilOrder.push(key); }
          porFunil[key].push(c);
        }

        return (
          <div key={fase}>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {rotuloDaFase(fases, fase)} — {items.length}
            </h3>
            {funilOrder.map(funilNome => (
              <div key={funilNome} className="mb-4">
                {funilOrder.length > 1 && (
                  <p className="text-[11px] font-medium text-muted-foreground/60 mb-2 px-1 uppercase tracking-wider">
                    {funilNome}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {porFunil[funilNome].map(c => (
                    <div key={c.id} className="border border-border rounded-lg p-3 bg-card">
                      {/* Card principal */}
                      <div className="flex items-start gap-3">
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => setSelectedId(c.id)}
                        >
                          <p className="text-sm font-medium truncate">{c.nome}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                            {c.funil && <span>{c.funil.nome}</span>}
                            {c.funil && c.responsavel && <span>·</span>}
                            {c.responsavel && <span>Editor: {c.responsavel.nome}</span>}
                            {c.copy && <><span>·</span><span>Copy: {c.copy.nome}</span></>}
                            {c.data_prazo && (
                              <><span>·</span><span>Prazo: {new Date(c.data_prazo + 'T00:00:00').toLocaleDateString('pt-BR')}</span></>
                            )}
                          </div>
                        </div>

                        {/* Ações */}
                        {devolvendoId !== c.id && (
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                              onClick={() => { setDevolvendoId(c.id); setNotaDevolucao(''); }}
                            >
                              <CornerDownLeft className="h-3.5 w-3.5" />
                              Devolver
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={saving}
                              onClick={() => handleAprovar(c)}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Aprovar
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Formulário de devolução */}
                      {devolvendoId === c.id && (
                        <div className="mt-3 pt-3 border-t border-border flex flex-col gap-2">
                          <p className="text-xs text-muted-foreground">Nota obrigatória para devolução:</p>
                          <textarea
                            autoFocus
                            rows={2}
                            value={notaDevolucao}
                            onChange={e => setNotaDevolucao(e.target.value)}
                            placeholder="Descreva o que precisa ser ajustado... Use @nome para marcar alguém."
                            className={cn(
                              'w-full text-sm rounded-md border border-input bg-background px-3 py-2 resize-none',
                              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
                            )}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => { setDevolvendoId(null); setNotaDevolucao(''); }}
                            >
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 text-xs gap-1"
                              disabled={!notaDevolucao.trim() || saving}
                              onClick={() => handleDevolver(c)}
                            >
                              <CornerDownLeft className="h-3.5 w-3.5" />
                              Devolver com nota
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      <CriativoDrawer
        criativoId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdate={loadCriativos}
        nivel={nivel}
        userId={userId}
        funis={[]}
        perfis={perfis}
      />
    </div>
  );
}
