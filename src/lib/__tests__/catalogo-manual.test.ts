import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  apelidoFornecedor,
  hojeIso,
  referenciaManual,
  validarCorrecao,
  mudancaSuspeita,
} from '../catalogo/manual'

afterEach(() => {
  vi.useRealTimers()
})

describe('referência do documento manual', () => {
  it('um documento por fornecedor POR DIA — corrigir duas vezes no mesmo dia cai no mesmo', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 17, 9, 0, 0))
    const manha = referenciaManual('ALUMITEC ALUMINIO')
    vi.setSystemTime(new Date(2026, 9, 17, 18, 30, 0))
    const tarde = referenciaManual('ALUMITEC ALUMINIO')
    expect(manha).toBe(tarde)
    expect(manha).toBe('MANUAL-ALUMITEC-ALUMINIO-2026-10-17')
  })

  it('dia seguinte é outro documento, para a correção carregar a data em que foi feita', () => {
    expect(referenciaManual('ALUMITEC ALUMINIO', '2026-10-17')).not.toBe(
      referenciaManual('ALUMITEC ALUMINIO', '2026-10-18')
    )
  })

  it('fornecedores diferentes nunca compartilham o documento manual', () => {
    expect(referenciaManual('CORTTEX INDUSTRIA TEXTIL', '2026-10-17')).not.toBe(
      referenciaManual('TAPECARIA AMERICANA DECOR', '2026-10-17')
    )
  })

  it('o apelido tira acento e pontuação, que quebrariam a chave', () => {
    expect(apelidoFornecedor('Tapeçaria Americana Decor Ltda.')).toBe(
      'TAPECARIA-AMERICANA-DECOR-LTDA'
    )
  })

  it('hojeIso usa a data LOCAL, não UTC — às 21h no Brasil o UTC já virou o dia', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 17, 22, 30, 0))
    expect(hojeIso()).toBe('2026-10-17')
  })
})

describe('a precedência, que é só a ordem das datas', () => {
  // A view escolhe a ocorrência mais recente de cada produto. Então a regra
  // do pedido ("reimportar documento antigo não desfaz a correção da loja")
  // cai de graça da comparação de datas — não precisa de mecanismo próprio.
  const maisRecente = (...datas: string[]) => [...datas].sort().reverse()[0]

  it('correção de hoje ganha de pedido antigo: reimportar o pedido não a desfaz', () => {
    const pedidoAntigo = '2026-04-02'
    const correcao = '2026-10-17'
    expect(maisRecente(pedidoAntigo, correcao)).toBe(correcao)
  })

  it('nota fiscal NOVA ganha da correção antiga — é prova melhor do que anotação velha', () => {
    const correcao = '2026-10-17'
    const pedidoNovo = '2026-11-03'
    expect(maisRecente(correcao, pedidoNovo)).toBe(pedidoNovo)
  })
})

describe('validação: recusar em vez de gravar lixo', () => {
  const ok = {
    fornecedorId: 'uuid-1',
    fornecedorNome: 'ALUMITEC ALUMINIO',
    descricao: 'TMDBB-TRILHO MAX DUPLO',
    custoUnitario: 8.736,
  }

  it('aceita uma correção completa', () => {
    expect(validarCorrecao(ok)).toBeNull()
  })

  it('material sem nome não dá para achar depois', () => {
    expect(validarCorrecao({ ...ok, descricao: '   ' })).toMatch(/nome/i)
  })

  it('custo precisa de fornecedor: o custo vigente é por fornecedor', () => {
    expect(validarCorrecao({ ...ok, fornecedorId: '' })).toMatch(/fornecedor/i)
  })

  it('custo zero ou negativo não existe', () => {
    expect(validarCorrecao({ ...ok, custoUnitario: 0 })).toMatch(/maior que zero/i)
    expect(validarCorrecao({ ...ok, custoUnitario: -3 })).toMatch(/maior que zero/i)
  })

  it('campo vazio vira NaN e precisa ser pego antes do banco', () => {
    expect(validarCorrecao({ ...ok, custoUnitario: Number.NaN })).toMatch(/informe o custo/i)
  })
})

describe('aviso de mudança grande — pede confirmação, não bloqueia', () => {
  it('avisa quando passa do dobro: casa decimal é o erro de digitação mais comum', () => {
    expect(mudancaSuspeita(8.736, 87.36)).toMatch(/dobro/i)
  })

  it('avisa quando cai abaixo da metade', () => {
    expect(mudancaSuspeita(8.736, 0.8736)).toMatch(/metade/i)
  })

  it('reajuste normal passa sem atrito — 8,302 para 8,736 é o caso real da Alumitec', () => {
    expect(mudancaSuspeita(8.302, 8.736)).toBeNull()
  })

  it('sem custo anterior não há com o que comparar', () => {
    expect(mudancaSuspeita(null, 99)).toBeNull()
    expect(mudancaSuspeita(0, 99)).toBeNull()
  })
})
