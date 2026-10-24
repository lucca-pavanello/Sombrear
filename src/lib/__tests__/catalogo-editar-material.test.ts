import { describe, it, expect } from 'vitest'
import { alvosComCodigo, alvosDoMaterial, validarEdicaoMaterial } from '../catalogo/editarMaterial'
import type { CustoVigente } from '@/hooks/useCatalogoCustos'

const CORTTEX = '8267118c-be47-49ff-99a5-1834f0fdd775'
const TA_DECOR = '8c06ee99-4eb8-4c96-862c-5403d8d5d182'

function celula(p: Partial<CustoVigente>): CustoVigente {
  return {
    item_id: 'x',
    fornecedor_id: null,
    fornecedor: null,
    codigo_fornecedor: null,
    descricao: 'MICROFIBRA 3.00M BEGE',
    categoria: 'tecido',
    cor: 'bege',
    largura_m: 3,
    unidade_canonica: 'm',
    custo_unitario: 6.3,
    preco_bruto: 6.3,
    desconto_pct: 0,
    unidade_documento: 'M',
    preco_liquido: 6.3,
    tipo: 'pedido',
    referencia: 'CORTTEX-012897',
    data_documento: '2026-07-01',
    tabela_preco: null,
    produto_id: null,
    ...p,
  }
}

describe('alvos da edição', () => {
  const celulas = [
    celula({ fornecedor_id: CORTTEX, codigo_fornecedor: '6137' }),
    celula({ fornecedor_id: TA_DECOR, codigo_fornecedor: null }),
    celula({ fornecedor_id: null }),
  ]

  it('manda uma célula por loja, com os valores que a tela vê', () => {
    expect(alvosDoMaterial(celulas)).toEqual([
      { fornecedor_id: CORTTEX, codigo: '6137', descricao: 'MICROFIBRA 3.00M BEGE' },
      { fornecedor_id: TA_DECOR, codigo: null, descricao: 'MICROFIBRA 3.00M BEGE' },
      { fornecedor_id: null, codigo: null, descricao: 'MICROFIBRA 3.00M BEGE' },
    ])
  })

  it('só leva código novo onde ele mudou — e vazio vira sem código', () => {
    const codigos = new Map([
      [CORTTEX, ' 6137 '], // igual, só com espaço: não mudou
      [TA_DECOR, '22.139.1'], // novo
      ['', ''], // continua sem código
    ])
    const alvos = alvosComCodigo(celulas, codigos)
    expect('novo_codigo' in alvos[0]).toBe(false)
    expect(alvos[1].novo_codigo).toBe('22.139.1')
    expect('novo_codigo' in alvos[2]).toBe(false)

    const apagando = alvosComCodigo(celulas, new Map([[CORTTEX, '  ']]))
    expect(apagando[0].novo_codigo).toBeNull()
  })
})

describe('validarEdicaoMaterial', () => {
  it('recusa nome vazio e largura sem sentido', () => {
    expect(validarEdicaoMaterial({ descricao: '  ', categoria: 'tecido' })).toMatch(/nome/)
    expect(validarEdicaoMaterial({ descricao: 'X', categoria: 'tecido', larguraM: 0 })).toMatch(/Largura/)
    expect(validarEdicaoMaterial({ descricao: 'X', categoria: 'tecido', larguraM: NaN })).toMatch(/Largura/)
  })

  it('aceita sem largura', () => {
    expect(validarEdicaoMaterial({ descricao: 'X', categoria: 'tecido', larguraM: null })).toBeNull()
  })
})
