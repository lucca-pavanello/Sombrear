/**
 * Lotes de alterações da IA. `precos_auditoria` não tem coluna de lote (e não se
 * cria migration pra isso): o `lote_id` mora dentro do `detalhe` (jsonb) de cada
 * linha gravada pela Edge Function no mesmo "Aplicar".
 */

export interface LinhaAuditoria {
  id: number
  usuario: string
  acao: string
  detalhe: Record<string, unknown>
  criado_em: string
}

export interface LoteAplicado {
  loteId: string
  /** na ordem em que devem ser DESFEITAS: da última aplicada para a primeira */
  linhas: LinhaAuditoria[]
  criadoEm: string
}

/** Último lote aplicado pela IA (a linha mais recente que tem lote_id). */
export function ultimoLote(auditoria: LinhaAuditoria[]): LoteAplicado | null {
  const ordenadas = [...auditoria].sort((a, b) => b.id - a.id)
  const primeira = ordenadas.find(l => typeof l.detalhe?.lote_id === 'string')
  if (!primeira) return null
  const loteId = String(primeira.detalhe.lote_id)
  const linhas = ordenadas.filter(l => l.detalhe?.lote_id === loteId)
  return { loteId, linhas, criadoEm: primeira.criado_em }
}
