import { useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  MAX_BASE64,
  type ImagemFoto,
  type PedidoFoto,
  type ResultadoContagem,
} from '@/lib/estoque/contagem-resposta'

/**
 * Foto do caderno → Edge Function `estoque-foto` (só lê; não grava nada).
 * `reduzirImagem` encolhe para no máx. ~1600px JPEG antes de enviar.
 */

const LADO_MAX = 1600

export interface FotoPreparada extends ImagemFoto {
  id: string
  /** data URL para miniatura */
  previa: string
  nome: string
}

/** Frase para quem usa, pelo status HTTP; nunca o corpo cru do erro. */
export function fraseDoErroFoto(status: number | null): string {
  if (status === 401) return 'Sua sessão expirou. Entre de novo para ler as fotos.'
  if (status === 403) return 'Seu acesso não permite ler fotos do Estoque.'
  if (status === 413) return 'As fotos ficaram grandes demais. Remova alguma ou tire de novo mais de longe.'
  if (status === 429) return 'Muita gente usando a leitura ao mesmo tempo. Espere um minuto e tente de novo.'
  if (status === null) return 'Sem conexão com o servidor. Confira a internet e tente de novo.'
  return 'Não consegui ler as fotos agora. Tente de novo em instantes.'
}

function statusDoErro(error: unknown): number | null {
  const ctx = (error as { context?: { status?: number } } | null)?.context
  return typeof ctx?.status === 'number' ? ctx.status : null
}

function carregar(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('formato')) }
    img.src = url
  })
}

/** Reduz para no máx. 1600px no maior lado e recomprime em JPEG. */
export async function reduzirImagem(file: File): Promise<FotoPreparada> {
  const img = await carregar(file)
  const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * escala))
  const h = Math.max(1, Math.round(img.naturalHeight * escala))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.fillStyle = '#ffffff' // PNG com transparência não vira fundo preto
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  let qualidade = 0.85
  let dataUrl = canvas.toDataURL('image/jpeg', qualidade)
  while (dataUrl.length - dataUrl.indexOf(',') - 1 > MAX_BASE64 && qualidade > 0.4) {
    qualidade -= 0.15
    dataUrl = canvas.toDataURL('image/jpeg', qualidade)
  }
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    mimeType: 'image/jpeg',
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    previa: dataUrl,
    nome: file.name,
  }
}

export type EstadoLeitura =
  | { fase: 'ocioso' }
  | { fase: 'lendo' }
  | { fase: 'erro'; mensagem: string; status: number | null }

export function useLerFotoContagem() {
  const [estado, setEstado] = useState<EstadoLeitura>({ fase: 'ocioso' })
  const emVoo = useRef(false)

  const ler = useCallback(async (fotos: ImagemFoto[]): Promise<ResultadoContagem | null> => {
    if (emVoo.current) return null
    emVoo.current = true
    setEstado({ fase: 'lendo' })
    try {
      const pedido: PedidoFoto = {
        tipo: 'contagem',
        imagens: fotos.map(({ mimeType, data }) => ({ mimeType, data })),
      }
      const { data, error } = await supabase.functions.invoke('estoque-foto', { body: pedido })
      if (error) throw error
      if (!data?.ok || data.tipo !== 'contagem' || !Array.isArray(data.linhas)) {
        throw Object.assign(new Error('resposta inválida'), { context: { status: 500 } })
      }
      setEstado({ fase: 'ocioso' })
      return data as ResultadoContagem
    } catch (err) {
      console.error('estoque-foto:', err)
      const status = statusDoErro(err)
      setEstado({ fase: 'erro', status, mensagem: fraseDoErroFoto(status) })
      return null
    } finally {
      emVoo.current = false
    }
  }, [])

  const limparErro = useCallback(() => setEstado({ fase: 'ocioso' }), [])

  return { estado, ler, limparErro }
}
