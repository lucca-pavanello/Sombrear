// Copiado do CRM da MIP (plataforma/crm/app/src/lib/audioMp3.ts). Áudio gravado na aba WhatsApp (01/10). O MediaRecorder grava em MP4
// fragmentado (Chrome e Safari) ou WebM, e a Meta recusa os dois com
// "131053: Media upload error". Testado em 01/10 na conversa 254: m4a e mp4
// saídos do navegador falharam; MP3 e m4a normal chegaram e tocaram. Por isso a
// gravação sai no formato que o navegador tiver e vira MP3 aqui, antes de ir.

/** teto de uma gravação: 5 min de MP3 a 64 kbps dá ~2,4 MB, longe dos 16 MB */
export const TETO_AUDIO_S = 300
const KBPS = 64
const TAXA = 44_100

/** o que pedir ao MediaRecorder; undefined = deixa ele escolher */
export function formatoDeGravacao(suporta: (tipo: string) => boolean): string | undefined {
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => { try { return suporta(t) } catch { return false } })
}

/** o navegador grava áudio? (http sem ser localhost não tem mediaDevices) */
export const podeGravarAudio = () =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** média dos canais: áudio de recado não precisa de estéreo */
export function paraMono(canais: Float32Array[]): Float32Array {
  if (canais.length <= 1) return canais[0] ?? new Float32Array(0)
  const saida = new Float32Array(canais[0].length)
  for (const c of canais) for (let i = 0; i < saida.length; i++) saida[i] += (c[i] ?? 0) / canais.length
  return saida
}

export function paraInt16(f: Float32Array): Int16Array {
  const s = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]))
    s[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return s
}

/** PCM mono em MP3; o codificador só baixa quando alguém grava */
export async function pcmParaMp3(pcm: Float32Array, taxa: number): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const enc = new Mp3Encoder(1, taxa, KBPS)
  const amostras = paraInt16(pcm)
  const partes: Uint8Array[] = []
  for (let i = 0; i < amostras.length; i += 1152) {
    const b = enc.encodeBuffer(amostras.subarray(i, i + 1152))
    if (b.length) partes.push(new Uint8Array(b))
  }
  const fim = enc.flush()
  if (fim.length) partes.push(new Uint8Array(fim))
  return new Blob(partes as BlobPart[], { type: 'audio/mpeg' })
}

/** a gravação do navegador (MP4 fragmentado, WebM...) em MP3 pronto pra mandar */
export async function gravacaoParaMp3(gravacao: Blob, agora = new Date()): Promise<File> {
  // OfflineAudioContext decodifica já na taxa do MP3 e não precisa de toque pra começar (iPhone)
  const ctx = new OfflineAudioContext(1, 1, TAXA)
  const audio = await ctx.decodeAudioData(await gravacao.arrayBuffer())
  const canais = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
  const mp3 = await pcmParaMp3(paraMono(canais), audio.sampleRate)
  return new File([mp3], nomeDoAudio(agora), { type: 'audio/mpeg' })
}

const dois = (n: number) => String(n).padStart(2, '0')
export const nomeDoAudio = (d: Date) =>
  `audio-${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}.mp3`

/** 0:07, 1:32 */
export const tempoDeGravacao = (s: number) => `${Math.floor(s / 60)}:${dois(Math.floor(s % 60))}`

/** a frase pra quem tocou no microfone e não deu */
export function erroDoMicrofone(e: unknown): string {
  const nome = (e as { name?: string })?.name
  if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'O microfone está bloqueado. Libere o microfone para o dash nas permissões do navegador.'
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Não achei microfone neste aparelho.'
  if (nome === 'NotReadableError') return 'Outro app está usando o microfone. Feche e tente de novo.'
  return 'Não consegui gravar o áudio. Tente de novo.'
}
