import { describe, expect, it } from 'vitest'
import { avaliarParametro, faixaDaChave } from '@/lib/precos-ia/sanidade'
import { LIMITE_AUDIO_BASE64, mimeBase, validarAudio } from '@/lib/precos-ia/audio'
import { extrairJson } from '@/lib/precos-ia/json'
import { ultimoLote, type LinhaAuditoria } from '@/lib/precos-ia/lotes'

describe('avaliarParametro', () => {
  it('mudança normal passa', () => {
    expect(avaliarParametro('markup_venda', 2.8, 2.9)).toEqual({ suspeita: false })
    expect(avaliarParametro('markup_venda_pv_ph', 1.8, '1,85')).toEqual({ suspeita: false })
  })
  it('28 no lugar de 2,8 é suspeito e sugere a leitura provável', () => {
    const v = avaliarParametro('markup_venda', 2.8, 28)
    expect(v.suspeita).toBe(true)
    expect(v.motivo).toContain('2,8')
    expect(v.motivo).toContain('erro de digitação')
  })
  it('markup abaixo de 1 é suspeito mesmo dentro de 3×', () => {
    expect(avaliarParametro('markup_venda', 1.2, 0.9).suspeita).toBe(true)
  })
  it('mais de 3× ou menos de 1/3 sem faixa conhecida é suspeito', () => {
    expect(avaliarParametro('kitbox_fixo1', 20, 61).suspeita).toBe(true)
    expect(avaliarParametro('kitbox_fixo1', 20, 6).suspeita).toBe(true)
    expect(avaliarParametro('kitbox_fixo1', 20, 59).suspeita).toBe(false)
  })
  it('porcentagem fora de 0–100 é suspeita', () => {
    expect(avaliarParametro('desconto_avista_pct', 5, 150).suspeita).toBe(true)
    expect(avaliarParametro('desconto_avista_pct', 5, 7).suspeita).toBe(false)
  })
  it('taxa de parcelamento 10 é suspeita (1,06 → 10)', () => {
    expect(avaliarParametro('taxa_parcelamento', 1.06, 10).suspeita).toBe(true)
  })
  it('valor impossível bloqueia', () => {
    expect(avaliarParametro('markup_venda', 2.8, 'abc').invalido).toBeTruthy()
    expect(avaliarParametro('markup_venda', 2.8, -1).invalido).toBeTruthy()
    expect(avaliarParametro('markup_venda', 2.8, null).invalido).toBeTruthy()
  })
  it('sem valor atual só usa a faixa', () => {
    expect(avaliarParametro('markup_venda', null, 2.8).suspeita).toBe(false)
    expect(avaliarParametro('markup_venda', null, 28).suspeita).toBe(true)
  })
  it('faixas por tipo de chave', () => {
    expect(faixaDaChave('markup_atacado')?.max).toBe(10)
    expect(faixaDaChave('kitbox_fixo1')).toBeNull()
  })
})

describe('validarAudio', () => {
  it('normaliza o mime e aceita base64', () => {
    const r = validarAudio({ mimeType: 'audio/webm;codecs=opus', data: 'AAAA' })
    expect(r).toEqual({ ok: true, mimeType: 'audio/webm', data: 'AAAA' })
    expect(mimeBase('Audio/MP4')).toBe('audio/mp4')
  })
  it('recusa vazio, formato estranho e grande demais', () => {
    expect(validarAudio(null).ok).toBe(false)
    expect(validarAudio({ mimeType: 'image/png', data: 'AAAA' }).ok).toBe(false)
    const grande = validarAudio({ mimeType: 'audio/webm', data: 'A'.repeat(LIMITE_AUDIO_BASE64 + 1) })
    expect(grande.ok).toBe(false)
    if (!grande.ok) { expect(grande.status).toBe(413); expect(grande.erro).toMatch(/longo/) }
  })
  it('recusa base64 corrompido', () => {
    expect(validarAudio({ mimeType: 'audio/webm', data: '%%%' }).ok).toBe(false)
  })
})

describe('extrairJson', () => {
  it('lê JSON puro, com cerca e com texto em volta', () => {
    expect(extrairJson('{"a":1}')).toEqual({ a: 1 })
    expect(extrairJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extrairJson('claro! {"a":1} pronto')).toEqual({ a: 1 })
  })
  it('devolve null quando não é objeto', () => {
    expect(extrairJson('oi')).toBeNull()
    expect(extrairJson('[1]')).toBeNull()
    expect(extrairJson('{quebrado')).toBeNull()
  })
})

describe('ultimoLote', () => {
  const l = (id: number, lote?: string): LinhaAuditoria =>
    ({ id, usuario: 'x', acao: 'atualizar_parametro', detalhe: lote ? { lote_id: lote } : {}, criado_em: `2026-11-10T10:00:0${id}` })
  it('pega o lote mais recente e ordena do último aplicado ao primeiro', () => {
    const r = ultimoLote([l(1, 'A'), l(2, 'A'), l(3), l(4, 'B'), l(5, 'B')])
    expect(r?.loteId).toBe('B')
    expect(r?.linhas.map(x => x.id)).toEqual([5, 4])
  })
  it('sem lote_id em lugar nenhum → null', () => {
    expect(ultimoLote([l(1), l(2)])).toBeNull()
    expect(ultimoLote([])).toBeNull()
  })
})
