import type { CustoVigente } from '@/hooks/useCatalogoCustos'

/**
 * Editar e excluir um material do catálogo — a parte que não depende de banco.
 *
 * Nada aqui reescreve item de documento. A edição vira um ajuste por cima
 * (`catalogo_ajustes_material`, migration 0044) e a view de custo passa a
 * mostrar o valor ajustado. Por isso o nome muda em TODAS as lojas de uma vez:
 * é o nome que junta as lojas numa linha só, e mudar em uma só partiria o
 * material em dois.
 */

/** Uma célula do material, como a tela a vê — é por ela que o banco acha o produto. */
export interface AlvoMaterial {
  fornecedor_id: string | null
  codigo: string | null
  descricao: string
  /** Presente = trocar o código desta loja (null apaga). Ausente = manter. */
  novo_codigo?: string | null
}

export interface EdicaoMaterial {
  descricao: string
  categoria: string
  cor: string | null
  larguraM: number | null
  /** fornecedor_id ('' = sem fornecedor) → código novo daquela loja. */
  codigos: Map<string, string>
}

/** As células do material, uma por loja, para mandar ao banco. */
export function alvosDoMaterial(celulas: CustoVigente[]): AlvoMaterial[] {
  return celulas.map(c => ({
    fornecedor_id: c.fornecedor_id,
    codigo: c.codigo_fornecedor,
    descricao: c.descricao,
  }))
}

/**
 * Os alvos com o código novo de cada loja — só onde ele mudou. Mandar o
 * código igual seria inofensivo, mas mandar só a diferença deixa o ajuste
 * dizer a verdade sobre o que a loja mexeu.
 */
export function alvosComCodigo(celulas: CustoVigente[], codigos: Map<string, string>): AlvoMaterial[] {
  return celulas.map(c => {
    const alvo: AlvoMaterial = {
      fornecedor_id: c.fornecedor_id,
      codigo: c.codigo_fornecedor,
      descricao: c.descricao,
    }
    const digitado = codigos.get(c.fornecedor_id ?? '')
    if (digitado !== undefined && digitado.trim() !== (c.codigo_fornecedor ?? '')) {
      alvo.novo_codigo = digitado.trim() || null
    }
    return alvo
  })
}

/** Recusa em vez de gravar lixo. */
export function validarEdicaoMaterial(e: Partial<EdicaoMaterial>): string | null {
  if (!e.descricao?.trim()) return 'O material precisa de um nome.'
  if (!e.categoria) return 'Escolha a categoria.'
  if (e.larguraM !== null && e.larguraM !== undefined) {
    if (!Number.isFinite(e.larguraM) || e.larguraM <= 0) return 'Largura inválida.'
  }
  return null
}
