import { useEffect, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useFilters } from '@/contexts/FilterContext';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

/**
 * Em qual empresa eu estou.
 *
 * POR QUE NO CABEÇALHO, E NÃO NA FILA DE FILTROS
 *
 * A regra da casa: a sidebar diz onde eu vou, o cabeçalho diz quem eu sou, e os
 * filtros ficam no corpo porque recortam o conteúdo logo abaixo. Empresa não
 * recorta um conteúdo — ela troca a operação inteira. Período e conta são
 * perguntas sobre um dado; empresa é sobre de quem é o dado.
 *
 * E tem a razão prática, que sozinha já bastaria: o Financeiro passa
 * `hideFilters`. Na fila de filtros, o seletor sumiria justamente na área onde
 * a separação mais importa — a que vai para a contabilidade.
 *
 * SÓ APARECE COM MAIS DE UMA EMPRESA ATIVA
 *
 * Com uma só, um seletor de uma opção é ruído ocupando a barra.
 *
 * A COR
 *
 * Cada empresa tem um ponto de 6px com a cor da marca dela, e é o único lugar
 * do painel onde essas duas cores aparecem. O nome continua escrito ao lado: a
 * cor não substitui a leitura, ela evita ter que ler toda vez.
 *
 * Os valores vivem em `--empresa-<slug>` no `index.css`, com o porquê de o
 * vermelho da Alaskan ser a exceção da regra de cores. Aqui dentro não há hex.
 */

interface Empresa {
  id: string;
  nome: string;
  /** Escolhe o token de cor em index.css: `--empresa-<slug>`. */
  slug: string | null;
}

/**
 * O ponto da empresa.
 *
 * A cor vem de `--empresa-<slug>` em index.css — nunca de hex aqui dentro. O
 * `var()` leva FALLBACK: empresa nova sem token cadastrado ganha um ponto
 * neutro em vez de um ponto invisível, e sem precisar de uma lista de slugs
 * conhecidos no código, que é o tipo de lista que envelhece calada.
 */
function PontoDaEmpresa({ slug }: { slug: string | null }) {
  if (!slug) return null;
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: `hsl(var(--empresa-${slug}, var(--muted-foreground)))` }}
    />
  );
}

export function SeletorEmpresa() {
  const { empresaId, setEmpresaId } = useFilters();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [aberto, setAberto] = useState(false);

  /* Da tabela, e não de uma lista no código: lista escrita à mão envelhece
     calada na primeira empresa nova — e este projeto já perdeu R$ 10.065 num
     DRE por causa de uma. */
  useEffect(() => {
    let ativo = true;
    supabase.from('empresas').select('id,nome,slug').eq('ativo', true).order('nome')
      .then(({ data }) => { if (ativo) setEmpresas((data as Empresa[]) ?? []); });
    return () => { ativo = false; };
  }, []);

  /* Empresa que saiu do ar não pode continuar filtrando em silêncio: a tela
     ficaria vazia sem dizer por quê. */
  useEffect(() => {
    if (!empresaId || empresas.length === 0) return;
    if (!empresas.some(e => e.id === empresaId)) setEmpresaId(null);
  }, [empresas, empresaId, setEmpresaId]);

  if (empresas.length <= 1) return null;

  /* "Ambas", nunca "Todas": "todas" soa como ausência de filtro. "Ambas" avisa
     que há mais de uma operação ali dentro, que é o que importa saber antes de
     olhar um número somado. */
  const atual = empresaId ? empresas.find(e => e.id === empresaId) : undefined;
  const rotulo = empresaId ? (atual?.nome ?? "Empresa") : "Ambas";

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1.5 text-xs font-medium',
            empresaId && 'border-primary/50 text-primary',
          )}
        >
          {/* O ponto SUBSTITUI o ícone quando há empresa escolhida: dois
              símbolos lado a lado no mesmo chip seria um a mais do que a
              pergunta tem resposta. */}
          {atual ? <PontoDaEmpresa slug={atual.slug} /> : <Building2 className="h-3.5 w-3.5" />}
          {/* No celular fica só o ícone: a barra tem 14 de altura e já carrega
              busca, sino e conta. O nome volta a partir de `sm`. */}
          <span className="hidden max-w-[150px] truncate sm:inline">{rotulo}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto min-w-[200px] p-0" align="end">
        <button
          onClick={() => { setEmpresaId(null); setAberto(false); }}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent',
            !empresaId && 'bg-accent font-semibold text-accent-foreground',
          )}
        >
          <Check className={cn('h-3.5 w-3.5', empresaId && 'invisible')} />
          Ambas
        </button>

        {/* Escolha única: dinheiro de duas empresas somado num número só não é
            um total, é um erro. */}
        {empresas.map(e => (
          <button
            key={e.id}
            onClick={() => { setEmpresaId(e.id); setAberto(false); }}
            className={cn(
              'flex w-full items-center gap-2 border-t border-border/40 px-3 py-2 text-left text-xs hover:bg-accent',
              empresaId === e.id && 'bg-accent font-semibold text-accent-foreground',
            )}
          >
            <Check className={cn("h-3.5 w-3.5", empresaId !== e.id && "invisible")} />
            <PontoDaEmpresa slug={e.slug} />
            <span className="truncate">{e.nome}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
