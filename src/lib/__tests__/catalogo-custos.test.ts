import { describe, it, expect } from 'vitest'
import {
  liquido,
  paraUnidadeCanonica,
  normalizarItem,
  conferirDocumento,
  descontoTotal,
  type ItemDocumento,
} from '../catalogo/normalizar'

/**
 * Golden do catálogo de custos: os documentos reais que a loja mandou.
 *
 * Não são casos inventados. Cada número abaixo foi lido do PDF ou da foto, e o
 * total de cada bloco é o total IMPRESSO no papel. Se um destes quebrar, ou a
 * leitura do documento está errada, ou a regra de normalização mudou — e nos
 * dois casos o catálogo está prestes a gravar um custo que ninguém pagou.
 */

// ── Alumitec, pedido 122327 — 24/06/2026 ──────────────────────
// Ferragem de cortina. Tabela cheia com 30% por item, frete FOB.
const ALUMITEC_122327: ItemDocumento[] = [
  { descricao: 'SLSBB-SUPORTE L SIMPLES BRANCO', quantidade: 40, unidade: 'PC', precoBruto: 10.57, descontoPct: 30 },
  { descricao: 'PTA29BB-PONTEIRA TAMPA 29 BRANCO', quantidade: 20, unidade: 'PC', precoBruto: 6.64, descontoPct: 30 },
  // 6 PÇ / 36 MTS: compra-se 6 barras, cobra-se por 36 metros.
  { descricao: 'TS29LBB-TUBO DESL LEVE 29MM BRANCO', quantidade: 36, unidade: 'MTS', precoBruto: 18.25, descontoPct: 30 },
]

// ── Alumitec, pedido 115104 — 02/04/2026 ──────────────────────
// Onde moram as duas unidades traiçoeiras: MILHEIRO e ROLO.
const ALUMITEC_115104: ItemDocumento[] = [
  { descricao: 'TS29LTT-TUBO DESL LEVE 29MM TITANIO', quantidade: 36, unidade: 'MTS', precoBruto: 25.86, descontoPct: 30 },
  { descricao: 'TMSBB-TRILHO MAX SIMPLES C ABA BRANCO 27 MM', quantidade: 90, unidade: 'MTS', precoBruto: 7.44, descontoPct: 30 },
  { descricao: 'TMDBB-TRILHO MAX DUPLO BRANCO (40.7 MM)', quantidade: 30, unidade: 'MTS', precoBruto: 12.48, descontoPct: 30 },
  { descricao: 'TMDULBB-TRILHO MAX DUPLO ULTRA LARGO BB (84 MM)', quantidade: 90, unidade: 'MTS', precoBruto: 19.55, descontoPct: 30 },
  { descricao: 'TMTBB-TRILHO MAX TRIPLO BRANCO (67,3 MM)', quantidade: 30, unidade: 'MTS', precoBruto: 21.58, descontoPct: 30 },
  { descricao: 'SLSCR-SUPORTE L SIMPLES CROMADO', quantidade: 20, unidade: 'PC', precoBruto: 10.0, descontoPct: 30 },
  { descricao: 'SLDCR-SUPORTE L DUPLO C/REGULAGEM CROMADO', quantidade: 5, unidade: 'PC', precoBruto: 14.0, descontoPct: 30 },
  { descricao: 'SLDAE-SUPORTE L DUPLO C/REGULAGEM ESCOVADO', quantidade: 5, unidade: 'PC', precoBruto: 14.8, descontoPct: 30 },
  { descricao: 'SLDTT-SUPORTE L DUPLO C/REGULAGEM TITANIO', quantidade: 10, unidade: 'PC', precoBruto: 14.8, descontoPct: 30 },
  { descricao: 'PTA29CR-PONTEIRA TAMPA 29 CROMADO', quantidade: 10, unidade: 'PC', precoBruto: 5.95, descontoPct: 30 },
  { descricao: 'PTA29TT-PONTEIRA TAMPA 29 TITANIO', quantidade: 20, unidade: 'PC', precoBruto: 6.29, descontoPct: 30 },
  { descricao: 'PTA29AE-PONTEIRA TAMPA 29 ESCOVADO', quantidade: 20, unidade: 'PC', precoBruto: 6.29, descontoPct: 30 },
  { descricao: 'DC-DESLIZANTE DE CORDA BRANCO', quantidade: 4, unidade: 'MILH', precoBruto: 259.44, descontoPct: 30 },
  { descricao: 'FDP-FIO DOBRA PERFEITA BB 5X5 CM - ROLO 50 MTS', quantidade: 4, unidade: 'ROLO', precoBruto: 226.25, descontoPct: 30, metrosPorRolo: 50 },
]

