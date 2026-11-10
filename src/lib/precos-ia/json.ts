/** Extrai o JSON da resposta do modelo (tolera cerca ```json e texto em volta). */
export function extrairJson(texto: string): Record<string, unknown> | null {
  const limpo = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const tenta = (s: string) => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch { return null }
  }
  const direto = tenta(limpo)
  if (direto) return direto
  const i = limpo.indexOf('{'), f = limpo.lastIndexOf('}')
  return i >= 0 && f > i ? tenta(limpo.slice(i, f + 1)) : null
}
