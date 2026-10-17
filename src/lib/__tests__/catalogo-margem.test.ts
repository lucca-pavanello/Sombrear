import { describe, it, expect } from 'vitest'
import { margemDoTecido, formatarMargem, sinalDaMargem } from '../catalogo/margem'

/**
 * Números reais: preço de `precos_cortina_tecidos`, custo de
 * `catalogo_custo_vigente`, conferidos no banco em 17/10/2026.
 */

describe('margem do tecido, com os números da loja', () => {
  it('Microfibra 3,00m: vende a 14,00/m, compra a 6,30/m da Corttex', () => {
    // 7 metros de consumo numa cortina Wave.
    const m = margemDoTecido(7, 14.0, 6.3)
    expect(m).not.toBeNull()
    expect(m!.venda).toBeCloseTo(98.0, 2)
    expect(m!.custo).toBeCloseTo(44.1, 2)
    expect(m!.lucro).toBeCloseTo(53.9, 2)
    expect(m!.margem).toBeCloseTo(0.55, 4)
    expect(m!.markup).toBeCloseTo(2.2222, 3)
  })

  it('margem e markup NÃO são a mesma coisa — 2× de markup é 50% de margem', () => {
    const m = margemDoTecido(10, 20, 10)!
    expect(m.markup).toBe(2)
    expect(m.margem).toBe(0.5)
    // Trocar um pelo outro faz a loja achar que ganha o dobro do que ganha.
  })

  it('custo acima da venda dá margem negativa, e isso TEM que aparecer', () => {
    // O caso que me assustou: se a Microfibra 3,30 de venda (15,60) for mesmo
    // a Clássica 3,30 da TA Decor (13,90), sobra quase nada. Por isso a
    // ligação é dita pela loja, não adivinhada.
    const apertada = margemDoTecido(5, 15.6, 13.9)!
    expect(apertada.margem).toBeCloseTo(0.109, 3)
    expect(sinalDaMargem(apertada.margem)).toBe('apertada')

    const prejuizo = margemDoTecido(5, 12.0, 13.9)!
    expect(prejuizo.margem).toBeLessThan(0)
    expect(prejuizo.lucro).toBeLessThan(0)
    expect(sinalDaMargem(prejuizo.margem)).toBe('prejuizo')
  })

  it('a quantidade entra pelos metros, e não muda a margem percentual', () => {
    const uma = margemDoTecido(7, 14.0, 6.3)!
    const tres = margemDoTecido(21, 14.0, 6.3)!
    expect(tres.custo).toBeCloseTo(uma.custo * 3, 6)
    expect(tres.margem).toBeCloseTo(uma.margem, 10)
  })
})

describe('sem custo confiável, não mostra número nenhum', () => {
  it('null, zero e negativo devolvem null — nunca "margem 100%"', () => {
    expect(margemDoTecido(7, 14, null)).toBeNull()
    expect(margemDoTecido(7, 14, undefined)).toBeNull()
    expect(margemDoTecido(7, 14, 0)).toBeNull()
    expect(margemDoTecido(7, 14, -3)).toBeNull()
    // Custo ausente virando zero faria a tela afirmar lucro total.
  })

  it('metros ou preço inválidos também devolvem null', () => {
    expect(margemDoTecido(0, 14, 6.3)).toBeNull()
    expect(margemDoTecido(Number.NaN, 14, 6.3)).toBeNull()
    expect(margemDoTecido(7, 0, 6.3)).toBeNull()
  })
})

describe('como a margem aparece escrita', () => {
  it('uma casa decimal, com vírgula', () => {
    expect(formatarMargem(0.55)).toBe('55,0%')
    expect(formatarMargem(0.109)).toBe('10,9%')
  })

  it('negativa vem com sinal de menos de verdade', () => {
    expect(formatarMargem(-0.158)).toBe('−15,8%')
  })

  it('o corte de atenção é 30%', () => {
    expect(sinalDaMargem(0.2999)).toBe('apertada')
    expect(sinalDaMargem(0.3)).toBe('ok')
  })
})
