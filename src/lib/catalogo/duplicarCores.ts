/**
 * Duplicar um material em outras cores — a parte que não depende de banco.
 *
 * "MICROFIBRA 90 grs 3.30 BEGE" + "branco, cinza" vira "MICROFIBRA 90 grs
 * 3.30 BRANCO" e "... CINZA", com a cor escrita do jeito que o material já
 * escreve (BEGE / bege / Bege). A tela mostra os nomes antes de salvar e a
 * loja pode corrigir qualquer um — a sugestão é palpite, não regra.
 */

export interface VariacaoCor {
  descricao: string
  cor: string | null
}

/** "branco, cinza;  marfim\nprata" → ['branco', 'cinza', 'marfim', 'prata'], sem repetir. */
export function separarCores(texto: string): string[] {
  const vistas = new Set<string>()
  const cores: string[] = []
  for (const parte of texto.split(/[,;\n]+|\s+e\s+/i)) {
    const c = parte.trim().replace(/\s+/g, ' ')
    const chave = semAcento(c).toLowerCase()
    if (!c || vistas.has(chave)) continue
    vistas.add(chave)
    cores.push(c)
  }
  return cores
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Escreve `nova` com a mesma caixa de `modelo`: BEGE → BRANCO, bege → branco, Bege → Branco. */
export function mesmaCaixa(modelo: string, nova: string): string {
  if (modelo === modelo.toUpperCase()) return nova.toUpperCase()
  if (modelo === modelo.toLowerCase()) return nova.toLowerCase()
  return nova.charAt(0).toUpperCase() + nova.slice(1).toLowerCase()
}

/**
 * O nome da variação. Procura a cor atual no nome (sem ligar para acento e
 * caixa) e troca a ÚLTIMA ocorrência — "BEGE" no fim é o caso comum. Sem cor
 * cadastrada, troca a última palavra. Sem nada para trocar, acrescenta.
 */
export function nomeNaCor(descricao: string, corAtual: string | null, nova: string): string {
  const palavras = descricao.trim().split(/\s+/)
  const alvo = corAtual?.trim()
  let i = -1
  if (alvo) {
    const chave = semAcento(alvo).toLowerCase()
    for (let k = palavras.length - 1; k >= 0; k--) {
      if (semAcento(palavras[k]).toLowerCase() === chave) {
        i = k
        break
      }
    }
    if (i < 0) return `${descricao.trim()} ${mesmaCaixa(descricao, nova)}`
  } else {
    i = palavras.length - 1
  }
  palavras[i] = mesmaCaixa(palavras[i], nova)
  return palavras.join(' ')
}

/** As variações sugeridas. A cor segue a caixa da cor atual; sem cor atual, fica vazia como no original. */
export function variacoesSugeridas(
  descricao: string,
  corAtual: string | null,
  cores: string[]
): VariacaoCor[] {
  return cores.map(c => ({
    descricao: nomeNaCor(descricao, corAtual, c),
    cor: corAtual ? mesmaCaixa(corAtual, c) : null,
  }))
}
