/**
 * Margem do tecido numa cortina: o que a loja cobra contra o que ela paga.
 *
 * Compara a LINHA DE TECIDO com ela mesma. O motor cobra
 * `consumo × preço_por_metro`; aqui o custo é `consumo × custo_por_metro`,
 * do catálogo. São os mesmos metros dos dois lados, então a comparação é
 * honesta.
 *
 * Deliberadamente NÃO é a margem da cortina inteira. Trilho, deslizante,
 * ponteira e mão de obra também custam, e o catálogo ainda não sabe quantos
 * metros de trilho entram em cada cortina. Dizer "margem da cortina" usando
 * só o tecido daria um número alto e falso.
 *
 * A fórmula é a mesma que `estoque_vw_cobertura_margem` já usa no banco:
 * margem = (venda − custo) / venda. Não é o markup — markup de 2× é margem
 * de 50%, e confundir os dois é como a loja acha que ganha o dobro do que
 * ganha.
 */

export interface MargemTecido {
  /** Metros de tecido cobrados: consumo de uma cortina × quantidade. */
  metros: number
  venda: number
  custo: number
  lucro: number
  /** (venda − custo) / venda, em 0–1. Negativo quando o custo passa a venda. */
  margem: number
  /** venda / custo. 2 = a loja cobra o dobro do que paga. */
  markup: number
}

/**
 * Devolve null quando não há custo confiável — e null significa "não mostre
 * nada", nunca "margem zero". Preencher com zero faria a tela afirmar um
 * lucro total que ninguém mediu.
 */
export function margemDoTecido(
  metros: number,
  precoPorMetro: number,
  custoPorMetro: number | null | undefined
): MargemTecido | null {
  if (custoPorMetro == null || !Number.isFinite(custoPorMetro) || custoPorMetro <= 0) return null
  if (!Number.isFinite(metros) || metros <= 0) return null
  if (!Number.isFinite(precoPorMetro) || precoPorMetro <= 0) return null

  const venda = metros * precoPorMetro
  const custo = metros * custoPorMetro
  return {
    metros,
    venda,
    custo,
    lucro: venda - custo,
    margem: (venda - custo) / venda,
    markup: venda / custo,
  }
}

/** "55,0%" — e "−10,9%" quando o custo passou a venda. */
export function formatarMargem(margem: number): string {
  const pct = margem * 100
  const sinal = pct < 0 ? '−' : ''
  return `${sinal}${Math.abs(pct).toFixed(1).replace('.', ',')}%`
}

/**
 * Quando a margem merece atenção na tela.
 *
 * Abaixo de 30% o tecido está pagando pouco mais que o próprio custo depois
 * da mão de obra; abaixo de zero a loja perde dinheiro no pano. O corte é um
 * aviso visual, não uma regra de negócio — ninguém é impedido de vender.
 */
export type SinalMargem = 'prejuizo' | 'apertada' | 'ok'

export function sinalDaMargem(margem: number): SinalMargem {
  if (margem < 0) return 'prejuizo'
  if (margem < 0.3) return 'apertada'
  return 'ok'
}
