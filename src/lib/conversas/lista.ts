/**
 * A lista e o chat da aba Conversas, sem React nem banco: tipos, filtros, busca, agrupamento
 * por dia e a leitura dos anexos. Testado em __tests__/conversas-lista.test.ts.
 */

export type Autor = 'cliente' | 'ia' | 'equipe'
export type StatusEntrega = 'sent' | 'delivered' | 'read' | 'failed'

/** como `mensagens-chatwoot/mapear.ts` grava; lat/lng só em localização */
export type Anexo = { tipo: string | null; url: string | null; nome: string | null; lat?: number | null; lng?: number | null }

/** linha de `mensagens_sombrear`; as três últimas colunas chegam com a migration 0039 */
export type Mensagem = {
  id: number
  conversa_id: number
  lead_id: string | null
  telefone: string | null
  autor: Autor
  autor_nome: string | null
  canal_envio: 'chatwoot' | 'celular' | null
  privada: boolean
  conteudo: string | null
  anexos: Anexo[] | null
  excluida: boolean
  enviada_em: string
  status_entrega?: StatusEntrega | null
  erro_entrega?: string | null
  do_celular?: boolean | null
}

/** linha de `conversas_sombrear` (0039) */
export type Conversa = {
  conversa_id: number
  inbox_id: number | null
  telefone: string | null
  lead_id: string | null
  nome: string | null
  ultima_mensagem_em: string
  ultimo_autor: Autor
  ultimo_conteudo: string | null
  ultimo_anexo_tipo: string | null
  ultima_recebida_em: string | null
  total_mensagens: number
  status: string
  ia_pausada: boolean
  nao_lida: boolean
}

// ── filtros ──────────────────────────────────────────────────────────────────

export type Filtro = 'todas' | 'nao_lidas' | 'aguardando' | 'humano' | 'ia' | 'encerradas'

export const FILTROS: { valor: Filtro; rotulo: string; titulo?: string }[] = [
  { valor: 'todas', rotulo: 'Abertas' },
  { valor: 'nao_lidas', rotulo: 'Não lidas' },
  { valor: 'aguardando', rotulo: 'Aguardando', titulo: 'Aguardando resposta: o cliente mandou a última mensagem' },
  { valor: 'humano', rotulo: 'Com humano', titulo: 'A IA está pausada: quem responde é a equipe' },
  { valor: 'ia', rotulo: 'IA', titulo: 'A Amanda está respondendo' },
  { valor: 'encerradas', rotulo: 'Encerradas' },
]

export const encerrada = (c: Pick<Conversa, 'status'>) => c.status === 'resolved'
/** a última mensagem foi do cliente: está esperando resposta */
export const aguardando = (c: Pick<Conversa, 'ultimo_autor'>) => c.ultimo_autor === 'cliente'

/** a encerrada só aparece no filtro dela; os outros são recortes das abertas */
export function passaFiltro(c: Conversa, filtro: Filtro): boolean {
  if (filtro === 'encerradas') return encerrada(c)
  if (encerrada(c)) return false
  if (filtro === 'nao_lidas') return c.nao_lida
  if (filtro === 'aguardando') return aguardando(c)
  if (filtro === 'humano') return c.ia_pausada
  if (filtro === 'ia') return !c.ia_pausada
  return true
}

