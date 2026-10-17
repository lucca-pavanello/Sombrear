/**
 * Correção de custo feita pela loja — e a regra de quem ganha de quem.
 *
 * Uma correção NÃO edita o item do documento. O pedido 115104 diz que o
 * trilho saiu por R$ 8,736/m e isso é um fato do papel: reescrever aquela
 * linha seria falsificar a nota. A correção entra como um registro próprio,
 * num documento de tipo `lista_manual` datado do dia.
 *
 * A precedência cai de graça do desenho: `catalogo_custo_vigente` já escolhe
 * a ocorrência mais recente de cada produto, então
 *
 *   - reimportar um pedido ANTIGO não desfaz a correção (a data dele é mais
 *     velha) — que é exatamente o que o pedido pede;
 *   - um pedido NOVO, com nota de verdade, passa a valer por cima da
 *     correção. É o certo: nota fiscal nova é prova melhor do que anotação
 *     velha. A tela mostra de onde veio o custo para a loja perceber.
 *
 * Um documento manual por fornecedor POR DIA. Assim cada correção carrega a
 * data em que foi feita, em vez de um documento guarda-chuva cuja data se
 * move e bagunça a ordem das outras.
 */

/** "ALUMITEC ALUMINIO" -> "ALUMITEC-ALUMINIO" */
export function apelidoFornecedor(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

export function hojeIso(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`
}

/** `MANUAL-ALUMITEC-ALUMINIO-2026-10-17` */
export function referenciaManual(fornecedor: string, dia = hojeIso()): string {
  return `MANUAL-${apelidoFornecedor(fornecedor)}-${dia}`
}

export interface CorrecaoCusto {
  fornecedorId: string
  fornecedorNome: string
  codigoFornecedor: string | null
  descricao: string
  categoria: string
  cor: string | null
  larguraM: number | null
  /** O custo na unidade canônica — o número que a loja vê na tela. */
  custoUnitario: number
  unidadeCanonica: 'm' | 'm2' | 'un' | 'kg'
  motivo: string | null
}

/**
 * Checagens que não dependem de banco, para o teste alcançar.
 *
 * Recusa em vez de gravar lixo: custo zero ou negativo não existe, e material
 * sem nome não dá para achar depois.
 */
export function validarCorrecao(c: Partial<CorrecaoCusto>): string | null {
  if (!c.descricao?.trim()) return 'Diga o nome do material.'
  if (!c.fornecedorId) return 'Escolha de qual fornecedor é esse custo.'
  if (c.custoUnitario === undefined || c.custoUnitario === null || Number.isNaN(c.custoUnitario)) {
    return 'Informe o custo.'
  }
  if (c.custoUnitario <= 0) return 'O custo precisa ser maior que zero.'
  if (!Number.isFinite(c.custoUnitario)) return 'Custo inválido.'
  return null
}

/**
 * Avisa quando o valor novo é muito distante do atual.
 *
 * Não bloqueia — só pede confirmação. Mesmo cuidado que a tela de preços de
 * venda já toma: a maioria dos erros de digitação de preço é casa decimal.
 */
export function mudancaSuspeita(atual: number | null, novo: number): string | null {
  if (!atual || atual <= 0) return null
  if (novo >= atual * 2) return `Isso é mais que o dobro do custo atual (${atual.toFixed(4)}).`
  if (novo <= atual / 2) return `Isso é menos da metade do custo atual (${atual.toFixed(4)}).`
  return null
}
