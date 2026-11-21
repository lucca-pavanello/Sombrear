/**
 * Mensagem do Chatwoot → linha de `mensagens_sombrear`. Sem import de propósito: roda
 * na edge function e nos testes do vitest.
 *
 * O Chatwoot entrega a mesma mensagem em dois formatos: pela API (message_type número,
 * created_at em segundos) e pelo webhook (message_type texto, created_at ISO). As duas
 * entradas passam por aqui.
 *
 * QUEM FALOU (medido em 01/10/2026 nas 15.631 mensagens da conta 1):
 * - cliente: message_type 0 / 'incoming'.
 * - IA: o n8n da Amanda marca content_attributes.autor = 'stella_ia'. Algumas saem pelo
 *   usuário "Atendente Amanda" sem a marca (quase todas apagadas ou vazias): também IA.
 * - equipe pelo Chatwoot: usuário da loja (Stella), sem source_id.
 * - equipe pelo celular: a loja responde pelo WhatsApp, o WhatsApp devolve uma cópia e o
 *   Chatwoot grava no usuário dono do token da integração (hoje "Lucca"), COM source_id.
 *   O nome desse usuário não é de quem escreveu, então autor_nome fica null.
 * - equipe pelo dash (aba Conversas): a function `conversas` carimba content_attributes.autor =
 *   'equipe' com o nome de quem mandou. Vale antes de tudo: o token que envia é o da integração,
 *   então o usuário do Chatwoot não diz quem escreveu.
 * - message_type 2 (evento do sistema: atribuição, etiqueta) não é mensagem e não entra.
 *
 * ENTREGA (aba Conversas): `status` vem como texto no webhook e número na API (0 enviada,
 * 1 entregue, 2 lida, 3 falhou); o motivo da recusa fica em content_attributes.external_error.
 * O webhook de message_updated costuma vir SEM `status`: aí fica null e o index.ts busca na API.
 */

export type Autor = 'cliente' | 'ia' | 'equipe'

export type StatusEntrega = 'sent' | 'delivered' | 'read' | 'failed'

export type LinhaMensagem = {
  id: number
  conversa_id: number
  inbox_id: number | null
  telefone: string | null
  autor: Autor
  autor_nome: string | null
  canal_envio: 'chatwoot' | 'celular' | null
  privada: boolean
  conteudo: string | null
  tipo_conteudo: string | null
  /** lat/lng só em localização (file_type 'location') */
  anexos: { tipo: string | null; url: string | null; nome: string | null; lat?: number; lng?: number }[]
  excluida: boolean
  responde_a: number | null
  enviada_em: string
  /** só de mensagem enviada (IA ou equipe); null = o Chatwoot não disse */
  status_entrega: StatusEntrega | null
  erro_entrega: string | null
  do_celular: boolean
}

/** o estado da conversa que vem junto de cada webhook: aberta/encerrada e etiquetas */
export type EstadoConversa = { conversa_id: number; status: string; etiquetas: string[] }

type Remetente = { type?: string | null; name?: string | null; phone_number?: string | null } | null

export type MensagemChatwoot = {
  id: number
  content?: string | null
  content_type?: string | null
  message_type?: number | string | null
  private?: boolean | null
  created_at?: number | string | null
  source_id?: string | null
  status?: string | number | null
  content_attributes?: Record<string, unknown> | null
  sender?: Remetente
  attachments?: {
    file_type?: string | null; data_url?: string | null; file_name?: string | null
    coordinates_lat?: number | null; coordinates_long?: number | null; fallback_title?: string | null
  }[] | null
  conversation_id?: number | null
  inbox_id?: number | null
  conversation?: { id?: number; inbox_id?: number; status?: string | null; labels?: unknown; meta?: { sender?: Remetente } } | null
}

const NOME_IA = 'atendente amanda'
const USUARIO_ESPELHO_CELULAR = 'lucca'

function tipoDaMensagem(m: MensagemChatwoot): 'entrada' | 'saida' | 'evento' | 'modelo' {
  const t = m.message_type
  if (t === 0 || t === 'incoming') return 'entrada'
  if (t === 1 || t === 'outgoing') return 'saida'
  if (t === 3 || t === 'template') return 'modelo'
  return 'evento'
}

