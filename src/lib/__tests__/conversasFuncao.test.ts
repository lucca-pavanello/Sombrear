/**
 * A function `conversas` (supabase/functions/conversas) com Chatwoot e banco de mentira: nada
 * aqui toca produção. O que importa provar é a ORDEM: a IA pausa antes de a mensagem sair, e
 * mensagem que não vai sair não deixa rastro errado.
 */
import { describe, expect, it } from 'vitest'
import { encerrar, enviar, ia, type Deps } from '../../../supabase/functions/conversas/acoes'
import { comIA, etiquetasDaResposta, lerPedido, recusaDoArquivo, TETO_ENVIO } from '../../../supabase/functions/conversas/pedido'
import type { EstadoConversa, LinhaMensagem } from '../../../supabase/functions/mensagens-chatwoot/mapear'

const QUEM = { id: 'user-1', nome: 'Thais' }

/** Chatwoot em memória: uma conversa, com as etiquetas e o status que os testes mexem */
function chatwootFalso(o: { inbox?: number; status?: string; etiquetas?: string[]; falhar?: (metodo: string, caminho: string) => boolean } = {}) {
  const chamadas: string[] = []
  let etiquetas = [...(o.etiquetas ?? [])]
  let status = o.status ?? 'open'
  const mensagens: LinhaMensagem[] = []
  const estados: EstadoConversa[] = []
  const formularios: FormData[] = []
  const corpos: any[] = []
  const responder = (metodo: string, caminho: string, corpo?: any) => {
    chamadas.push(`${metodo} ${caminho}`)
    if (o.falhar?.(metodo, caminho)) throw new Error(`chatwoot 500 em ${metodo} ${caminho}`)
    if (caminho.endsWith('/labels')) {
      if (metodo === 'POST') etiquetas = corpo.labels
      return { payload: etiquetas }
    }
    if (caminho.endsWith('/toggle_status')) { status = corpo.status; return { payload: { success: true, current_status: status } } }
    if (caminho.endsWith('/messages')) {
      corpos.push(corpo)
      return { id: 9001, content: corpo?.content ?? null, message_type: 1, created_at: 1790000000, private: !!corpo?.private, content_attributes: corpo?.content_attributes ?? {}, sender: { type: 'user', name: 'Lucca' } }
    }
    return { id: 356, inbox_id: o.inbox ?? 5, status, meta: { sender: { phone_number: '+5517999990000' } } }
  }
  const deps: Deps = {
    pedir: async (metodo, caminho, corpo) => responder(metodo, caminho, corpo),
    enviarFormulario: async (caminho, form) => { formularios.push(form); return responder('POST', caminho, { content: form.get('content') }) },
    espelharMensagem: async (l) => { mensagens.push(l) },
    espelharEstado: async (e) => { estados.push(e) },
  }
  return { deps, chamadas, mensagens, estados, formularios, corpos, etiquetas: () => etiquetas, status: () => status }
}

const pedidoEnviar = { acao: 'enviar' as const, conversa_id: 356, texto: 'Bom dia!', voz: false }

describe('lerPedido', () => {
  it('enviar: texto limpo; sem texto e sem arquivo recusa', () => {
    expect(lerPedido({ acao: 'enviar', conversa_id: 356, texto: '  oi  ' }, false)).toEqual({ acao: 'enviar', conversa_id: 356, texto: 'oi', voz: false })
    expect(typeof lerPedido({ acao: 'enviar', conversa_id: 356, texto: '   ' }, false)).toBe('string')
  })

  it('multipart: os campos chegam como texto', () => {
    expect(lerPedido({ acao: 'enviar', conversa_id: '356', voz: '1' }, true)).toEqual({ acao: 'enviar', conversa_id: 356, texto: null, voz: true })
    expect(lerPedido({ acao: 'ia', conversa_id: '356', ligada: 'false' }, false)).toEqual({ acao: 'ia', conversa_id: 356, ligada: false })
  })

  it('conta e caixa mandadas pelo navegador são ignoradas', () => {
    const p = lerPedido({ acao: 'encerrar', conversa_id: 356, conta: 9, inbox_id: 2 }, false)
    expect(p).toEqual({ acao: 'encerrar', conversa_id: 356 })
  })

  it('recusa conversa inválida, ação desconhecida, ia sem lado e arquivo fora do enviar', () => {
    for (const corpo of [null, {}, { acao: 'enviar', conversa_id: 0, texto: 'x' }, { acao: 'apagar', conversa_id: 1 }, { acao: 'ia', conversa_id: 1 }]) {
      expect(typeof lerPedido(corpo, false)).toBe('string')
    }
    expect(typeof lerPedido({ acao: 'ia', conversa_id: 1, ligada: true }, true)).toBe('string')
  })
})

