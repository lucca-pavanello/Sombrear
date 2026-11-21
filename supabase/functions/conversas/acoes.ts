/**
 * As três ações da aba Conversas sobre o Chatwoot da Sombrear (conta 1, caixa 5). O Chatwoot e
 * o banco chegam injetados (`Deps`), como em registrar-ligacao: dá para testar a ordem dos
 * passos sem rede. Adaptado de `crm-conversas/index.ts` do CRM da MIP.
 *
 * A ordem do envio importa ("se a pessoa responder, a IA para"):
 *  1. a conversa tem de ser da caixa do WhatsApp da loja;
 *  2. ela ganha a etiqueta `humano` ANTES de a mensagem sair. Sem conseguir pausar, não envia;
 *  3. a mensagem vai pela conversa do Chatwoot, carimbada com quem mandou;
 *  4. só com id ela conta como enviada e vai pro espelho (o webhook confirma depois).
 */
import { INBOX_WHATSAPP, notaInterna, type Pedir } from '../registrar-ligacao/chatwoot.ts'
import { mapearMensagem, type EstadoConversa, type LinhaMensagem, type MensagemChatwoot } from '../mensagens-chatwoot/mapear.ts'
import { comIA, etiquetasDaResposta, HUMANO, type Pedido } from './pedido.ts'

export type Quem = { id: string; nome: string }

export type Deps = {
  /** fetch JSON do Chatwoot já com a base, a conta e o token; lança em resposta que não é 2xx */
  pedir: Pedir
  /** o mesmo, em multipart (anexo) */
  enviarFormulario: (caminho: string, form: FormData) => Promise<any>
  /** grava a mensagem enviada em mensagens_sombrear; falha aqui não desfaz o envio */
  espelharMensagem: (linha: LinhaMensagem) => Promise<void>
  /** grava aberta/encerrada e etiquetas em conversas_estado */
  espelharEstado: (estado: EstadoConversa) => Promise<void>
}

export type Resultado = { status: number; corpo: Record<string, unknown> }

const falha = (status: number, erro: string, codigo: string): Resultado => ({ status, corpo: { ok: false, erro, codigo } })
const certo = (corpo: Record<string, unknown>): Resultado => ({ status: 200, corpo: { ok: true, ...corpo } })
const avisar = (onde: string, e: unknown) => console.error(`[conversas] ${onde}:`, e instanceof Error ? e.message : e)

type Conversa = { id: number; status: string; telefone: string | null }

/** a conversa, só se for da caixa do WhatsApp da loja; a caixa nunca vem do navegador */
async function conversaDaLoja(d: Deps, id: number): Promise<Conversa | null> {
  const c = await d.pedir('GET', `/conversations/${id}`).catch(() => null)
  if (!c?.id || c.inbox_id !== INBOX_WHATSAPP) return null
  return { id: Number(c.id), status: String(c.status ?? 'open'), telefone: c.meta?.sender?.phone_number ?? null }
}

/** liga ou pausa a IA (a `humano`), lendo e regravando a lista inteira; null = não conseguiu */
async function mudarIA(d: Deps, conversa: number, ligada: boolean): Promise<string[] | null> {
  try {
    const hoje = etiquetasDaResposta(await d.pedir('GET', `/conversations/${conversa}/labels`))
    if (!hoje) return null
    const { lista, mudou } = comIA(hoje, ligada)
    if (!mudou) return lista
    const gravada = etiquetasDaResposta(await d.pedir('POST', `/conversations/${conversa}/labels`, { labels: lista }))
    // confere o que o Chatwoot gravou: a `humano` tem de estar (pausada) ou não estar (ligada)
    if (!gravada || gravada.includes(HUMANO) === ligada) return null
    return gravada
  } catch (e) {
    avisar('etiquetas', e)
    return null
  }
}

async function mudarStatus(d: Deps, conversa: number, status: 'open' | 'resolved'): Promise<boolean> {
  try {
    const r = await d.pedir('POST', `/conversations/${conversa}/toggle_status`, { status })
    const atual = r?.payload?.current_status
    return atual == null || atual === status
  } catch (e) {
    avisar(`status ${status}`, e)
    return false
  }
}

const estado = (d: Deps, e: EstadoConversa) => d.espelharEstado(e).catch(x => avisar('espelho do estado', x))

