/**
 * Ligação da Amanda de voz → CRM → WhatsApp (supabase/functions/registrar-ligacao), com banco e
 * Chatwoot de mentira: nada aqui toca produção. Os formatos do Chatwoot são os da conta 1
 * (inbox 5, contato com identifier 55...@s.whatsapp.net), sem dado de cliente.
 */
import { describe, expect, it } from 'vitest'
import { conversaDoCliente, etiquetar, type Pedir } from '../../../supabase/functions/registrar-ligacao/chatwoot'
import { blocoOrcamento, mensagensCliente, notaEquipe, primeiroNome } from '../../../supabase/functions/registrar-ligacao/mensagem'
import {
  equipeAssumiu, normalizarTelefone, registrar, type Db, type Lead, type Ligacao, type StatusWhatsapp,
} from '../../../supabase/functions/registrar-ligacao/registrar'

const ORC = { modelo: 'Rolo', tecido: 'BK Branco', largura: 2, altura: 2, quantidade: 1, total4x: 931, totalAvista: 884.45, instalacao: 85, maisBarato: true }

const LIG: Ligacao = {
  ref: 'lig-1', inicio: '2026-10-20T13:40:00Z', fim: '2026-10-20T13:43:10Z',
  telefone_chamador: '+55 17 99876-5432', telefone: '17998765432', nome: 'Juliana Prado Souza',
  assunto: 'orcamento', resumo: 'Rolô blackout pra sala, 2 x 2 do vão; vai mandar foto da janela.',
  orcamento: ORC,
  transcricao: [{ quem: 'amanda', texto: 'Boa tarde, Amanda da Sombrear Decor aqui.' }, { quem: 'cliente', texto: 'Queria uma persiana.' }],
}

/** banco em memória com o mesmo contrato do adaptador do Supabase */
function bancoFalso(leads: Lead[] = []) {
  const ligacoes = new Map<string, Record<string, any>>()
  const memoria: { sessao: string; texto: string }[] = []
  const criados: Record<string, unknown>[] = []
  const atualizacoes: { id: string; campos: Record<string, unknown> }[] = []
  const porIdent = new Map<string, Lead & { identificador: string }>()
  for (const l of leads) porIdent.set((l as any).identificador, l as any)
  const db: Db = {
    async statusLigacao(ref) { return (ligacoes.get(ref)?.whatsapp_status as StatusWhatsapp) ?? null },
    async salvarLigacao(linha) { ligacoes.set(String(linha.ref), { ...ligacoes.get(String(linha.ref)), ...linha }) },
    async acharLead(identificador) { return porIdent.get(identificador) ?? null },
    async criarLead(campos) {
      criados.push(campos)
      const l = { id: `lead-${criados.length}`, nome: (campos.nome as string) ?? null, status_lead: '1', resumo_conversa: null,
        chatwoot_labels: null, precisa_humano: null, id_conversa_chatwoot: null, identificador: String(campos.identificador_usuario) }
      porIdent.set(l.identificador, l)
      return l
    },
    async atualizarLead(id, campos) { atualizacoes.push({ id, campos }) },
    async lembrar(sessao, texto) { memoria.push({ sessao, texto }) },
  }
  return { db, ligacoes, memoria, criados, atualizacoes }
}

