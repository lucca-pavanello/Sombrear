import { describe, it, expect } from 'vitest'
import { separarCores, mesmaCaixa, nomeNaCor, variacoesSugeridas } from '../catalogo/duplicarCores'
import { apelidoFornecedor } from '../catalogo/manual'

describe('separarCores', () => {
  it('aceita vírgula, ponto e vírgula, linha e "e", sem repetir', () => {
    expect(separarCores('prata, cinza, trigo, perola e branco')).toEqual(['prata', 'cinza', 'trigo', 'perola', 'branco'])
    expect(separarCores('branco;  Branco\npérola, perola ,')).toEqual(['branco', 'pérola'])
    expect(separarCores('   ')).toEqual([])
  })
})

describe('nome e cor na nova cor', () => {
  it('segue a caixa do material', () => {
    expect(mesmaCaixa('BEGE', 'branco')).toBe('BRANCO')
    expect(mesmaCaixa('bege', 'BRANCO')).toBe('branco')
    expect(mesmaCaixa('Bege', 'branco')).toBe('Branco')
  })

  it('troca a cor no nome — os pedidos reais da Stella em 24/10', () => {
    expect(nomeNaCor('MICROFIBRA 90 grs 3.30 BEGE', 'BEGE', 'marfim')).toBe('MICROFIBRA 90 grs 3.30 MARFIM')
    expect(nomeNaCor('LINHO GAZE 3.00M BEGE', 'bege', 'perola')).toBe('LINHO GAZE 3.00M PEROLA')
    // cor não cadastrada: troca a última palavra
    expect(nomeNaCor('LINHO GAZE LEVE 3.00 BEGE', null, 'trigo')).toBe('LINHO GAZE LEVE 3.00 TRIGO')
    // a cor não aparece no nome: acrescenta em vez de estragar o nome
    expect(nomeNaCor('BLACKOUT ROLO', 'preto', 'branco')).toBe('BLACKOUT ROLO BRANCO')
  })

  it('a cor da variação segue a cor original; sem cor original, fica sem', () => {
    expect(variacoesSugeridas('LINHO GAZE 3.00M BEGE', 'bege', ['Prata'])).toEqual([
      { descricao: 'LINHO GAZE 3.00M PRATA', cor: 'prata' },
    ])
    expect(variacoesSugeridas('LINHO GAZE LEVE 3.00 BEGE', null, ['cinza'])[0].cor).toBeNull()
  })
})

describe('apelido do fornecedor', () => {
  it('é o mesmo que o banco calcula na 0035', () => {
    expect(apelidoFornecedor('Tapeçaria Américana  Decor!')).toBe('TAPECARIA-AMERICANA-DECOR')
  })
})
