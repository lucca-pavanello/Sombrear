/** o que a janela precisa saber da conversa (a tela da Sombrear só liga isto na V2, com a API Oficial) */
type Conversa = { janela_meta: boolean; ultima_recebida_em: string | null }

/** A Meta só deixa mandar texto livre até 24 h depois da última mensagem do cliente. */
export const JANELA_MS = 24 * 3_600_000
/** a partir de quanto tempo restante a tela avisa que a janela vai fechar */
export const AVISO_JANELA_MS = 3 * 3_600_000

export interface Janela {
  aberta: boolean
  /** instante (ms) em que fecha; null se não há prazo (caixa fora da Meta) ou já está fechada sem referência */
  fechaEm: number | null
  /** ms que faltam; null se não há prazo */
  restanteMs: number | null
}

/**
 * Caixa que não é da Meta nunca fecha. Na Meta, sem mensagem recebida (lead de disparo, contato
 * novo) a janela está fechada: o primeiro contato é modelo aprovado.
 */
export function janelaDe(c: Pick<Conversa, 'janela_meta' | 'ultima_recebida_em'>, agora = Date.now()): Janela {
  if (!c.janela_meta) return { aberta: true, fechaEm: null, restanteMs: null }
  const recebida = c.ultima_recebida_em ? Date.parse(c.ultima_recebida_em) : NaN
  if (Number.isNaN(recebida)) return { aberta: false, fechaEm: null, restanteMs: 0 }
  const fechaEm = recebida + JANELA_MS
  const restanteMs = Math.max(0, fechaEm - agora)
  return { aberta: restanteMs > 0, fechaEm, restanteMs }
}

export type EstadoJanela = 'aberta' | 'fechando' | 'fechada'

export interface SeloJanela {
  estado: EstadoJanela
  /** "fecha em 5 h", "fecha em 40 min", "janela fechada" */
  rotulo: string
}

/** A conversa está na Meta e dá pra mandar texto livre agora (filtro "Janela aberta"). */
export const janelaAberta = (c: Pick<Conversa, 'janela_meta' | 'ultima_recebida_em'>, agora = Date.now()) =>
  c.janela_meta && janelaDe(c, agora).aberta

/**
 * O selo da lista: só existe pra conversa da Meta (caixa fora dela nunca fecha, não mostra nada).
 * "fechando" = faltam AVISO_JANELA_MS ou menos.
 */
export function seloJanela(c: Pick<Conversa, 'janela_meta' | 'ultima_recebida_em'>, agora = Date.now()): SeloJanela | null {
  if (!c.janela_meta) return null
  const j = janelaDe(c, agora)
  if (!j.aberta || j.restanteMs == null) return { estado: 'fechada', rotulo: 'janela fechada' }
  const min = Math.max(1, Math.ceil(j.restanteMs / 60_000))
  const h = Math.floor(min / 60)
  return { estado: j.restanteMs <= AVISO_JANELA_MS ? 'fechando' : 'aberta', rotulo: h ? `fecha em ${h} h` : `fecha em ${min} min` }
}

/** "2 h 15 min", "40 min" */
export function faltaParaFechar(ms: number) {
  const min = Math.max(1, Math.ceil(ms / 60_000))
  const h = Math.floor(min / 60)
  return h ? `${h} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`
}
