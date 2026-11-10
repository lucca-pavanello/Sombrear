import { describe, it, expect } from 'vitest'
import type { Orcamento } from '../supabase'
import {
  agrupar, filtrar, ordenar, contarFaixas, contarNovos, resumir, parseValorBR,
  telefoneInternacional, formatarTelefone, linkWhatsApp, escritasFechou, escritaVoltar,
  valoresAnteriores, resumoItem,
} from '../acompanhar'

const AGORA = new Date('2026-11-10T12:00:00Z').getTime()
const diasAtras = (d: number) => new Date(AGORA - d * 86_400_000 - 1000).toISOString()

let n = 0
const o = (p: Partial<Orcamento> = {}): Orcamento => ({
  id: `id${++n}`, created_at: diasAtras(1), responsavel: 'Ana', cliente: 'Maria Silva',
  modelo: 'Rolô', tecido: 'Blackout Branco', quantidade: 1, valor_venda: 100, instalacao: 0, ...p,
})

describe('agrupar', () => {
  it('itens com o mesmo pedido_id viram um card; soltos ficam sozinhos', () => {
    const rows = [
      o({ pedido_id: 'P1', valor_venda: 100, instalacao: 20 }),
      o({ pedido_id: 'P1', valor_venda: 50 }),
      o({ valor_venda: 70 }),
    ]
    const cards = agrupar(rows, 'fila', AGORA)
    expect(cards).toHaveLength(2)
    const p1 = cards.find(c => c.pedidoId === 'P1')!
    expect(p1.itens).toHaveLength(2)
    expect(p1.total).toBe(170)
  })

  it('exclui desfecho, fechado e QA_HARNESS da fila', () => {
    const rows = [o(), o({ desfecho: 'sumiu' }), o({ fechado: true }), o({ cliente: 'QA_HARNESS' })]
    expect(agrupar(rows, 'fila', AGORA)).toHaveLength(1)
  })

  it('pedido está na fila se qualquer item está, e mostra só os pendentes', () => {
    const rows = [o({ pedido_id: 'P', fechado: true }), o({ pedido_id: 'P', valor_venda: 40 })]
    const cards = agrupar(rows, 'fila', AGORA)
    expect(cards).toHaveLength(1)
    expect(cards[0].itens).toHaveLength(1)
    expect(cards[0].total).toBe(40)
  })

  it('itensNoPedido conta também os itens já respondidos', () => {
    const rows = [o({ pedido_id: 'P', fechado: true }), o({ pedido_id: 'P', desfecho: 'sumiu' }), o({ pedido_id: 'P' })]
    const [card] = agrupar(rows, 'fila', AGORA)
    expect(card.itens).toHaveLength(1)
    expect(card.itensNoPedido).toBe(3)
  })

  it('vista respondidos pega só quem tem desfecho', () => {
    const rows = [o(), o({ desfecho: 'perdido', desfecho_motivo: 'Achou caro', desfecho_em: diasAtras(0) })]
    const cards = agrupar(rows, 'respondidos', AGORA)
    expect(cards).toHaveLength(1)
    expect(cards[0].desfecho).toBe('perdido')
    expect(cards[0].motivo).toBe('Achou caro')
  })
})

describe('faixas, resumo e selo', () => {
  const rows = [
    o({ created_at: diasAtras(2) }),
    o({ created_at: diasAtras(7) }),
    o({ created_at: diasAtras(15) }),
    o({ created_at: diasAtras(45), valor_venda: 300 }),
    o({ pedido_id: 'X', created_at: diasAtras(3) }),
    o({ pedido_id: 'X', created_at: diasAtras(3) }),
  ]
  const cards = agrupar(rows, 'fila', AGORA)

  it('conta por faixa em pedidos', () => {
    expect(contarFaixas(cards)).toEqual({ novo: 3, atencao: 1, frio: 1, todos: 5 })
  })

  it('o selo conta pedidos novos e bate com a aba "até 7 dias"', () => {
    expect(contarNovos(rows, AGORA)).toBe(3)
    expect(filtrar(cards, { faixa: 'novo' })).toHaveLength(contarNovos(rows, AGORA))
  })

  it('resumo soma valor parado e conta frios', () => {
    const r = resumir(cards)
    expect(r.fila).toBe(5)
    expect(r.frios).toBe(1)
    expect(r.parado).toBe(100 + 100 + 100 + 300 + 200)
  })
})

