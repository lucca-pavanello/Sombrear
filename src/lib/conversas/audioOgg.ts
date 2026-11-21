// Copiado do CRM da MIP (plataforma/crm/app/src/lib/audioOgg.ts).
// Áudio como mensagem de voz (15/10/2026, pedido do Léo: "o áudio ir como se fosse gravado").
// O WhatsApp só mostra a "bolinha" de voz com OGG/Opus mono mandado com `voice: true` (a
// crm-conversas faz isso pela Graph). O MediaRecorder grava MP4 ou WebM, que a Meta recusa
// (lib/audioMp3.ts); aqui o áudio é decodificado e codificado de novo em OGG/Opus no navegador,
// com o codificador do opus-recorder (MIT, public/opus/), que só baixa quando alguém manda voz.

import { paraMono } from './audioMp3'

/** o Opus de voz trabalha em 48 kHz; 32 kbps mono é a qualidade de recado do próprio WhatsApp */
const TAXA = 48_000
const KBPS = 32
const PEDACO = 4096
const CODIFICADOR = '/opus/encoderWorker.min.js'

/** PCM mono em OGG/Opus, num worker (a página não trava em áudio longo) */
export function pcmParaOgg(pcm: Float32Array, taxa: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = new Worker(CODIFICADOR)
    const paginas: Uint8Array[] = []
    const fim = (e?: unknown) => { w.terminate(); if (e) reject(e instanceof Error ? e : new Error(String(e))) }
    const tempo = window.setTimeout(() => fim(new Error('o codificador de voz não respondeu')), 60_000)
    w.onerror = e => { window.clearTimeout(tempo); fim(new Error(e.message || 'erro no codificador de voz')) }
    w.onmessage = ({ data }: MessageEvent<{ message?: string; page?: Uint8Array }>) => {
      if (data.page) { paginas.push(data.page); return }
      if (data.message === 'ready') {
        // cabeçalhos do OGG, o áudio em pedaços e o fim
        w.postMessage({ command: 'getHeaderPages' })
        for (let i = 0; i < pcm.length; i += PEDACO) w.postMessage({ command: 'encode', buffers: [pcm.slice(i, i + PEDACO)] })
        w.postMessage({ command: 'done' })
      } else if (data.message === 'done') {
        window.clearTimeout(tempo)
        fim()
        resolve(new Blob(paginas as BlobPart[], { type: 'audio/ogg' }))
      }
    }
    w.postMessage({
      command: 'init', originalSampleRate: taxa, encoderSampleRate: TAXA, numberOfChannels: 1,
      // 2048 = OPUS_APPLICATION_VOIP: feito pra fala
      encoderApplication: 2048, encoderFrameSize: 20, maxFramesPerPage: 40, bitRate: KBPS * 1000,
    })
  })
}

const dois = (n: number) => String(n).padStart(2, '0')
export const nomeDaVoz = (d: Date) =>
  `voz-${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}.ogg`

/** qualquer áudio (gravação do navegador, MP3, M4A...) em OGG/Opus de voz */
export async function audioParaVoz(audio: Blob, agora = new Date()): Promise<File> {
  // OfflineAudioContext decodifica já em 48 kHz e não precisa de toque pra começar (iPhone)
  const ctx = new OfflineAudioContext(1, 1, TAXA)
  const decodificado = await ctx.decodeAudioData(await audio.arrayBuffer())
  const canais = Array.from({ length: decodificado.numberOfChannels }, (_, i) => decodificado.getChannelData(i))
  const ogg = await pcmParaOgg(paraMono(canais), decodificado.sampleRate)
  if (ogg.size < 200) throw new Error('o áudio de voz saiu vazio')
  return new File([ogg], nomeDaVoz(agora), { type: 'audio/ogg' })
}

/** o arquivo é voz pronta pra mandar? (o servidor confere de novo) */
export const ehVoz = (f: Pick<File, 'type' | 'name'>) => /^audio\/ogg\b/i.test(f.type) || /\.ogg$/i.test(f.name)
