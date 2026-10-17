import { describe, it, expect } from 'vitest'
import { acharMaterial, descrever, type MaterialCandidato } from '../catalogo/acharMaterial'

/**
 * Fixture conferida linha a linha contra `catalogo_custo_vigente` em
 * 17/10/2026 — descrição, código, fornecedor, cor, largura e custo. Ao
 * mexer aqui, confira de novo: um fixture que inventa um detalhe (uma cor
 * que o banco não tem, por exemplo) transforma o teste em enfeite.
 *
 * As três microfibras são o pior caso e existem de verdade: duas da Corttex
 * a R$ 6,30/m e uma da TA Decor a R$ 13,90/m. Um agente que escolhe sozinho
 * acerta uma em três, e o erro só aparece semanas depois num orçamento.
 */
const m = (
  item_id: string,
  descricao: string,
  codigo_fornecedor: string | null,
  fornecedor: string,
  custo_unitario: number,
  cor: string | null = null,
  largura_m: number | null = null
): MaterialCandidato => ({
  item_id, descricao, codigo_fornecedor, fornecedor,
  custo_unitario, cor, largura_m, unidade_canonica: 'm',
})

const CATALOGO: MaterialCandidato[] = [
  m('1', 'MICROFIBRA 3.00M BEGE',              '2969020',        'CORTTEX INDUSTRIA TEXTIL',  6.30, 'bege',   3.00),
  m('2', 'MICROFIBRA 3.00M MARFIM',            '2969090',        'CORTTEX INDUSTRIA TEXTIL',  6.30, 'marfim', 3.00),
  m('3', 'MICROFIBRA CLASSICA 3,30L - AREIA',  '22.139.1.L/05',  'TAPECARIA AMERICANA DECOR',13.90, 'areia',  3.30),
  m('4', 'VOIL FLAME 3.00M BEGE',              '2819020',        'CORTTEX INDUSTRIA TEXTIL', 11.00, 'bege',   3.00),
  m('5', 'VOIL FLAME 3.30M BEGE',              '3272020',        'CORTTEX INDUSTRIA TEXTIL', 14.50, 'bege',   3.30),
  m('6', 'LINHO IRLANDES II - TRIGO',          '38.013/09',      'TAPECARIA AMERICANA DECOR',16.40, 'trigo'),
  m('7', 'VOIL FLAME 3.00M MARFIM',            '2819090',        'CORTTEX INDUSTRIA TEXTIL', 11.00, 'marfim', 3.00),
  // Os cinco trilhos Max, como estão no banco — o ultra largo é o único
  // sem cor registrada, e é justamente ele que disputa com o duplo.
  m('8',  'TMDBB-TRILHO MAX DUPLO BRANCO (40.7 MM)',              '6501', 'ALUMITEC ALUMINIO',  8.736, 'branco'),
  m('9',  'TMDULBB-TRILHO MAX DUPLO ULTRA LARGO BB (84 MM)',      '9150', 'ALUMITEC ALUMINIO', 13.685, null),
  m('10', 'TMSBB-TRILHO MAX SIMPLES C ABA BRANCO 27 MM',          '6505', 'ALUMITEC ALUMINIO',  5.208, 'branco'),
  m('11', 'TMTBB-TRILHO MAX TRIPLO BRANCO (67,3 MM)',             '6506', 'ALUMITEC ALUMINIO', 15.106, 'branco'),
  m('12', 'TMUBB-TRILHO MAX UNIVERSAL BRANCO',                    '6507', 'ALUMITEC ALUMINIO', 13.090, 'branco'),
]

