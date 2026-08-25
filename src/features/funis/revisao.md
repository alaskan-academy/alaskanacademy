# Revisão da área de Funis — diagnóstico

Levantamento de 26/08/2026, antes de mexer em qualquer coisa. Ela pediu a
revisão porque quer "mudar quase tudo", e porque a área bloqueia o módulo de
[Análises](../analises/plan.md).

---

## O defeito de raiz: "funil" na tabela é a VARIANTE

Os 23 registros de `funis` se chamam REV1, REV2, REV5, REV6 — e os nomes se
repetem entre produtos:

| Nome | Quantas vezes |
|---|---|
| REV1 - Original | 4 |
| REV2 | 3 |
| REV3 | 3 |

Isso não é bagunça de cadastro. É o modelo dizendo que **o funil de verdade é o
produto**, e o que está gravado como funil é a revisão dele. "Saponária REV5" e
"Saponária REV6" são o mesmo funil em duas versões — não dois funis.

Tudo o que está torto abaixo é consequência disso.

**O modelo que a operação já usa, sem estar escrito em lugar nenhum:**

```
produto  →  funil  →  variante (REV)  →  checkout
                                     →  VSL
                                     →  página
                                     →  preço
```

A alteração acontece na variante. A campanha aponta para a variante. A métrica
é da variante. O funil é o guarda-chuva.

---

## O que está quebrado hoje

### Dois campos dizendo a mesma coisa, e discordando

`ativo` (boolean) e `status` (texto) coexistem. Quatro funis têm
`status = 'ativo'` e `ativo = false` ao mesmo tempo.

Foi o que me fez contar **1 funil ativo** quando ela via vários na tela — a
consulta usou o booleano, a tela usa o status. Se dois campos podem discordar,
um dia discordam, e ninguém sabe qual é o certo.

**Um só sobrevive.** `status` é mais rico e é o que a tela já usa.

### `payt_key` não identifica nada

O mesmo valor — `8e820d583a121bdb552c6202638d8066` — em **9 funis diferentes**.
É a chave da conta na Payt, não do funil. Como identificador de funil, é
inútil, e foi provavelmente copiada de um para outro no cadastro.

### `produto` é texto livre e nulo na maioria

Nulo em **14 de 23**. Onde existe, é digitado à mão: "Saponária" com acento,
enquanto o enum `produto_tipo` usa `saponaria`. Duas taxonomias para a mesma
coisa, nenhuma conversando com a outra.

### `metodo` contradiz o nome

`REV5 - VSL` tem `metodo = 'TSL'`. `REV5 - VSL 03` também. O nome diz uma coisa,
o campo diz outra, e ninguém sabe qual vale.

### `link_checkout` em 8 de 23

Metade dos funis não tem checkout registrado — e é justamente por ele que a
venda seria ligada ao funil.

### Não existe VSL

Ela pediu para incluir. Hoje a informação de qual VSL está rodando vive só no
nome ("REV5 - VSL 03") e nas mensagens do Google Chat.

---

## O que já existe e é bom: `testes_funis`

**Isto muda o plano do módulo de Análises.** A tabela já tem exatamente a forma
do que eu ia criar como `alteracoes`:

`variante_a`, `variante_b`, `metrica`, `resultado_a`, `resultado_b`, `vencedor`,
`data_inicio`, `data_fim`, `pipeline_status`, `impacto`, `dificuldade`, `kpi`.

E está em uso: **38 testes ativos**, todos ligados a funil, criados em agosto.

| Status | Testes | Com vencedor |
|---|---|---|
| planejado | 20 | 0 |
| concluído | 13 | **3** |
| rodando | 4 | 0 |
| produzindo | 1 | 0 |

**Só 3 de 13 concluídos têm vencedor.** O ciclo não fecha aqui pelo mesmo motivo
que não fecha no Google Chat: registrar é manual, medir é manual, e ninguém
volta para preencher o resultado depois.

**Consequência para o plano:** não criar `alteracoes` do zero. O módulo de
Análises deve alimentar `testes_funis` — o que falta ali é o resultado ser
calculado sozinho a partir das datas, não um lugar novo para digitar.

---

## O tamanho da área hoje

4.361 linhas em seis abas:

| Aba | Linhas | O que faz |
|---|---|---|
| Funis | 475 | lista e cadastro |
| Testes | 247 | testes A/B |
| Esteira | 402 | pipeline dos testes |
| Concluídos | 345 | testes encerrados |
| Domínios | 233 | domínios e vencimento |
| Gerador UTM | 681 | monta link com UTM |
| FunilModal | 551 | cadastro de funil |
| TesteModal | 807 | cadastro de teste |

**Testes, Esteira e Concluídos são três telas do mesmo objeto** em fases
diferentes — 994 linhas para o que provavelmente é uma tela com filtro.

---

## Perguntas que precisam de resposta antes de mexer

1. **Um funil tem várias variantes (REV) ou cada REV é um funil?** Todo o resto
   depende disto. Os dados dizem "variantes"; confirmar com ela.
2. **O que identifica a venda como sendo de uma variante?** O `link_checkout` é
   único por REV? Se for, é ele que liga tudo.
3. **Domínios e Gerador de UTM continuam aqui?** São ferramentas úteis mas de
   outra natureza — não são o funil, são infraestrutura em volta dele.
4. **Testes/Esteira/Concluídos viram uma tela só?**
5. **O que fazer com os 23 registros atuais** — migrar para o modelo novo, ou
   recomeçar o cadastro com o histórico preservado?
