import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

const CHAVE = 'notas_admin';

export function NotasTab() {
  const [text, setText]       = useState('');
  const [status, setStatus]   = useState<'idle' | 'saving' | 'saved'>('idle');
  const loaded                = useRef(false);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('configuracoes_texto')
        .select('valor')
        .eq('chave', CHAVE)
        .maybeSingle();
      setText(data?.valor ?? '');
      loaded.current = true;
    };
    load();
  }, []);

  const persist = async (value: string) => {
    setStatus('saving');
    await supabase
      .from('configuracoes_texto')
      .upsert({ chave: CHAVE, valor: value }, { onConflict: 'chave' });
    setStatus('saved');
    setTimeout(() => setStatus('idle'), 2500);
  };

  const handleChange = (value: string) => {
    if (!loaded.current) return;
    setText(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus('saving');
    timerRef.current = setTimeout(() => persist(value), 1000);
  };

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold">Notas</h3>
          <p className="text-xs text-muted-foreground">
            Anotações internas para o time administrativo. Salvo automaticamente.
          </p>
        </div>
        <span className="text-xs mt-1 text-muted-foreground min-w-[60px] text-right">
          {status === 'saving' && 'Salvando…'}
          {status === 'saved'  && '✓ Salvo'}
        </span>
      </div>

      <textarea
        className="w-full h-[520px] bg-card border border-border rounded-lg p-4 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary font-mono leading-relaxed placeholder:text-muted-foreground/50"
        placeholder={"Anotações, lembretes, decisões importantes…\n\nEx:\n- Reunião 10/06: definir meta Q3\n- Lembrar de revisar critérios de avaliação"}
        value={text}
        onChange={e => handleChange(e.target.value)}
      />
    </div>
  );
}