describe('o agente NÃO escolhe sozinho quando há mais de um', () => {
  it('"microfibra" casa com três e devolve os três, sem eleger nenhum', () => {
    const r = acharMaterial(CATALOGO, { termo: 'microfibra' })
    expect(r.tipo).toBe('ambiguo')
    if (r.tipo !== 'ambiguo') return
    expect(r.candidatos).toHaveLength(3)
    expect(r.mensagem).toMatch(/3 materiais/)
  })

  it('a mensagem traz o que diferencia um do outro — fornecedor, largura e custo', () => {
    const r = acharMaterial(CATALOGO, { termo: 'microfibra' })
    if (r.tipo !== 'ambiguo') throw new Error('esperava ambíguo')
    expect(r.mensagem).toContain('CORTTEX')
    expect(r.mensagem).toContain('TAPECARIA AMERICANA DECOR')
    expect(r.mensagem).toContain('3,30 m')
    expect(r.mensagem).toContain('13,90')
    // Sem isso a pessoa não tem como escolher: os nomes são quase iguais.
  })

  it('dizer só o fornecedor ainda não basta — restam as duas cores da Corttex', () => {
    const r = acharMaterial(CATALOGO, { termo: 'microfibra', fornecedor: 'corttex' })
    expect(r.tipo).toBe('ambiguo')
    if (r.tipo !== 'ambiguo') return
    expect(r.candidatos).toHaveLength(2)
  })

  it('fornecedor + cor resolve', () => {
    const r = acharMaterial(CATALOGO, { termo: 'microfibra', fornecedor: 'corttex', cor: 'bege' })
    expect(r.tipo).toBe('achou')
    if (r.tipo !== 'achou') return
    expect(r.material.item_id).toBe('1')
    expect(r.material.custo_unitario).toBe(6.3)
  })

  it('"trilho max duplo" casa com o duplo e com o duplo ultra largo', () => {
    const r = acharMaterial(CATALOGO, { termo: 'trilho max duplo' })
    expect(r.tipo).toBe('ambiguo')
    if (r.tipo !== 'ambiguo') return
    expect(r.candidatos.map(c => c.codigo_fornecedor).sort()).toEqual(['6501', '9150'])
  })

  it('"trilho max" sozinho casa com os cinco — de R$ 5,21 a R$ 15,11', () => {
    const r = acharMaterial(CATALOGO, { termo: 'trilho max' })
    expect(r.tipo).toBe('ambiguo')
    if (r.tipo !== 'ambiguo') return
    expect(r.candidatos).toHaveLength(5)
  })

  it('mais uma palavra desempata', () => {
    const r = acharMaterial(CATALOGO, { termo: 'trilho max duplo ultra largo' })
    expect(r.tipo).toBe('achou')
    if (r.tipo !== 'achou') return
    expect(r.material.codigo_fornecedor).toBe('9150')
  })
})

describe('código do fornecedor é o caminho exato', () => {
  it('acha pelo código numérico da Alumitec', () => {
    const r = acharMaterial(CATALOGO, { termo: '6501' })
    expect(r.tipo).toBe('achou')
    if (r.tipo !== 'achou') return
    expect(r.material.custo_unitario).toBe(8.736)
  })

  it('acha pelo código com pontos da TA Decor', () => {
    const r = acharMaterial(CATALOGO, { termo: '22.139.1.L/05' })
    expect(r.tipo).toBe('achou')
    if (r.tipo !== 'achou') return
    expect(r.material.descricao).toContain('CLASSICA')
  })

  it('código vence a descrição: é o identificador estável dos fornecedores', () => {
    const r = acharMaterial(CATALOGO, { termo: '2969090' })
    expect(r.tipo).toBe('achou')
    if (r.tipo !== 'achou') return
    expect(r.material.cor).toBe('marfim')
  })
})

describe('acento, caixa e largura', () => {
  it('"linho irlandes" sem acento acha "LINHO IRLANDES II"', () => {
    const r = acharMaterial(CATALOGO, { termo: 'Linho Irlandês' })
    expect(r.tipo).toBe('achou')
    if (r.tipo !== 'achou') return
    expect(r.material.item_id).toBe('6')
  })

  it('a largura desempata duas Voil Flame iguais no nome', () => {
    const ambos = acharMaterial(CATALOGO, { termo: 'voil flame bege' })
    expect(ambos.tipo).toBe('ambiguo')

    const r = acharMaterial(CATALOGO, { termo: 'voil flame bege', larguraM: 3.3 })
    expect(r.tipo).toBe('achou')
    if (r.tipo !== 'achou') return
    expect(r.material.custo_unitario).toBe(14.5)
  })
})

describe('recusar em vez de inventar', () => {
  it('material que não existe devolve "nenhum", e sugere cadastrar', () => {
    const r = acharMaterial(CATALOGO, { termo: 'oxford maquinetado' })
    expect(r.tipo).toBe('nenhum')
    if (r.tipo !== 'nenhum') return
    expect(r.mensagem).toMatch(/cadastre/i)
  })

  it('termo vazio não varre o catálogo inteiro', () => {
    expect(acharMaterial(CATALOGO, { termo: '   ' }).tipo).toBe('nenhum')
  })

  it('pista que não casa com ninguém é ignorada em vez de zerar a busca', () => {
    // "fornecedor: Xyz" não existe; melhor cair na busca por nome do que
    // dizer que a microfibra não existe.
    const r = acharMaterial(CATALOGO, { termo: '6501', fornecedor: 'Xyz Ltda' })
    expect(r.tipo).toBe('achou')
  })
})

describe('descrever: como o material aparece para a pessoa escolher', () => {
  it('junta nome, fornecedor, largura, cor e custo', () => {
    const texto = descrever(CATALOGO[2])
    expect(texto).toBe(
      'MICROFIBRA CLASSICA 3,30L - AREIA · TAPECARIA AMERICANA DECOR · 3,30 m · areia · R$ 13,90/m'
    )
  })
})
