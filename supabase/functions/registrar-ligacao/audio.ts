/**
 * A gravação da ligação: a Amanda de voz manda o audio.ogg depois de registrar a ligação
 * (POST ?audio=<ref>, corpo binário). Fica no bucket privado `ligacoes-audio` e o caminho vai
 * para `ligacoes.audio_path`, que a aba Agente IA > Ligações toca com link assinado.
 */

export const BUCKET = 'ligacoes-audio'
/** ~25 min de Opus mono; mais que isso não é ligação de loja (a voz corta em 10 min) */
export const LIMITE_BYTES = 25 * 1024 * 1024

const EXTENSAO: Record<string, string> = { 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' }

export type Arquivos = {
  existeLigacao(ref: string): Promise<boolean>
  subir(caminho: string, bytes: Uint8Array, tipo: string): Promise<void>
  marcar(ref: string, caminho: string): Promise<void>
}

export type ResultadoAudio = { status: number; corpo: Record<string, unknown> }

export async function guardarAudio(ref: string | null, tipo: string | null, bytes: Uint8Array, a: Arquivos): Promise<ResultadoAudio> {
  // o ref vira nome de arquivo: só o formato que a voz gera (voz-<uuid>), nada de barra
  if (!ref || !/^[A-Za-z0-9_-]{1,80}$/.test(ref)) return { status: 400, corpo: { erro: 'ref inválido' } }
  const base = (tipo ?? '').split(';')[0].trim().toLowerCase()
  const ext = EXTENSAO[base]
  if (!ext) return { status: 400, corpo: { erro: 'tipo de áudio não aceito' } }
  if (!bytes.byteLength) return { status: 400, corpo: { erro: 'áudio vazio' } }
  if (bytes.byteLength > LIMITE_BYTES) return { status: 413, corpo: { erro: 'áudio grande demais' } }
  // a ligação vem antes do áudio: sem ela não há onde pendurar a gravação
  if (!(await a.existeLigacao(ref))) return { status: 404, corpo: { erro: 'ligação não encontrada' } }
  const caminho = `${ref}.${ext}`
  await a.subir(caminho, bytes, base)
  await a.marcar(ref, caminho)
  return { status: 200, corpo: { ok: true, audio_path: caminho } }
}
