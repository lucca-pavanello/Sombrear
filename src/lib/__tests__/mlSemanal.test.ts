import { describe, it, expect } from 'vitest'
import {
  compararTendencias, lerAnuncio, semanas, VISITAS_MINIMAS_PARA_LER,
  type TendenciaSemana, type AnuncioSemana,
} from '../mlSemanal'

const t = (semana: string, keyword: string, posicao: number): TendenciaSemana => ({ semana, keyword, posicao })

const anuncio = (p: Partial<AnuncioSemana> = {}): AnuncioSemana => ({
  semana: '2026-08-30',
  ml_item_id: 'MLB1',
  titulo: 'Cortina Rolo Blackout',
  status: 'active',
  preco: 214,
  visitas: 0,
  perguntas: 0,
  vendidos: 0,
  ...p,
})

describe('compararTendencias', () => {
  const ANTES = [t('2026-08-23', 'cortina blackout quarto', 1), t('2026-08-23', 'cortina cozinha', 5), t('2026-08-23', 'persiana rolo', 20)]

  it('posição MENOR é subida — o sinal não pode inverter', () => {
    const c = compararTendencias([t('2026-08-30', 'cortina cozinha', 2)], ANTES)
    expect(c.subiram).toHaveLength(1)
    expect(c.subiram[0]).toMatchObject({ keyword: 'cortina cozinha', posicao: 2, anterior: 5, ganho: 3 })
    expect(c.cairam).toHaveLength(0)
  })

  it('posição maior é queda, com ganho negativo', () => {
    const c = compararTendencias([t('2026-08-30', 'persiana rolo', 33)], ANTES)
    expect(c.cairam[0]).toMatchObject({ keyword: 'persiana rolo', anterior: 20, ganho: -13 })
    expect(c.subiram).toHaveLength(0)
  })

  it('palavra nova entra como entrada, não como subida de posição infinita', () => {
    const c = compararTendencias([t('2026-08-30', 'persiana solar', 7)], ANTES)
    expect(c.entraram).toEqual([{ keyword: 'persiana solar', posicao: 7, anterior: null, ganho: null }])
    expect(c.subiram).toHaveLength(0)
    expect(c.cairam).toHaveLength(0)
  })

  it('palavra que sumiu do ranking aparece em sairam', () => {
    const c = compararTendencias([t('2026-08-30', 'cortina cozinha', 5)], ANTES)
    expect(c.sairam.map(s => s.keyword)).toEqual(['cortina blackout quarto', 'persiana rolo'])
  })

  it('mesma posição não é subida nem queda', () => {
    const c = compararTendencias([t('2026-08-30', 'cortina cozinha', 5)], [t('2026-08-23', 'cortina cozinha', 5)])
    expect(c.subiram).toHaveLength(0)
    expect(c.cairam).toHaveLength(0)
    expect(c.entraram).toHaveLength(0)
  })

  it('primeira semana: sem anterior, tudo é entrada e nada é queda', () => {
    const c = compararTendencias([t('2026-08-30', 'a', 1), t('2026-08-30', 'b', 2)], [])
    expect(c.entraram).toHaveLength(2)
    expect(c.cairam).toHaveLength(0)
    expect(c.sairam).toHaveLength(0)
  })

  it('ordena as subidas pela maior subida', () => {
    const c = compararTendencias(
      [t('2026-08-30', 'cortina cozinha', 4), t('2026-08-30', 'persiana rolo', 2)],
      ANTES,
    )
    expect(c.subiram.map(x => x.keyword)).toEqual(['persiana rolo', 'cortina cozinha'])
  })
})

describe('lerAnuncio', () => {
  it('anúncio pausado é fora do ar, mesmo com visita', () => {
    expect(lerAnuncio(anuncio({ status: 'paused', visitas: 500 }))).toBe('fora_do_ar')
  })

  it('venda ganha de tudo', () => {
    expect(lerAnuncio(anuncio({ vendidos: 1, visitas: 0 }))).toBe('vendeu')
  })

  it('pergunta sem venda aponta preço ou prazo', () => {
    expect(lerAnuncio(anuncio({ perguntas: 2, visitas: 3 }))).toBe('perguntaram_e_nao_compraram')
  })

  it('zero visita é problema de título, não de preço', () => {
    expect(lerAnuncio(anuncio({ visitas: 0 }))).toBe('ninguem_viu')
  })

  it('pouca visita não vira diagnóstico — não manda mexer no anúncio à toa', () => {
    expect(lerAnuncio(anuncio({ visitas: VISITAS_MINIMAS_PARA_LER - 1 }))).toBe('pouco_movimento')
  })

  it('visita suficiente sem pergunta aponta capa ou preço', () => {
    expect(lerAnuncio(anuncio({ visitas: VISITAS_MINIMAS_PARA_LER }))).toBe('viram_e_nao_perguntaram')
  })

  it('null de visita conta como zero, não quebra', () => {
    expect(lerAnuncio(anuncio({ visitas: null, perguntas: null, vendidos: null }))).toBe('ninguem_viu')
  })
})

describe('semanas', () => {
  it('devolve as semanas sem repetir, da mais recente para a mais antiga', () => {
    expect(semanas([
      { semana: '2026-08-23' }, { semana: '2026-08-30' }, { semana: '2026-08-23' },
    ])).toEqual(['2026-08-30', '2026-08-23'])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(semanas([])).toEqual([])
  })
})
