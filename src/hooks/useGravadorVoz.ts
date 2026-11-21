import { useCallback, useEffect, useRef, useState } from 'react'
import { erroDoMicrofone, formatoDeGravacao, gravacaoParaMp3, TETO_AUDIO_S } from '@/lib/conversas/audioMp3'
import { audioParaVoz } from '@/lib/conversas/audioOgg'

export type EstadoGravador = 'livre' | 'pedindo' | 'gravando' | 'convertendo'

type Sessao = { gravador: MediaRecorder; stream: MediaStream; partes: Blob[]; parou: Promise<void>; inicio: number }

/**
 * O microfone da aba Conversas, copiado do CRM da MIP (hooks/useGravadorAudio.ts): grava, conta
 * o tempo e entrega voz em OGG/Opus (ou MP3, se o navegador não codificar). No teto (5 min) para
 * sozinho e espera o enviar. Sair da conversa ou da tela solta o microfone.
 *
 * Não é o useGravadorAudio do dash: aquele entrega base64 para as funções de IA (precos-ia,
 * orcamento-voz); este entrega um arquivo pronto para o WhatsApp.
 */
export function useGravadorVoz() {
  const [estado, setEstado] = useState<EstadoGravador>('livre')
  const [segundos, setSegundos] = useState(0)
  const [noTeto, setNoTeto] = useState(false)
  const sessao = useRef<Sessao | null>(null)
  const relogio = useRef<number | null>(null)
  /** sobe a cada iniciar/cancelar: descartou enquanto o navegador pedia o microfone, a resposta chega e é solta */
  const vez = useRef(0)

  const soltar = useCallback(() => {
    if (relogio.current != null) { window.clearInterval(relogio.current); relogio.current = null }
    const s = sessao.current
    sessao.current = null
    if (!s) return
    if (s.gravador.state !== 'inactive') { try { s.gravador.stop() } catch { /* já parou */ } }
    s.stream.getTracks().forEach(t => t.stop())
  }, [])

  // ao desmontar: solta o microfone e invalida um pedido de permissão ainda pendente (ele não pode ligar depois)
  useEffect(() => () => { vez.current++; soltar() }, [soltar])

  /** pede o microfone e começa; devolve a frase do erro, se não deu */
  const iniciar = useCallback(async (): Promise<string | null> => {
    if (sessao.current) return null
    setEstado('pedindo'); setSegundos(0); setNoTeto(false)
    const minha = ++vez.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      if (minha !== vez.current) { stream.getTracks().forEach(t => t.stop()); return null }
      const tipo = formatoDeGravacao(t => MediaRecorder.isTypeSupported(t))
      const gravador = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined)
      const partes: Blob[] = []
      gravador.ondataavailable = e => { if (e.data.size) partes.push(e.data) }
      const parou = new Promise<void>(ok => { gravador.onstop = () => ok() })
      gravador.start(1000)
      sessao.current = { gravador, stream, partes, parou, inicio: Date.now() }
      setEstado('gravando')
      relogio.current = window.setInterval(() => {
        const s = sessao.current
        if (!s) return
        const passou = (Date.now() - s.inicio) / 1000
        setSegundos(Math.min(passou, TETO_AUDIO_S))
        if (passou >= TETO_AUDIO_S && s.gravador.state === 'recording') {
          s.gravador.stop()
          s.stream.getTracks().forEach(t => t.stop())
          setNoTeto(true)
        }
      }, 250)
      return null
    } catch (e) {
      soltar()
      setEstado('livre')
      return erroDoMicrofone(e)
    }
  }, [soltar])

  /**
   * Para e devolve o áudio: OGG/Opus pra sair como voz gravada (`voz: true`); se o navegador não
   * conseguir codificar, o MP3 de antes, que chega como arquivo de áudio. null se não tinha nada.
   */
  const concluir = useCallback(async (): Promise<{ arquivo: File; voz: boolean } | null> => {
    const s = sessao.current
    if (!s) return null
    if (relogio.current != null) { window.clearInterval(relogio.current); relogio.current = null }
    if (s.gravador.state !== 'inactive') s.gravador.stop()
    s.stream.getTracks().forEach(t => t.stop())
    await s.parou
    sessao.current = null
    setEstado('convertendo')
    try {
      if (!s.partes.length) return null
      const gravacao = new Blob(s.partes, { type: s.gravador.mimeType || s.partes[0].type })
      try {
        return { arquivo: await audioParaVoz(gravacao), voz: true }
      } catch {
        // navegador sem o codificador de voz (worker bloqueado, áudio que não decodifica): segue em MP3, chega como arquivo
        return { arquivo: await gravacaoParaMp3(gravacao), voz: false }
      }
    } finally {
      setEstado('livre'); setSegundos(0); setNoTeto(false)
    }
  }, [])

  const cancelar = useCallback(() => { vez.current++; soltar(); setEstado('livre'); setSegundos(0); setNoTeto(false) }, [soltar])

  return { estado, segundos, noTeto, iniciar, concluir, cancelar }
}