// ── Corttex, pedido 012897 — 29/09/2026 ───────────────────────
// Tecido. Preço já líquido: NÃO existe coluna de desconto.
const CORTTEX_012897: ItemDocumento[] = [
  { descricao: '2819020 - VOIL FLAME 3.00M BEGE', quantidade: 100, unidade: 'MT', precoBruto: 11.0 },
  { descricao: '3272020 - VOIL FLAME 3.30M BEGE', quantidade: 50, unidade: 'MT', precoBruto: 14.5 },
  { descricao: '2819090 - VOIL FLAME 3.00M MARFIM', quantidade: 50, unidade: 'MT', precoBruto: 11.0 },
  { descricao: '2969020 - MICROFIBRA 3.00M BEGE', quantidade: 100, unidade: 'MT', precoBruto: 6.3 },
  { descricao: '2969090 - MICROFIBRA 3.00M MARFIM', quantidade: 50, unidade: 'MT', precoBruto: 6.3 },
  { descricao: '2849090 - BLACKOUT LISO 2.80M MARFIM', quantidade: 50, unidade: 'MT', precoBruto: 14.5 },
]

// ── TA Decor, pedido 533152 — 02/10/2026 ──────────────────────
// "Desc. 0,00" porque o desconto já está na tabela de campanha.
const TADECOR_533152: ItemDocumento[] = [
  { descricao: '38.013/09 LINHO IRLANDES II - TRIGO', quantidade: 94.6, unidade: 'MT', precoBruto: 16.4, descontoPct: 0 },
  { descricao: '22.139.1.L/05 MICROFIBRA CLASSICA 3,30L - AREIA', quantidade: 100, unidade: 'MT', precoBruto: 13.9, descontoPct: 0 },
  { descricao: '38.041 LINHO LIBIO - COR UNICA', quantidade: 47.6, unidade: 'MT', precoBruto: 22.9, descontoPct: 0 },
]

describe('a soma dos itens bate com o total impresso no documento', () => {
  it('Alumitec 122327 fecha em R$ 848,82', () => {
    const c = conferirDocumento(ALUMITEC_122327, 848.82)
    expect(c.somado).toBe(848.82)
    expect(c.diferenca).toBe(0)
    expect(c.fecha).toBe(true)
  })

  it('Alumitec 122327 desconta exatamente os R$ 363,78 que o papel declara', () => {
    expect(descontoTotal(ALUMITEC_122327)).toBe(363.78)
  })

  it('Corttex 012897 fecha em R$ 4.045,00', () => {
    const c = conferirDocumento(CORTTEX_012897, 4045.0)
    expect(c.somado).toBe(4045.0)
    expect(c.fecha).toBe(true)
  })

  it('TA Decor 533152 fecha em R$ 4.031,48', () => {
    const c = conferirDocumento(TADECOR_533152, 4031.48)
    expect(c.somado).toBe(4031.48)
    expect(c.fecha).toBe(true)
  })

  it('recusa quando a conta não fecha, em vez de arredondar a diferença para debaixo do tapete', () => {
    const c = conferirDocumento(CORTTEX_012897, 4000.0)
    expect(c.fecha).toBe(false)
    expect(c.diferenca).toBe(45.0)
  })
})

describe('desconto: só o que está impresso, e nunca duas vezes', () => {
  it('Alumitec: 10,57 com 30% vira 7,399 — três casas, não duas', () => {
    expect(liquido(10.57, 30)).toBe(7.399)
    expect(liquido(18.25, 30)).toBe(12.775)
    expect(liquido(259.44, 30)).toBe(181.608)
  })

  it('TA Decor: desconto 0 mantém o unitário da tabela de campanha intacto', () => {
    expect(liquido(16.4, 0)).toBe(16.4)
    expect(liquido(16.4)).toBe(16.4)
  })

  it('aplicar 30% na TA Decor descontaria duas vezes — e dá outro total', () => {
    const comoSeTivesseDesconto = TADECOR_533152.map(i => ({ ...i, descontoPct: 30 }))
    const c = conferirDocumento(comoSeTivesseDesconto, 4031.48)
    expect(c.fecha).toBe(false)
    expect(c.somado).toBe(2822.04)
  })

  it('desconto fora da faixa para o cálculo em vez de gerar custo negativo', () => {
    expect(() => liquido(10, 100)).toThrow(/faixa/i)
    expect(() => liquido(10, -5)).toThrow(/faixa/i)
  })
})