export function contarPorFiltro(conversas: Conversa[]): Record<Filtro, number> {
  const n = { todas: 0, nao_lidas: 0, aguardando: 0, humano: 0, ia: 0, encerradas: 0 }
  for (const c of conversas) for (const f of FILTROS) if (passaFiltro(c, f.valor)) n[f.valor]++
  return n
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** por nome (sem acento) ou por qualquer pedaço do telefone */
export function buscar(conversas: Conversa[], termo: string): Conversa[] {
  const t = semAcento(termo.trim())
  if (!t) return conversas
  const digitos = t.replace(/\D/g, '')
  return conversas.filter(c =>
    semAcento(c.nome ?? '').includes(t)
    || (digitos.length >= 3 && (c.telefone ?? '').replace(/\D/g, '').includes(digitos)))
}

// ── o que mostrar ────────────────────────────────────────────────────────────

/** +5517999990000 → (17) 99999-0000; o que não for celular/fixo do Brasil volta como veio */
export function telefoneLegivel(v: string | null | undefined): string {
  let d = String(v ?? '').replace(/\D/g, '')
  if (!d) return 'Sem telefone'
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return String(v)
}

export const nomeDaConversa = (c: Pick<Conversa, 'nome' | 'telefone'>) => c.nome?.trim() || telefoneLegivel(c.telefone)

export type TipoAnexo = 'imagem' | 'audio' | 'video' | 'localizacao' | 'documento'

/** o `file_type` do Chatwoot (image, audio, video, location, file, fallback...) no que a tela desenha */
export function tipoDoAnexo(tipo: string | null | undefined): TipoAnexo {
  if (tipo === 'image') return 'imagem'
  if (tipo === 'audio') return 'audio'
  if (tipo === 'video') return 'video'
  if (tipo === 'location') return 'localizacao'
  return 'documento'
}

export const ROTULO_ANEXO: Record<TipoAnexo, string> = {
  imagem: 'Foto', audio: 'Áudio', video: 'Vídeo', localizacao: 'Localização', documento: 'Documento',
}

/** link do Google Maps pra um ponto; null se as coordenadas não vieram */
export const linkDoMapa = (a: Pick<Anexo, 'lat' | 'lng'>) =>
  typeof a.lat === 'number' && typeof a.lng === 'number' ? `https://www.google.com/maps?q=${a.lat},${a.lng}` : null

/** a linha de baixo do item da lista: quem falou por último e o quê */
export function previaDaConversa(c: Pick<Conversa, 'ultimo_autor' | 'ultimo_conteudo' | 'ultimo_anexo_tipo'>): string {
  const quem = c.ultimo_autor === 'ia' ? 'IA: ' : c.ultimo_autor === 'equipe' ? 'Equipe: ' : ''
  const texto = c.ultimo_conteudo?.replace(/\s+/g, ' ').trim()
  if (texto) return quem + texto
  if (c.ultimo_anexo_tipo) return quem + ROTULO_ANEXO[tipoDoAnexo(c.ultimo_anexo_tipo)]
  return quem + 'Mensagem apagada'
}

/** falhou: status failed, ou o WhatsApp devolveu erro e o status ficou em "enviada" ou vazio */
export const falhou = (m: Pick<Mensagem, 'status_entrega' | 'erro_entrega'>) =>
  m.status_entrega === 'failed' || (!!m.erro_entrega && (m.status_entrega === 'sent' || !m.status_entrega))

/** a equipe respondeu pelo WhatsApp do aparelho, não pelo dash nem pelo Chatwoot */
export const doCelular = (m: Pick<Mensagem, 'do_celular' | 'canal_envio'>) => m.do_celular ?? m.canal_envio === 'celular'

// ── datas (no fuso de quem está olhando) ─────────────────────────────────────

const dois = (n: number) => String(n).padStart(2, '0')
export const diaChave = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}` }
export const hora = (iso: string) => { const d = new Date(iso); return `${dois(d.getHours())}:${dois(d.getMinutes())}` }

/** "Hoje", "Ontem", "terça-feira" (na última semana) ou "12/11/2026" */
export function rotuloDoDia(iso: string, agora = new Date()): string {
  const d = new Date(iso)
  const meiaNoite = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dias = Math.round((meiaNoite(agora) - meiaNoite(d)) / 86_400_000)
  if (dias === 0) return 'Hoje'
  if (dias === 1) return 'Ontem'
  if (dias > 1 && dias < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' })
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** na lista: a hora se foi hoje, "ontem", ou a data curta */
export function quandoNaLista(iso: string, agora = new Date()): string {
  const r = rotuloDoDia(iso, agora)
  if (r === 'Hoje') return hora(iso)
  if (r === 'Ontem') return 'ontem'
  const d = new Date(iso)
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`
}

export function agruparPorDia(ms: Mensagem[], agora = new Date()) {
  const grupos: { dia: string; rotulo: string; itens: Mensagem[] }[] = []
  for (const m of ms) {
    const dia = diaChave(m.enviada_em)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo?.dia === dia) ultimo.itens.push(m)
    else grupos.push({ dia, rotulo: rotuloDoDia(m.enviada_em, agora), itens: [m] })
  }
  return grupos
}

/** bolhas seguidas do mesmo autor em menos de 5 min ficam coladas, sem repetir o nome */
export const juntaComAnterior = (m: Mensagem, ant: Mensagem | undefined) =>
  !!ant && ant.autor === m.autor && ant.autor_nome === m.autor_nome
  && Date.parse(m.enviada_em) - Date.parse(ant.enviada_em) < 5 * 60_000

// ── sem a migration 0039 ─────────────────────────────────────────────────────

type LeadDaLista = { id: string; nome: string | null; chatwoot_labels: string | null; precisa_humano: string | null }

/**
 * A lista montada no navegador a partir das mensagens, para o banco que ainda não tem a view
 * `conversas_sombrear` (antes de aplicar a 0039). Sem encerradas e sem não lidas: esses dois
 * dependem das tabelas novas. `mensagens` em qualquer ordem.
 */
export function conversasDasMensagens(mensagens: Mensagem[], leads: LeadDaLista[]): Conversa[] {
  const leadPorId = new Map(leads.map(l => [l.id, l]))
  const porConversa = new Map<number, Conversa>()
  const ordenadas = [...mensagens].filter(m => !m.privada)
    .sort((a, b) => Date.parse(b.enviada_em) - Date.parse(a.enviada_em) || b.id - a.id)
  for (const m of ordenadas) {
    let c = porConversa.get(m.conversa_id)
    if (!c) {
      c = {
        conversa_id: m.conversa_id, inbox_id: null, telefone: m.telefone, lead_id: m.lead_id, nome: null,
        ultima_mensagem_em: m.enviada_em, ultimo_autor: m.autor,
        ultimo_conteudo: m.excluida ? null : (m.conteudo ?? '').slice(0, 160) || null,
        ultimo_anexo_tipo: m.anexos?.[0]?.tipo ?? null,
        ultima_recebida_em: null, total_mensagens: 0, status: 'open', ia_pausada: false, nao_lida: false,
      }
      porConversa.set(m.conversa_id, c)
    }
    c.total_mensagens++
    c.telefone ??= m.telefone
    c.lead_id ??= m.lead_id
    if (m.autor === 'cliente' && !c.ultima_recebida_em) c.ultima_recebida_em = m.enviada_em
  }
  for (const c of porConversa.values()) {
    const l = c.lead_id ? leadPorId.get(c.lead_id) : undefined
    if (!l) continue
    c.nome = l.nome
    c.ia_pausada = (l.chatwoot_labels ?? '').toLowerCase().split(',').some(e => e.trim() === 'humano')
      || (l.precisa_humano ?? '').toLowerCase().trim() === 'sim'
  }
  return [...porConversa.values()]
}
