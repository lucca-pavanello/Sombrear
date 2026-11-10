/**
 * Copilot: orçamentos em aberto e desfechos. Os dados agora trazem também a fila do
 * Acompanhar; o que não pode acontecer é isso mexer nos números de venda de sempre.
 */
import { describe, expect, it } from 'vitest'
import {
  desfechosDoPeriodo, orcamentosEmAberto, rodarFerramenta, type LeadCopilot, type VendaCopilot,
} from '../copilot/ferramentas'
import { FERRAMENTAS } from '../copilot/prompt'

const venda = (p: Partial<VendaCopilot>): VendaCopilot => ({
  id: Math.random().toString(36).slice(2), created_at: '2026-09-10T12:00:00Z', fechado: true, ...p,
})
const aberto = (p: Partial<VendaCopilot>): VendaCopilot => ({
  id: Math.random().toString(36).slice(2), created_at: '2026-09-18T12:00:00Z', fechado: false, desfecho: null, ...p,
})
const lead = (p: Partial<LeadCopilot>): LeadCopilot => ({
  id: Math.random().toString(36).slice(2), created_at: '2026-09-01T12:00:00Z', status_lead: '3', ...p,
})
const HOJE = '2026-09-20'
const setembro = { inicio: '2026-09-01', fim: '2026-09-30' }

describe('orçamentos em aberto nos dados não mexem nos números de venda', () => {
  const vendas = [
    venda({ pedido_id: 'P', valor_venda: 100, margem: 40, data_pedido: '2026-09-01', modelo: 'Rolo', telefone: '17 99999-0001' }),
    venda({ valor_venda: 300, margem: 20, data_pedido: '2026-09-02', modelo: 'Double', origem: 'instagram' }),
  ]
  const extras = [
    aberto({ valor_venda: 9999, margem: -50, modelo: 'Rolo', data_pedido: '2026-09-03', telefone: '17 99999-0001' }),
    aberto({ valor_venda: 5000, desfecho: 'perdido', desfecho_em: '2026-09-05T12:00:00Z', data_pedido: '2026-09-03' }),
    aberto({ valor_venda: 777, desfecho: 'sumiu', desfecho_em: '2026-09-06T12:00:00Z' }),
  ]
  const leads = [lead({ id: 'L1', nome: 'Ana', whatsapp: '5517999990001', origem: 'instagram', created_at: '2026-08-30T12:00:00Z', lead_temperatura: 'quente', ultimo_valor_cotado: 'R$ 100,00' })]

  it('toda ferramenta de venda e de lead dá o mesmo resultado com ou sem a fila', () => {
    const so = { orcamentos: vendas, leads }
    const com = { orcamentos: [...vendas, ...extras], leads }
    const casos: [string, Record<string, unknown>][] = [
      ['numeros_do_periodo', { periodo: setembro }],
      ['comparar_periodos', { atual: setembro, anterior: { inicio: '2026-08-01', fim: '2026-08-31' } }],
      ['serie_mensal', { meses: 3 }],
      ['vendas_por_modelo', { periodo: setembro }],
      ['resultado_por_canal', { periodo: setembro }],
      ['leads_quentes', {}],
      ['leads_parados', { dias: 1 }],
      ['ver_lead', { termo: 'Ana' }],
    ]
    for (const [nome, args] of casos) {
      expect(rodarFerramenta(nome, args, com, HOJE), nome).toEqual(rodarFerramenta(nome, args, so, HOJE))
    }
  })
})

