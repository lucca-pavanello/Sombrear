import { describe, it, expect } from 'vitest'
import type { Orcamento } from '../supabase'
import { dividirRotulo, montarTabelaSemanario, partesDoPdf, type NivelCustoPdf } from '../semanarioPdf'

type Detalhe = NonNullable<Orcamento['custos_detalhe']>
const parte = (rotulo: string, real: number): Detalhe[number] => ({ parte: rotulo, tabela: real, fator: 1, real })

const ROLO: Detalhe = [
  parte('Tecido SCREEN 1% BEGE — rolo 1,50m a R$ 31,00/m²', 93),
  parte('Ferragem Rolô branca — tubo 38mm', 40),
]
const MOTORIZADO: Detalhe = [
  parte('Tecido SCREEN 1% BEGE — rolo 1,50m a R$ 31,00/m² × 2', 186),
  parte('Estrutura motorizada — 2,00m, até 6,00 (grupo 41/sem-juncao) × 2', 120),
  parte('Motor motor (110 / 220) (pç) 6n até 16 kg × 2', 600),
  parte('Controle 6 canais', 80),
  parte('Bandô branco — 4,00m', 30),
]

const orc = (id: string, extra: Partial<Orcamento> = {}) => ({
  id, cliente: `Cliente ${id}`, modelo: 'Rolo', tecido: 'SCREEN 1% BEGE', largura: 2, altura: 1.5,
  numero_pedido: null, custos_detalhe: null, ...extra,
}) as unknown as Orcamento

const ajudantes = {
  pago: () => 1000,
  pagoParceira: () => 100,
  sobraItem: () => 500,
  pgtoReal: () => ({ forma: '4x no cartão', parcelas: 4 }),
  totaisGrupo: (itens: Orcamento[]) => ({ bruto: 1000 * itens.length, parceira: 100 * itens.length, sobra: 500 * itens.length }),
  dataDe: () => '2026-09-10T12:00:00',
}

const montar = (grupos: { itens: Orcamento[] }[], nivel: NivelCustoPdf) =>
  montarTabelaSemanario({
    ...ajudantes, nivel,
    grupos: grupos.map(g => ({ pedido: null, itens: g.itens })),
    totais: { bruto: 5000, parceira: 400, sobra: 2000 },
  })

