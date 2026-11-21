import { describe, expect, it } from 'vitest'
import { estadoDaConversa, mapearMensagem, statusDe, statusFinal } from '../../../supabase/functions/mensagens-chatwoot/mapear'

// formatos reais da conta 1 do Chatwoot (01/10/2026), sem dado de cliente
const base = { id: 10, conversation_id: 356, inbox_id: 5, created_at: 1790000000, content: 'oi' }

describe('mapearMensagem', () => {
  it('cliente: mensagem de entrada, sem nome de autor', () => {
    const l = mapearMensagem({ ...base, message_type: 0, sender: { type: 'contact', name: 'Fulana', phone_number: '+5517999990000' } })
    expect(l).toMatchObject({ autor: 'cliente', autor_nome: null, canal_envio: null, telefone: '+5517999990000' })
  })

  it('IA: marca stella_ia do n8n', () => {
    const l = mapearMensagem({ ...base, message_type: 1, content_attributes: { autor: 'stella_ia' }, sender: { type: 'user', name: 'Lucca' } })
    expect(l).toMatchObject({ autor: 'ia', autor_nome: 'Amanda', canal_envio: null })
  })

  it('IA: usuário Atendente Amanda sem a marca', () => {
    const l = mapearMensagem({ ...base, message_type: 1, sender: { type: 'user', name: 'Atendente Amanda' } })
    expect(l?.autor).toBe('ia')
  })

  it('equipe pelo Chatwoot: usuário da loja, sem source_id', () => {
    const l = mapearMensagem({ ...base, message_type: 1, sender: { type: 'user', name: 'Stella' } })
    expect(l).toMatchObject({ autor: 'equipe', autor_nome: 'Stella', canal_envio: 'chatwoot' })
  })

  it('equipe pelo celular: cópia do WhatsApp gravada no usuário da integração', () => {
    const l = mapearMensagem({ ...base, message_type: 1, source_id: 'wamid.X', sender: { type: 'user', name: 'Lucca' } })
    expect(l).toMatchObject({ autor: 'equipe', autor_nome: null, canal_envio: 'celular' })
  })

  it('evento do sistema não é mensagem', () => {
    expect(mapearMensagem({ ...base, message_type: 2 })).toBeNull()
  })

  it('webhook: tipo em texto, data ISO, conversa aninhada, apagada e citação', () => {
    const l = mapearMensagem({
      id: 11, message_type: 'outgoing', created_at: '2026-10-01T13:00:00.000Z', content: 'Esta mensagem foi excluída',
      content_attributes: { deleted: true, in_reply_to: 9 }, sender: { type: 'user', name: 'Stella' },
      conversation: { id: 356, inbox_id: 5, meta: { sender: { phone_number: '+5517999990000' } } },
      attachments: [{ file_type: 'audio', data_url: 'https://x/a.ogg', file_name: 'a.ogg' }],
    })
    expect(l).toMatchObject({
      conversa_id: 356, inbox_id: 5, telefone: '+5517999990000', excluida: true, responde_a: 9,
      enviada_em: '2026-10-01T13:00:00.000Z', anexos: [{ tipo: 'audio', url: 'https://x/a.ogg', nome: 'a.ogg' }],
    })
  })
})

describe('aba Conversas: quem mandou pelo dash, entrega e estado', () => {
  it('equipe pelo dash: o carimbo vale mais que o usuário do token, mesmo com source_id', () => {
    const l = mapearMensagem({ ...base, message_type: 1, source_id: 'wamid.X', content_attributes: { autor: 'equipe', autor_nome: 'Thais' }, sender: { type: 'user', name: 'Lucca' } })
    expect(l).toMatchObject({ autor: 'equipe', autor_nome: 'Thais', canal_envio: 'chatwoot', do_celular: false })
    const amanda = mapearMensagem({ ...base, message_type: 1, content_attributes: { autor: 'equipe', autor_nome: 'Thais' }, sender: { type: 'user', name: 'Atendente Amanda' } })
    expect(amanda?.autor).toBe('equipe')
  })

  it('do_celular acompanha o canal', () => {
    const l = mapearMensagem({ ...base, message_type: 1, source_id: 'wamid.X', sender: { type: 'user', name: 'Lucca' } })
    expect(l?.do_celular).toBe(true)
    expect(mapearMensagem({ ...base, message_type: 0 })?.do_celular).toBe(false)
  })

  it('status: número na API, texto no webhook; do cliente não tem', () => {
    expect([0, 1, 2, 3, 'read', 'x', null].map(statusDe)).toEqual(['sent', 'delivered', 'read', 'failed', 'read', null, null])
    expect(mapearMensagem({ ...base, message_type: 1, status: 1, sender: { type: 'user', name: 'Stella' } })?.status_entrega).toBe('delivered')
    expect(mapearMensagem({ ...base, message_type: 1, sender: { type: 'user', name: 'Stella' } })?.status_entrega).toBeNull()
    expect(mapearMensagem({ ...base, message_type: 0, status: 'read' })?.status_entrega).toBeNull()
  })

  it('recusada pelo WhatsApp com status parado em enviada é falha; entregue depois continua entregue', () => {
    const l = mapearMensagem({ ...base, message_type: 1, status: 'sent', content_attributes: { external_error: '131053: Media upload error' }, sender: { type: 'user', name: 'Stella' } })
    expect(l).toMatchObject({ status_entrega: 'failed', erro_entrega: '131053: Media upload error' })
    expect(statusFinal('delivered', 'erro antigo')).toBe('delivered')
    expect(statusFinal(null, 'erro')).toBe('failed')
    expect(statusFinal(null, null)).toBeNull()
  })

  it('estado: da conversa aninhada no webhook de mensagem e do webhook da própria conversa', () => {
    expect(estadoDaConversa({ event: 'message_created', conversation: { id: 356, status: 'open', labels: ['humano', ' vip '] } }))
      .toEqual({ conversa_id: 356, status: 'open', etiquetas: ['humano', 'vip'] })
    expect(estadoDaConversa({ event: 'conversation_status_changed', id: 356, status: 'resolved', labels: [] }))
      .toEqual({ conversa_id: 356, status: 'resolved', etiquetas: [] })
    expect(estadoDaConversa({ event: 'message_created', conversation: { id: 356 } })).toBeNull()
    expect(estadoDaConversa({ event: 'message_created' })).toBeNull()
  })
})
