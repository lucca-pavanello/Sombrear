import { describe, it, expect } from 'vitest'
import {
  parseQuantidade, diferenca, linhaDaIA, ordenarPorConfianca, materiaisDuplicados,
  problemaDaLinha, podeIncluir, resumir, motivoContagem, type LinhaContagem, type ProdutoContagem,
} from '../estoque/contagem'
import { sanitizarContagem } from '../estoque/contagem-resposta'

const prod = (id: string, q: number): ProdutoContagem => ({ id, nome: `Mat ${id}`, unidade: 'm', quantidade_atual: q })
const mapa = (...ps: ProdutoContagem[]) => new Map(ps.map((p) => [p.id, p]))
const linha = (o: Partial<LinhaContagem>): LinhaContagem => ({
  uid: 'x', textoLido: '', materialId: '', contado: '', confianca: 'alta', observacao: '', incluir: true, manual: false, ...o,
})

describe('parseQuantidade', () => {
  it('lê formatos brasileiros', () => {
    expect(parseQuantidade('1,5')).toBe(1.5)
    expect(parseQuantidade('1.250,5')).toBe(1250.5)
    expect(parseQuantidade('1.250')).toBe(1250)
    expect(parseQuantidade('1.5')).toBe(1.5)
    expect(parseQuantidade(' 12 ')).toBe(12)
    expect(parseQuantidade('0')).toBe(0)
    expect(parseQuantidade('1,250.5')).toBe(1250.5)
  })
  it('rejeita lixo, vazio e negativo', () => {
    for (const v of ['', '  ', 'abc', '-3', '1,2,3', '1.2.3', '12m', null, undefined]) expect(parseQuantidade(v as never)).toBeNull()
    expect(parseQuantidade(-1)).toBeNull()
    expect(parseQuantidade(NaN)).toBeNull()
  })
})

describe('diferenca', () => {
  it('calcula em 3 casas sem ruído de float', () => {
    expect(diferenca('10,3', 10.1)).toBe(0.2)
    expect(diferenca('5', 8)).toBe(-3)
    expect(diferenca('', 8)).toBeNull()
  })
})

describe('linhas', () => {
  it('linha da IA sem material ou quantidade começa excluída', () => {
    expect(linhaDaIA({ texto_lido: 'x', material_id: null, quantidade: 3, unidade_lida: null, confianca: 'alta', observacao: '' }).incluir).toBe(false)
    expect(linhaDaIA({ texto_lido: 'x', material_id: 'a', quantidade: null, unidade_lida: null, confianca: 'alta', observacao: '' }).incluir).toBe(false)
    const ok = linhaDaIA({ texto_lido: 'x', material_id: 'a', quantidade: 2.5, unidade_lida: 'm', confianca: 'alta', observacao: '' })
    expect(ok.incluir).toBe(true)
    expect(ok.contado).toBe('2,5')
  })
  it('ordena baixa confiança primeiro, estável', () => {
    const r = ordenarPorConfianca([
      linha({ uid: 'a', confianca: 'alta' }), linha({ uid: 'b', confianca: 'baixa' }),
      linha({ uid: 'c', confianca: 'media' }), linha({ uid: 'd', confianca: 'baixa' }),
    ])
    expect(r.map((l) => l.uid)).toEqual(['b', 'd', 'c', 'a'])
  })
  it('duplicidade só conta linhas incluídas', () => {
    const ls = [linha({ uid: '1', materialId: 'a' }), linha({ uid: '2', materialId: 'a' }), linha({ uid: '3', materialId: 'b' }), linha({ uid: '4', materialId: 'b', incluir: false })]
    expect([...materiaisDuplicados(ls)]).toEqual(['a'])
  })
  it('problema e podeIncluir', () => {
    const dup = new Set(['a'])
    expect(problemaDaLinha(linha({ materialId: '' }), dup)).toBe('sem_material')
    expect(problemaDaLinha(linha({ materialId: 'b', contado: '' }), dup)).toBe('sem_quantidade')
    expect(problemaDaLinha(linha({ materialId: 'a', contado: '1' }), dup)).toBe('duplicado')
    expect(problemaDaLinha(linha({ materialId: 'b', contado: '1' }), dup)).toBeNull()
    expect(podeIncluir(linha({ materialId: 'b', contado: 'x' }))).toBe(false)
    expect(podeIncluir(linha({ materialId: 'b', contado: '0' }))).toBe(true)
  })
})

describe('resumir', () => {
  it('separa ajustes, sem mudança e bloqueadas', () => {
    const r = resumir([
      linha({ uid: '1', materialId: 'a', contado: '12,5' }),
      linha({ uid: '2', materialId: 'b', contado: '4' }),
      linha({ uid: '3', materialId: 'c', contado: '' }),
      linha({ uid: '4', materialId: 'a', contado: '1', incluir: false }),
    ], mapa(prod('a', 10), prod('b', 4), prod('c', 1)))
    expect(r.ajustes).toHaveLength(1)
    expect(r.ajustes[0]).toMatchObject({ produtoId: 'a', anterior: 10, novo: 12.5, delta: 2.5 })
    expect(r.semMudanca).toBe(1)
    expect(r.bloqueadas).toBe(1)
  })
  it('duplicado bloqueia as duas linhas', () => {
    const r = resumir([linha({ uid: '1', materialId: 'a', contado: '1' }), linha({ uid: '2', materialId: 'a', contado: '2' })], mapa(prod('a', 10)))
    expect(r.ajustes).toHaveLength(0)
    expect(r.bloqueadas).toBe(2)
  })
  it('contar zero é ajuste válido', () => {
    expect(resumir([linha({ materialId: 'a', contado: '0' })], mapa(prod('a', 3))).ajustes[0].novo).toBe(0)
  })
})

describe('motivoContagem', () => {
  it('formata DD/MM', () => expect(motivoContagem(new Date(2026, 10, 5))).toBe('Contagem por foto 05/11'))
})

describe('sanitizarContagem', () => {
  const ids = new Set(['a', 'b'])
  it('zera material desconhecido, quantidade inválida e confiança fora do enum', () => {
    const r = sanitizarContagem({
      linhas: [
        { texto_lido: 'x', material_id: 'zzz', quantidade: 3, confianca: 'alta' },
        { texto_lido: 'y', material_id: 'a', quantidade: -2, confianca: 'sei lá' },
        { texto_lido: 'z', material_id: 'b', quantidade: Infinity, unidade_lida: 'm' },
        { texto_lido: 'w', material_id: 'b', quantidade: '5' },
        null, {}, 'lixo',
      ],
      ilegivel: ['canto rasgado', 3, ''],
    }, ids)
    expect(r.tipo).toBe('contagem')
    expect(r.linhas).toHaveLength(4)
    expect(r.linhas[0]).toMatchObject({ material_id: null, quantidade: 3 })
    expect(r.linhas[1]).toMatchObject({ material_id: 'a', quantidade: null, confianca: 'baixa' })
    expect(r.linhas[2].quantidade).toBeNull()
    expect(r.linhas[3].quantidade).toBeNull()
    expect(r.ilegivel).toEqual(['canto rasgado'])
  })
  it('entrada inválida vira resultado vazio', () => {
    expect(sanitizarContagem(null, ids).linhas).toEqual([])
    expect(sanitizarContagem({ linhas: 'x' }, ids).linhas).toEqual([])
  })
})
