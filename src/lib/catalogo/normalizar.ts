/**
 * Catálogo de custos — ler o documento do fornecedor sem estragar o número.
 *
 * Três fornecedores, três jeitos de escrever a mesma coisa, e cada diferença
 * dá um erro diferente se a gente ignorar:
 *
 *  1. A Alumitec imprime o preço CHEIO e a coluna "Dsc: 30". O que ela cobra é
 *     o líquido (10,57 − 30% = 7,399). A TA Decor imprime "Desc. 0,00" porque o
 *     desconto já está dentro da tabela da campanha ("M.A.V. 2026"). Aplicar
 *     30% nos dois desconta duas vezes e inventa um custo que ninguém pagou.
 *
 *  2. As unidades não são comparáveis como vêm. No MESMO pedido (115104) a
 *     Alumitec vende deslizante por MILHEIRO (R$ 181,608 o milheiro, que é
 *     R$ 0,1816 a unidade) e fio por ROLO de 50 metros (R$ 158,375 o rolo, que
 *     é R$ 3,1675 o metro). Quem compara milheiro com unidade erra por 1000×.
 *
 *  3. "6 PÇ / 36 MTS" é uma linha só: compra-se 6 barras, cobra-se por 36
 *     metros. A quantidade que multiplica o preço é a de METROS.
 *
 * O arredondamento para centavos só acontece no subtotal, nunca no unitário —
 * mesma regra de cortina.ts, e pelo mesmo motivo: a Alumitec trabalha com três
 * casas (7,399) e arredondar ali desmonta a conferência com o total do papel.
 *
 * Nada aqui adivinha. Unidade que não está na lista PARA e diz qual era —
 * custo inventado no catálogo vira preço errado no orçamento.
 */

/** Unidades como os fornecedores escrevem. */
export type UnidadeDocumento = 'PC' | 'MT' | 'MTS' | 'MILH' | 'ROLO' | 'UN'

/** Unidades do banco (`estoque_produtos.unidade`), que não vamos alargar. */
export type UnidadeCanonica = 'm' | 'm2' | 'un' | 'kg'

export interface ItemDocumento {
  descricao: string
  /** A quantidade que MULTIPLICA o preço — em "6 PÇ / 36 MTS", é 36. */
  quantidade: number
  unidade: UnidadeDocumento
  precoBruto: number
  /** Só o desconto IMPRESSO no documento. Tabela de campanha vem com 0. */
  descontoPct?: number
  /** Metros por rolo, quando a unidade é ROLO. Está no nome: "ROLO 50 MTS". */
  metrosPorRolo?: number
}

export interface ItemNormalizado {
  precoLiquido: number
  subtotal: number
  unidadeCanonica: UnidadeCanonica
  quantidadeCanonica: number
  custoUnitario: number
}

const centavos = (n: number) => Math.round(n * 100) / 100

/**
 * Quatro casas: a Alumitec imprime três (7,399 / 12,775 / 181,608) e `0.7 *
 * 10.57` dá 7.398999999999999 em ponto flutuante. Sem isso a soma não fecha
 * com o total do papel.
 */
const unitario = (n: number) => Math.round(n * 10_000) / 10_000

/**
 * O preço que a loja paga de fato.
 *
 * `descontoPct` é só o que está IMPRESSO. Quando o documento traz desconto
 * zerado e uma tabela de preço nomeada, o líquido é o próprio unitário — o
 * desconto já foi dado lá dentro.
 */
export function liquido(precoBruto: number, descontoPct = 0): number {
  if (!Number.isFinite(precoBruto) || precoBruto < 0) {
    throw new Error(`Preço bruto inválido: ${precoBruto}`)
  }
  if (!Number.isFinite(descontoPct) || descontoPct < 0 || descontoPct >= 100) {
    throw new Error(`Desconto fora da faixa (0 a 99,99): ${descontoPct}`)
  }
  return unitario(precoBruto * (1 - descontoPct / 100))
}

/**
 * Leva quantidade e preço para a unidade do banco, preservando o produto
 * `quantidade × preço` — é essa invariante que faz a soma continuar fechando
 * com o total impresso depois da conversão.
 */
