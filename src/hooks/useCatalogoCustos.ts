import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * Catálogo de custos: o que a loja PAGA pelos materiais de cortina.
 *
 * Fonte: `catalogo_custo_vigente`, uma view que escolhe, para cada fornecedor,
 * a ocorrência mais recente de cada produto — e que ignora de propósito os
 * documentos de tipo `orcamento`/`cotacao`. Preço oferecido não é preço pago:
 * o orçamento O-3831 da TA Decor é o único documento com entretela e varão, e
 * ele aparece no histórico como cotado, nunca no custo.
 *
 * Não confundir com `precos_*`, que é o que a loja COBRA. As duas coisas não
 * se tocam: mudar um custo aqui não altera nenhum orçamento.
 */

export type CategoriaCatalogo =
  | 'tecido' | 'varao' | 'suporte' | 'ponteira' | 'trilho' | 'entretela'
  | 'fita_wave' | 'cordao' | 'botao' | 'rodizio' | 'deslizante' | 'outro'

export type TipoDocumento = 'pedido' | 'orcamento' | 'cotacao' | 'lista_manual'

export interface CustoVigente {
  item_id: string
  fornecedor_id: string | null
  fornecedor: string | null
  codigo_fornecedor: string | null
  descricao: string
  categoria: CategoriaCatalogo
  cor: string | null
  largura_m: number | null
  unidade_canonica: 'm' | 'm2' | 'un' | 'kg'
  custo_unitario: number
  preco_bruto: number
  desconto_pct: number
  /** A unidade em que o fornecedor cobrou: PC, MTS, MILH, ROLO. */
  unidade_documento: string
  /** O líquido NA UNIDADE DO PAPEL — não confundir com `custo_unitario`. */
  preco_liquido: number
  tipo: TipoDocumento
  referencia: string
  data_documento: string | null
  tabela_preco: string | null
  produto_id: string | null
}

/** Uma ocorrência do produto num documento — inclusive as que não viram custo. */
export interface OcorrenciaCusto {
  id: string
  descricao: string
  codigo_fornecedor: string | null
  quantidade_documento: number
  unidade_documento: string
  preco_bruto: number
  desconto_pct: number
  preco_liquido: number
  custo_unitario: number
  unidade_canonica: string
  observacao: string | null
  catalogo_documentos: {
    referencia: string
    tipo: TipoDocumento
    data_documento: string | null
    tabela_preco: string | null
    categoria_cliente: string | null
    estoque_fornecedores: { nome: string } | null
  } | null
}

/**
 * Rótulos por extenso. O banco guarda slug porque é chave; a tela mostra o
 * nome que a loja usa.
 */
export const ROTULO_CATEGORIA: Record<CategoriaCatalogo, string> = {
  tecido: 'Tecido',
  varao: 'Varão',
  suporte: 'Suporte',
  ponteira: 'Ponteira',
  trilho: 'Trilho',
  entretela: 'Entretela',
  fita_wave: 'Fita wave',
  cordao: 'Cordão',
  botao: 'Botão',
  rodizio: 'Rodízio',
  deslizante: 'Deslizante',
  outro: 'A classificar',
}

/**
 * A separação que o pedido exige: tecido de um lado, acessório do outro.
 * Quem procura um tecido não pode ter que passar por ponteira e deslizante.
 */
export const GRUPOS = {
  tecido: ['tecido'] as CategoriaCatalogo[],
  acessorio: [
    'varao', 'trilho', 'suporte', 'ponteira', 'deslizante',
    'entretela', 'fita_wave', 'cordao', 'botao', 'rodizio', 'outro',
  ] as CategoriaCatalogo[],
}

export type GrupoCatalogo = keyof typeof GRUPOS

export function grupoDa(categoria: CategoriaCatalogo): GrupoCatalogo {
  return GRUPOS.tecido.includes(categoria) ? 'tecido' : 'acessorio'
}

/** Unidade como a loja fala: "R$ 8,74 / m", não "8.736 m". */
export function rotuloUnidade(u: string): string {
  return u === 'm' ? 'm' : u === 'm2' ? 'm²' : u === 'un' ? 'un' : u
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useCustosVigentes() {
  return useQuery({
    queryKey: ['catalogo-custo-vigente'],
    queryFn: async (): Promise<CustoVigente[]> => {
      const { data, error } = await supabase
        .from('catalogo_custo_vigente')
        .select('*')
        .order('categoria')
        .order('descricao')
      if (error) throw error
      return (data ?? []) as CustoVigente[]
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

/**
 * Todas as aparições de um produto, do mais novo para o mais velho.
 *
 * Casa por (fornecedor, código) quando há código — é o identificador estável
 * dos três fornecedores. Sem código, cai na descrição exata: nomes parecidos
 * NÃO são o mesmo produto (a Microfibra da Corttex custa R$ 6,30/m e a
 * Microfibra Clássica da TA Decor custa R$ 13,90/m).
 */
export function useHistoricoCusto(item: CustoVigente | null) {
  return useQuery({
    queryKey: ['catalogo-historico', item?.fornecedor_id, item?.codigo_fornecedor, item?.descricao],
    enabled: !!item,
    queryFn: async (): Promise<OcorrenciaCusto[]> => {
      if (!item) return []
      let q = supabase
        .from('catalogo_itens')
        .select(
          'id, descricao, codigo_fornecedor, quantidade_documento, unidade_documento,' +
            'preco_bruto, desconto_pct, preco_liquido, custo_unitario, unidade_canonica, observacao,' +
            'catalogo_documentos!inner(referencia, tipo, data_documento, tabela_preco,' +
            'categoria_cliente, estoque_fornecedores(nome))'
        )
        .eq('catalogo_documentos.fornecedor_id', item.fornecedor_id)

      q = item.codigo_fornecedor
        ? q.eq('codigo_fornecedor', item.codigo_fornecedor)
        : q.eq('descricao', item.descricao)

      const { data, error } = await q
      if (error) throw error

      // Ordena aqui, não no PostgREST: `catalogo_documentos` é uma relação
      // para-um, e `referencedTable` ordena DENTRO de uma lista embutida —
      // não serve para ordenar as linhas de fora por uma coluna de lá. São
      // poucas ocorrências por produto; ordenar no cliente é exato e barato.
      const linhas = (data ?? []) as unknown as OcorrenciaCusto[]
      return linhas
        .slice()
        .sort((a, b) =>
          (b.catalogo_documentos?.data_documento ?? '').localeCompare(
            a.catalogo_documentos?.data_documento ?? ''
          )
        )
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

/**
 * O que foi cotado mas nunca comprado.
 *
 * Fica fora do custo de propósito, mas some da tela seria pior: hoje é a única
 * notícia que a loja tem do preço de entretela e varão.
 */
export function useApenasCotados() {
  return useQuery({
    queryKey: ['catalogo-apenas-cotados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('catalogo_itens')
        .select(
          'id, descricao, categoria, cor, custo_unitario, unidade_canonica, codigo_fornecedor,' +
            'catalogo_documentos!inner(referencia, tipo, data_documento,' +
            'estoque_fornecedores(nome))'
        )
        .in('catalogo_documentos.tipo', ['orcamento', 'cotacao'])
        .order('categoria')
      if (error) throw error
      return (data ?? []) as unknown as OcorrenciaCusto[]
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
