import { describe, it, expect } from 'vitest'
import {
  chaveMaterial, pivotarPorFornecedor, ordenar, lojasDe, pagandoAMais, SEM_FORNECEDOR,
} from '../catalogo/pivo'
import type { CustoVigente } from '@/hooks/useCatalogoCustos'

/**
 * Números reais de `catalogo_custo_vigente`, conferidos no banco em
 * 18/10/2026. Os ids de fornecedor são os de produção.
 */

const CORTTEX = '8267118c-be47-49ff-99a5-1834f0fdd775'
const TA_DECOR = '8c06ee99-4eb8-4c96-862c-5403d8d5d182'
const ALUMITEC = '7685099a-b464-43e6-81f3-76335cc77907'

function custo(p: Partial<CustoVigente> & { descricao: string; custo_unitario: number }): CustoVigente {
  return {
    item_id: `${p.descricao}|${p.fornecedor_id ?? ''}`,
    fornecedor_id: null,
    fornecedor: null,
    codigo_fornecedor: null,
    categoria: 'tecido',
    cor: null,
    largura_m: null,
    unidade_canonica: 'm',
    preco_bruto: p.custo_unitario,
    desconto_pct: 0,
    unidade_documento: 'M',
    preco_liquido: p.custo_unitario,
    tipo: 'pedido',
    referencia: 'TESTE',
    data_documento: '2026-04-02',
    tabela_preco: null,
    produto_id: null,
    ...p,
  } as CustoVigente
}

describe('chave de agrupamento', () => {
  it('acento, caixa e espaço duplo não fazem material diferente', () => {
    expect(chaveMaterial('Semi  Blact 3 m')).toBe(chaveMaterial('SEMI BLACT 3 M'))
    expect(chaveMaterial('Cordão')).toBe(chaveMaterial('cordao'))
  })

  it('nome parecido NÃO é o mesmo material', () => {
    // Esta é a separação que custou caro: unificar as duas Microfibras já
    // produziu uma margem falsa de 10,9% numa tela mostrada à loja.
    expect(chaveMaterial('MICROFIBRA 3.00M BEGE'))
      .not.toBe(chaveMaterial('MICROFIBRA CLASSICA 3,30L - AREIA'))
  })
})

describe('uma linha por material, uma coluna por loja', () => {
  it('o mesmo nome em duas lojas vira UMA linha com as duas colunas', () => {
    const linhas = pivotarPorFornecedor([
      custo({ descricao: 'Semi Blact 3 m', custo_unitario: 14.9, fornecedor_id: null }),
      custo({ descricao: 'Semi Blact 3 m', custo_unitario: 13.8, fornecedor_id: TA_DECOR,
              fornecedor: 'TAPECARIA AMERICANA DECOR' }),
    ])
    expect(linhas).toHaveLength(1)
    expect(linhas[0].porFornecedor.size).toBe(2)
    // O que o cálculo usa é o menor: é dele que a loja compra.
    expect(linhas[0].menor!.custo_unitario).toBe(13.8)
    expect(linhas[0].menor!.fornecedor_id).toBe(TA_DECOR)
  })

  it('nomes diferentes continuam linhas diferentes, mesmo com preço igual', () => {
    // "Blact 100%" (lista da dona, 14,50) e "BLACKOUT LISO 2.80M MARFIM"
    // (Corttex, 14,50) custam o mesmo, mas a largura discorda — 3,00 x 2,80.
    // Juntar seria decidir no lugar da loja uma pendência que está aberta.
    const linhas = pivotarPorFornecedor([
      custo({ descricao: 'Blact 100%', custo_unitario: 14.5 }),
      custo({ descricao: 'BLACKOUT LISO 2.80M MARFIM', custo_unitario: 14.5,
              fornecedor_id: CORTTEX, fornecedor: 'CORTTEX INDUSTRIA TEXTIL' }),
    ])
    expect(linhas).toHaveLength(2)
  })

  it('material em uma loja só tem a outra célula vazia, e isso não é erro', () => {
    const [l] = pivotarPorFornecedor([
      custo({ descricao: 'Oxford', custo_unitario: 9.5 }),
    ])
    expect(l.porFornecedor.get(SEM_FORNECEDOR)!.custo_unitario).toBe(9.5)
    expect(l.porFornecedor.get(CORTTEX)).toBeUndefined()
    expect(l.menor!.custo_unitario).toBe(9.5)
  })

  it('unidades diferentes não se comparam — o menor sai da unidade predominante', () => {
    // O deslizante vem por MILHEIRO numa loja e por unidade noutra. Comparar
    // R$ 0,18/un com R$ 181,61/milheiro escolheria o barato errado.
    const [l] = pivotarPorFornecedor([
      custo({ descricao: 'Deslizante de corda', custo_unitario: 0.1816,
              unidade_canonica: 'un', fornecedor_id: ALUMITEC, fornecedor: 'ALUMITEC ALUMINIO' }),
      custo({ descricao: 'Deslizante de corda', custo_unitario: 0.2, unidade_canonica: 'un',
              fornecedor_id: TA_DECOR, fornecedor: 'TAPECARIA AMERICANA DECOR' }),
      custo({ descricao: 'Deslizante de corda', custo_unitario: 0.05, unidade_canonica: 'm',
              fornecedor_id: CORTTEX, fornecedor: 'CORTTEX INDUSTRIA TEXTIL' }),
    ])
    expect(l.unidade_canonica).toBe('un')
    expect(l.unidadesDiferentes).toBe(true)
    expect(l.menor!.custo_unitario).toBeCloseTo(0.1816, 4)
  })
})