describe('filtrar e ordenar', () => {
  const cards = agrupar([
    o({ cliente: 'João Pereira', telefone: '(17) 99657-8816', created_at: diasAtras(1), valor_venda: 500 }),
    o({ cliente: 'Márcia', modelo: 'Double Vision', created_at: diasAtras(5), valor_venda: 900, responsavel: 'Bia' }),
    o({ cliente: 'Zé', created_at: diasAtras(20), valor_venda: 100 }),
  ], 'fila', AGORA)

  it('busca ignora acento e maiúscula, e acha por telefone e modelo', () => {
    expect(filtrar(cards, { busca: 'marcia' })).toHaveLength(1)
    expect(filtrar(cards, { busca: 'double' })).toHaveLength(1)
    expect(filtrar(cards, { busca: '99657' })).toHaveLength(1)
  })

  it('filtra por responsável', () => {
    expect(filtrar(cards, { responsavel: 'Bia' })).toHaveLength(1)
  })

  it('ordena por recentes, valor e antigos', () => {
    expect(ordenar(cards, 'recentes').map(c => c.cliente)).toEqual(['João Pereira', 'Márcia', 'Zé'])
    expect(ordenar(cards, 'valor').map(c => c.cliente)).toEqual(['Márcia', 'João Pereira', 'Zé'])
    expect(ordenar(cards, 'antigos').map(c => c.cliente)).toEqual(['Zé', 'Márcia', 'João Pereira'])
  })
})

describe('parseValorBR', () => {
  it('formato brasileiro', () => {
    expect(parseValorBR('1.200,50')).toBe(1200.5)
    expect(parseValorBR('1200,5')).toBe(1200.5)
    expect(parseValorBR('R$ 1.200,50')).toBe(1200.5)
    expect(parseValorBR('1.200')).toBe(1200)
    expect(parseValorBR('1200.50')).toBe(1200.5)
    expect(parseValorBR('950')).toBe(950)
  })
  it('vazio, zero e lixo viram null', () => {
    expect(parseValorBR('')).toBeNull()
    expect(parseValorBR('abc')).toBeNull()
    expect(parseValorBR('0')).toBeNull()
  })
})

describe('telefone e WhatsApp', () => {
  it('não duplica o 55', () => {
    expect(telefoneInternacional('(17) 99657-8816')).toBe('5517996578816')
    expect(telefoneInternacional('5517996578816')).toBe('5517996578816')
    expect(telefoneInternacional('')).toBe('')
  })
  it('formata para exibir', () => {
    expect(formatarTelefone('5517996578816')).toBe('(17) 99657-8816')
    expect(formatarTelefone('1733221100')).toBe('(17) 3322-1100')
  })
  it('link leva a mensagem pronta, codificada', () => {
    const [card] = agrupar([o({ cliente: 'maria SILVA', telefone: '17996578816', modelo: 'Rolô' })], 'fila', AGORA)
    const url = linkWhatsApp(card)
    expect(url.startsWith('https://wa.me/5517996578816?text=')).toBe(true)
    const texto = decodeURIComponent(url.split('?text=')[1])
    expect(texto).toBe('Olá, Maria! Aqui é da Sombrear. Passando para saber se ficou alguma dúvida sobre o orçamento de Rolô que enviamos. Posso ajudar?')
  })
  it('sem telefone não há link', () => {
    const [card] = agrupar([o({ telefone: null })], 'fila', AGORA)
    expect(linkWhatsApp(card)).toBe('')
  })
})