describe('partesDoPdf', () => {
  it('Rolo comum: só a parte Tecido em "tecido e motorização"', () => {
    const r = partesDoPdf({ tecido: 'SCREEN 1% BEGE', custos_detalhe: ROLO }, 'tecido-motor')
    expect(r).toEqual([{ rotulo: 'Tecido — rolo 1,50m a R$ 31,00/m²', real: 93 }])
  })

  it('motorizado: Tecido, Motor e Controle, na ordem gravada; sem Estrutura, Junção e Bandô', () => {
    const r = partesDoPdf({ tecido: 'SCREEN 1% BEGE', custos_detalhe: MOTORIZADO }, 'tecido-motor')
    expect(r.map(p => p.rotulo)).toEqual([
      'Tecido — rolo 1,50m a R$ 31,00/m² × 2',
      'Motor motor (110 / 220) (pç) 6n até 16 kg × 2',
      'Controle 6 canais',
    ])
  })

  it('"todas as partes" traz tudo, na ordem gravada', () => {
    const r = partesDoPdf({ tecido: 'SCREEN 1% BEGE', custos_detalhe: MOTORIZADO }, 'todas')
    expect(r.map(p => p.real)).toEqual([186, 120, 600, 80, 30])
    expect(r[1].rotulo).toBe('Estrutura motorizada — 2,00m, até 6,00 (grupo 41/sem-juncao) × 2')
  })

  it('usa o valor real, não o de tabela', () => {
    const r = partesDoPdf({ tecido: '', custos_detalhe: [{ parte: 'Controle 6 canais', tabela: 50, fator: 1.6, real: 80 }] }, 'todas')
    expect(r).toEqual([{ rotulo: 'Controle 6 canais', real: 80 }])
  })

  it.each<NivelCustoPdf>(['tecido-motor', 'todas'])('nada vazio (%s): sem detalhe, lista vazia, real 0 ou rótulo vazio', nivel => {
    expect(partesDoPdf({ tecido: 'X', custos_detalhe: null }, nivel)).toEqual([])
    expect(partesDoPdf({ tecido: 'X', custos_detalhe: undefined }, nivel)).toEqual([])
    expect(partesDoPdf({ tecido: 'X', custos_detalhe: [] }, nivel)).toEqual([])
    expect(partesDoPdf({ tecido: 'X', custos_detalhe: [parte('Tecido X — rolo 1,50m', 0)] }, nivel)).toEqual([])
    expect(partesDoPdf({ tecido: 'X', custos_detalhe: [parte('', 50), parte('   ', 50)] }, nivel)).toEqual([])
  })

  it('"Sem custos" nunca devolve parte', () => {
    expect(partesDoPdf({ tecido: 'SCREEN 1% BEGE', custos_detalhe: MOTORIZADO }, 'nenhum')).toEqual([])
  })

  it('encurta "Tecido <nome do item>" sem diferenciar maiúsculas', () => {
    const r = partesDoPdf({ tecido: 'screen 1% bege', custos_detalhe: ROLO }, 'tecido-motor')
    expect(r[0].rotulo).toBe('Tecido — rolo 1,50m a R$ 31,00/m²')
  })

  it('não encurta quando o tecido do item é outro', () => {
    const r = partesDoPdf({ tecido: 'BLACKOUT CINZA', custos_detalhe: ROLO }, 'tecido-motor')
    expect(r[0].rotulo).toBe('Tecido SCREEN 1% BEGE — rolo 1,50m a R$ 31,00/m²')
  })

  it('não encurta quando o nome do item é só o começo do nome do tecido', () => {
    const r = partesDoPdf({ tecido: 'SCREEN 1', custos_detalhe: ROLO }, 'tecido-motor')
    expect(r[0].rotulo).toBe('Tecido SCREEN 1% BEGE — rolo 1,50m a R$ 31,00/m²')
  })

  it('não encurta quando o nome do item é uma palavra a menos que o do tecido', () => {
    const r = partesDoPdf({ tecido: 'SCREEN 1%', custos_detalhe: ROLO }, 'tecido-motor')
    expect(r[0].rotulo).toBe('Tecido SCREEN 1% BEGE — rolo 1,50m a R$ 31,00/m²')
  })

  it('rótulo que só começa parecido com Motor/Controle não entra em tecido-motor', () => {
    const d = [{ parte: 'Motor-tubular avulso', tabela: 10, fator: 1, real: 10 }, { parte: 'Motorização extra', tabela: 10, fator: 1, real: 10 }]
    expect(partesDoPdf({ tecido: '', custos_detalhe: d }, 'tecido-motor')).toEqual([])
  })
})

describe('dividirRotulo', () => {
  it.each([
    ['Tecido — rolo 1,50m a R$ 31,00/m²', 'Tecido', 'rolo 1,50m a R$ 31,00/m²'],
    ['Ferragem Rolô branca — tubo 38mm', 'Ferragem', 'Rolô branca — tubo 38mm'],
    ['Estrutura motorizada — 2,00m, até 6,00 (grupo 41/sem-juncao) × 2', 'Estrutura', 'motorizada — 2,00m, até 6,00 (grupo 41/sem-juncao) × 2'],
    ['Controle 6 canais', 'Controle', '6 canais'],
    ['Junção 53mm', 'Junção', '53mm'],
    ['Bandô branco — 4,00m', 'Bandô', 'branco — 4,00m'],
    ['Kit Box branco', 'Kit Box', 'branco'],
    ['Motor motor (110 / 220) (pç) 6n até 16 kg × 2', 'Motor', '(110 / 220) 6n até 16 kg × 2'],
    ['Motor', 'Motor', ''],
    ['Tecido  —  rolo 2,00m', 'Tecido', 'rolo 2,00m'],
  ])('%s', (rotulo, categoria, detalhe) => {
    expect(dividirRotulo(rotulo)).toEqual({ categoria, detalhe })
  })

  it('só tira a categoria repetida se for a palavra inteira', () => {
    expect(dividirRotulo('Motor motorizado 6n').detalhe).toBe('motorizado 6n')
  })

  it('"(pç)" some em qualquer posição', () => {
    expect(dividirRotulo('Motor 6n (pç) até 16 kg').detalhe).toBe('6n até 16 kg')
  })
})