describe('ordenação', () => {
  const linhas = pivotarPorFornecedor([
    custo({ descricao: 'Natural Look 2868', custo_unitario: 19.9 }),
    custo({ descricao: 'Flame leve', custo_unitario: 10.0 }),
    custo({ descricao: 'Oxford', custo_unitario: 9.5 }),
  ])

  it('do mais barato para o mais caro', () => {
    expect(ordenar(linhas, 'menor_custo').map(l => l.descricao))
      .toEqual(['Oxford', 'Flame leve', 'Natural Look 2868'])
  })

  it('do mais caro para o mais barato', () => {
    expect(ordenar(linhas, 'maior_custo').map(l => l.descricao))
      .toEqual(['Natural Look 2868', 'Flame leve', 'Oxford'])
  })

  it('por nome respeita acento do português', () => {
    expect(ordenar(linhas, 'nome').map(l => l.descricao))
      .toEqual(['Flame leve', 'Natural Look 2868', 'Oxford'])
  })

  it('ordenar não altera a lista recebida', () => {
    const antes = linhas.map(l => l.descricao)
    ordenar(linhas, 'maior_custo')
    expect(linhas.map(l => l.descricao)).toEqual(antes)
  })
})

describe('colunas de loja', () => {
  it('"Sem fornecedor" vai para o fim: é pendência, não loja', () => {
    const linhas = pivotarPorFornecedor([
      custo({ descricao: 'Oxford', custo_unitario: 9.5 }),
      custo({ descricao: 'VOIL FLAME 3.00M BEGE', custo_unitario: 11.0,
              fornecedor_id: CORTTEX, fornecedor: 'CORTTEX INDUSTRIA TEXTIL' }),
      custo({ descricao: 'LINHO LIBIO - COR UNICA', custo_unitario: 22.9,
              fornecedor_id: TA_DECOR, fornecedor: 'TAPECARIA AMERICANA DECOR' }),
    ])
    const nomes = new Map([
      [CORTTEX, 'CORTTEX INDUSTRIA TEXTIL'],
      [TA_DECOR, 'TAPECARIA AMERICANA DECOR'],
    ])
    expect(lojasDe(linhas, nomes).map(l => l.nome)).toEqual([
      'CORTTEX INDUSTRIA TEXTIL',
      'TAPECARIA AMERICANA DECOR',
      'Sem fornecedor',
    ])
  })

  it('loja fixada vira coluna mesmo sem ter nenhum preço ainda', () => {
    // O pedido de 18/10: a Tapeçaria Americana tem que aparecer em
    // acessórios, onde ela ainda não vendeu nada, para a dona poder digitar
    // o primeiro preço. Sem isto, a coluna só existiria depois do preço —
    // e o preço só poderia ser digitado na coluna.
    const linhas = pivotarPorFornecedor([
      custo({ descricao: 'TMSBB-TRILHO MAX SIMPLES', custo_unitario: 5.208, categoria: 'trilho',
              fornecedor_id: ALUMITEC, fornecedor: 'ALUMITEC ALUMINIO' }),
    ])
    const nomes = new Map([
      [ALUMITEC, 'ALUMITEC ALUMINIO'],
      [TA_DECOR, 'TAPECARIA AMERICANA DECOR'],
    ])
    expect(lojasDe(linhas, nomes, [TA_DECOR]).map(l => l.nome)).toEqual([
      'ALUMITEC ALUMINIO',
      'TAPECARIA AMERICANA DECOR',
    ])
  })
})

describe('comprei aqui x mais barato', () => {
  const material = pivotarPorFornecedor([
    custo({ descricao: 'Semi Blact 3 m', custo_unitario: 14.9, fornecedor_id: CORTTEX,
            fornecedor: 'CORTTEX INDUSTRIA TEXTIL' }),
    custo({ descricao: 'Semi Blact 3 m', custo_unitario: 16.4, fornecedor_id: TA_DECOR,
            fornecedor: 'TAPECARIA AMERICANA DECOR' }),
  ])[0]

  it('avisa quanto custa comprar onde não é o mais barato', () => {
    const aviso = pagandoAMais(material, TA_DECOR)
    expect(aviso).not.toBeNull()
    expect(aviso!.diferenca).toBeCloseTo(1.5, 4)
    expect(aviso!.menor.fornecedor_id).toBe(CORTTEX)
  })

  it('não avisa quando a marcada JÁ é a mais barata', () => {
    expect(pagandoAMais(material, CORTTEX)).toBeNull()
  })

  it('não avisa quando nada foi marcado', () => {
    expect(pagandoAMais(material, undefined)).toBeNull()
  })

  it('não avisa quando a loja marcada ainda não tem preço', () => {
    // Marcar e só depois digitar o preço é uma ordem possível; até o preço
    // chegar não há diferença nenhuma para mostrar.
    expect(pagandoAMais(material, ALUMITEC)).toBeNull()
  })

  it('marcação NÃO muda o custo do cálculo — ele segue sendo o menor', () => {
    // A regra da loja de 18/10. O check é registro de onde comprou, não
    // regra de preço: trocá-los faria o orçamento mudar de valor por causa
    // de uma marcação feita para organizar a compra.
    expect(material.menor!.custo_unitario).toBe(14.9)
    expect(material.menor!.fornecedor_id).toBe(CORTTEX)
  })
})
