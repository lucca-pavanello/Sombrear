import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Gravador de áudio do microfone (MediaRecorder), reutilizável.
 *
 * Fluxo: iniciar() → gravando (contador de segundos) → parar() entrega o áudio em
 * base64 a `aoFinalizar`; cancelar() descarta. Para sozinho em `maxSegundos`
 * (também entregando o que gravou). Erros chegam em português, prontos pra tela.
 *
 * O áudio sai como { mimeType, data } — o mesmo formato que a Edge Function
 * `precos-ia` aceita em `audio`.
 */

export interface AudioGravado {
  /** tipo gravado, ex.: "audio/webm;codecs=opus" (o servidor tira os parâmetros) */
  mimeType: string
  /** base64 puro, sem o prefixo "data:" */
  data: string
  duracaoSeg: number
}

export type EstadoGravador = 'ocioso' | 'pedindo-permissao' | 'gravando' | 'finalizando'

interface Opcoes {
  maxSegundos?: number
  aoFinalizar: (audio: AudioGravado) => void
}

// Ordem de preferência: ogg/opus é o que o Gemini documenta (ogg); depois webm e mp4.
// O servidor aceita webm, ogg, mp4, mpeg, wav, aac e flac (sem parâmetros de codec).
const TIPOS_PREFERIDOS = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export function escolherMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return TIPOS_PREFERIDOS.find(t => MediaRecorder.isTypeSupported(t))
}

/** Por que a gravação não é possível neste navegador/página (null = dá pra gravar). */
export function motivoIndisponivel(): string | null {
  if (typeof window === 'undefined') return 'Gravação indisponível aqui.'
  if (!window.isSecureContext) return 'O microfone só funciona em página segura (HTTPS). Abra o dash pelo endereço https.'
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return 'Este navegador não grava áudio. Use Chrome, Edge, Firefox ou Safari atualizado — ou digite o pedido.'
  }
  return null
}

export function mensagemDeErroMicrofone(err: unknown): string {
  const nome = err instanceof DOMException ? err.name : ''
  if (nome === 'NotAllowedError' || nome === 'SecurityError') {
    return 'Permissão do microfone negada. Libere o microfone no cadeado ao lado do endereço e tente de novo.'
  }
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Nenhum microfone encontrado neste aparelho.'
  if (nome === 'NotReadableError' || nome === 'AbortError') return 'O microfone está em uso por outro programa. Feche-o e tente de novo.'
  return 'Não consegui acessar o microfone. Tente de novo ou digite o pedido.'
}

function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(leitor.error)
    leitor.onload = () => {
      const url = String(leitor.result ?? '')
      resolve(url.slice(url.indexOf(',') + 1))
    }
    leitor.readAsDataURL(blob)
  })
}

