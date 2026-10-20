import { describe, expect, it } from 'vitest'
import type { Ligacao } from '@/hooks/useLigacoes'
import { duracao, filtrarLigacoes, telefoneBonito } from '@/lib/ligacoes'

const l = (nome: string | null, telefone: string | null, telefone_chamador: string | null = null) =>
  ({ id: nome ?? 'x', nome, telefone, telefone_chamador }) as Ligacao

describe('aba Ligações: textos', () => {
  it('duração em segundos ou minutos', () => {
    expect(duracao('2026-10-20T10:51:00Z', '2026-10-20T10:51:45Z')).toBe('45 s')
    expect(duracao('2026-10-20T10:51:00Z', '2026-10-20T10:53:00Z')).toBe('2 min')
    expect(duracao('2026-10-20T10:51:00Z', '2026-10-20T10:52:30Z')).toBe('1 min 30 s')
    expect(duracao('2026-10-20T10:51:00Z', null)).toBe('')
  })

  it('telefone com máscara, com ou sem o 55', () => {
    expect(telefoneBonito('17996185177')).toBe('(17) 99618-5177')
    expect(telefoneBonito('+55 17 99618-5177')).toBe('(17) 99618-5177')
    expect(telefoneBonito('1733041354')).toBe('(17) 3304-1354')
    expect(telefoneBonito(null)).toBe('')
  })

  it('busca por nome ou por pedaço do telefone', () => {
    const lista = [l('Estela', '17996185177'), l('Marcos', null, '+5517991234567'), l(null, null)]
    expect(filtrarLigacoes(lista, 'est').map(x => x.nome)).toEqual(['Estela'])
    expect(filtrarLigacoes(lista, '99123').map(x => x.nome)).toEqual(['Marcos'])
    expect(filtrarLigacoes(lista, '(17) 99618').map(x => x.nome)).toEqual(['Estela'])
    expect(filtrarLigacoes(lista, '  ')).toHaveLength(3)
  })
})
