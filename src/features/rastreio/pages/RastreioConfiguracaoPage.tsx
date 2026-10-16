import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CircleSlash } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/lib/supabase";
import { formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { RastreioNav } from "../components/RastreioNav";

/**
 * Configuração — o que o prompt do curso chama de "CREDENCIAIS PELO PAINEL".
 *
 * ── Ela LÊ e não escreve, e isso é escolha ──────────────────────────────
 *
 * O curso pede "adicionar / editar / remover cada conta". Aqui ela só mostra:
 * o que existe hoje são três produtos e um pixel, mexidos uma vez por mês no
 * máximo, e uma tela de edição para isso seria cadastro sem resultado ao
 * lado — a segunda armadilha. Quando houver a segunda empresa e a terceira
 * conta, a edição se justifica; hoje um `update` resolve e a tela que falta
 * é a que diz se está tudo ligado.
 *
 * ── O bloco que o curso NÃO pede e que vale mais ────────────────────────
 *
 * "Produto que vendeu e não tem pixel". Ele tem de ficar vazio. Se aparecer
 * alguém ali, são vendas que não chegam à Meta — em silêncio, porque o
 * dashboard continua certo e só a campanha emagrece.
 *
 * ── E o expurgo, que a política publicada promete ───────────────────────
 *
 * `/privacidade` afirma 14 dias. Se o cron parar, a página passa a mentir e
 * ninguém fica sabendo. A linha aqui é a prova de que ele rodou.
 */

interface LinhaPixel {
  product_code: string;
  envia_meta: boolean;
  projeto_id: string | null;
  pixel_label: string | null;
  pixel_id: string | null;
  pixel_ativo: boolean | null;
  /* A empresa DERIVA do projeto e é lida agora, nunca guardada aqui — ver
     `20261016e`. Vem pela vista e não por embed porque o PostgREST não segue
     chave estrangeira que atravessa schema (`20261016i`). */
  empresa_nome: string | null;
}

interface LinhaSettings {
  capi_ativa: boolean;
  test_event_code: string | null;
  currency: string;
}

interface LinhaSemPixel {
  product_code: string | null;
  produto_nome: string | null;
  compras: number;
}

interface Expurgo {
  mais_antigo_com_payload: string | null;
  ja_expurgados: number;
}

function Selo({ ok, sim, nao }: { ok: boolean; sim: string; nao: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium",
        ok ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <CircleSlash className="h-3 w-3" />}
      {ok ? sim : nao}
    </span>
  );
}

