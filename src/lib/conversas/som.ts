import { useSyncExternalStore } from 'react'

/**
 * Som de mensagem nova, copiado do CRM da MIP (hooks/useAvisoMensagem.ts): dois toques curtos
 * gerados aqui (Web Audio), sem arquivo. O navegador só deixa tocar depois do primeiro clique ou
 * tecla na página. Liga e desliga pelo sino da aba Conversas (fica no navegador). Quem escuta o
 * banco é o useConversasAoVivo; aqui fica só o som e a vez entre abas.
 */

const CHAVE = 'sombrear-som-mensagem'
const ULTIMO = 'sombrear-som-ultimo'
const INTERVALO_MS = 4000

const lerLigado = () => { try { return localStorage.getItem(CHAVE) !== 'desligado' } catch { return true } }
let ligado = lerLigado()
const ouvintes = new Set<() => void>()

export const somLigado = () => ligado

/** o sino: ligado ou desligado, e trocar (tocar o aviso ao ligar mostra como ele soa) */
export function useSomMensagem() {
  const valor = useSyncExternalStore(cb => { ouvintes.add(cb); return () => { ouvintes.delete(cb) } }, () => ligado)
  const trocar = () => {
    ligado = !ligado
    try { localStorage.setItem(CHAVE, ligado ? 'ligado' : 'desligado') } catch { /* fica só nesta aba */ }
    ouvintes.forEach(f => f())
    if (ligado) void tocarAviso()
  }
  return { ligado: valor, trocar }
}

let audio: AudioContext | null = null
function contexto(): AudioContext | null {
  if (audio) return audio
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!C) return null
  audio = new C()
  return audio
}

/** o navegador só libera som depois de um gesto: chame no primeiro clique ou tecla */
export function destravarSom() {
  const a = contexto()
  if (a?.state === 'suspended') void a.resume().catch(() => undefined)
}

/** dois toques curtos e suaves, subindo */
export async function tocarAviso() {
  const a = contexto()
  if (!a) return
  if (a.state === 'suspended') await a.resume().catch(() => undefined)
  if (a.state !== 'running') return
  const t = a.currentTime
  for (const [freq, atraso] of [[880, 0], [1318.5, 0.13]] as const) {
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t + atraso)
    g.gain.exponentialRampToValueAtTime(0.22, t + atraso + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + atraso + 0.4)
    o.connect(g).connect(a.destination)
    o.start(t + atraso)
    o.stop(t + atraso + 0.45)
  }
}

/** com várias abas abertas, uma toca: a primeira que gravar a hora vence */
export function minhaVez(agora = Date.now()): boolean {
  try {
    const ultimo = Number(localStorage.getItem(ULTIMO) ?? 0)
    if (agora - ultimo < INTERVALO_MS) return false
    localStorage.setItem(ULTIMO, String(agora))
  } catch { /* sem localStorage: toca */ }
  return true
}
