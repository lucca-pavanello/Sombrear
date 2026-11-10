import { describe, expect, it } from 'vitest'
import { avaliarParametro, faixaDaChave, normalizarAcao, numeroDoValor } from '@/lib/precos-ia/sanidade'
import { LIMITE_AUDIO_BASE64, mimeBase, validarAudio } from '@/lib/precos-ia/audio'
import { extrairJson } from '@/lib/precos-ia/json'
import {
  classificarAlvo, classificarApagar, classificarInserir, filtroDeBusca, lotesDesfeitos, mesmoValor,
  pendentesDoLote, planoReversao, separarLote, ultimoLote, type LinhaAuditoria,
} from '@/lib/precos-ia/lotes'

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

describe('numeroDoValor / normalizarAcao', () => {
  it('aceita vírgula decimal, milhar e R$', () => {
    expect(numeroDoValor('2,8')).toBe(2.8)
    expect(numeroDoValor('2.8')).toBe(2.8)
    expect(numeroDoValor('1.234,56')).toBe(1234.56)
    expect(numeroDoValor('R$ 36,00')).toBe(36)
    expect(numeroDoValor(7)).toBe(7)
  })
  it('recusa o que não é número finito', () => {
    for (const v of ['abc', '', null, undefined, NaN, Infinity, '1,2,3', {}, true]) expect(numeroDoValor(v)).toBeNull()
  })
  it('atualizar_parametro com "2,8" vira 2.8 (antes virava NaN no aplicar)', () => {
    const r = normalizarAcao({ tipo: 'atualizar_parametro', chave: 'markup_venda', valor: '2,8' })
    expect(r.erro).toBeUndefined()
    expect(r.acao.valor).toBe(2.8)
  })
  it('normaliza os campos numéricos dos outros tipos e preserva texto', () => {
    const r = normalizarAcao({ tipo: 'atualizar_preco_tecido', nome: 'SCREEN 3% BEGE', largura: '2,8', preco: '36,5' })
    expect(r.acao).toMatchObject({ nome: 'SCREEN 3% BEGE', largura: 2.8, preco: 36.5 })
    expect(normalizarAcao({ tipo: 'criar_promocao', tecido: 'X', desconto_pct: '10', inicio: '2026-01-01', fim: '2026-01-02' }).acao.desconto_pct).toBe(10)
    expect(normalizarAcao({ tipo: 'atualizar_romana', largura: '1,30', altura: '1,2', custo: '100,68' }).acao).toMatchObject({ largura: 1.3, altura: 1.2, custo: 100.68 })
  })
  it('largura null = todas as larguras; id opcional some', () => {
    expect(normalizarAcao({ tipo: 'atualizar_preco_tecido', nome: 'X', largura: null, preco: 1 }).acao.largura).toBeNull()
    expect('id' in normalizarAcao({ tipo: 'atualizar_componente_ferragem', item: 'tubo', valor: '14' }).acao).toBe(false)
  })
  it('rejeita campo obrigatório ausente ou não numérico', () => {
    expect(normalizarAcao({ tipo: 'atualizar_parametro', chave: 'a', valor: 'abc' }).erro).toBeTruthy()
    expect(normalizarAcao({ tipo: 'atualizar_parametro', chave: 'a' }).erro).toBeTruthy()
    expect(normalizarAcao({ tipo: 'atualizar_motor_componente', item: 'x', custo: 'Infinity' }).erro).toBeTruthy()
  })
})

describe('audio: formatos aceitos', () => {
  it('aceita ogg, mp4, mpeg, wav, aac, flac e tira o codec', () => {
    for (const m of ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/flac', 'audio/webm;codecs=opus']) {
      expect(validarAudio({ mimeType: m, data: 'AAAA' }).ok, m).toBe(true)
    }
  })
  it('recusa o que o Gemini não documenta', () => {
    for (const m of ['audio/x-ms-wma', 'video/webm', 'video/mp4', 'audio/amr']) {
      expect(validarAudio({ mimeType: m, data: 'AAAA' }).ok, m).toBe(false)
    }
  })
})