describe('unidades: milheiro e rolo não são comparáveis como vêm', () => {
  it('MILHEIRO vira unidade: R$ 181,608 o milheiro é R$ 0,181608 a peça', () => {
    const r = paraUnidadeCanonica(4, 'MILH', 181.608)
    expect(r.unidadeCanonica).toBe('un')
    expect(r.quantidadeCanonica).toBe(4000)
    expect(r.custoUnitario).toBeCloseTo(0.181608, 6)
  })

  it('ROLO de 50 m vira metro: R$ 158,375 o rolo é R$ 3,1675 o metro', () => {
    const r = paraUnidadeCanonica(4, 'ROLO', 158.375, 50)
    expect(r.unidadeCanonica).toBe('m')
    expect(r.quantidadeCanonica).toBe(200)
    expect(r.custoUnitario).toBeCloseTo(3.1675, 6)
  })

  it('ROLO sem metragem PARA e diz o que falta — não chuta 50', () => {
    expect(() => paraUnidadeCanonica(4, 'ROLO', 158.375)).toThrow(/metragem/i)
  })

  it('PÇ cobrado por metro entra como metro, com a quantidade de metros', () => {
    const r = paraUnidadeCanonica(36, 'MTS', 12.775)
    expect(r.unidadeCanonica).toBe('m')
    expect(r.quantidadeCanonica).toBe(36)
  })

  it('a conversão preserva o dinheiro: quantidade × custo canônico = subtotal', () => {
    for (const item of ALUMITEC_115104) {
      const n = normalizarItem(item)
      expect(n.quantidadeCanonica * n.custoUnitario).toBeCloseTo(n.subtotal, 2)
    }
  })
})

describe('os subtotais de cada linha, item a item', () => {
  it('Alumitec 115104 reproduz os 14 subtotais impressos', () => {
    const esperado = [
      651.67, 468.72, 262.08, 1231.65, 453.18, 140.0, 49.0,
      51.8, 103.6, 41.65, 88.06, 88.06, 726.43, 633.5,
    ]
    expect(ALUMITEC_115104.map(i => normalizarItem(i).subtotal)).toEqual(esperado)
  })

  it('Corttex reproduz os 6 subtotais impressos', () => {
    expect(CORTTEX_012897.map(i => normalizarItem(i).subtotal)).toEqual([
      1100.0, 725.0, 550.0, 630.0, 315.0, 725.0,
    ])
  })

  it('TA Decor reproduz os 3 subtotais, inclusive o 47,6 × 22,90 = 1.090,04', () => {
    expect(TADECOR_533152.map(i => normalizarItem(i).subtotal)).toEqual([
      1551.44, 1390.0, 1090.04,
    ])
  })
})

describe('a lista que a cliente digitou à mão é a tabela da Corttex', () => {
  // A Stella mandou os preços de cabeça. Conferem ao centavo com o pedido
  // 012897 — o que valida a lista dela E a nossa leitura do documento.
  const listaDaCliente: Record<string, number> = {
    'Flame pesado': 11.0,
    'Flame pesado 3,30 m': 14.5,
    'Microfibra 90 grs 3 m': 6.3,
    'Blact 100%': 14.5,
  }

  it('Flame 3,00 m: a cliente diz 11,00 e a Corttex cobra 11,00', () => {
    const doc = CORTTEX_012897.find(i => i.descricao.includes('VOIL FLAME 3.00M BEGE'))!
    expect(liquido(doc.precoBruto)).toBe(listaDaCliente['Flame pesado'])
  })

  it('Flame 3,30 m: 14,50 nos dois', () => {
    const doc = CORTTEX_012897.find(i => i.descricao.includes('VOIL FLAME 3.30M'))!
    expect(liquido(doc.precoBruto)).toBe(listaDaCliente['Flame pesado 3,30 m'])
  })

  it('Microfibra 3,00 m: 6,30 nos dois', () => {
    const doc = CORTTEX_012897.find(i => i.descricao.includes('MICROFIBRA 3.00M BEGE'))!
    expect(liquido(doc.precoBruto)).toBe(listaDaCliente['Microfibra 90 grs 3 m'])
  })

  it('Blackout: 14,50 nos dois — mas o documento diz 2,80 m e a lista não diz largura', () => {
    const doc = CORTTEX_012897.find(i => i.descricao.includes('BLACKOUT LISO'))!
    expect(liquido(doc.precoBruto)).toBe(listaDaCliente['Blact 100%'])
    expect(doc.descricao).toContain('2.80M')
  })
})

describe('produtos de nome parecido que não são o mesmo produto', () => {
  it('a Microfibra da Corttex custa menos da metade da Microfibra da TA Decor', () => {
    const corttex = CORTTEX_012897.find(i => i.descricao.includes('MICROFIBRA 3.00M BEGE'))!
    const taDecor = TADECOR_533152.find(i => i.descricao.includes('MICROFIBRA CLASSICA'))!

    const custoCorttex = normalizarItem(corttex).custoUnitario
    const custoTaDecor = normalizarItem(taDecor).custoUnitario

    expect(custoCorttex).toBe(6.3)
    expect(custoTaDecor).toBe(13.9)
    // 2,2× de diferença: unificar os dois pelo nome "microfibra" estragaria o custo.
    expect(custoTaDecor / custoCorttex).toBeGreaterThan(2)
  })

  it('o mesmo trilho da Alumitec subiu de preço entre março e abril', () => {
    // TMDBB em 09/03 (pedido 113818) e em 02/04 (pedido 115104).
    const marco = liquido(11.86, 30)
    const abril = liquido(12.48, 30)
    expect(marco).toBe(8.302)
    expect(abril).toBe(8.736)
    expect(abril).toBeGreaterThan(marco)
  })
})
