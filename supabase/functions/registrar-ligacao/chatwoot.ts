/**
 * A conversa do cliente no Chatwoot da Sombrear (conta 1, inbox 5 "Sombrear", que entrega no
 * WhatsApp da loja pela Uazapi). Acha o contato pelo identificador do WhatsApp
 * (5517...@s.whatsapp.net, o mesmo que o n8n usa) ou cria; reaproveita a conversa da inbox
 * 5 ou abre uma. `pedir` é o fetch já com a base e o token: injetado para testar sem rede.
 */

export const INBOX_WHATSAPP = 5

export type Pedir = (metodo: 'GET' | 'POST', caminho: string, corpo?: unknown) => Promise<any>

export type Conversa = { contatoId: number; conversaId: number; criouContato: boolean; criouConversa: boolean }

export async function conversaDoCliente(
  pedir: Pedir, p: { numero: string; identificador: string; nome: string | null; conversaConhecida?: number | null },
): Promise<Conversa> {
  if (p.conversaConhecida) {
    const c = await pedir('GET', `/conversations/${p.conversaConhecida}`).catch(() => null)
    if (c?.id && c.inbox_id === INBOX_WHATSAPP && c.meta?.sender?.id) {
      return { contatoId: c.meta.sender.id, conversaId: c.id, criouContato: false, criouConversa: false }
    }
  }

  const busca = await pedir('GET', `/contacts/search?q=${encodeURIComponent(p.numero)}`)
  const achados: any[] = busca?.payload ?? []
  const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')
  let contato = achados.find(c => c.identifier === p.identificador)
    ?? achados.find(c => digitos(c.phone_number) === p.numero)
  let criouContato = false
  if (!contato) {
    const r = await pedir('POST', '/contacts', {
      inbox_id: INBOX_WHATSAPP, name: p.nome?.trim() || `+${p.numero}`,
      phone_number: `+${p.numero}`, identifier: p.identificador,
    })
    contato = r?.payload?.contact ?? r?.payload ?? r
    criouContato = true
  }
  if (!contato?.id) throw new Error('chatwoot: não consegui achar nem criar o contato')

  const conversas: any[] = (await pedir('GET', `/contacts/${contato.id}/conversations`))?.payload ?? []
  const daInbox = conversas.filter(c => c.inbox_id === INBOX_WHATSAPP).sort((a, b) => b.id - a.id)
  if (daInbox.length) return { contatoId: contato.id, conversaId: daInbox[0].id, criouContato, criouConversa: false }

  const caixas: any[] = contato.contact_inboxes ?? (await pedir('GET', `/contacts/${contato.id}`))?.payload?.contact_inboxes ?? []
  const sourceId = caixas.find(ci => (ci.inbox?.id ?? ci.inbox_id) === INBOX_WHATSAPP)?.source_id
  const nova = await pedir('POST', '/conversations', {
    inbox_id: INBOX_WHATSAPP, contact_id: contato.id, ...(sourceId ? { source_id: sourceId } : {}),
  })
  if (!nova?.id) throw new Error('chatwoot: não consegui abrir a conversa')
  return { contatoId: contato.id, conversaId: nova.id, criouContato, criouConversa: true }
}

/** mensagem ao cliente (sai no WhatsApp) com a marca da Amanda, que o Dash conta como IA */
export function enviarAoCliente(pedir: Pedir, conversa: number, texto: string) {
  return pedir('POST', `/conversations/${conversa}/messages`, {
    content: texto, message_type: 'outgoing', content_attributes: { autor: 'stella_ia', origem: 'ligacao' },
  })
}

/** nota interna: só a equipe vê no Chatwoot, não vai pro WhatsApp */
export function notaInterna(pedir: Pedir, conversa: number, texto: string) {
  return pedir('POST', `/conversations/${conversa}/messages`, { content: texto, message_type: 'outgoing', private: true })
}

/** o POST de etiquetas troca a lista inteira: soma à que já existe */
export async function etiquetar(pedir: Pedir, conversa: number, etiqueta: string) {
  const atuais: string[] = (await pedir('GET', `/conversations/${conversa}/labels`))?.payload ?? []
  if (atuais.includes(etiqueta)) return
  await pedir('POST', `/conversations/${conversa}/labels`, { labels: [...atuais, etiqueta] })
}