describe('orcamentos_em_aberto', () => {
  const fila = [
    aberto({ cliente: 'Ana', pedido_id: 'P1', valor_venda: 1000, modelo: 'Rolo', responsavel: 'Lucca', created_at: '2026-09-18T12:00:00Z', telefone: '17999990001' }),
    aberto({ cliente: 'Ana', pedido_id: 'P1', valor_venda: 500, instalacao: 100, modelo: 'Double', responsavel: 'Lucca', created_at: '2026-09-18T12:00:00Z' }),
    aberto({ cliente: 'Bia', valor_venda: 3000, modelo: 'Rolo', responsavel: 'Arthur', created_at: '2026-09-02T12:00:00Z' }),
    aberto({ cliente: 'Caio', valor_venda: 200, modelo: 'Romana', responsavel: 'Arthur', created_at: '2026-07-01T12:00:00Z' }),
    aberto({ cliente: 'Dani', valor_cobrado: 400, valor_venda: 999, created_at: '2026-09-19T12:00:00Z', responsavel: 'Lucca' }),
    aberto({ cliente: 'QA_HARNESS', valor_venda: 8888 }),
    aberto({ cliente: 'Fechado', fechado: true, valor_venda: 7777 }),
    aberto({ cliente: 'Respondido', desfecho: 'perdido', valor_venda: 6666 }),
  ]

  it('conta a fila, soma itens do mesmo pedido e separa por faixa de espera', () => {
    const r = orcamentosEmAberto(fila, {}, HOJE)
    expect(r.orcamentos_em_aberto).toBe(4)
    expect(r.valor_total).toBe(5200)
    expect(r.por_faixa_de_espera).toEqual([
      { faixa: 'até 7 dias', orcamentos: 2, valor: 2000 },
      { faixa: '8 a 30 dias', orcamentos: 1, valor: 3000 },
      { faixa: 'mais de 30 dias', orcamentos: 1, valor: 200 },
    ])
    expect('orcamentos' in r).toBe(false)
  })

  it('lista os maiores ou os mais antigos, sem telefone', () => {
    const maiores = orcamentosEmAberto(fila, { limite: 2 }, HOJE)
    expect(maiores.orcamentos!.map((c) => c.cliente)).toEqual(['Bia', 'Ana'])
    expect(maiores.orcamentos![1]).toEqual({
      cliente: 'Ana', modelo: 'Rolo, Double', valor: 1600, dias_parado: 2, responsavel: 'Lucca',
    })
    const antigos = orcamentosEmAberto(fila, { limite: 1, ordem: 'antigos' }, HOJE)
    expect(antigos.orcamentos![0].cliente).toBe('Caio')
    expect(JSON.stringify(maiores)).not.toMatch(/999990001|telefone/)
  })

  it('filtra por responsável e modelo sem ligar para acento ou caixa', () => {
    expect(orcamentosEmAberto(fila, { responsavel: 'arthur' }, HOJE).orcamentos_em_aberto).toBe(2)
    expect(orcamentosEmAberto(fila, { modelo: 'ROLO' }, HOJE).orcamentos_em_aberto).toBe(2)
  })

  it('despacha pela IA, limita a lista e está declarada', () => {
    const r = rodarFerramenta('orcamentos_em_aberto', { limite: 500, ordem: 'antigos' }, { orcamentos: fila, leads: [] }, HOJE) as { mostrando: number }
    expect(r.mostrando).toBe(4)
    expect(FERRAMENTAS.map((f) => f.name)).toEqual(expect.arrayContaining(['orcamentos_em_aberto', 'desfechos_do_periodo']))
  })
})

describe('desfechos_do_periodo', () => {
  const marcado = (p: Partial<VendaCopilot>) => aberto({ desfecho_em: '2026-09-10T15:00:00Z', ...p })
  const base = [
    marcado({ desfecho: 'fechou', fechado: true, valor_venda: 1000 }),
    marcado({ desfecho: 'fechou', fechado: true, valor_venda: 500, pedido_id: 'X' }),
    marcado({ desfecho: 'fechou', fechado: true, valor_venda: 500, pedido_id: 'X' }),
    marcado({ desfecho: 'perdido', desfecho_motivo: 'achou caro', valor_venda: 300 }),
    marcado({ desfecho: 'perdido', desfecho_motivo: 'Achou caro', valor_venda: 200 }),
    marcado({ desfecho: 'perdido', desfecho_motivo: 'Prazo de entrega', valor_venda: 900 }),
    marcado({ desfecho: 'perdido', desfecho_motivo: null, valor_venda: 50 }),
    marcado({ desfecho: 'sumiu', valor_venda: 100 }),
    marcado({ desfecho: 'perdido', desfecho_motivo: 'Achou caro', valor_venda: 1, desfecho_em: '2026-08-10T15:00:00Z' }),
    marcado({ desfecho: 'perdido', cliente: 'QA_HARNESS', valor_venda: 5 }),
  ]

  it('conta por desfecho, agrupa pedido e calcula a conversão entre respondidos', () => {
    const r = desfechosDoPeriodo(base, setembro)
    expect(r.fechou).toBe(2)
    expect(r.nao_fechou).toBe(4)
    expect(r.sumiu).toBe(1)
    expect(r.respondidos).toBe(6)
    expect(r.conversao_entre_respondidos_pct).toBe(33.3)
    expect(r.conversao_sobre_todos_pct).toBe(28.6)
    expect(r.valor_fechou).toBe(2000)
    expect(r.valor_nao_fechou).toBe(1450)
  })

  it('ranqueia os motivos de perda juntando a caixa e usando o texto padrão', () => {
    const { motivos_de_perda } = desfechosDoPeriodo(base, setembro)
    expect(motivos_de_perda[0]).toEqual({ motivo: 'Achou caro', orcamentos: 2, valor: 500 })
    expect(motivos_de_perda.map((m) => m.motivo)).toEqual(['Achou caro', 'Prazo de entrega', 'sem motivo informado'])
  })

  it('período sem desfecho não inventa taxa', () => {
    const r = desfechosDoPeriodo(base, { inicio: '2026-01-01', fim: '2026-01-31' })
    expect(r.conversao_entre_respondidos_pct).toBeNull()
    expect(r.motivos_de_perda).toEqual([])
  })
})
