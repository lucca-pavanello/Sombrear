/** Copiado do CRM da MIP (lib/anexos.ts). Limite de arquivo do WhatsApp: 16 MB. */
export const TETO_ARQUIVO = 16 * 1024 * 1024

const IMAGENS = ['image/jpeg', 'image/png']
const VIDEOS = ['video/mp4', 'video/3gpp']
const AUDIOS = ['audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/amr']
const DOCUMENTOS = [
  'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]

/** valor do `accept` do seletor de arquivo */
export const ACEITA = [...IMAGENS, ...VIDEOS, ...AUDIOS, 'audio/*', ...DOCUMENTOS, '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.m4a', '.mp3', '.ogg', '.opus', '.wav'].join(',')

export type TipoArquivo = 'imagem' | 'video' | 'audio' | 'documento'

/**
 * Qualquer áudio vale (m4a, wav, opus, webm...): antes de sair ele vira voz em OGG/Opus
 * (lib/audioOgg.ts), o formato que o WhatsApp aceita e mostra como gravado. O parâmetro do codec
 * ("audio/ogg; codecs=opus") não conta; sem tipo, a extensão decide.
 */
export const tipoDoArquivo = (mime: string, nome = ''): TipoArquivo | null => {
  const m = mime.split(';')[0]!.trim().toLowerCase()
  if (IMAGENS.includes(m)) return 'imagem'
  if (VIDEOS.includes(m)) return 'video'
  if (m.startsWith('audio/') || (!m && /\.(m4a|mp3|ogg|opus|wav|aac|amr)$/i.test(nome))) return 'audio'
  if (DOCUMENTOS.includes(m)) return 'documento'
  return null
}

/** O que dizer quando o arquivo não serve; null = pode enviar. */
export function problemaDoArquivo(f: { name: string; type: string; size: number }): string | null {
  if (f.size > TETO_ARQUIVO) return 'Arquivo grande demais: o limite é 16 MB.'
  if (f.type === 'video/quicktime' || /\.mov$/i.test(f.name)) return 'Vídeo .mov (iPhone) o WhatsApp não aceita. Mande em MP4.'
  if (f.type === 'image/webp' || f.type === 'image/gif' || f.type === 'image/heic') return 'Foto só em JPEG ou PNG. Esse formato o WhatsApp não aceita.'
  if (!tipoDoArquivo(f.type, f.name)) return 'Esse tipo de arquivo o WhatsApp não aceita. Use foto (JPEG, PNG), vídeo (MP4), áudio, PDF, Word, Excel, PowerPoint ou texto.'
  return null
}

export function tamanhoLegivel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}
