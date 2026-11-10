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

export function validarAudio(bruto: unknown): ResultadoAudio {
  const a = bruto as Partial<AudioRecebido> | null | undefined
  if (!a || typeof a.data !== 'string' || typeof a.mimeType !== 'string' || !a.data) {
    return { ok: false, status: 400, erro: 'O áudio chegou vazio — grave de novo.' }
  }
  const mimeType = mimeBase(a.mimeType)
  if (!/^(audio\/|video\/(webm|mp4)$)/.test(mimeType)) {
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