/** Chatwoot em memória: contatos, conversas, mensagens e etiquetas */
function chatwootFalso(inicial: { contatos?: any[]; conversas?: any[]; falharEm?: string } = {}) {
  const contatos = [...(inicial.contatos ?? [])]
  const conversas = [...(inicial.conversas ?? [])]
  const mensagens: { conversa: number; corpo: any }[] = []
  const etiquetas = new Map<number, string[]>()
  const chamadas: string[] = []
  const pedir: Pedir = async (metodo, caminho, corpo: any) => {
    chamadas.push(`${metodo} ${caminho}`)
    if (inicial.falharEm && caminho.includes(inicial.falharEm)) throw new Error('chatwoot 500 em ' + caminho)
    let m
    if (metodo === 'GET' && (m = caminho.match(/^\/contacts\/search\?q=(.+)$/))) {
      const q = decodeURIComponent(m[1])
      return { payload: contatos.filter(c => String(c.phone_number).replace(/\D/g, '').includes(q)) }
    }
    if (metodo === 'POST' && caminho === '/contacts') {
      const c = { id: 900 + contatos.length, ...corpo, contact_inboxes: [{ inbox: { id: corpo.inbox_id }, source_id: 'uuid-novo' }] }
      contatos.push(c)
      return { payload: { contact: c } }
    }
    if (metodo === 'GET' && (m = caminho.match(/^\/contacts\/(\d+)$/))) {
      return { payload: { ...contatos.find(c => c.id === Number(m![1])), contact_inboxes: [{ inbox: { id: 5 }, source_id: 'uuid-antigo' }] } }
    }
    if (metodo === 'GET' && (m = caminho.match(/^\/contacts\/(\d+)\/conversations$/))) {
      return { payload: conversas.filter(c => c.meta.sender.id === Number(m![1])) }
    }
    if (metodo === 'POST' && caminho === '/conversations') {
      const c = { id: 700 + conversas.length, inbox_id: corpo.inbox_id, meta: { sender: { id: corpo.contact_id } }, source_id: corpo.source_id }
      conversas.push(c)
      return c
    }
    if (metodo === 'GET' && (m = caminho.match(/^\/conversations\/(\d+)$/))) return conversas.find(c => c.id === Number(m![1])) ?? null
    if (metodo === 'POST' && (m = caminho.match(/^\/conversations\/(\d+)\/messages$/))) {
      mensagens.push({ conversa: Number(m[1]), corpo })
      return { id: mensagens.length }
    }
    if (metodo === 'GET' && (m = caminho.match(/^\/conversations\/(\d+)\/labels$/))) return { payload: etiquetas.get(Number(m[1])) ?? [] }
    if (metodo === 'POST' && (m = caminho.match(/^\/conversations\/(\d+)\/labels$/))) {
      etiquetas.set(Number(m[1]), corpo.labels)
      return { payload: corpo.labels }
    }
    throw new Error('rota não prevista no teste: ' + metodo + ' ' + caminho)
  }
  return { pedir, contatos, conversas, mensagens, etiquetas, chamadas }
}

const AGORA = () => new Date('2026-10-20T13:43:30Z')
const SEM_PAUSA = async () => {}

describe('telefone e nome', () => {
  it('normaliza para 55 + DDD + número e recusa o que não é telefone', () => {
    expect(normalizarTelefone('(17) 99876-5432')).toBe('5517998765432')
    expect(normalizarTelefone('+55 17 3304-1354')).toBe('551733041354')
    expect(normalizarTelefone('5517998765432')).toBe('5517998765432')
    expect(normalizarTelefone('179991234567')).toBeNull() // o dígito a mais que o GPT inventou no teste
    expect(normalizarTelefone('')).toBeNull()
    expect(normalizarTelefone(null)).toBeNull()
  })

  it('primeiro nome com maiúscula', () => {
    expect(primeiroNome('juliana prado')).toBe('Juliana')
    expect(primeiroNome('  ')).toBe('')
  })

  it('equipe assumiu: etiqueta humano ou precisa_humano = Sim', () => {
    const l = (x: Partial<Lead>) => ({ id: '1', nome: null, status_lead: '1', resumo_conversa: null, chatwoot_labels: null, precisa_humano: null, id_conversa_chatwoot: null, ...x })
    expect(equipeAssumiu(l({ chatwoot_labels: 'lead-gelado, humano' }))).toBe(true)
    expect(equipeAssumiu(l({ precisa_humano: 'Sim' }))).toBe(true)
    expect(equipeAssumiu(l({ chatwoot_labels: 'orcamento-calcular', precisa_humano: '' }))).toBe(false)
    expect(equipeAssumiu(null)).toBe(false)
  })
})