describe('recusaDoArquivo', () => {
  it('aceita o que o WhatsApp aceita, com ou sem o codec no tipo', () => {
    expect(recusaDoArquivo('image/jpeg', 1000)).toBeNull()
    expect(recusaDoArquivo('audio/ogg; codecs=opus', 1000)).toBeNull()
    expect(recusaDoArquivo('application/pdf', TETO_ENVIO)).toBeNull()
  })

  it('recusa vazio, grande demais e tipo que não vai', () => {
    expect(recusaDoArquivo('image/jpeg', 0)).toMatch(/vazio/)
    expect(recusaDoArquivo('image/jpeg', TETO_ENVIO + 1)).toMatch(/16 MB/)
    expect(recusaDoArquivo('image/webp', 1000)).toMatch(/não aceita/)
    expect(recusaDoArquivo('application/x-msdownload', 1000)).toMatch(/não aceita/)
  })
})

describe('comIA e etiquetasDaResposta', () => {
  it('pausar soma a humano sem perder as outras; ligar tira só ela', () => {
    expect(comIA(['vip'], false)).toEqual({ lista: ['vip', 'humano'], mudou: true })
    expect(comIA(['vip', 'humano'], false)).toEqual({ lista: ['vip', 'humano'], mudou: false })
    expect(comIA(['humano', 'vip'], true)).toEqual({ lista: ['vip'], mudou: true })
    expect(comIA(['vip'], true)).toEqual({ lista: ['vip'], mudou: false })
  })

  it('só aceita lista', () => {
    expect(etiquetasDaResposta({ payload: ['a', ' b ', ''] })).toEqual(['a', 'b'])
    expect(etiquetasDaResposta({ error: 'x' })).toBeNull()
    expect(etiquetasDaResposta(null)).toBeNull()
  })
})

describe('enviar', () => {
  it('pausa a IA antes de a mensagem sair, carimba quem mandou e espelha', async () => {
    const c = chatwootFalso({ etiquetas: ['vip'] })
    const r = await enviar(c.deps, QUEM, pedidoEnviar, null)
    expect(r).toMatchObject({ status: 200, corpo: { ok: true, mensagem_id: 9001, etiquetas: ['vip', 'humano'] } })
    const iLabel = c.chamadas.indexOf('POST /conversations/356/labels')
    const iMsg = c.chamadas.indexOf('POST /conversations/356/messages')
    expect(iLabel).toBeGreaterThan(-1)
    expect(iMsg).toBeGreaterThan(iLabel)
    expect(c.corpos[0]).toMatchObject({ content: 'Bom dia!', message_type: 'outgoing', private: false, content_attributes: { autor: 'equipe', autor_nome: 'Thais', origem: 'dash' } })
    // o token é o da integração ("Lucca"): quem aparece na tela é quem mandou pelo dash
    expect(c.mensagens[0]).toMatchObject({ id: 9001, conversa_id: 356, inbox_id: 5, autor: 'equipe', autor_nome: 'Thais', canal_envio: 'chatwoot', do_celular: false, status_entrega: 'sent', telefone: '+5517999990000' })
    expect(c.estados[c.estados.length - 1]).toEqual({ conversa_id: 356, status: 'open', etiquetas: ['vip', 'humano'] })
  })

  it('não conseguiu pausar a IA: nada é enviado', async () => {
    const c = chatwootFalso({ falhar: (m, p) => m === 'POST' && p.endsWith('/labels') })
    const r = await enviar(c.deps, QUEM, pedidoEnviar, null)
    expect(r).toMatchObject({ status: 502, corpo: { ok: false, codigo: 'pausa' } })
    expect(c.chamadas.some(x => x.endsWith('/messages'))).toBe(false)
    expect(c.mensagens).toHaveLength(0)
  })

  it('conversa de outra caixa não existe para a aba', async () => {
    const c = chatwootFalso({ inbox: 2 })
    const r = await enviar(c.deps, QUEM, pedidoEnviar, null)
    expect(r).toMatchObject({ status: 404, corpo: { codigo: 'conversa' } })
    expect(c.chamadas).toEqual(['GET /conversations/356'])
  })

  it('o Chatwoot recusou a mensagem: avisa que a IA ficou pausada e não espelha', async () => {
    const c = chatwootFalso({ falhar: (m, p) => m === 'POST' && p.endsWith('/messages') })
    const r = await enviar(c.deps, QUEM, pedidoEnviar, null)
    expect(r).toMatchObject({ status: 502, corpo: { codigo: 'envio' } })
    expect(c.etiquetas()).toContain('humano')
    expect(c.mensagens).toHaveLength(0)
  })

  it('conversa encerrada reabre antes de enviar', async () => {
    const c = chatwootFalso({ status: 'resolved' })
    await enviar(c.deps, QUEM, pedidoEnviar, null)
    expect(c.status()).toBe('open')
    expect(c.chamadas.indexOf('POST /conversations/356/toggle_status')).toBeLessThan(c.chamadas.indexOf('POST /conversations/356/messages'))
  })

  it('arquivo vai em multipart, com a legenda e o carimbo', async () => {
    const c = chatwootFalso()
    const arquivo = new File([new Uint8Array(10)], 'foto.jpg', { type: 'image/jpeg' })
    const r = await enviar(c.deps, QUEM, { ...pedidoEnviar, texto: 'a medida' }, arquivo)
    expect(r.status).toBe(200)
    const f = c.formularios[0]
    expect(f.get('content')).toBe('a medida')
    expect(f.get('message_type')).toBe('outgoing')
    expect(f.get('content_attributes[autor]')).toBe('equipe')
    expect(f.get('content_attributes[autor_nome]')).toBe('Thais')
    expect((f.get('attachments[]') as File).name).toBe('foto.jpg')
  })
})

