import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Check, Loader2, X } from 'lucide-react';
import { toYMD } from '@/lib/recorrencia';
import type { Evento, TipoEvento } from '../types';

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const DIAS = [
  { n: 1, r: 'seg' }, { n: 2, r: 'ter' }, { n: 3, r: 'qua' },
  { n: 4, r: 'qui' }, { n: 5, r: 'sex' }, { n: 6, r: 'sáb' }, { n: 0, r: 'dom' },
];

interface Perfil { id: string; nome: string }

/**
 * Criar e editar evento.
 *
 * Quem não é admin só cadastra a própria folga — e isso é de propósito. A
 * tabela `editor_folgas` que existia antes tinha zero linhas justamente porque
 * dependia de alguém de fora registrar a folga dos outros. Quem sabe que vai
 * faltar é quem falta.
 */
export function EventoFormModal({
  aberto, evento, ehAdmin, userId, perfis, dataSugerida, onFechar, onSalvo,
}: {
  aberto: boolean;
  evento: Evento | null;
  ehAdmin: boolean;
  userId: string;
  perfis: Perfil[];
  dataSugerida: string | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const editando = !!evento;

  const [tipo, setTipo]     = useState<TipoEvento>(evento?.tipo ?? (ehAdmin ? 'reuniao' : 'folga'));
  const [titulo, setTitulo] = useState(evento?.titulo ?? '');
  const [data, setData]     = useState(evento?.data ?? dataSugerida ?? toYMD(new Date()));
  const [hIni, setHIni]     = useState(evento?.hora_inicio?.slice(0, 5) ?? '');
  const [hFim, setHFim]     = useState(evento?.hora_fim?.slice(0, 5) ?? '');
  const [call, setCall]     = useState(evento?.link_call ?? '');
  const [grav, setGrav]     = useState(evento?.link_gravacao ?? '');
  const [pauta, setPauta]   = useState(evento?.pauta ?? '');
  const [ata, setAta]       = useState(evento?.ata ?? '');
  const [pessoa, setPessoa] = useState(evento?.pessoa_id ?? userId);
  const [motivo, setMotivo] = useState(evento?.motivo ?? '');
  const [participantes, setParticipantes] = useState<string[]>(evento?.participantes ?? []);
  const [recTipo, setRecTipo] = useState(evento?.recorrencia_tipo ?? 'none');
  const [recDias, setRecDias] = useState<number[]>(evento?.recorrencia_dias_semana ?? []);
  const [recFim, setRecFim]   = useState(evento?.recorrencia_fim ?? '');
  const [puladas, setPuladas] = useState<string[]>(evento?.recorrencia_puladas ?? []);
  const [salvando, setSalvando] = useState(false);

  const ehReuniao = tipo === 'reuniao';
  const ehFolga   = tipo === 'folga';

  /** `2026-09-07` vira `7 de set` — a data crua não se lê de relance. */
  const formatarDia = (ymd: string) => {
    const d = new Date(ymd + 'T00:00:00');
    return `${d.getDate()} de ${MES_CURTO[d.getMonth()]}`;
  };

  const alternar = (lista: string[], id: string) =>
    lista.includes(id) ? lista.filter(x => x !== id) : [...lista, id];

  const salvar = async () => {
    const nome = ehFolga && !titulo.trim()
      ? `Folga — ${perfis.find(p => p.id === pessoa)?.nome ?? ''}`.trim()
      : titulo.trim();

    if (!nome) { toast({ title: 'Falta o título', variant: 'destructive' }); return; }
    if (!data) { toast({ title: 'Falta a data', variant: 'destructive' }); return; }

    setSalvando(true);
    const linha = {
      tipo,
      titulo: nome,
      data,
      hora_inicio: ehReuniao && hIni ? hIni : null,
      hora_fim:    ehReuniao && hFim ? hFim : null,
      link_call:     ehReuniao ? (call.trim() || null) : null,
      link_gravacao: ehReuniao ? (grav.trim() || null) : null,
      pauta: ehReuniao ? (pauta.trim() || null) : null,
      ata:   ehReuniao ? (ata.trim()   || null) : null,
      participantes: ehReuniao ? participantes : [],
      pessoa_id: ehFolga ? pessoa : null,
      motivo:    ehFolga ? (motivo.trim() || null) : null,
      recorrencia_tipo: recTipo === 'none' ? null : recTipo,
      recorrencia_dias_semana: recTipo === 'semanal' ? recDias : null,
      recorrencia_fim: recTipo === 'none' ? null : (recFim || null),
      /* Sem recorrência não há o que pular: a lista some junto com a série. */
      recorrencia_puladas: recTipo === 'none' ? [] : puladas,
      criado_por: userId,
    };

    const { error } = editando
      ? await supabase.from('eventos').update(linha).eq('id', evento!.id)
      : await supabase.from('eventos').insert(linha);

    setSalvando(false);

    if (error) {
      toast({ title: 'Não salvou', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: editando ? 'Evento atualizado' : 'Evento criado' });
    onSalvo();
  };

  return (
    <Dialog open={aberto} onOpenChange={v => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          {/* O botao que abre este modal diz "Registrar folga" para quem nao e
              admin; o titulo tem que dizer a mesma coisa. */}
          <DialogTitle className="text-base">
            {editando ? 'Editar evento' : ehAdmin ? 'Novo evento' : 'Registrar folga'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={tipo} onValueChange={v => setTipo(v as TipoEvento)} disabled={!ehAdmin}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reuniao">Reunião</SelectItem>
                  <SelectItem value="folga">Folga</SelectItem>
                  <SelectItem value="feriado">Feriado</SelectItem>
                  <SelectItem value="marco">Marco</SelectItem>
                </SelectContent>
              </Select>
              {!ehAdmin && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Você pode registrar a sua folga; reunião e feriado, quem cria é sócio.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Data</Label>
              <Input type="date" className="mt-1" value={data} onChange={e => setData(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Título{ehFolga && <span className="text-muted-foreground"> (opcional)</span>}</Label>
            <Input
              className="mt-1"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder={ehFolga ? 'Preenchido com o nome de quem folga' : 'Alinhamento de criativos'}
            />
          </div>

          {ehReuniao && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Começa</Label>
                  <Input type="time" className="mt-1" value={hIni} onChange={e => setHIni(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Termina</Label>
                  <Input type="time" className="mt-1" value={hFim} onChange={e => setHFim(e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs">Link da call</Label>
                <Input
                  className="mt-1"
                  value={call}
                  onChange={e => setCall(e.target.value)}
                  placeholder="https://meet.google.com/..."
                />
              </div>

              <div>
                <Label className="text-xs">Link da gravação</Label>
                <Input
                  className="mt-1"
                  value={grav}
                  onChange={e => setGrav(e.target.value)}
                  placeholder="cole depois da reunião"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Assim que a data passa, é a gravação que ganha o destaque na tela — o link da call
                  vira referência.
                </p>
              </div>

              {/*
                Lista com marcação, e não bolinhas soltas.

                Como chips, marcado e desmarcado eram a mesma forma com um tom
                de fundo de diferença — para saber quem estava na reunião era
                preciso comparar cor com cor. Um quadradinho marcado responde de
                relance, e o "todos / ninguém" evita seis cliques para o caso
                mais comum, que é a reunião com a equipe inteira.
              */}
              <div>
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs">Quem participa</Label>
                  <span className="text-[11px] text-muted-foreground">
                    {participantes.length === 0
                      ? 'ninguém marcado'
                      : `${participantes.length} de ${perfis.length}`}
                    {perfis.length > 0 && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={() => setParticipantes(
                            participantes.length === perfis.length ? [] : perfis.map(x => x.id),
                          )}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {participantes.length === perfis.length ? 'ninguém' : 'todos'}
                        </button>
                      </>
                    )}
                  </span>
                </div>

                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-border">
                  {perfis.map((p, i) => {
                    const marcado = participantes.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setParticipantes(l => alternar(l, p.id))}
                        aria-pressed={marcado}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                          i > 0 && 'border-t border-border/50',
                          marcado ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/50',
                        )}
                      >
                        <span className={cn(
                          'grid h-4 w-4 shrink-0 place-items-center rounded border',
                          marcado ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                        )}>
                          {marcado && <Check className="h-3 w-3" />}
                        </span>
                        {p.nome}
                      </button>
                    );
                  })}
                  {perfis.length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted-foreground">Ninguém cadastrado ainda.</p>
                  )}
                </div>
              </div>

              <div>
                <Label className="text-xs">Pauta</Label>
                <Textarea
                  className="mt-1 min-h-[80px] font-mono text-xs"
                  value={pauta}
                  onChange={e => setPauta(e.target.value)}
                  placeholder={'- o que precisa ser decidido\n- o que ficou pendente da última'}
                />
              </div>

              <div>
                <Label className="text-xs">Ata</Label>
                <Textarea
                  className="mt-1 min-h-[80px] font-mono text-xs"
                  value={ata}
                  onChange={e => setAta(e.target.value)}
                  placeholder="o que ficou combinado — escrever depois"
                />
              </div>
            </>
          )}

          {ehFolga && (
            <>
              <div>
                <Label className="text-xs">De quem</Label>
                <Select value={pessoa} onValueChange={setPessoa} disabled={!ehAdmin}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent>
                    {perfis.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Motivo</Label>
                <Input className="mt-1" value={motivo} onChange={e => setMotivo(e.target.value)} />
              </div>
            </>
          )}

          {/* ---- recorrência ---- */}
          <div className="rounded-lg border border-border p-3">
            <Label className="text-xs">Se repete</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-3">
              <Select value={recTipo} onValueChange={setRecTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não se repete</SelectItem>
                  <SelectItem value="diario">Todo dia</SelectItem>
                  <SelectItem value="semanal">Toda semana</SelectItem>
                  <SelectItem value="mensal">Todo mês</SelectItem>
                </SelectContent>
              </Select>
              {/*
                O campo não dizia o que era.

                Ele é o FIM da série — a data de começo é a do evento, lá em
                cima. Como `type="date"` não mostra `placeholder`, o campo
                aparecia como "dd/mm/aaaa" puro ao lado de "Todo dia", e não
                havia como saber se aquilo era começar ou parar.
              */}
              {recTipo !== 'none' && (
                <div>
                  <Label className="text-[11px] text-muted-foreground">Repete até</Label>
                  <Input
                    type="date"
                    className="mt-1"
                    value={recFim}
                    min={data || undefined}
                    onChange={e => setRecFim(e.target.value)}
                  />
                </div>
              )}
            </div>

            {recTipo === 'semanal' && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {DIAS.map(d => (
                  <button
                    key={d.n}
                    type="button"
                    onClick={() => setRecDias(l => l.includes(d.n) ? l.filter(x => x !== d.n) : [...l, d.n])}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
                      recDias.includes(d.n)
                        ? 'border-primary bg-primary/15 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {d.r}
                  </button>
                ))}
              </div>
            )}

            {recTipo !== 'none' && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Começa em {data ? formatarDia(data) : 'na data acima'}
                {recFim ? ` e para em ${formatarDia(recFim)}` : ' e não tem fim marcado'}.
                Para pular um dia solto, abra aquele dia na agenda.
              </p>
            )}

            {/*
              Os dias pulados moram aqui porque não há outro lugar: pulado, o
              dia some da agenda, e não haveria por onde trazê-lo de volta.
            */}
            {puladas.length > 0 && (
              <div className="mt-2.5">
                <Label className="text-[11px] text-muted-foreground">Dias pulados</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[...puladas].sort().map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPuladas(l => l.filter(x => x !== d))}
                      title="Trazer este dia de volta"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-destructive/40 hover:text-foreground"
                    >
                      {formatarDia(d)} <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onFechar} disabled={salvando}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editando ? 'Salvar' : 'Criar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
