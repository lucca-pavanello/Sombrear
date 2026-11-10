/**
 * Desfecho do orçamento — o que aconteceu depois que o preço foi passado.
 *
 * O dash sempre soube gerar orçamento e nunca soube o fim da história: em
 * 13/08/2026 eram 498 orçamentos e 6 marcados como venda. Não é conversão de
 * 1,2% — é que ninguém tinha onde marcar. Daí estas três respostas, que a
 * pessoa dá em um toque:
 *
 *   fechou   → virou venda (também liga `fechado`, que é o que conta dinheiro)
 *   perdido  → respondeu que não vai fechar (com o motivo, quando disser)
 *   sumiu    → parou de responder
 *
 * `null` = ainda esperando resposta. É esse null que forma a fila.
 */
export type Desfecho = 'fechou' | 'perdido' | 'sumiu'

export const DESFECHOS: Record<Desfecho, { rotulo: string; curto: string; cor: string }> = {
  fechou:  { rotulo: 'Fechou',      curto: 'Fechou',  cor: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  perdido: { rotulo: 'Não fechou',  curto: 'Perdido', cor: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  sumiu:   { rotulo: 'Sumiu',       curto: 'Sumiu',   cor: 'border-border bg-muted/60 text-muted-foreground' },
}

/** Motivos prontos pra não precisar digitar — o campo aceita qualquer texto. */
export const MOTIVOS_PERDA = [
  'Achou caro',
  'Prazo de entrega',
  'Comprou de outro',
  'Adiou a compra',
  'Desistiu da obra',
] as const

/** Dias inteiros desde que o orçamento foi feito. */
export function diasDesde(iso: string, agora: number = Date.now()): number {
  const ms = agora - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/** Os campos que registrar/desfazer um desfecho escreve — o undo restaura exatamente estes. */
export const CAMPOS_DESFECHO = [
  'desfecho', 'desfecho_em', 'desfecho_por', 'desfecho_motivo',
  'fechado', 'status', 'origem', 'valor_cobrado', 'forma_pagamento_real',
] as const

/**
 * Faixa de idade da espera. As cores seguem o semáforo do dash: verde é
 * novo (ainda dá pra fechar), âmbar pede atenção, vermelho é esquecido.
 */
export function faixaEspera(dias: number) {
  if (dias <= 7) return { id: 'novo',    rotulo: 'até 7 dias',      cor: 'text-emerald-600 dark:text-emerald-400' }
  if (dias <= 30) return { id: 'atencao', rotulo: '8 a 30 dias',    cor: 'text-amber-600 dark:text-amber-400' }
  return { id: 'frio', rotulo: 'mais de 30 dias', cor: 'text-rose-600 dark:text-rose-400' }
}