describe('ia', () => {
  it('pausar põe a humano; religar tira', async () => {
    const c = chatwootFalso({ etiquetas: ['vip'] })
    expect((await ia(c.deps, { acao: 'ia', conversa_id: 356, ligada: false })).corpo).toMatchObject({ ok: true, etiquetas: ['vip', 'humano'] })
    expect((await ia(c.deps, { acao: 'ia', conversa_id: 356, ligada: true })).corpo).toMatchObject({ ok: true, etiquetas: ['vip'] })
    expect(c.estados[c.estados.length - 1]).toEqual({ conversa_id: 356, status: 'open', etiquetas: ['vip'] })
  })

  it('o Chatwoot fora do ar vira frase, não exceção', async () => {
    const c = chatwootFalso({ falhar: (_m, p) => p.endsWith('/labels') })
    expect(await ia(c.deps, { acao: 'ia', conversa_id: 356, ligada: false })).toMatchObject({ status: 502, corpo: { codigo: 'etiquetas' } })
  })
})

describe('encerrar', () => {
  it('religa a IA, deixa a nota e resolve, nessa ordem', async () => {
    const c = chatwootFalso({ etiquetas: ['humano'] })
    const r = await encerrar(c.deps, QUEM, { acao: 'encerrar', conversa_id: 356 })
    expect(r).toMatchObject({ status: 200, corpo: { ok: true, etiquetas: [] } })
    const ordem = ['POST /conversations/356/labels', 'POST /conversations/356/messages', 'POST /conversations/356/toggle_status'].map(x => c.chamadas.indexOf(x))
    expect(ordem).toEqual([...ordem].sort((a, b) => a - b))
    expect(ordem.every(i => i > -1)).toBe(true)
    expect(c.corpos[0]).toMatchObject({ private: true })
    expect(c.status()).toBe('resolved')
    expect(c.estados[c.estados.length - 1]).toEqual({ conversa_id: 356, status: 'resolved', etiquetas: [] })
  })

  it('já encerrada: não mexe em nada', async () => {
    const c = chatwootFalso({ status: 'resolved', etiquetas: ['humano'] })
    const r = await encerrar(c.deps, QUEM, { acao: 'encerrar', conversa_id: 356 })
    expect(r.corpo).toMatchObject({ ok: true, ja_encerrada: true })
    expect(c.chamadas).toEqual(['GET /conversations/356'])
  })

  it('o Chatwoot não resolveu: diz que a IA já foi religada', async () => {
    const c = chatwootFalso({ etiquetas: ['humano'], falhar: (_m, p) => p.endsWith('/toggle_status') })
    const r = await encerrar(c.deps, QUEM, { acao: 'encerrar', conversa_id: 356 })
    expect(r).toMatchObject({ status: 502, corpo: { codigo: 'status' } })
    expect(c.etiquetas()).toEqual([])
  })
})