export function formatarSegundos(total: number): string {
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function useGravadorAudio({ maxSegundos = 90, aoFinalizar }: Opcoes) {
  const [estado, setEstado] = useState<EstadoGravador>('ocioso')
  const [segundos, setSegundos] = useState(0)
  const [erro, setErro] = useState<string | null>(null)

  const gravadorRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const pedacosRef = useRef<Blob[]>([])
  const inicioRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const descartarRef = useRef(false)
  // Cada iniciar() ganha um número; cancelar()/desmontar invalidam as tentativas em andamento.
  // Sem isso, a permissão do microfone aprovada DEPOIS de cancelar/desmontar abria a gravação sozinha.
  const tentativaRef = useRef(0)
  const montadoRef = useRef(true)
  const pedindoRef = useRef(false)
  const callbackRef = useRef(aoFinalizar)
  callbackRef.current = aoFinalizar

  const indisponivel = motivoIndisponivel()

  const limpar = useCallback(() => {
    if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    gravadorRef.current = null
    pedacosRef.current = []
  }, [])

  const parar = useCallback(() => {
    const g = gravadorRef.current
    if (g && g.state !== 'inactive') { setEstado('finalizando'); g.stop() }
  }, [])

  const cancelar = useCallback(() => {
    tentativaRef.current++ // invalida um getUserMedia ainda pendente
    pedindoRef.current = false
    descartarRef.current = true
    const g = gravadorRef.current
    if (g && g.state !== 'inactive') g.stop()
    else limpar()
    setEstado('ocioso')
    setSegundos(0)
  }, [limpar])

  const iniciar = useCallback(async () => {
    setErro(null)
    const motivo = motivoIndisponivel()
    if (motivo) { setErro(motivo); return }
    if (gravadorRef.current || pedindoRef.current) return
    const tentativa = ++tentativaRef.current
    const caducou = () => !montadoRef.current || tentativa !== tentativaRef.current
    pedindoRef.current = true
    setEstado('pedindo-permissao')
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (tentativa === tentativaRef.current) pedindoRef.current = false
      if (caducou()) {
        // desmontou ou cancelou com o pedido de permissão aberto: solta o microfone e some
        stream.getTracks().forEach(t => t.stop())
        return
      }
      streamRef.current = stream
      const mimeType = escolherMimeType()
      const gravador = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      gravadorRef.current = gravador
      pedacosRef.current = []
      descartarRef.current = false

      gravador.ondataavailable = e => { if (e.data.size > 0) pedacosRef.current.push(e.data) }
      gravador.onerror = () => {
        descartarRef.current = true
        setErro('A gravação falhou. Tente de novo.')
        if (gravador.state !== 'inactive') gravador.stop()
      }
      gravador.onstop = async () => {
        const descartar = descartarRef.current
        const tipo = gravador.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(pedacosRef.current, { type: tipo })
        const duracaoSeg = Math.max(1, Math.round((Date.now() - inicioRef.current) / 1000))
        limpar()
        setSegundos(0)
        if (descartar) { setEstado('ocioso'); return }
        if (blob.size < 500) {
          setErro('Não captei nenhum som. Confira o microfone e grave de novo.')
          setEstado('ocioso')
          return
        }
        try {
          const data = await blobParaBase64(blob)
          setEstado('ocioso')
          callbackRef.current({ mimeType: tipo, data, duracaoSeg })
        } catch {
          setErro('Não consegui ler o áudio gravado. Tente de novo.')
          setEstado('ocioso')
        }
      }

      inicioRef.current = Date.now()
      setSegundos(0)
      gravador.start(1000)
      setEstado('gravando')
      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - inicioRef.current) / 1000)
        setSegundos(s)
        if (s >= maxSegundos && gravador.state !== 'inactive') { setEstado('finalizando'); gravador.stop() }
      }, 250)
    } catch (err) {
      if (tentativa === tentativaRef.current) pedindoRef.current = false
      if (caducou()) {
        // tentativa antiga: só solta o que ELA abriu, sem mexer na gravação nova nem na tela
        stream?.getTracks().forEach(t => t.stop())
        return
      }
      limpar()
      stream?.getTracks().forEach(t => t.stop())
      setErro(mensagemDeErroMicrofone(err))
      setEstado('ocioso')
    }
  }, [limpar, maxSegundos])

  // desmontou no meio da gravação: solta o microfone e não entrega nada
  useEffect(() => {
    montadoRef.current = true
    return () => {
      montadoRef.current = false
      tentativaRef.current++
      descartarRef.current = true
      const g = gravadorRef.current
      if (g && g.state !== 'inactive') { try { g.stop() } catch { /* já parado */ } }
      limpar()
    }
  }, [limpar])

  return {
    estado,
    gravando: estado === 'gravando',
    ocupado: estado !== 'ocioso',
    segundos,
    maxSegundos,
    erro,
    limparErro: () => setErro(null),
    /** texto explicando por que o botão fica inativo (null = disponível) */
    indisponivel,
    iniciar,
    parar,
    cancelar,
  }
}
