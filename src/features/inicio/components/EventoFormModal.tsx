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
import { Loader2 } from 'lucide-react';
import { toYMD } from '@/lib/recorrencia';
import type { Evento, TipoEvento } from '../types';

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
  const [salvando, setSalvando] = useState(false);

  const ehReuniao = tipo === 'reuniao';
  const ehFolga   = tipo === 'folga';

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
          <DialogTitle className="text-base">{editando ? 'Editar evento' : 'Novo evento'}</DialogTitle>
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

              <div>
                <Label className="text-xs">Quem participa</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {perfis.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setParticipantes(l => alternar(l, p.id))}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        participantes.includes(p.id)
                          ? 'border-primary bg-primary/15 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {p.nome}
                    </button>
                  ))}
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
              {recTipo !== 'none' && (
                <Input
                  type="date"
                  value={recFim}
                  onChange={e => setRecFim(e.target.value)}
                  placeholder="até quando"
                />
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
                Ainda não dá para pular uma ocorrência específica — se a reunião de uma semana não
                acontecer, ela continua aparecendo.
              </p>
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
