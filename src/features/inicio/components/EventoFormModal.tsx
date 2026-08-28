import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Calendar as CalendarIcon, Check, ChevronRight, Loader2, X } from 'lucide-react';
import { toYMD, daYMD } from '@/lib/recorrencia';
import { TIPOS_EVENTO, type Evento, type TipoEvento } from '../types';

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
  const [dataFim, setDataFim] = useState(evento?.data_fim ?? '');
  const [calAberto, setCalAberto] = useState(false);
  /** Verdadeiro entre o clique do primeiro dia e o do ultimo. */
  const [escolhendoFim, setEscolhendoFim] = useState(false);
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
  const [verPuladas, setVerPuladas] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const ehReuniao = tipo === 'reuniao';
  const ehFolga   = tipo === 'folga';

  /** `2026-09-07` vira `7 de set` — a data crua não se lê de relance. */
  const formatarDia = (ymd: string) => {
    const d = new Date(ymd + 'T00:00:00');
    return `${d.getDate()} de ${MES_CURTO[d.getMonth()]}`;
  };

  /**
   * O período escrito como uma pessoa escreveria.
   *
   * O ano só aparece quando não é o ano corrente. Escrito por extenso dos dois
   * lados, "30 de ago de 2026 a 1 de set de 2026" não cabe na metade da linha e
   * o campo trunca justo no fim, que é a parte que interessa — e ninguém diz o
   * ano quando fala do feriado da semana que vem.
   */
  const rotuloPeriodo = (() => {
    if (!data) return 'Escolher o dia';

    const anoAtual = new Date().getFullYear();
    const dia  = (d: Date) => `${d.getDate()} de ${MES_CURTO[d.getMonth()]}`;
    const ano  = (d: Date) => (d.getFullYear() === anoAtual ? '' : ` de ${d.getFullYear()}`);

    const de = daYMD(data);
    if (!dataFim) return dia(de) + ano(de);

    const ate = daYMD(dataFim);
    const mesmoAno = de.getFullYear() === ate.getFullYear();

    if (mesmoAno && de.getMonth() === ate.getMonth()) return `${de.getDate()} a ${dia(ate)}${ano(ate)}`;
    if (mesmoAno) return `${dia(de)} a ${dia(ate)}${ano(ate)}`;
    return `${dia(de)}${ano(de)} a ${dia(ate)}${ano(ate)}`;
  })();

  /**
   * Dois cliques: o primeiro é o começo, o segundo é o fim.
   *
   * Contando os cliques na mão, e não pelo `onSelect` do react-day-picker.
   * O `onSelect` do modo intervalo não recomeça: com um período já escolhido,
   * clicar num dia qualquer ele entende como "arrastar uma das pontas", então
   * abrir um evento de 30/8 a 1/9 e clicar no dia 10 dava "10 de ago a 1 de
   * set" — um período que ninguém pediu e que já fechava o calendário.
   *
   * Aqui o primeiro clique sempre começa de novo, e enquanto o segundo não
   * vier o evento é de um dia só. Quem quer um dia só clica uma vez e fecha,
   * que foi exatamente como ela descreveu.
   */
  const clicarNoDia = (d: Date) => {
    const ymd = toYMD(d);

    if (!escolhendoFim) {
      setData(ymd);
      setDataFim('');
      setEscolhendoFim(true);
      return;
    }

    // Clicar antes do começo não é erro: é a mesma escolha ao contrário.
    if (ymd < data) { setDataFim(data); setData(ymd); }
    else if (ymd > data) { setDataFim(ymd); }
    else { setDataFim(''); }

    setEscolhendoFim(false);
    setCalAberto(false);
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
      data_fim: dataFim || null,
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
      /*
        Evento de um dia e sem repetição não tem o que pular: a lista some
        junto. Com período, ela fica — dá para tirar um dia do meio de um
        feriado emendado sem desmanchar o resto.
      */
      recorrencia_puladas: recTipo === 'none' && !dataFim ? [] : puladas,
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
                  {TIPOS_EVENTO.map(t => (
                    <SelectItem key={t.chave} value={t.chave}>{t.rotulo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!ehAdmin && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Você pode registrar a sua folga; reunião e feriado, quem cria é sócio.
                </p>
              )}
            </div>
            {/*
              Um calendário, e não dois campos de data.

              Feriado emendado e folga de uma semana eram um evento por dia,
              digitados um a um e sem nada ligando um ao outro — apagar "as
              férias" era apagar sete linhas e lembrar das sete. Aqui é uma
              linha só: clica no primeiro dia, clica no último, pronto. Um
              clique só continua sendo um dia só, que é a esmagadora maioria
              dos casos e por isso não custa nada a mais.
            */}
            <div>
              <Label className="text-xs">Quando</Label>
              <Popover open={calAberto} onOpenChange={v => { setCalAberto(v); setEscolhendoFim(false); }}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="mt-1 flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground hover:bg-muted/40"
                  >
                    <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{rotuloPeriodo}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    locale={ptBR}
                    numberOfMonths={1}
                    defaultMonth={data ? daYMD(data) : undefined}
                    selected={data ? { from: daYMD(data), to: dataFim ? daYMD(dataFim) : undefined } : undefined}
                    onDayClick={clicarNoDia}
                  />
                  <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                    {escolhendoFim
                      ? 'Agora clique no último dia — ou feche, e fica só este.'
                      : dataFim
                        ? (
                            <button
                              type="button"
                              onClick={() => setDataFim('')}
                              className="hover:text-foreground"
                            >
                              Voltar a ser um dia só
                            </button>
                          )
                        : 'Clique no primeiro dia e depois no último.'}
                  </div>
                </PopoverContent>
              </Popover>
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
            {/*
              Um rótulo por campo, e não um só em cima dos dois.

              Com "Se repete" solto no alto, a coluna da esquerda começava na
              primeira linha e a da direita uma linha abaixo, empurrada pelo
              próprio rótulo — os dois campos ficavam em alturas diferentes.
              Rotulando cada um, as duas colunas têm a mesma estrutura e se
              alinham sozinhas.
            */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Se repete</Label>
                <Select value={recTipo} onValueChange={setRecTipo}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não se repete</SelectItem>
                    <SelectItem value="diario">Todo dia</SelectItem>
                    <SelectItem value="semanal">Toda semana</SelectItem>
                    <SelectItem value="mensal">Todo mês</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/*
                O campo da data não dizia o que era.

                Ele é o FIM da série — a data de começo é a do evento, lá em
                cima. Como `type="date"` não mostra `placeholder`, o campo
                aparecia como "dd/mm/aaaa" puro ao lado de "Todo dia", e não
                havia como saber se aquilo era começar ou parar.
              */}
              {recTipo !== 'none' && (
                <div>
                  <Label className="text-xs">Repete até</Label>
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

              Ficam fechados. Uma reunião semanal que roda o ano inteiro junta
              feriado, férias e semana cancelada — daqui a um ano são dezenas de
              chips, e a lista aberta empurraria o resto do formulário para
              fora da tela por uma informação que quase nunca se mexe. Fechado,
              a contagem já responde "tem dia pulado?", que é a pergunta comum;
              quem precisa desfazer abre.
            */}
            {puladas.length > 0 && (
              <div className="mt-2.5">
                <button
                  type="button"
                  onClick={() => setVerPuladas(v => !v)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className={cn('h-3 w-3 transition-transform', verPuladas && 'rotate-90')} />
                  {puladas.length === 1 ? '1 dia pulado' : `${puladas.length} dias pulados`}
                </button>

                {verPuladas && (
                  <div className="mt-1.5 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
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
                )}
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