describe('textos', () => {
  it('orçamento: cumprimenta pelo primeiro nome numa mensagem e manda valor + pedido de foto na outra', () => {
    const [a, b] = mensagensCliente({ nome: 'Juliana Prado Souza', assunto: 'orcamento', resumo: 'x', orcamento: ORC })
    expect(a).toBe('Oi, Juliana, tudo bem? Aqui é da Sombrear, a gente se falou agora há pouco por telefone 😊')
    expect(b).toContain('• 01 Rolô BK Branco 2,00 x 2,00')
    expect(b).toContain('a partir de R$ 931,00 em até 4x, ou R$ 884,45 à vista')
    expect(b).toContain('acréscimo de R$ 85,00')
    expect(b).toContain('foto da janela')
    for (const m of [a, b]) expect((m.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1)
  })

  it('sem nome: pergunta com quem fala', () => {
    const [a] = mensagensCliente({ nome: null, assunto: 'duvida', resumo: 'x' })
    expect(a).toContain('Com quem eu falo?')
    expect(a).not.toContain('**')
  })

  it('outro assunto: avisa que o time responde, sem prometer data', () => {
    const [, b] = mensagensCliente({ nome: 'Carlos Lima', assunto: 'outro', resumo: 'Quer saber quando vão instalar a persiana que comprou.' })
    expect(b).toContain('Já passei seu recado pro pessoal da loja')
    expect(b).toContain('Eles te respondem por aqui')
    expect(b).not.toContain('Quer saber')  // o resumo é anotação da equipe, não fala pro cliente
    expect(b).not.toMatch(/hoje|amanhã|já já/i)
  })

  it('sem travessão em nenhum texto', () => {
    const textos = [
      ...mensagensCliente({ nome: 'A B', assunto: 'orcamento', resumo: 'x', orcamento: ORC }),
      notaEquipe({ inicio: LIG.inicio, fim: LIG.fim, nome: 'A', telefone: '5517', telefoneChamador: null, assunto: 'outro', resumo: 'x', orcamento: ORC, transcricao: LIG.transcricao!, equipeAssumiu: false }),
      blocoOrcamento({ ...ORC, instalacao: 'sob_consulta' }, null),
    ]
    for (const t of textos) expect(t).not.toMatch(/[–—]/)
  })

  it('nota da equipe: horário de Rio Preto, duração, conversa e aviso de nome', () => {
    const n = notaEquipe({ inicio: LIG.inicio, fim: LIG.fim, nome: 'Juliana', telefone: '5517998765432', telefoneChamador: '5517000000000', assunto: 'orcamento', resumo: 'r', orcamento: ORC, transcricao: LIG.transcricao!, equipeAssumiu: false })
    expect(n).toContain('20/10 às 10:40 (3 min)')
    expect(n).toContain('pode ter vindo errado pela voz')
    expect(n).toContain('número da linha: 5517000000000')
    expect(n).toContain('Cliente: Queria uma persiana.')
  })
})

describe('registrar: ordem das mensagens', () => {
  it('espera entre uma mensagem e outra, para o "oi" chegar antes da foto', async () => {
    const b = bancoFalso(); const c = chatwootFalso()
    const eventos: string[] = []
    const pedir: Pedir = async (metodo, caminho, corpo) => {
      if (metodo === 'POST' && caminho.endsWith('/messages') && !(corpo as { private?: boolean })?.private) {
        eventos.push('msg:' + String((corpo as { content: string }).content).slice(0, 3))
      }
      return c.pedir(metodo, caminho, corpo)
    }
    await registrar(LIG, b.db, pedir, AGORA, async ms => { eventos.push('pausa:' + ms) })
    expect(eventos).toEqual(['msg:Oi,', 'pausa:3000', 'msg:Te '])
  })
})

describe('registrar: cliente novo', () => {
  it('cria lead de origem ligação, contato e conversa no Chatwoot, manda 2 mensagens, nota e etiqueta', async () => {
    const b = bancoFalso(); const c = chatwootFalso()
    const r = await registrar(LIG, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r.status).toBe('enviado')

    expect(b.criados[0]).toMatchObject({
      identificador_usuario: '5517998765432@s.whatsapp.net', whatsapp: '5517998765432', nome: 'Juliana Prado Souza',
      origem: 'ligacao', status_lead: '1', inicio_atendimento: '20-10-2026', ultimo_valor_cotado: 'a partir de R$ 931,00',
    })
    expect(c.contatos[0]).toMatchObject({ inbox_id: 5, phone_number: '+5517998765432', identifier: '5517998765432@s.whatsapp.net' })
    expect(c.conversas[0]).toMatchObject({ inbox_id: 5, source_id: 'uuid-novo' })

    const doCliente = c.mensagens.filter(m => !m.corpo.private)
    expect(doCliente).toHaveLength(2)
    expect(doCliente[0].corpo).toMatchObject({ message_type: 'outgoing', content_attributes: { autor: 'stella_ia', origem: 'ligacao' } })
    expect(c.mensagens.filter(m => m.corpo.private)).toHaveLength(1)
    expect(c.etiquetas.get(r.conversa!)).toEqual(['ligacao'])

    expect(b.atualizacoes[b.atualizacoes.length - 1]?.campos).toMatchObject({ id_conversa_chatwoot: String(r.conversa), inbox_id_chatwoot: '5', id_conta_chatwoot: '1' })
    expect(b.memoria).toHaveLength(1)
    expect(b.memoria[0].sessao).toBe('5517998765432@s.whatsapp.net')
    expect(b.memoria[0].texto).toContain('[Ligação de 20/10 às 10:40')
    expect(b.ligacoes.get('lig-1')).toMatchObject({ whatsapp_status: 'enviado', lead_id: 'lead-1', telefone: '5517998765432' })
  })

  it('sem telefone confirmado usa o número da linha', async () => {
    const b = bancoFalso(); const c = chatwootFalso()
    const r = await registrar({ ...LIG, telefone: null }, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r.status).toBe('enviado')
    expect(b.criados[0].whatsapp).toBe('5517998765432')
  })

  it('sem número nenhum: só guarda a ligação, não mexe em CRM nem WhatsApp', async () => {
    const b = bancoFalso(); const c = chatwootFalso()
    const r = await registrar({ ...LIG, telefone: null, telefone_chamador: null }, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r.status).toBe('sem_telefone')
    expect(b.criados).toHaveLength(0)
    expect(c.chamadas).toHaveLength(0)
    expect(b.ligacoes.get('lig-1')?.whatsapp_status).toBe('sem_telefone')
  })
})

describe('registrar: cliente que já existe', () => {
  const existente = (x: Partial<Lead> = {}) => ({
    id: 'lead-antigo', nome: null, status_lead: 'historico', resumo_conversa: 'conversa antiga', chatwoot_labels: 'orcamento-calcular',
    precisa_humano: '', id_conversa_chatwoot: '356', identificador: '5517998765432@s.whatsapp.net', ...x,
  }) as any

  it('atualiza o lead e usa a conversa que já existe, sem criar contato', async () => {
    const b = bancoFalso([existente()])
    const c = chatwootFalso({ conversas: [{ id: 356, inbox_id: 5, meta: { sender: { id: 42 } } }] })
    const r = await registrar(LIG, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r).toMatchObject({ status: 'enviado', conversa: 356, lead_id: 'lead-antigo' })
    expect(b.criados).toHaveLength(0)
    expect(c.contatos).toHaveLength(0)
    const campos = b.atualizacoes[0].campos
    expect(campos.resumo_conversa).toMatch(/^\[Ligação 20-10-2026\] .*\nconversa antiga$/)
    expect(campos).toMatchObject({ nome: 'Juliana Prado Souza', status_lead: '1', ultimo_valor_cotado: 'a partir de R$ 931,00' })
    // a conversa já era a do CRM: não regrava os ids
    expect(b.atualizacoes).toHaveLength(1)
  })

  it('acha o contato pelo telefone quando o CRM não tem conversa e soma a etiqueta às que existem', async () => {
    const b = bancoFalso([existente({ id_conversa_chatwoot: null, status_lead: '2', nome: 'Ju' })])
    const c = chatwootFalso({
      contatos: [{ id: 42, phone_number: '+5517998765432', identifier: '5517998765432@s.whatsapp.net' }],
      conversas: [{ id: 300, inbox_id: 5, meta: { sender: { id: 42 } } }, { id: 400, inbox_id: 5, meta: { sender: { id: 42 } } }],
    })
    c.etiquetas.set(400, ['orcamento-calcular'])
    const r = await registrar(LIG, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r.conversa).toBe(400) // a mais recente da inbox do WhatsApp
    expect(c.etiquetas.get(400)).toEqual(['orcamento-calcular', 'ligacao'])
    expect(b.atualizacoes[0].campos.nome).toBeUndefined() // não troca o nome que a equipe já tinha
    expect(b.atualizacoes[0].campos.status_lead).toBeUndefined()
  })

  it('equipe já assumiu: nada vai pro cliente, só a nota', async () => {
    const b = bancoFalso([existente({ chatwoot_labels: 'humano, lead-gelado' })])
    const c = chatwootFalso({ conversas: [{ id: 356, inbox_id: 5, meta: { sender: { id: 42 } } }] })
    const r = await registrar(LIG, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r.status).toBe('so_nota')
    expect(c.mensagens.filter(m => !m.corpo.private)).toHaveLength(0)
    expect(c.mensagens[0].corpo.content).toContain('A equipe já atendia esse cliente')
    expect(b.ligacoes.get('lig-1')?.whatsapp_status).toBe('so_nota')
  })
})

describe('registrar: falhas e repetição', () => {
  it('Chatwoot fora do ar: o lead fica no CRM e a ligação marca o erro', async () => {
    const b = bancoFalso(); const c = chatwootFalso({ falharEm: '/contacts/search' })
    const r = await registrar(LIG, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r.status).toBe('erro')
    expect(b.criados).toHaveLength(1)
    expect(b.memoria).toHaveLength(0)
    expect(b.ligacoes.get('lig-1')).toMatchObject({ whatsapp_status: 'erro', lead_id: 'lead-1' })
    expect(String(b.ligacoes.get('lig-1')?.whatsapp_erro)).toContain('chatwoot 500')
  })

  it('a mesma ligação enviada de novo não manda mensagem duas vezes', async () => {
    const b = bancoFalso(); const c = chatwootFalso()
    await registrar(LIG, b.db, c.pedir, AGORA, SEM_PAUSA)
    const antes = c.mensagens.length
    const r = await registrar(LIG, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r).toMatchObject({ status: 'enviado', repetida: true })
    expect(c.mensagens.length).toBe(antes)
  })

  it('outro assunto sem resumo não quebra', async () => {
    const b = bancoFalso(); const c = chatwootFalso()
    const r = await registrar({ ...LIG, assunto: 'outro', resumo: '', orcamento: null }, b.db, c.pedir, AGORA, SEM_PAUSA)
    expect(r.status).toBe('enviado')
    expect(c.mensagens.find(m => !m.corpo.private && m.corpo.content.includes('recado'))).toBeTruthy()
  })
})

describe('chatwoot', () => {
  it('conversa conhecida de outra inbox não serve: procura a do WhatsApp', async () => {
    const c = chatwootFalso({
      contatos: [{ id: 7, phone_number: '+5517998765432', identifier: '5517998765432@s.whatsapp.net' }],
      conversas: [{ id: 10, inbox_id: 7, meta: { sender: { id: 7 } } }],
    })
    const r = await conversaDoCliente(c.pedir, { numero: '5517998765432', identificador: '5517998765432@s.whatsapp.net', nome: 'X', conversaConhecida: 10 })
    expect(r.criouConversa).toBe(true)
    expect(c.conversas[c.conversas.length - 1]).toMatchObject({ inbox_id: 5, source_id: 'uuid-antigo' })
  })

  it('etiqueta repetida não regrava a lista', async () => {
    const c = chatwootFalso()
    c.etiquetas.set(1, ['ligacao'])
    await etiquetar(c.pedir, 1, 'ligacao')
    expect(c.chamadas.filter(x => x.startsWith('POST'))).toHaveLength(0)
  })
})
