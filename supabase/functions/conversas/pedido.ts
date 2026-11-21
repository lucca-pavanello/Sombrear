/**
 * O pedido da aba Conversas, sem rede e sem import: roda na edge function e nos testes do
 * vitest. Adaptado de `_shared/crm.ts` e `_shared/chatwoot.ts` do CRM da MIP.
 */

/** o mesmo teto da tela (src/lib/conversas/anexos.ts): 16 MB */
export const TETO_ENVIO = 16 * 1024 * 1024
export const TETO_TEXTO = 4096

const TIPOS_ACEITOS = new Set([
  'image/jpeg', 'image/png',
  'video/mp4', 'video/3gpp',
  'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/amr',
  'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/** null = pode sair; senão a frase pra quem está no dash. A tela confere antes; aqui é a trava. */
export function recusaDoArquivo(tipo: string, tamanho: number): string | null {
  if (tamanho <= 0) return 'O arquivo veio vazio.'
  if (tamanho > TETO_ENVIO) return 'Arquivo grande demais: o limite é 16 MB.'
  const puro = tipo.split(';')[0].trim().toLowerCase()
  if (!TIPOS_ACEITOS.has(puro)) {
    return 'O WhatsApp não aceita esse tipo de arquivo. Mande foto (JPG ou PNG), vídeo MP4, áudio (MP3, AAC, M4A, OGG ou AMR), PDF, documento do Office ou texto.'
  }
  return null
}

/** a etiqueta do Chatwoot que cala a Amanda na conversa */
export const HUMANO = 'humano'

/** a lista que o Chatwoot devolve em .../labels ({ payload: [...] }); null se não veio lista */
export function etiquetasDaResposta(corpo: unknown): string[] | null {
  const payload = (corpo as { payload?: unknown } | null)?.payload
  if (!Array.isArray(payload)) return null
  return payload.map(String).map(e => e.trim()).filter(Boolean)
}

/**
 * O POST .../labels do Chatwoot SUBSTITUI a lista inteira: lê, mexe só na `humano` e grava a
 * lista toda. `ligada` = a IA responde (sem `humano`). `mudou` = precisa gravar.
 */
export function comIA(atuais: readonly string[], ligada: boolean): { lista: string[]; mudou: boolean } {
  const sem = atuais.filter(e => e !== HUMANO)
  const lista = ligada ? sem : [...sem, HUMANO]
  return { lista, mudou: ligada ? sem.length !== atuais.length : !atuais.includes(HUMANO) }
}

export type Pedido =
  | { acao: 'enviar'; conversa_id: number; texto: string | null; voz: boolean }
  | { acao: 'ia'; conversa_id: number; ligada: boolean }
  | { acao: 'encerrar'; conversa_id: number }

const idDe = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null }
const sim = (v: unknown) => v === true || v === 'true' || v === '1'
const nao = (v: unknown) => v === false || v === 'false' || v === '0'

/**
 * Confere o corpo (JSON, ou os campos de texto do multipart, que chegam como string). Devolve o
 * pedido limpo ou a frase do erro. Conta e caixa do Chatwoot NÃO existem aqui de propósito:
 * nunca vêm do navegador.
 */
export function lerPedido(corpo: unknown, temArquivo: boolean): Pedido | string {
  const c = (corpo ?? null) as Record<string, unknown> | null
  if (!c || typeof c !== 'object') return 'Pedido inválido.'
  const conversa_id = idDe(c.conversa_id)
  if (!conversa_id) return 'Pedido inválido: falta a conversa.'
  if (temArquivo && c.acao !== 'enviar') return 'Pedido inválido: arquivo só no enviar.'

  if (c.acao === 'enviar') {
    const texto = typeof c.texto === 'string' ? c.texto.trim() : ''
    if (!texto && !temArquivo) return 'Escreva a mensagem ou anexe um arquivo.'
    if (texto.length > TETO_TEXTO) return `Mensagem longa demais: o limite é ${TETO_TEXTO} caracteres.`
    return { acao: 'enviar', conversa_id, texto: texto || null, voz: temArquivo && sim(c.voz) }
  }
  if (c.acao === 'ia') {
    if (!sim(c.ligada) && !nao(c.ligada)) return 'Pedido inválido: ligar ou pausar a IA?'
    return { acao: 'ia', conversa_id, ligada: sim(c.ligada) }
  }
  if (c.acao === 'encerrar') return { acao: 'encerrar', conversa_id }
  return 'Pedido inválido: ação desconhecida.'
}
