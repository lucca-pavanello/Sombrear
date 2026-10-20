/**
 * O que acontece quando uma ligação da Amanda de voz termina, em ordem:
 * 1. guarda a ligação (tabela ligacoes, idempotente pelo ref);
 * 2. cria ou atualiza o lead no CRM (crm_sombrear_ia, pelo identificador do WhatsApp);
 * 3. acha ou abre a conversa do cliente no Chatwoot e manda as mensagens + a nota da equipe;
 *    se a equipe já assumiu o lead (etiqueta "humano"), manda só a nota;
 * 4. deixa um lembrete na memória da Amanda do WhatsApp (n8n_chat_histories);
 * 5. marca na ligação o que foi feito.
 * Banco e Chatwoot entram por parâmetro, para os testes rodarem sem tocar em produção.
 */
import { conversaDoCliente, enviarAoCliente, etiquetar, notaInterna, type Pedir } from './chatwoot.ts'
import { lembreteMemoria, mensagensCliente, notaEquipe, reais, type Assunto, type Fala, type Orcamento } from './mensagem.ts'

export type Ligacao = {
  ref: string
  inicio: string
  fim?: string | null
  telefone_chamador?: string | null
  telefone?: string | null
  nome?: string | null
  assunto?: Assunto | null
  resumo?: string | null
  orcamento?: Orcamento | null
  ambientes?: string[] | null  // cômodos que o cliente citou ("sala", "quarto")
  transcricao?: Fala[]
}

export type Lead = {
  id: string; nome: string | null; status_lead: string | null; resumo_conversa: string | null
  chatwoot_labels: string | null; precisa_humano: string | null; id_conversa_chatwoot: string | null
}

export type StatusWhatsapp = 'pendente' | 'enviado' | 'so_nota' | 'sem_telefone' | 'erro'

export type Db = {
  statusLigacao(ref: string): Promise<StatusWhatsapp | null>
  salvarLigacao(linha: Record<string, unknown>): Promise<void>
  acharLead(identificador: string): Promise<Lead | null>
  criarLead(campos: Record<string, unknown>): Promise<Lead>
  atualizarLead(id: string, campos: Record<string, unknown>): Promise<void>
  lembrar(sessao: string, texto: string): Promise<void>
}

export type Resultado = { status: StatusWhatsapp; lead_id?: string; conversa?: number; erro?: string; repetida?: boolean }

const LIMITE_RESUMO = 4000

/** só dígitos, com 55 na frente; null se não parece telefone brasileiro (DDD + 8 ou 9 dígitos) */
export function normalizarTelefone(v: string | null | undefined): string | null {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) d = '55' + d
  return /^55\d{10,11}$/.test(d) ? d : null
}

export function equipeAssumiu(l: Lead | null): boolean {
  if (!l) return false
  const etiquetas = String(l.chatwoot_labels ?? '').split(',').map(s => s.trim().toLowerCase())
  return etiquetas.includes('humano') || String(l.precisa_humano ?? '').trim().toLowerCase() === 'sim'
}

function diaBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(/\//g, '-')
}

