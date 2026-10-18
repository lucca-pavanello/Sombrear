import type { CustoVigente } from '@/hooks/useCatalogoCustos'

/**
 * O mesmo material, lado a lado, em cada loja onde a Sombrear compra.
 *
 * A tela antiga mostrava uma LINHA por (fornecedor, material): o trilho duplo
 * aparecia duas vezes, uma da Alumitec e outra da TA Decor, e descobrir qual
 * era mais barato dependia de procurar a outra linha. O pedido da loja é o
 * contrário — uma linha por material, uma COLUNA por loja, e a célula vazia
 * quando aquela loja ainda não tem preço, para a dona preencher depois.
 *
 * O custo que vale é o MENOR entre as lojas, porque é dele que a loja compra.
 *
 * ── A chave de agrupamento é a descrição, e isso é uma decisão, não um acaso
 *
 * Não existe no banco nenhuma noção de "este material da Corttex é o mesmo
 * daquele da TA Decor" — a chave da view é (fornecedor, código, descrição), e
 * código é de cada fornecedor. Agrupar por descrição normalizada é o que
 * respeita os dois lados:
 *
 *   • junta o que a loja escreveu igual nas duas lojas — que é exatamente o
 *     caso de preencher a célula vazia: ela digita o MESMO nome na outra loja
 *     e as duas viram uma linha só;
 *   • NÃO junta "MICROFIBRA 3.00M BEGE" (Corttex, R$ 6,30/m) com "MICROFIBRA
 *     CLASSICA 3,30L - AREIA" (TA Decor, R$ 13,90/m). Nome parecido, preço
 *     2×, largura e fornecedor diferentes — são produtos diferentes, e
 *     unificar os dois já produziu uma margem falsa de 10,9% uma vez.
 */

/** fornecedor_id de quem não tem fornecedor atribuído (a lista da dona). */
export const SEM_FORNECEDOR = ''

/** Acento, caixa e espaço duplo não distinguem material. O resto distingue. */
export function chaveMaterial(descricao: string): string {
  return descricao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export interface MaterialPivotado {
  chave: string
  descricao: string
  categoria: CustoVigente['categoria']
  cor: string | null
  largura_m: number | null
  /** A unidade em que as lojas comparáveis cobram. */
  unidade_canonica: string
  /** `fornecedor_id ?? ''` → o custo vigente daquela loja. */
  porFornecedor: Map<string, CustoVigente>
  /** O que o cálculo usa: o menor entre as lojas comparáveis. */
  menor: CustoVigente | null
  /**
   * Alguma loja cobra numa unidade diferente das outras. Quando isto é
   * verdade, o menor é escolhido só entre as que compartilham a unidade
   * predominante — comparar R$/m com R$/un daria o barato errado.
   */
  unidadesDiferentes: boolean
}

/** Uma linha por material; uma entrada em `porFornecedor` por loja. */
export function pivotarPorFornecedor(custos: CustoVigente[]): MaterialPivotado[] {
  const grupos = new Map<string, CustoVigente[]>()
  for (const c of custos) {
    const k = chaveMaterial(c.descricao)
    const atual = grupos.get(k)
    if (atual) atual.push(c)
    else grupos.set(k, [c])
  }

  const linhas: MaterialPivotado[] = []
  for (const [chave, itens] of grupos) {
    const porFornecedor = new Map<string, CustoVigente>()
    for (const c of itens) {
      const loja = c.fornecedor_id ?? SEM_FORNECEDOR
      const jaTem = porFornecedor.get(loja)
      // Duas linhas da MESMA loja com o mesmo nome não acontecem hoje
      // (conferido no banco: zero colisões). Se um dia acontecer, a célula
      // fica com a mais barata em vez de depender da ordem da consulta.
      if (!jaTem || c.custo_unitario < jaTem.custo_unitario) porFornecedor.set(loja, c)
    }

    const unidade = unidadePredominante(itens)
    const comparaveis = [...porFornecedor.values()].filter(c => c.unidade_canonica === unidade)
    const menor = comparaveis.reduce<CustoVigente | null>(
      (m, c) => (m == null || c.custo_unitario < m.custo_unitario ? c : m),
      null
    )

    const base = itens[0]
    linhas.push({
      chave,
      // O nome mostrado é o da loja mais barata: é o material que a Sombrear
      // de fato compra.
      descricao: (menor ?? base).descricao,
      categoria: base.categoria,
      cor: base.cor,
      largura_m: base.largura_m,
      unidade_canonica: unidade,
      porFornecedor,
      menor,
      unidadesDiferentes: itens.some(c => c.unidade_canonica !== unidade),
    })
  }
  return linhas
}

/**
 * A unidade que mais lojas usam. Empate resolve pela ordem alfabética da
 * unidade, só para a tela não trocar de resposta entre dois carregamentos.
 */
function unidadePredominante(itens: CustoVigente[]): string {
  const contagem = new Map<string, number>()
  for (const c of itens) {
    contagem.set(c.unidade_canonica, (contagem.get(c.unidade_canonica) ?? 0) + 1)
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
}

export type Ordem = 'nome' | 'menor_custo' | 'maior_custo'

export const ROTULO_ORDEM: Record<Ordem, string> = {
  nome: 'Nome (A–Z)',
  menor_custo: 'Custo: do mais barato',
  maior_custo: 'Custo: do mais caro',
}

/**
 * Material sem nenhum preço vai para o fim em qualquer ordenação: ordenar por
 * custo e começar pelos que não têm custo seria a pior primeira tela possível.
 */
export function ordenar(linhas: MaterialPivotado[], ordem: Ordem): MaterialPivotado[] {
  return linhas.slice().sort((a, b) => {
    if (ordem === 'nome') return a.descricao.localeCompare(b.descricao, 'pt-BR')
    if (a.menor == null || b.menor == null) {
      if (a.menor == null && b.menor == null) return a.descricao.localeCompare(b.descricao, 'pt-BR')
      return a.menor == null ? 1 : -1
    }
    const d = a.menor.custo_unitario - b.menor.custo_unitario
    return (ordem === 'menor_custo' ? d : -d) || a.descricao.localeCompare(b.descricao, 'pt-BR')
  })
}

/** As lojas que aparecem nestes materiais, para virarem colunas. */
export function lojasDe(
  linhas: MaterialPivotado[],
  nomePorId: Map<string, string | null>
): { id: string; nome: string }[] {
  const vistas = new Set<string>()
  for (const l of linhas) for (const id of l.porFornecedor.keys()) vistas.add(id)
  return [...vistas]
    .map(id => ({ id, nome: (id && nomePorId.get(id)) || 'Sem fornecedor' }))
    .sort((a, b) =>
      // "Sem fornecedor" por último: é pendência, não loja.
      (a.id === SEM_FORNECEDOR ? 1 : 0) - (b.id === SEM_FORNECEDOR ? 1 : 0) ||
      a.nome.localeCompare(b.nome, 'pt-BR')
    )
}