function dataIso(v: number | string | null | undefined): string | null {
  if (v == null || v === '') return null
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const STATUS: StatusEntrega[] = ['sent', 'delivered', 'read', 'failed']

export function statusDe(v: unknown): StatusEntrega | null {
  if (typeof v === 'number') return STATUS[v] ?? null
  return typeof v === 'string' && (STATUS as string[]).includes(v) ? v as StatusEntrega : null
}

/**
 * O WhatsApp recusou (external_error) mas o Chatwoot deixou em "enviada": é falha. Entregue ou
 * lida depois de um reenvio continua valendo, mesmo com o erro antigo guardado.
 */
export function statusFinal(status: StatusEntrega | null, erro: string | null): StatusEntrega | null {
  return erro && (status === 'sent' || status === null) ? 'failed' : status
}

/**
 * Aberta/encerrada e etiquetas, de qualquer webhook que traga a conversa: o de mensagem (em
 * `conversation`) e os de conversa (conversation_status_changed, conversation_updated: a
 * conversa é o próprio corpo). null quando o corpo não traz status.
 */
export function estadoDaConversa(body: Record<string, unknown> | null): EstadoConversa | null {
  if (!body) return null
  const evento = String(body.event ?? '')
  const c = (evento.startsWith('conversation_') ? body : body.conversation) as { id?: unknown; status?: unknown; labels?: unknown } | null | undefined
  const id = Number(c?.id)
  if (!c || !Number.isInteger(id) || id <= 0 || typeof c.status !== 'string' || !c.status) return null
  const etiquetas = Array.isArray(c.labels) ? c.labels.map(e => String(e).trim()).filter(Boolean) : []
  return { conversa_id: id, status: c.status, etiquetas }
}

/** null quando não é mensagem (evento do sistema) ou falta o essencial */
export function mapearMensagem(m: MensagemChatwoot, telefoneConversa?: string | null): LinhaMensagem | null {
  const tipo = tipoDaMensagem(m)
  if (tipo === 'evento') return null
  const conversa = m.conversation_id ?? m.conversation?.id ?? null
  const enviada = dataIso(m.created_at)
  if (!m.id || !conversa || !enviada) return null

  const attrs = (m.content_attributes ?? {}) as Record<string, unknown>
  const remetente = m.sender ?? null
  const nome = (remetente?.name ?? '').trim()

  let autor: Autor
  let canal: LinhaMensagem['canal_envio'] = null
  let autorNome: string | null = nome || null
  if (tipo === 'entrada') {
    autor = 'cliente'
    autorNome = null
  } else if (attrs.autor === 'equipe') {
    autor = 'equipe'
    canal = 'chatwoot'
    autorNome = typeof attrs.autor_nome === 'string' && attrs.autor_nome.trim() ? attrs.autor_nome.trim() : null
  } else if (attrs.autor === 'stella_ia' || nome.toLowerCase() === NOME_IA || remetente?.type === 'agent_bot') {
    autor = 'ia'
    autorNome = 'Amanda'
  } else {
    autor = 'equipe'
    const veioDoCelular = !!m.source_id && nome.toLowerCase() === USUARIO_ESPELHO_CELULAR
    canal = veioDoCelular ? 'celular' : 'chatwoot'
    if (veioDoCelular) autorNome = null
  }

  const resposta = attrs.in_reply_to
  const erro = tipo !== 'entrada' && typeof attrs.external_error === 'string' && attrs.external_error.trim()
    ? attrs.external_error.trim() : null
  return {
    id: Number(m.id),
    conversa_id: Number(conversa),
    inbox_id: m.inbox_id ?? m.conversation?.inbox_id ?? null,
    telefone: telefoneConversa ?? m.conversation?.meta?.sender?.phone_number
      ?? (tipo === 'entrada' ? remetente?.phone_number ?? null : null),
    autor,
    autor_nome: autorNome,
    canal_envio: canal,
    privada: !!m.private,
    conteudo: m.content ?? null,
    tipo_conteudo: m.content_type ?? null,
    anexos: (m.attachments ?? []).map(a => ({
      tipo: a.file_type ?? null, url: a.data_url ?? null, nome: a.file_name ?? a.fallback_title ?? null,
      ...(typeof a.coordinates_lat === 'number' && typeof a.coordinates_long === 'number' ? { lat: a.coordinates_lat, lng: a.coordinates_long } : {}),
    })),
    excluida: attrs.deleted === true,
    responde_a: typeof resposta === 'number' ? resposta : null,
    enviada_em: enviada,
    status_entrega: tipo === 'entrada' ? null : statusFinal(statusDe(m.status), erro),
    erro_entrega: erro,
    do_celular: canal === 'celular',
  }
}