describe('escritasFechou', () => {
  const itens = [o({ valor_venda: 333.33 }), o({ valor_venda: 333.33 }), o({ valor_venda: 333.34 })]

  it('rateia o pago entre os itens e a soma bate ao centavo', () => {
    const e = escritasFechou(itens, { origem: 'google', parcelas: 3, cobrado: 1234.57 }, 'a@b.c', new Date(AGORA))
    const soma = e.reduce((s, x) => s + (x.patch.valor_cobrado ?? 0), 0)
    expect(Math.round(soma * 100)).toBe(123457)
    expect(e.every(x => x.patch.desfecho === 'fechou' && x.patch.fechado === true)).toBe(true)
    expect(e.every(x => x.patch.origem === 'google')).toBe(true)
  })

  it('valor igual ao calculado grava valor_cobrado null (limpa valor antigo)', () => {
    const e = escritasFechou(itens, { origem: '', parcelas: 1, cobrado: 1000 }, null, new Date(AGORA))
    expect(e.every(x => 'valor_cobrado' in x.patch && x.patch.valor_cobrado === null)).toBe(true)
    expect(e[0].patch.forma_pagamento_real).toBe('à vista')
  })

  it('sem forma de pagamento grava forma_pagamento_real null', () => {
    const e = escritasFechou(itens, { origem: '', parcelas: 0, cobrado: null }, null, new Date(AGORA))
    expect(e.every(x => x.patch.forma_pagamento_real === null && x.patch.valor_cobrado === null)).toBe(true)
  })

  it('o desfazer devolve o valor_cobrado e a forma antigos', () => {
    const antigo = o({ valor_cobrado: 777, forma_pagamento_real: '2x de R$ 388,50' })
    const [e] = escritasFechou([antigo], { origem: '', parcelas: 0, cobrado: null }, null, new Date(AGORA))
    expect(valoresAnteriores(antigo, e.patch)).toMatchObject({ valor_cobrado: 777, forma_pagamento_real: '2x de R$ 388,50' })
  })

  it('origem vazia mantém a que o item já tinha', () => {
    const e = escritasFechou([o({ origem: 'instagram' })], { origem: '', parcelas: 0, cobrado: null }, null)
    expect(e[0].patch.origem).toBe('instagram')
  })
})

describe('escritaVoltar', () => {
  it('perdido/sumiu: só zera os campos de desfecho', () => {
    const p = escritaVoltar(o({ desfecho: 'sumiu', status: 'CALCULADO' }))
    expect(p).toEqual({ desfecho: null, desfecho_em: null, desfecho_por: null, desfecho_motivo: null })
  })
  it('fechou: desliga fechado; status só volta se for "fechado"; nunca "em andamento"', () => {
    expect(escritaVoltar(o({ desfecho: 'fechou', status: 'fechado' }))).toMatchObject({ fechado: false, status: 'CALCULADO' })
    const outro = escritaVoltar(o({ desfecho: 'fechou', status: 'ENVIADO' }))
    expect(outro.fechado).toBe(false)
    expect('status' in outro).toBe(false)
  })
  it('linha antiga: não mexe em valor_cobrado nem forma', () => {
    const p = escritaVoltar(o({ desfecho: 'fechou', valor_cobrado: 900, forma_pagamento_real: '3x' }))
    expect('valor_cobrado' in p).toBe(false)
    expect('forma_pagamento_real' in p).toBe(false)
  })
  it('gravado por esta tela e ainda igual: limpa', () => {
    const p = escritaVoltar(
      o({ desfecho: 'fechou', valor_cobrado: 900, forma_pagamento_real: '3x' }),
      { valor_cobrado: 900, forma_pagamento_real: '3x' },
    )
    expect(p.valor_cobrado).toBeNull()
    expect(p.forma_pagamento_real).toBeNull()
  })
  it('gravado por esta tela mas alterado depois: preserva', () => {
    const p = escritaVoltar(o({ desfecho: 'fechou', valor_cobrado: 950 }), { valor_cobrado: 900 })
    expect('valor_cobrado' in p).toBe(false)
  })
})

describe('valoresAnteriores e resumoItem', () => {
  it('devolve o valor atual de cada campo do patch (null quando ausente)', () => {
    const item = o({ status: 'CALCULADO' })
    expect(valoresAnteriores(item, { desfecho: 'fechou', status: 'fechado', valor_cobrado: 1 }))
      .toEqual({ desfecho: null, status: 'CALCULADO', valor_cobrado: null })
  })
  it('resume o item', () => {
    expect(resumoItem(o({ largura: 1.5, altura: 2, quantidade: 2 }))).toBe('Rolô Blackout Branco 1,50×2,00 · 2 un')
  })
})