export function paraUnidadeCanonica(
  quantidade: number,
  unidade: UnidadeDocumento,
  precoLiquido: number,
  metrosPorRolo?: number
): { unidadeCanonica: UnidadeCanonica; quantidadeCanonica: number; custoUnitario: number } {
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    throw new Error(`Quantidade inválida: ${quantidade}`)
  }

  switch (unidade) {
    case 'MT':
    case 'MTS':
      return { unidadeCanonica: 'm', quantidadeCanonica: quantidade, custoUnitario: precoLiquido }

    case 'PC':
    case 'UN':
      return { unidadeCanonica: 'un', quantidadeCanonica: quantidade, custoUnitario: precoLiquido }

    // Milheiro: o preço é por 1000 peças. Sem dividir, o deslizante da Alumitec
    // entraria no catálogo a R$ 181,61 a unidade em vez de R$ 0,18.
    case 'MILH':
      return {
        unidadeCanonica: 'un',
        quantidadeCanonica: quantidade * 1000,
        custoUnitario: precoLiquido / 1000,
      }

    // Rolo: a metragem está no nome do produto ("ROLO 50 MTS"), não numa
    // coluna. Se ela não vier, paramos — rolo tem tamanho variável e chutar 50
    // aqui seria inventar o custo do metro.
    case 'ROLO': {
      if (!metrosPorRolo || !Number.isFinite(metrosPorRolo) || metrosPorRolo <= 0) {
        throw new Error(
          `Rolo sem metragem: não dá para saber o custo por metro. ` +
            `Informe quantos metros tem o rolo (costuma estar na descrição, ex. "ROLO 50 MTS").`
        )
      }
      return {
        unidadeCanonica: 'm',
        quantidadeCanonica: quantidade * metrosPorRolo,
        custoUnitario: precoLiquido / metrosPorRolo,
      }
    }

    default: {
      const nunca: never = unidade
      throw new Error(`Unidade que o catálogo não conhece: ${String(nunca)}`)
    }
  }
}

/** Uma linha do documento, pronta para o banco. */
export function normalizarItem(item: ItemDocumento): ItemNormalizado {
  const precoLiquido = liquido(item.precoBruto, item.descontoPct ?? 0)
  const { unidadeCanonica, quantidadeCanonica, custoUnitario } = paraUnidadeCanonica(
    item.quantidade,
    item.unidade,
    precoLiquido,
    item.metrosPorRolo
  )
  return {
    precoLiquido,
    // O subtotal sai da quantidade do DOCUMENTO: é o número que tem de bater
    // com o papel. A via canônica dá o mesmo valor, e o teste cobra isso.
    subtotal: centavos(item.quantidade * precoLiquido),
    unidadeCanonica,
    quantidadeCanonica,
    custoUnitario,
  }
}

export interface ConferenciaDocumento {
  fecha: boolean
  somado: number
  declarado: number
  diferenca: number
  itens: ItemNormalizado[]
}

/**
 * A reconciliação do §22: a soma dos itens tem de dar o total impresso.
 *
 * Isto é o portão da importação. Documento que não fecha não entra no banco —
 * é preferível um produto faltando a um custo errado circulando no orçamento.
 */
export function conferirDocumento(
  itens: ItemDocumento[],
  totalDeclarado: number
): ConferenciaDocumento {
  const normalizados = itens.map(normalizarItem)
  const somado = centavos(normalizados.reduce((acc, i) => acc + i.subtotal, 0))
  const diferenca = centavos(somado - totalDeclarado)
  return {
    fecha: Math.abs(diferenca) < 0.005,
    somado,
    declarado: totalDeclarado,
    diferenca,
    itens: normalizados,
  }
}

/**
 * O total de desconto do documento, para conferir contra a linha "Descontos:"
 * que a Alumitec imprime — uma segunda prova independente da primeira.
 */
export function descontoTotal(itens: ItemDocumento[]): number {
  return centavos(
    itens.reduce((acc, i) => {
      const cheio = i.quantidade * i.precoBruto
      const pago = i.quantidade * liquido(i.precoBruto, i.descontoPct ?? 0)
      return acc + (cheio - pago)
    }, 0)
  )
}
