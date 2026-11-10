/**
 * Validação do áudio que o Assistente de Preços recebe (função pura).
 * Usada pela Edge Function `precos-ia` e testada no vitest.
 */

/** ~4 MB em base64 (≈ 3 MB de áudio, bem mais que os 90 s de gravação máxima). */
export const LIMITE_AUDIO_BASE64 = 4_000_000

export interface AudioRecebido { mimeType: string; data: string }

export type ResultadoAudio =
  | { ok: true; mimeType: string; data: string }
  | { ok: false; status: number; erro: string }

/** "audio/webm;codecs=opus" → "audio/webm" (o Gemini quer o tipo sem parâmetros). */
export function mimeBase(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase()
}

/**
 * Formatos que o Gemini documenta para áudio: wav, mp3, aiff, aac, ogg, flac.
 * O gravador do navegador entrega webm/ogg/mp4 (opus/aac) — aceitos aqui sem os
 * parâmetros de codec. `video/webm|mp4` NÃO entra: só chega áudio de verdade.
 */
export const MIMES_AUDIO_ACEITOS = [
  'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/flac',
] as const

export function validarAudio(bruto: unknown): ResultadoAudio {
  const a = bruto as Partial<AudioRecebido> | null | undefined
  if (!a || typeof a.data !== 'string' || typeof a.mimeType !== 'string' || !a.data) {
    return { ok: false, status: 400, erro: 'O áudio chegou vazio — grave de novo.' }
  }
  const mimeType = mimeBase(a.mimeType)
  if (!(MIMES_AUDIO_ACEITOS as readonly string[]).includes(mimeType)) {
    return { ok: false, status: 400, erro: 'Formato de áudio não suportado.' }
  }
  if (a.data.length > LIMITE_AUDIO_BASE64) {
    return { ok: false, status: 413, erro: 'Áudio muito longo. Grave um pedaço menor (até 90 segundos) ou digite o pedido.' }
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(a.data)) {
    return { ok: false, status: 400, erro: 'O áudio chegou corrompido — grave de novo.' }
  }
  return { ok: true, mimeType, data: a.data.replace(/\s/g, '') }
}
