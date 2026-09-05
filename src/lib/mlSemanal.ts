/**
 * Leitura da medição semanal do Mercado Livre — lógica pura, sem React nem Supabase.
 *
 * O n8n grava um retrato por domingo (`ml_tendencias_semana`, `ml_anuncios_semana`). Aqui
 * mora a parte que compara dois retratos e diz o que mudou, porque comparação é onde erro
 * passa despercebido: uma palavra que "subiu" na verdade caiu, um anúncio novo aparece como
 * queda de 100%. Fica em `lib/` pra ser testável sem subir client de banco, igual ao
 * `simulador.ts` e ao `precoMl.ts`.
 */

export type TendenciaSemana = {
  semana: string
  keyword: string
  posicao: number
}

export type AnuncioSemana = {
  semana: string
  ml_item_id: string
  titulo: string | null
  status: string | null
  preco: number | null
  visitas: number | null
  perguntas: number | null
  vendidos: number | null
}

/**
 * Abaixo disso não dá pra concluir nada sobre o anúncio: 3 visitas sem pergunta não
 * significam que o preço está errado, significam que ninguém viu ainda. O número é
 * deliberadamente conservador — um diagnóstico errado manda mexer no anúncio à toa.
 */
export const VISITAS_MINIMAS_PARA_LER = 20

export type MudancaTendencia = {
  keyword: string
  posicao: number
  /** posição na semana anterior; null quando a palavra não estava no ranking */
  anterior: number | null
  /** positivo = subiu no ranking (posição menor). null quando é entrada nova. */
  ganho: number | null
}

export type ComparacaoTendencias = {
  subiram: MudancaTendencia[]
  cairam: MudancaTendencia[]
  entraram: MudancaTendencia[]
  sairam: { keyword: string; anterior: number }[]
}

/**
 * O que mudou no ranking de buscas entre duas semanas.
 *
 * Cuidado central: **posição menor é melhor**. `ganho` é `anterior - posicao`, então um
 * número positivo quer dizer que a palavra subiu. Inverter isso faria a tela mostrar
 * exatamente o oposto do que aconteceu, sem nada denunciar.
 */
export function compararTendencias(
  atual: TendenciaSemana[],
  anterior: TendenciaSemana[],
): ComparacaoTendencias {
  const antes = new Map(anterior.map(t => [t.keyword, t.posicao]))
  const agora = new Map(atual.map(t => [t.keyword, t.posicao]))

  const subiram: MudancaTendencia[] = []
  const cairam: MudancaTendencia[] = []
  const entraram: MudancaTendencia[] = []

  for (const t of atual) {
    const ant = antes.get(t.keyword)
    if (ant == null) {
      entraram.push({ keyword: t.keyword, posicao: t.posicao, anterior: null, ganho: null })
      continue
    }
    const ganho = ant - t.posicao
    if (ganho > 0) subiram.push({ keyword: t.keyword, posicao: t.posicao, anterior: ant, ganho })
    else if (ganho < 0) cairam.push({ keyword: t.keyword, posicao: t.posicao, anterior: ant, ganho })
  }

  const sairam = anterior
    .filter(t => !agora.has(t.keyword))
    .map(t => ({ keyword: t.keyword, anterior: t.posicao }))
    .sort((a, b) => a.anterior - b.anterior)

  return {
    subiram: subiram.sort((a, b) => (b.ganho ?? 0) - (a.ganho ?? 0)),
    cairam: cairam.sort((a, b) => (a.ganho ?? 0) - (b.ganho ?? 0)),
    entraram: entraram.sort((a, b) => a.posicao - b.posicao),
    sairam,
  }
}

export type Diagnostico =
  | 'fora_do_ar'
  | 'vendeu'
  | 'perguntaram_e_nao_compraram'
  | 'viram_e_nao_perguntaram'
  | 'ninguem_viu'
  | 'pouco_movimento'

export const EXPLICACAO: Record<Diagnostico, string> = {
  fora_do_ar: 'O anúncio não está ativo, então nada do resto importa até ele voltar.',
  vendeu: 'Vendeu na semana. É o anúncio a copiar, não a mexer.',
  perguntaram_e_nao_compraram: 'Chegou gente e ela perguntou, mas não fechou. Costuma ser preço, prazo ou uma dúvida que a descrição não responde.',
  viram_e_nao_perguntaram: 'Gente viu e não quis saber mais. Costuma ser a foto de capa ou o preço, que aparecem antes de qualquer texto.',
  ninguem_viu: 'Ninguém abriu o anúncio. O problema está antes: título e palavras de busca.',
  pouco_movimento: 'Movimento baixo demais pra concluir alguma coisa. Deixa mais uma semana antes de mexer.',
}

/**
 * O que o número da semana está dizendo sobre um anúncio.
 *
 * A ordem das perguntas é a do funil: chegou? olhou? perguntou? comprou? Assim o
 * diagnóstico aponta o primeiro degrau que quebrou, e não o último.
 */
export function lerAnuncio(a: AnuncioSemana): Diagnostico {
  if (a.status !== 'active') return 'fora_do_ar'
  if ((a.vendidos ?? 0) > 0) return 'vendeu'
  if ((a.perguntas ?? 0) > 0) return 'perguntaram_e_nao_compraram'

  const visitas = a.visitas ?? 0
  if (visitas === 0) return 'ninguem_viu'
  if (visitas < VISITAS_MINIMAS_PARA_LER) return 'pouco_movimento'
  return 'viram_e_nao_perguntaram'
}

/** As semanas presentes nos dados, da mais recente para a mais antiga. */
export function semanas(linhas: { semana: string }[]): string[] {
  return [...new Set(linhas.map(l => l.semana))].sort().reverse()
}
