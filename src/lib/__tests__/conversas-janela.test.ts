import { describe, expect, it } from 'vitest'
import { AVISO_JANELA_MS, faltaParaFechar, janelaAberta, janelaDe, seloJanela } from '@/lib/conversas/janela'

const agora = Date.parse('2026-10-08T15:00:00Z')
const h = (n: number) => new Date(agora - n * 3_600_000).toISOString()

describe('janelaDe', () => {
  it('caixa que não é da Meta nunca fecha', () => {
    expect(janelaDe({ janela_meta: false, ultima_recebida_em: null }, agora)).toEqual({ aberta: true, fechaEm: null, restanteMs: null })
    expect(janelaDe({ janela_meta: false, ultima_recebida_em: h(100) }, agora).aberta).toBe(true)
  })

  it('cliente falou há 2 h: aberta, faltam 22 h', () => {
    const j = janelaDe({ janela_meta: true, ultima_recebida_em: h(2) }, agora)
    expect(j.aberta).toBe(true)
    expect(j.restanteMs).toBe(22 * 3_600_000)
    expect(j.fechaEm).toBe(agora + 22 * 3_600_000)
  })

  it('passou de 24 h: fechada', () => {
    const j = janelaDe({ janela_meta: true, ultima_recebida_em: h(25) }, agora)
    expect(j.aberta).toBe(false)
    expect(j.restanteMs).toBe(0)
  })

  it('exatamente 24 h: já fechou', () => {
    expect(janelaDe({ janela_meta: true, ultima_recebida_em: h(24) }, agora).aberta).toBe(false)
  })

  it('nunca recebeu mensagem (lead de disparo): fechada', () => {
    expect(janelaDe({ janela_meta: true, ultima_recebida_em: null }, agora)).toEqual({ aberta: false, fechaEm: null, restanteMs: 0 })
  })

  it('o aviso vale para menos de 3 h restantes', () => {
    const j = janelaDe({ janela_meta: true, ultima_recebida_em: h(22) }, agora)
    expect(j.restanteMs! <= AVISO_JANELA_MS).toBe(true)
    expect(janelaDe({ janela_meta: true, ultima_recebida_em: h(10) }, agora).restanteMs! <= AVISO_JANELA_MS).toBe(false)
  })
})

describe('faltaParaFechar', () => {
  it('horas e minutos', () => {
    expect(faltaParaFechar(2 * 3_600_000 + 15 * 60_000)).toBe('2 h 15 min')
    expect(faltaParaFechar(3_600_000)).toBe('1 h')
    expect(faltaParaFechar(40 * 60_000)).toBe('40 min')
    expect(faltaParaFechar(5_000)).toBe('1 min')
  })
})

describe('janelaAberta e seloJanela', () => {
  const min = (n: number) => new Date(agora - n * 60_000).toISOString()

  it('janelaAberta: só caixa da Meta com mensagem recebida nas últimas 24 h', () => {
    expect(janelaAberta({ janela_meta: true, ultima_recebida_em: h(2) }, agora)).toBe(true)
    expect(janelaAberta({ janela_meta: true, ultima_recebida_em: h(25) }, agora)).toBe(false)
    expect(janelaAberta({ janela_meta: true, ultima_recebida_em: null }, agora)).toBe(false)
    // caixa fora da Meta nunca fecha, mas não é "janela aberta" da Meta
    expect(janelaAberta({ janela_meta: false, ultima_recebida_em: h(2) }, agora)).toBe(false)
  })

  it('caixa fora da Meta não ganha selo', () => {
    expect(seloJanela({ janela_meta: false, ultima_recebida_em: h(30) }, agora)).toBeNull()
  })

  it('folgada: "fecha em N h" arredondando pra baixo', () => {
    expect(seloJanela({ janela_meta: true, ultima_recebida_em: h(2) }, agora)).toEqual({ estado: 'aberta', rotulo: 'fecha em 22 h' })
    expect(seloJanela({ janela_meta: true, ultima_recebida_em: min(60) }, agora)).toEqual({ estado: 'aberta', rotulo: 'fecha em 23 h' })
  })

  it('últimas 3 h: fechando, em horas e depois em minutos', () => {
    expect(seloJanela({ janela_meta: true, ultima_recebida_em: h(22) }, agora)).toEqual({ estado: 'fechando', rotulo: 'fecha em 2 h' })
    expect(seloJanela({ janela_meta: true, ultima_recebida_em: min(24 * 60 - 40) }, agora)).toEqual({ estado: 'fechando', rotulo: 'fecha em 40 min' })
    expect(seloJanela({ janela_meta: true, ultima_recebida_em: min(24 * 60 - 1) }, agora)).toEqual({ estado: 'fechando', rotulo: 'fecha em 1 min' })
  })

  it('exatamente 3 h restantes já é fechando', () => {
    expect(seloJanela({ janela_meta: true, ultima_recebida_em: h(24 - AVISO_JANELA_MS / 3_600_000) }, agora)?.estado).toBe('fechando')
  })

  it('fechada, ou sem mensagem recebida: "janela fechada"', () => {
    expect(seloJanela({ janela_meta: true, ultima_recebida_em: h(30) }, agora)).toEqual({ estado: 'fechada', rotulo: 'janela fechada' })
    expect(seloJanela({ janela_meta: true, ultima_recebida_em: null }, agora)).toEqual({ estado: 'fechada', rotulo: 'janela fechada' })
  })
})
