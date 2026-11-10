/**
 * Contrato da Edge Function `estoque-foto` (leitura de foto do caderno) e o
 * saneamento da resposta do modelo. Sem imports: roda no Deno (function) e no
 * navegador (cliente + testes) com o MESMO código.
 *
 * A resposta é uma união discriminada por `tipo`: hoje só 'contagem'; 'entrada'
 * e 'sobra' entram depois como novos membros de ResultadoFoto sem quebrar o cliente.
 */

export type Confianca = 'alta' | 'media' | 'baixa'

export interface LinhaLida {
  /** o que está escrito no caderno, transcrito */
  texto_lido: string
  material_id: string | null
  quantidade: number | null
  unidade_lida: string | null
  confianca: Confianca
  observacao: string
}

export interface ResultadoContagem {
  ok: true
  tipo: 'contagem'
  linhas: LinhaLida[]
  ilegivel: string[]
}

/** Futuro: | ResultadoEntrada | ResultadoSobra */
export type ResultadoFoto = ResultadoContagem

export interface ErroFoto {
  ok: false
  erro: string
}

export interface ImagemFoto {
  mimeType: string
  /** base64 puro, sem o prefixo data: */
  data: string
}

export interface PedidoFoto {
  imagens: ImagemFoto[]
  tipo: 'contagem'
}

export const MAX_IMAGENS = 4
/** limite por imagem em caracteres base64 (~4 MB) */
export const MAX_BASE64 = 4 * 1024 * 1024
export const MIMES_ACEITOS = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_LINHAS = 300

function texto(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/**
 * Transforma o JSON bruto do modelo em ResultadoContagem confiável:
 * material_id fora da lista vira null; quantidade não finita ou negativa vira null;
 * confiança inválida vira 'baixa'.
 */
export function sanitizarContagem(bruto: unknown, idsValidos: ReadonlySet<string>): ResultadoContagem {
  const obj = (bruto && typeof bruto === 'object' ? bruto : {}) as { linhas?: unknown; ilegivel?: unknown }
  const linhasBrutas = Array.isArray(obj.linhas) ? obj.linhas.slice(0, MAX_LINHAS) : []
  const linhas: LinhaLida[] = []
  for (const l of linhasBrutas) {
    if (!l || typeof l !== 'object') continue
    const r = l as Record<string, unknown>
    const textoLido = texto(r.texto_lido, 200)
    const materialId = typeof r.material_id === 'string' && idsValidos.has(r.material_id) ? r.material_id : null
    const qtdNum = typeof r.quantidade === 'number' ? r.quantidade : null
    const quantidade = qtdNum !== null && Number.isFinite(qtdNum) && qtdNum >= 0 ? qtdNum : null
    if (!textoLido && !materialId && quantidade === null) continue
    const confianca: Confianca = r.confianca === 'alta' || r.confianca === 'media' || r.confianca === 'baixa' ? r.confianca : 'baixa'
    linhas.push({
      texto_lido: textoLido,
      material_id: materialId,
      quantidade,
      unidade_lida: texto(r.unidade_lida, 20) || null,
      confianca,
      observacao: texto(r.observacao, 300),
    })
  }
  const ilegivel = (Array.isArray(obj.ilegivel) ? obj.ilegivel : [])
    .map((s) => texto(s, 200))
    .filter(Boolean)
    .slice(0, 50)
  return { ok: true, tipo: 'contagem', linhas, ilegivel }
}