const HEAD_ATUAL = ['Data', 'Pedido', 'Cliente', 'Produto', 'Cliente pagou', 'Parcela', 'Pagamento', 'À parceira', 'Sobra']

describe('montarTabelaSemanario', () => {
  const grupos = [
    { itens: [orc('a', { custos_detalhe: MOTORIZADO, modelo: 'Rolo Motorizado' })] },
    { itens: [orc('b', { custos_detalhe: ROLO }), orc('c')] },
    { itens: [orc('d', { custos_detalhe: [] })] },
  ]

  it('"Sem custos": cabeça igual à de hoje, 9 colunas, nenhuma linha de parte', () => {
    const t = montar(grupos, 'nenhum')
    expect(t.head).toEqual([HEAD_ATUAL])
    expect([...t.head, ...t.body, ...t.foot].every(l => l.length === 9)).toBe(true)
    expect(t.partes.every(p => p.length === 0)).toBe(true)
    expect(t.direita).toEqual([4, 5, 7, 8])
    expect(t.centro).toEqual([1, 6])
    expect(t.body).toHaveLength(5) // a, b, c, total do pedido b+c, d
    expect(t.foot[0].slice(0, 4)).toEqual(['', '', '', 'TOTAIS'])
    expect(t.foot[0][4]).toMatch(/5\.000,00/)
  })

  it('com custos: 10 colunas em cabeça, corpo e rodapé, com "Custo" entre Produto e Cliente pagou', () => {
    for (const nivel of ['tecido-motor', 'todas'] as const) {
      const t = montar(grupos, nivel)
      expect(t.head[0]).toEqual(['Data', 'Pedido', 'Cliente', 'Produto', 'Custo', 'Cliente pagou', 'Parcela', 'Pagamento', 'À parceira', 'Sobra'])
      expect([...t.head, ...t.body, ...t.foot].every(l => l.length === 10)).toBe(true)
      expect(t.direita).toEqual([4, 5, 6, 8, 9])
      expect(t.centro).toEqual([1, 7])
    }
  })

  it('o corpo só tem linhas de item e de total; as partes vão em `partes`, com o valor já formatado', () => {
    const t = montar(grupos, 'tecido-motor')
    expect(t.body).toHaveLength(5) // a, b, c, total do pedido b+c, d
    expect(t.body.every(l => l[4] === '')).toBe(true)
    expect(t.partes[0].map(p => p.rotulo)).toEqual([
      'Tecido — rolo 1,50m a R$ 31,00/m² × 2',
      'Motor motor (110 / 220) (pç) 6n até 16 kg × 2',
      'Controle 6 canais',
    ])
    expect(t.partes[0][0].valor).toMatch(/^R\$\s186,00$/)
    expect(t.partes[0][1]).toMatchObject({ categoria: 'Motor', detalhe: '(110 / 220) 6n até 16 kg × 2' })
    expect(t.colProduto).toBe(3)
    expect(t.colCusto).toBe(4)
  })

  it('item sem custos_detalhe (null ou []) fica com partes vazio', () => {
    const t = montar([{ itens: [orc('x')] }, { itens: [orc('y', { custos_detalhe: [] })] }], 'todas')
    expect(t.partes).toEqual([[], []])
  })

  it('"Total do pedido" só em pedido com 2+ itens, com os valores sob Cliente pagou / À parceira / Sobra', () => {
    const t = montar(grupos, 'tecido-motor')
    const idx = t.body.flatMap((l, i) => (l[3] === 'Total do pedido' ? [i] : []))
    expect(idx).toHaveLength(1)
    const l = t.body[idx[0]]
    expect(t.partes[idx[0]]).toEqual([])
    expect(l[4]).toBe('')
    expect(l[5]).toMatch(/2\.000,00/)
    expect(l[6]).toBe('')
    expect(l[7]).toBe('')
    expect(l[8]).toMatch(/200,00/)
    expect(l[9]).toMatch(/1\.000,00/)
    expect(t.foot[0][4]).toBe('')
    expect(t.foot[0][5]).toMatch(/5\.000,00/)
  })

  it('partes tem o mesmo tamanho do corpo; total e item sem custo levam []', () => {
    const t = montar(grupos, 'tecido-motor')
    expect(t.partes).toHaveLength(t.body.length)
    expect(t.partes.map(p => p.length)).toEqual([3, 1, 0, 0, 0])
  })
})
