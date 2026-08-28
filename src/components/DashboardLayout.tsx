import { ReactNode, useEffect } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import GlobalFilters from '@/components/GlobalFilters';
import { NotificacoesPopover } from '@/components/NotificacoesPopover';
import { ContaMenu } from '@/components/ContaMenu';
import { IngestStatusBanner } from '@/components/IngestStatusBanner';
import { useSidebarState } from '@/contexts/SidebarContext';
import { useAuth } from '@/contexts/AuthContext';
import { Menu, Search } from 'lucide-react';

export function DashboardLayout({
  children,
  title,
  hideFilters,
  hideTitle,
  hideAvisos,
}: {
  children: ReactNode;
  title: string;
  /**
   * Não renderiza a faixa de filtros global.
   *
   * Dois casos legítimos, e só eles: a tela não lê `useFilters` (a maioria), ou
   * a tela oferece os mesmos controles no corpo, em outro arranjo — é o Resumo,
   * que junta conta e período com o segmento e o Atualizar numa linha só.
   *
   * O que este prop NÃO pode fazer é esconder o seletor deixando o filtro
   * ativo. Já aconteceu aqui: a página filtrava por conta e não havia controle
   * nenhum na tela, então ela mostrava um recorte que ninguém tinha escolhido e
   * ninguém conseguia desfazer.
   */
  hideFilters?: boolean;
  /**
   * Esconde o nome da tela no cabeçalho — no computador.
   *
   * Quem já diz onde você está é a sidebar, a dois centímetros dali. Repetir o
   * nome ao lado dela gasta a barra fixa para não dizer nada de novo, e é por
   * isso que hoje TODAS as telas passam este prop.
   *
   * No celular a sidebar fica fechada atrás do ☰, e aí o título é a única
   * coisa que nomeia a tela: lá ele continua aparecendo.
   *
   * O `title` segue obrigatório, e agora é verdade que ele nomeia a aba do
   * navegador — antes o comentário aqui dizia isso e ninguém tinha escrito a
   * linha que faz acontecer.
   */
  hideTitle?: boolean;
  /** O Início traz os mesmos avisos num painel completo; a faixa aqui seria a
   *  mesma informação duas vezes na mesma tela. */
  hideAvisos?: boolean;
}) {
  const { collapsed, isMobile, toggle } = useSidebarState();
  const { user } = useAuth();

  /*
    O nome da tela na aba do navegador.

    A aba dizia "Alaskan Dashboard" em todas as telas, vindo do `index.html`.
    Com uma dúzia de abas abertas — que é como esta ferramenta é usada — nenhuma
    delas dizia qual era qual, e o histórico e os favoritos guardavam doze
    entradas com o mesmo nome.

    Ficou óbvio ao esconder o título do cabeçalho: o `title` passou a ter um
    lugar só onde aparece no computador, e era um lugar onde ele nunca esteve.
  */
  useEffect(() => {
    document.title = title ? `${title} · Alaskan` : 'Alaskan Dashboard';
  }, [title]);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <div className={`${isMobile ? 'pl-0' : collapsed ? 'pl-16' : 'pl-56'} transition-all duration-300`}>
        {/*
          `h-14` e não `py-4`: a altura precisa ser a MESMA do cabeçalho da
          sidebar, senão as duas linhas de baixo não se encontram e o topo da
          tela fica com um degrau. Com padding, a altura vinha do conteúdo — o
          botão "Buscar" — e dava 66,4px contra os 56px da sidebar.

          Se um dia entrar aqui um controle mais alto que 56px, é aqui e no
          cabeçalho da sidebar que a altura muda, junto.
        */}
        <header className="sticky top-0 z-40 flex h-14 items-center bg-background/80 backdrop-blur-xl border-b border-border px-4 md:px-6">
          <div className="flex w-full items-center justify-between gap-3">
            {/* `min-w-0` para o `truncate` do h1 valer: sem ele o flex deixa o
                título crescer além do espaço e empurra a busca e os filtros
                para fora da tela — o que acontecia com título longo de artigo. */}
            <div className="flex items-center gap-3 min-w-0">
              {isMobile && (
                <button onClick={toggle} className="text-muted-foreground hover:text-foreground p-1 shrink-0">
                  <Menu className="h-5 w-5" />
                </button>
              )}
              {/*
                `hideTitle` esconde no computador e MANTÉM no celular.

                O que torna o título dispensável é a sidebar: ela já marca em
                qual página você está, e repetir o nome dois centímetros ao lado
                gasta a barra inteira para não dizer nada de novo.

                No celular a sidebar está fechada atrás do ☰, e aí o título é a
                única coisa que nomeia a tela. Esconder nos dois lugares não
                seria consistência, seria deixar quem abre no telefone sem saber
                onde está.
              */}
              {(!hideTitle || isMobile) && (
                <h1 className="text-lg md:text-xl font-semibold text-foreground truncate">{title}</h1>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => document.dispatchEvent(new CustomEvent('openCommandPalette'))}
                className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border/60 rounded-md px-2.5 py-1.5 hover:bg-accent transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
                <span>Buscar</span>
                <kbd className="ml-1 text-[10px] bg-muted px-1 py-0.5 rounded font-mono">Ctrl+K</kbd>
              </button>
              {/*
                Sino e conta moram aqui, e não no rodapé da sidebar.

                A sidebar responde "onde eu vou"; estes dois não são lugares
                para ir, são coisas que valem em qualquer tela — e o cabeçalho é
                o único elemento presente em todas elas. No rodapé eles dividiam
                uma coluna de ícones com o botão de recolher a barra: três
                classes de ação diferentes desenhadas igual, sendo que uma delas
                encerrava a sessão num clique.

                No celular vale igual: o cabeçalho continua na tela quando a
                sidebar está fechada atrás do ☰, e antes o sino ficava escondido
                lá dentro.
              */}
              {user && <NotificacoesPopover userId={user.id} />}
              <ContaMenu />
            </div>
          </div>
        </header>
        <main className="p-4 md:p-6 animate-fade-in">
          {!hideAvisos && <IngestStatusBanner />}

          {/*
            Os filtros ficam na página, e não na barra fixa.

            Na barra eles ficavam ao lado da busca e do nome da tela —
            navegação — quando o que eles fazem é recortar o conteúdo logo
            abaixo. No Resumo isso chegava a espalhar três filtros da mesma
            leitura por dois cantos da tela: conta e período em cima, segmento
            embaixo.

            Fica aqui, e não dentro de cada página, para continuar existindo num
            lugar só: quem não usa filtro global passa `hideFilters`, e quem
            quer os controles em outro arranjo (o Resumo, que os junta com o
            segmento e o Atualizar) também passa e monta o seu.

            O custo, assumido: eles rolam com a página. Numa tabela longa, mudar
            o período exige voltar ao topo. Se isso incomodar, um `sticky
            top-14` aqui resolve sem mexer em mais nada.
          */}
          {!hideFilters && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <GlobalFilters />
            </div>
          )}

          {children}
        </main>
      </div>
    </div>
  );
}
