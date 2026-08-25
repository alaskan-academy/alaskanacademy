import { supabase } from '@/lib/supabase';

/**
 * Envio de documento fiscal: sobe o arquivo, grava a linha, e não deixa
 * arquivo órfão quando a segunda parte falha.
 *
 * Existe porque o caminho contrário aconteceu de verdade. O upload subia, o
 * `upsert` da linha estourava em `42P10`, a tela dizia só "não foi possível
 * enviar" e o arquivo ficava no Storage sem nenhuma linha apontando para ele —
 * invisível na tela, invisível no Drive, e ocupando espaço. Só descobrimos ao
 * listar o bucket: quatro NFs em `ferramentas/2026-08` sem dono.
 */

/** O que o Supabase devolve, traduzido para algo que se possa agir a respeito.
 *
 *  As mensagens cruas são escritas para quem escreve o código, não para quem
 *  está com a nota na mão: "there is no unique or exclusion constraint matching
 *  the ON CONFLICT specification" não diz a ninguém o que fazer em seguida. */
export function mensagemDeEnvio(err: unknown): string {
  // `String(err)` não serve: o erro do Supabase (`PostgrestError`, `StorageError`)
  // é um objeto simples, não um `Error`, e vira o inútil "[object Object]" —
  // que é justamente o tipo de mensagem que esta função existe para eliminar.
  // Peguei isso ao testar a própria função.
  const bruto = err instanceof Error
    ? err.message
    : (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : String(err));

  const codigo = (err as { statusCode?: string; code?: string })?.code
              ?? (err as { statusCode?: string })?.statusCode
              ?? '';

  if (/row-level security|violates row-level/i.test(bruto)) {
    return 'Seu usuário não tem permissão para gravar aqui. Peça à administração para liberar.';
  }
  if (/exceeded the maximum allowed size|Payload too large/i.test(bruto) || String(codigo) === '413') {
    return 'O arquivo é grande demais. Envie um PDF menor.';
  }
  if (/no unique or exclusion constraint/i.test(bruto)) {
    // Defeito de programação, não erro de uso. Diz isso em vez de fingir que a
    // pessoa fez algo errado.
    return 'Falha interna ao gravar o registro. Avise quem cuida do sistema — não é nada que você tenha feito.';
  }
  if (/Failed to fetch|NetworkError/i.test(bruto)) {
    return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  }
  return bruto;
}

/** `true` se o caminho já tem arquivo. Usado para saber se um envio que falhou
 *  no meio pode limpar o que subiu: se já existia coisa ali, o arquivo é de um
 *  envio anterior que deu certo, e apagá-lo destruiria a nota boa. */
async function jaExiste(caminho: string): Promise<boolean> {
  const corte = caminho.lastIndexOf('/');
  const pasta = caminho.slice(0, corte);
  const nome = caminho.slice(corte + 1);
  const { data } = await supabase.storage.from('documentos').list(pasta, { search: nome });
  return (data ?? []).some(f => f.name === nome);
}

/**
 * Sobe o arquivo e grava a linha como uma coisa só.
 *
 * `gravarLinha` recebe o caminho e devolve o erro do banco, ou null. Se ele
 * falhar depois de o arquivo ter subido, o arquivo é removido — a menos que já
 * existisse antes, caso em que o que está lá é a versão anterior e deve ficar.
 */
export async function enviarDocumento(
  caminho: string,
  arquivo: File,
  gravarLinha: (caminho: string) => Promise<{ message: string } | null>,
): Promise<void> {
  const existiaAntes = await jaExiste(caminho);

  const { error: erroUpload } = await supabase.storage
    .from('documentos')
    .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type });
  if (erroUpload) throw erroUpload;

  const erroLinha = await gravarLinha(caminho);
  if (erroLinha) {
    // Desfaz o que este envio criou. Sem isto o arquivo ficaria no bucket sem
    // nenhuma linha apontando para ele.
    if (!existiaAntes) await supabase.storage.from('documentos').remove([caminho]);
    throw erroLinha;
  }
}