export default function RastreioConfiguracaoPage() {
  const [pixels, setPixels] = useState<LinhaPixel[]>([]);
  const [settings, setSettings] = useState<LinhaSettings | null>(null);
  const [semPixel, setSemPixel] = useState<LinhaSemPixel[]>([]);
  const [expurgo, setExpurgo] = useState<Expurgo | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const t = supabase.schema("tracking");

    const [p, s, c, e] = await Promise.all([
      t
        .from("vw_pixel_produtos")
        .select("product_code,envia_meta,projeto_id,pixel_label,pixel_id,pixel_ativo,empresa_nome")
        .order("product_code"),
      t.from("settings").select("capi_ativa,test_event_code,currency").limit(1),
      /* Produto que vendeu e não está mapeado: a pergunta é sobre COMPRA, não
         sobre cadastro, então sai de `purchases` e não de `pixel_produtos`. */
      t.from("purchases").select("produto_code,produto_nome").eq("status", "paid"),
      t.from("events_log").select("criado_em,expurgado_em").not("payload_meta", "is", null).order("criado_em").limit(1),
    ]);

    const falhou = [p, s, c, e].find((r) => r.error);
    if (falhou?.error) {
      console.error("rastreio/config:", falhou.error.message);
      setErro(falhou.error.message);
      setLoading(false);
      return;
    }

    const mapeados = new Set(((p.data ?? []) as LinhaPixel[]).map((l) => l.product_code));
    const porCodigo = new Map<string, LinhaSemPixel>();
    for (const l of (c.data ?? []) as { produto_code: string | null; produto_nome: string | null }[]) {
      if (!l.produto_code || mapeados.has(l.produto_code)) continue;
      const atual = porCodigo.get(l.produto_code) ?? {
        product_code: l.produto_code,
        produto_nome: l.produto_nome,
        compras: 0,
      };
      atual.compras += 1;
      porCodigo.set(l.produto_code, atual);
    }

    const { count: expurgados } = await t
      .from("events_log")
      .select("id", { count: "exact", head: true })
      .not("expurgado_em", "is", null);

    setErro(null);
    setPixels((p.data ?? []) as LinhaPixel[]);
    setSettings(((s.data ?? [])[0] ?? null) as LinhaSettings | null);
    setSemPixel([...porCodigo.values()].sort((a, b) => b.compras - a.compras));
    setExpurgo({
      mais_antigo_com_payload: ((e.data ?? [])[0] as { criado_em?: string } | undefined)?.criado_em ?? null,
      ja_expurgados: expurgados ?? 0,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const diasDoMaisAntigo = expurgo?.mais_antigo_com_payload
    ? Math.floor((Date.now() - new Date(expurgo.mais_antigo_com_payload).getTime()) / 86_400_000)
    : null;

  return (
    <DashboardLayout title="Rastreio" hideTitle>
      <RastreioNav />

      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground animate-pulse">Carregando…</div>
      ) : erro ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Não foi possível ler a configuração</p>
            <p className="mt-1 text-xs text-muted-foreground">{erro}</p>
          </div>
          <button
            onClick={carregar}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-secondary"
          >
            Tentar de novo
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── A chave geral ─────────────────────────────────────── */}
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-medium text-foreground">O envio para a Meta</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Conversions API</dt>
                <dd>
                  <Selo ok={settings?.capi_ativa ?? false} sim="Ligada" nao="Desligada" />
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Código de teste</dt>
                <dd>
                  {settings?.test_event_code ? (
                    <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                      {settings.test_event_code}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">nenhum — produção</span>
                  )}
                </dd>
              </div>
            </dl>
            {/* Em vermelho de propósito: com um código de teste preenchido e
                uma sessão de Test Events ABERTA, a venda de verdade cai lá e
                NÃO conta. Foi medido em 14/10, no caminho contrário: o código
                vencido não bloqueia nada e o evento vai para produção. */}
            {settings?.test_event_code && (
              <p className="mt-3 text-[11px] text-destructive">
                Com um código de teste preenchido, a conversão real pode cair em Test Events e não contar.
                Ele só deve existir durante uma validação, com a aba do Gerenciador aberta.
              </p>
            )}
            {!settings?.capi_ativa && (
              <p className="mt-3 text-[11px] text-destructive">
                Com a chave desligada nenhuma compra chega à Meta. Desde a saída da UTMify, ninguém mais
                manda por nós — cada venda nesse estado é conversão perdida.
              </p>
            )}
          </div>

          {/* ── Produto que vendeu e não tem pixel ────────────────── */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-foreground">Produto sem pixel</h2>
              <span className="text-xs text-muted-foreground">tem de ficar vazio</span>
            </div>
            {semPixel.length === 0 ? (
              <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Todo produto que vendeu está mapeado.
              </p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <tbody>
                    {semPixel.map((l) => (
                      <tr key={l.product_code} className="border-b border-border/50 last:border-0">
                        <td className="py-2 font-mono text-xs text-destructive">{l.product_code}</td>
                        <td className="py-2 text-foreground">{l.produto_nome ?? "—"}</td>
                        <td className="py-2 text-right text-muted-foreground">
                          {formatNumber(l.compras)} compra(s)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[11px] text-destructive">
                  Estas vendas não chegam à Meta, e nada mais avisa: o dashboard continua certo e só a
                  campanha emagrece. Mapear em <code>tracking.pixel_produtos</code>.
                </p>
              </>
            )}
          </div>

          {/* ── Produto × pixel ───────────────────────────────────── */}
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-medium text-foreground">Para qual pixel vai cada produto</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 text-left font-semibold">Produto</th>
                  <th className="pb-2 text-left font-semibold">Pixel</th>
                  <th className="pb-2 text-left font-semibold">Empresa</th>
                  <th className="pb-2 text-right font-semibold">Envia</th>
                </tr>
              </thead>
              <tbody>
                {pixels.map((l) => (
                  <tr key={l.product_code} className="border-b border-border/50 last:border-0">
                    <td className="py-2 font-mono text-xs text-foreground">{l.product_code}</td>
                    <td className="py-2 text-muted-foreground">
                      {l.pixel_label ?? "—"}
                      {l.pixel_id && (
                        <span className="ml-1.5 font-mono text-[10px] opacity-60">{l.pixel_id}</span>
                      )}
                    </td>
                    {/* Empresa e envio são perguntas DIFERENTES, e misturá-las
                        mentia: `fn_capi_do_produto` não olha o projeto, então
                        um produto sem empresa envia à Meta normalmente. Numa
                        coluna só, "Sem projeto" aparecia no lugar de "envia?"
                        e lia-se como "não envia". */}
                    <td className="py-2 text-muted-foreground">
                      {l.empresa_nome ?? <span className="text-destructive">sem projeto</span>}
                    </td>
                    <td className="py-2 text-right">
                      <Selo ok={Boolean(l.envia_meta && l.pixel_ativo)} sim="Sim" nao="Não" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pixels.some((l) => !l.projeto_id) && (
              <p className="mt-3 text-[11px] text-destructive">
                Produto sem projeto envia à Meta igual, mas nasce sem empresa: a compra dele aparece como
                “sem empresa” na Visão geral, em vez de sumir. Apontar o projeto em{" "}
                <code>tracking.pixel_produtos</code>.
              </p>
            )}
          </div>

          {/* ── A retenção que a política promete ─────────────────── */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-medium text-foreground">A limpeza de 14 dias</h2>
              <span className="text-xs text-muted-foreground">a política publicada promete isto</span>
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Evento mais antigo ainda com payload</dt>
                <dd className={cn("text-foreground", (diasDoMaisAntigo ?? 0) > 14 && "text-destructive")}>
                  {diasDoMaisAntigo === null ? "nenhum" : `${diasDoMaisAntigo} dia(s)`}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Já expurgados</dt>
                <dd className="text-foreground">{formatNumber(expurgo?.ja_expurgados ?? 0)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {diasDoMaisAntigo !== null && diasDoMaisAntigo > 14
                ? "Passou de 14 dias: o cron parou, e a página de privacidade está afirmando um prazo que não está sendo cumprido."
                : "O cron roda às 4h40 e zera só os campos pesados — a linha fica, com data, evento, UTMs e geo."}
            </p>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
