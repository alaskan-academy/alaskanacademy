import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sem acento e em minúsculas — a normalização de toda busca da casa.
 *
 * É a mesma da coluna `busca` de `vw_mapa_revs` (`unaccent(lower(...))`), e
 * precisa ser: os nomes daqui têm acento — "Workshop Buquê de Velas", "Pós
 * Venda 01", "Saponária" — e quem digita no campo digita "buque" e "pos". Sem
 * isto a busca não acha, e quem buscou conclui que o registro sumiu em vez de
 * concluir que errou o acento.
 *
 * Mora aqui por causa da primeira armadilha do CLAUDE.md. Havia **14 cópias**
 * desta mesma expressão espalhadas pelo `src/` em 10/10/2026, e eu ia
 * escrever a décima quinta ao lado da de `MapaTab.tsx` — no mesmo diretório.
 * Duas cópias da mesma regra divergem: basta alguém ajustar o intervalo de
 * combinantes num arquivo e a busca de uma tela passa a achar o que a outra
 * não acha, sem nada denunciando.
 *
 * As duas do `src/features/funis/` passaram a ler daqui. As outras doze
 * continuam onde estavam — trazê-las é limpeza própria, não carona nesta.
 *
 * O intervalo vai escrito como `̀-ͯ` e não com os combinantes
 * literais de propósito: caractere combinante solto no código-fonte é
 * invisível no editor e já foi embaralhado por ferramenta neste repositório.
 */
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
