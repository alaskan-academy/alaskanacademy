import { cn } from '@/lib/utils';

/**
 * O símbolo "ak" da Alaskan, do manual da marca.
 *
 * Estava um ícone `Mountain` do lucide no lugar — desenho genérico de
 * biblioteca, sem relação com a identidade. Este é o traçado real, tirado do
 * arquivo `Prancheta 4.svg` do manual.
 *
 * `fill="currentColor"` e não o vermelho cravado: assim o símbolo assume a cor
 * de onde estiver. No manual ele aparece em vermelho (#BD1218) e em marinho
 * (#19255A), e aqui, sobre fundo escuro, quem manda é o contexto — vermelho na
 * marca da barra, branco quando estiver sobre cor cheia.
 *
 * O `viewBox` é o do arquivo original (600×600) com o retângulo invisível de
 * recorte mantido fora: sem ele o símbolo nasce descentralizado.
 */
export function MarcaAlaskan({ className }: { className?: string }) {
  return (
    <svg
      viewBox="40 40 520 520"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Alaskan"
      className={cn('shrink-0', className)}
      fill="currentColor"
    >
      <path d="M268.45,397.72q24.3-24.59,29.9-54.79V295.59q-5.62-30.22-29.9-54.82Q235.77,208.39,190,208.4q-46.09,0-78.63,32.37T78.81,319.26q0,45.75,32.54,78.32T190,430.12Q235.75,430.12,268.45,397.72Z" />
      <path d="M486.85,54.37h-29V228.63l49.82-61,37.79-46.32V113A58.61,58.61,0,0,0,486.85,54.37Z" />
      <polygon points="545.46 348 545.46 223.53 503.94 274.72 545.46 348" />
      <path d="M393.09,54.37h-282A58.63,58.63,0,0,0,52.49,113v94.24c3.77-4.56,7.81-9,12.15-13.31Q116.49,142.06,190,142.06q61.65,0,108.37,48V167.59h64.77V488.35H298.35V448.17Q251.62,496.44,190,496.44q-73.48,0-125.34-51.84c-4.34-4.33-8.38-8.74-12.15-13.3v57.4a58.62,58.62,0,0,0,58.63,58.61H393c.06-21.38.15-59.33.09-59.27Z" />
      <path d="M457.85,331.71V488h0v59.27h29a58.6,58.6,0,0,0,58.61-58.61v-5l-84.81-155.4Z" />
    </svg>
  );
}

/**
 * O logotipo completo: símbolo + "alaskan" na tipografia da marca.
 *
 * O manual usa Caviar Dreams no nome e Poppins Thin no descritivo. Caviar
 * Dreams não existe no Google Fonts e não vale um arquivo de fonte inteiro
 * para uma palavra; Poppins existe, é da própria identidade, e em peso leve
 * com as letras espaçadas chega bem perto do desenho original.
 *
 * O descritivo "MARKETING" fica de fora aqui: no manual ele é parte da
 * assinatura institucional, e dentro de um painel interno ele só ocuparia a
 * largura da barra sem dizer nada a quem já está logado.
 */
export function LogotipoAlaskan({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <MarcaAlaskan className="h-6 w-6 text-marca" />
      <span className="font-display text-lg font-light tracking-[0.02em] text-foreground">
        alaskan
      </span>
    </span>
  );
}