describe('desfazer lote: idempotência', () => {
  const l = (id: number, acao: string, detalhe: Record<string, unknown>): LinhaAuditoria =>
    ({ id, usuario: 'x', acao, detalhe, criado_em: `2026-11-10T10:00:${String(id).padStart(2, '0')}` })
  const itens = [
    l(1, 'atualizar_parametro', { lote_id: 'A', chave: 'k1', valor: 3, antes: { valor: 2 } }),
    l(2, 'atualizar_parametro', { lote_id: 'A', chave: 'k2', valor: 5, antes: { valor: 4 } }),
  ]
  const marca = (id: number, completo: boolean, revertidas: number[]) =>
    l(id, 'desfazer_lote', { lote_id: 'A', completo, revertidas })

  it('lote com marca completa não é mais oferecido', () => {
    expect(ultimoLote([...itens, marca(3, true, [2, 1])])).toBeNull()
    expect(lotesDesfeitos([marca(3, true, [])]).has('A')).toBe(true)
  })
  it('marca parcial NÃO esconde o lote; a marca nunca conta como alteração do lote', () => {
    const r = ultimoLote([...itens, marca(3, false, [2])])
    expect(r?.loteId).toBe('A')
    expect(r?.linhas.map(x => x.id)).toEqual([2, 1])
  })
  it('lote desfeito é ignorado e o anterior (não desfeito) aparece', () => {
    const b = [l(4, 'atualizar_parametro', { lote_id: 'B', chave: 'k', valor: 1, antes: { valor: 0 } })]
    expect(ultimoLote([...itens, ...b, l(5, 'desfazer_lote', { lote_id: 'B', completo: true, revertidas: [4] })])?.loteId).toBe('A')
  })
  it('desfeito só na sessão (marca não gravou) também esconde', () => {
    expect(ultimoLote(itens, ['A'])).toBeNull()
  })
  it('retry só tenta o que ainda não foi revertido', () => {
    const { linhas, marcas } = separarLote([...itens, marca(3, false, [2])])
    expect(linhas.map(x => x.id)).toEqual([2, 1])
    expect(pendentesDoLote(linhas, marcas, 'A').map(x => x.id)).toEqual([1])
    expect(pendentesDoLote(linhas, [marca(3, false, [2]), marca(4, false, [1])], 'A')).toEqual([])
  })
  it('marca de outro lote não conta', () => {
    const { linhas } = separarLote(itens)
    expect(pendentesDoLote(linhas, [l(9, 'desfazer_lote', { lote_id: 'Z', completo: false, revertidas: [1, 2] })], 'A')).toHaveLength(2)
  })
})

describe('desfazer: conflito e duplicação', () => {
  it('só reverte se o valor atual ainda é o "depois"', () => {
    const alvo = { antes: { valor: 2 }, depois: { valor: 3 } }
    expect(classificarAlvo(alvo, [{ valor: 3 }])).toBe('reverter')
    expect(classificarAlvo(alvo, [{ valor: '3.0000' }])).toBe('reverter')
    expect(classificarAlvo(alvo, [{ valor: 2 }])).toBe('ja_revertido')
    expect(classificarAlvo(alvo, [{ valor: 2.9 }])).toBe('conflito')
    expect(classificarAlvo(alvo, [])).toBe('conflito')
  })
  it('várias linhas (tecido por largura): uma divergente = conflito; mistura antes/depois reverte as pendentes', () => {
    const alvo = { antes: { preco: 30 }, depois: { preco: 36 } }
    expect(classificarAlvo(alvo, [{ preco: 36 }, { preco: 40 }])).toBe('conflito')
    expect(classificarAlvo(alvo, [{ preco: 36 }, { preco: 30 }])).toBe('reverter')
  })
  it('promoção criada: some = já revertida; desconto mudado = conflito', () => {
    expect(classificarApagar({ desconto_pct: 10 }, [])).toBe('ja_revertido')
    expect(classificarApagar({ desconto_pct: 10 }, [{ desconto_pct: 10 }])).toBe('reverter')
    expect(classificarApagar({ desconto_pct: 10 }, [{ desconto_pct: 15 }])).toBe('conflito')
  })
  it('promoção removida: não reinsere se já existe igual (não duplica)', () => {
    expect(classificarInserir([{ id: 1 }])).toBe('ja_revertido')
    expect(classificarInserir([])).toBe('reverter')
    const p = planoReversao({
      id: 7, usuario: 'x', acao: 'remover_promocao', criado_em: '',
      detalhe: { antes: { id: 9, alvo_tipo: 'tecido', alvo_nome: 'X', desconto_pct: 10, inicio: '2026-01-01', fim: '2026-01-31', created_at: '2026-01-01T00:00:00Z' } },
    })
    expect(p).toMatchObject({ tipo: 'inserir', procura: { alvo_nome: 'X', desconto_pct: 10, inicio: '2026-01-01', fim: '2026-01-31' } })
    expect(p && p.tipo === 'inserir' && 'id' in p.linha).toBe(false)
  })
  it('planoReversao: sem dados do "antes" → null; parâmetro e tecido', () => {
    expect(planoReversao({ id: 1, usuario: 'x', acao: 'atualizar_parametro', detalhe: { chave: 'k', valor: 3 }, criado_em: '' })).toBeNull()
    const p = planoReversao({ id: 1, usuario: 'x', acao: 'atualizar_preco_tecido', criado_em: '', detalhe: { preco: 36, antes: [{ id: 1, preco: 30 }, { id: 2, preco: 31 }] } })
    expect(p).toMatchObject({ tipo: 'atualizar' })
    expect(p && p.tipo === 'atualizar' && p.alvos.map(a => a.match)).toEqual([{ id: 1 }, { id: 2 }])
  })
  it('mesmoValor compara numérico por valor e filtroDeBusca ignora null/objeto/timestamp', () => {
    expect(mesmoValor('2.80', 2.8)).toBe(true)
    expect(mesmoValor('a', 'a')).toBe(true)
    expect(mesmoValor(null, undefined)).toBe(true)
    expect(mesmoValor(2, null)).toBe(false)
    expect(filtroDeBusca({ a: 1, b: null, c: { x: 1 }, created_at: 'x', d: 'ok' })).toEqual({ a: 1, d: 'ok' })
  })
})