export async function enviar(d: Deps, quem: Quem, p: Extract<Pedido, { acao: 'enviar' }>, arquivo: File | null): Promise<Resultado> {
  const conversa = await conversaDaLoja(d, p.conversa_id)
  if (!conversa) return falha(404, 'Não achei essa conversa.', 'conversa')

  // 1) pausar a IA
  const etiquetas = await mudarIA(d, conversa.id, false)
  if (!etiquetas) return falha(502, 'Não consegui pausar a IA nesta conversa, então nada foi enviado. Tente de novo.', 'pausa')

  // 2) a encerrada reabre antes (senão a resposta do cliente abre outra conversa)
  if (conversa.status === 'resolved') await mudarStatus(d, conversa.id, 'open')
  await estado(d, { conversa_id: conversa.id, status: 'open', etiquetas })

  // 3) enviar pela conversa, carimbada com quem mandou (o mapear.ts lê este carimbo)
  const carimbo = { autor: 'equipe', autor_nome: quem.nome, user_id: quem.id, origem: 'dash' }
  let r: any
  try {
    if (arquivo) {
      const form = new FormData()
      form.append('message_type', 'outgoing')
      form.append('private', 'false')
      if (p.texto) form.append('content', p.texto)
      for (const [k, v] of Object.entries(carimbo)) form.append(`content_attributes[${k}]`, v)
      form.append('attachments[]', arquivo, arquivo.name || 'arquivo')
      r = await d.enviarFormulario(`/conversations/${conversa.id}/messages`, form)
    } else {
      r = await d.pedir('POST', `/conversations/${conversa.id}/messages`, {
        content: p.texto, message_type: 'outgoing', private: false, content_attributes: carimbo,
      })
    }
  } catch (e) {
    avisar('envio', e)
    r = null
  }
  const id = Number(r?.id)
  if (!Number.isInteger(id) || id <= 0) {
    return falha(502, 'A mensagem não saiu. A IA ficou pausada nesta conversa; tente de novo.', 'envio')
  }

  // 4) o espelho, já com quem mandou; o webhook regrava depois com o status de entrega
  const linha = mapearMensagem({
    ...(r as MensagemChatwoot), conversation_id: conversa.id, inbox_id: INBOX_WHATSAPP,
    content_attributes: { ...((r as MensagemChatwoot).content_attributes ?? {}), ...carimbo },
  }, conversa.telefone)
  if (linha) {
    await d.espelharMensagem({ ...linha, status_entrega: linha.status_entrega ?? 'sent' }).catch(x => avisar('espelho da mensagem', x))
  }
  console.log(`[conversas] conversa ${conversa.id}: mensagem ${id} por ${quem.id}`)
  return certo({ mensagem_id: id, etiquetas })
}

export async function ia(d: Deps, p: Extract<Pedido, { acao: 'ia' }>): Promise<Resultado> {
  const conversa = await conversaDaLoja(d, p.conversa_id)
  if (!conversa) return falha(404, 'Não achei essa conversa.', 'conversa')
  const etiquetas = await mudarIA(d, conversa.id, p.ligada)
  if (!etiquetas) return falha(502, p.ligada ? 'Não consegui ligar a IA agora. Tente de novo.' : 'Não consegui pausar a IA agora. Tente de novo.', 'etiquetas')
  await estado(d, { conversa_id: conversa.id, status: conversa.status, etiquetas })
  return certo({ etiquetas })
}

/**
 * Encerrar: a IA religa (quem voltar a escrever é demanda nova, a Amanda atende), fica uma nota
 * interna de quem encerrou e a conversa vai para resolvida no Chatwoot.
 */
export async function encerrar(d: Deps, quem: Quem, p: Extract<Pedido, { acao: 'encerrar' }>): Promise<Resultado> {
  const conversa = await conversaDaLoja(d, p.conversa_id)
  if (!conversa) return falha(404, 'Não achei essa conversa.', 'conversa')
  if (conversa.status === 'resolved') return certo({ ja_encerrada: true })

  // 1) a IA religada antes de resolver: sem isso, quem voltar a escrever ficaria sem resposta
  const etiquetas = await mudarIA(d, conversa.id, true)
  if (!etiquetas) return falha(502, 'Não consegui religar a IA nesta conversa, então ela não foi encerrada. Tente de novo.', 'etiquetas')

  // 2) nota interna antes de resolver (nota em conversa resolvida pode reabrir no Chatwoot)
  await notaInterna(d.pedir, conversa.id, `Conversa encerrada por ${quem.nome} pelo dash.`).catch(x => avisar('nota do encerramento', x))

  // 3) resolvida no Chatwoot e no espelho
  if (!(await mudarStatus(d, conversa.id, 'resolved'))) {
    await estado(d, { conversa_id: conversa.id, status: conversa.status, etiquetas })
    return falha(502, 'A IA foi religada, mas o Chatwoot não encerrou a conversa. Tente de novo.', 'status')
  }
  await estado(d, { conversa_id: conversa.id, status: 'resolved', etiquetas })
  console.log(`[conversas] conversa ${conversa.id}: encerrada por ${quem.id}`)
  return certo({ etiquetas })
}