// o Chatwoot entrega ao WhatsApp em segundo plano: mandadas no mesmo segundo, as mensagens chegavam
// trocadas (a da foto antes do "oi"). A pausa garante a ordem.
const PAUSA_ENTRE_MENSAGENS_MS = 3000
const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function registrar(lig: Ligacao, db: Db, pedir: Pedir, agora: () => Date = () => new Date(),
  pausa: (ms: number) => Promise<void> = esperar): Promise<Resultado> {
  const assunto: Assunto = lig.assunto ?? 'duvida'
  const resumo = lig.resumo?.trim() || 'Ligação sem resumo.'
  const transcricao = lig.transcricao ?? []
  const numero = normalizarTelefone(lig.telefone) ?? normalizarTelefone(lig.telefone_chamador)
  const base = {
    ref: lig.ref, inicio: lig.inicio, fim: lig.fim ?? null,
    telefone_chamador: normalizarTelefone(lig.telefone_chamador) ?? lig.telefone_chamador ?? null,
    telefone: numero, nome: lig.nome?.trim() || null, assunto, resumo,
    orcamento: lig.orcamento ?? null, transcricao,
  }

  // repetiu o envio de uma ligação que já foi tratada: não manda nada de novo pro cliente
  const anterior = await db.statusLigacao(lig.ref)
  if (anterior && anterior !== 'pendente' && anterior !== 'erro') return { status: anterior, repetida: true }

  await db.salvarLigacao({ ...base, whatsapp_status: 'pendente', whatsapp_erro: null })
  if (!numero) {
    await db.salvarLigacao({ ...base, whatsapp_status: 'sem_telefone' })
    return { status: 'sem_telefone' }
  }

  const identificador = `${numero}@s.whatsapp.net`
  const quando = agora().toISOString()
  const valor = lig.orcamento ? `${lig.orcamento.maisBarato ? 'a partir de ' : ''}${reais(lig.orcamento.total4x)}` : null
  const linhaResumo = `[Ligação ${diaBR(lig.inicio)}] ${resumo}`

  let lead = await db.acharLead(identificador)
  const assumiu = equipeAssumiu(lead)
  if (!lead) {
    lead = await db.criarLead({
      identificador_usuario: identificador, whatsapp: numero, nome: base.nome, origem: 'ligacao',
      status_lead: '1', inicio_atendimento: diaBR(lig.inicio), resumo_conversa: linhaResumo,
      ultimo_valor_cotado: valor, timestamp_ultima_msg: quando,
    })
  } else {
    await db.atualizarLead(lead.id, {
      resumo_conversa: (linhaResumo + (lead.resumo_conversa ? '\n' + lead.resumo_conversa : '')).slice(0, LIMITE_RESUMO),
      ...(valor ? { ultimo_valor_cotado: valor } : {}),
      ...(!lead.nome && base.nome ? { nome: base.nome } : {}),
      ...(lead.status_lead === 'historico' ? { status_lead: '1' } : {}),
      timestamp_ultima_msg: quando,
    })
  }

  try {
    const conv = await conversaDoCliente(pedir, {
      numero, identificador, nome: base.nome, conversaConhecida: Number(lead.id_conversa_chatwoot) || null,
    })
    const ambientes = Array.isArray(lig.ambientes)
      ? lig.ambientes.filter(a => typeof a === 'string' && a.trim() && a.length <= 30).slice(0, 4)
      : []
    const mensagens = assumiu ? [] : mensagensCliente({
      nome: base.nome, assunto, resumo, orcamento: lig.orcamento, ambientes, quando: lig.fim ?? lig.inicio,
    })
    for (const [i, m] of mensagens.entries()) {
      if (i > 0) await pausa(PAUSA_ENTRE_MENSAGENS_MS)
      await enviarAoCliente(pedir, conv.conversaId, m)
    }
    await notaInterna(pedir, conv.conversaId, notaEquipe({
      inicio: lig.inicio, fim: lig.fim, nome: base.nome, telefone: numero,
      telefoneChamador: base.telefone_chamador, assunto, resumo, orcamento: lig.orcamento, transcricao, equipeAssumiu: assumiu,
    }))
    await etiquetar(pedir, conv.conversaId, 'ligacao')
    if (String(conv.conversaId) !== lead.id_conversa_chatwoot) {
      await db.atualizarLead(lead.id, {
        id_conta_chatwoot: '1', id_conversa_chatwoot: String(conv.conversaId),
        id_lead_chatwoot: String(conv.contatoId), inbox_id_chatwoot: '5',
      })
    }
    await db.lembrar(identificador, lembreteMemoria({ inicio: lig.inicio, resumo, orcamento: lig.orcamento, mensagens }))
    const status: StatusWhatsapp = assumiu ? 'so_nota' : 'enviado'
    await db.salvarLigacao({ ...base, lead_id: lead.id, conversa_chatwoot: String(conv.conversaId), whatsapp_status: status })
    return { status, lead_id: lead.id, conversa: conv.conversaId }
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e)
    await db.salvarLigacao({ ...base, lead_id: lead.id, whatsapp_status: 'erro', whatsapp_erro: erro.slice(0, 500) })
    return { status: 'erro', lead_id: lead.id, erro }
  }
}
