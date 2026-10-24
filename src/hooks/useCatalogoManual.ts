import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { gravarCustoManual } from '@/lib/catalogo/gravarCusto'
import type { CorrecaoCusto } from '@/lib/catalogo/manual'
import type { AlvoMaterial } from '@/lib/catalogo/editarMaterial'

/**
 * Escrita no catálogo de custos, para a tela. As leituras ficam em
 * useCatalogoCustos.ts e a gravação em si em lib/catalogo/gravarCusto.ts —
 * o mesmo arquivo que o chat de estoque usa, para a IA e o formulário nunca
 * gravarem de jeitos diferentes.
 */

export function useSalvarCustoManual() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (c: CorrecaoCusto) => gravarCustoManual(c),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalogo-custo-vigente'] })
      qc.invalidateQueries({ queryKey: ['catalogo-historico'] })
    },
  })
}

function invalidarCatalogo(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['catalogo-custo-vigente'] })
  qc.invalidateQueries({ queryKey: ['catalogo-historico'] })
  qc.invalidateQueries({ queryKey: ['catalogo-compra-escolhida'] })
}

/**
 * Nome, categoria, cor, largura e códigos de um material — em todas as lojas
 * de uma vez. Ajuste por cima do documento, nunca reescrita dele (0044).
 */
export function useEditarMaterial() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (v: {
      alvos: AlvoMaterial[]
      descricao: string
      categoria: string
      cor: string | null
      larguraM: number | null
      chaveAntiga: string
      chaveNova: string
    }) => {
      const { data, error } = await supabase.rpc('catalogo_editar_material', {
        p_alvos: v.alvos,
        p_descricao: v.descricao.trim(),
        p_categoria: v.categoria,
        p_cor: v.cor,
        p_largura_m: v.larguraM,
        p_chave_antiga: v.chaveAntiga,
        p_chave_nova: v.chaveNova,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: () => invalidarCatalogo(qc),
  })
}

/**
 * Tira o material do catálogo (ou só o preço de uma loja, com um alvo só).
 * O documento fica; some o que foi registrado até agora. Se a loja voltar a
 * comprar, o registro novo aparece normalmente.
 */
export function useExcluirMaterial() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (alvos: AlvoMaterial[]) => {
      const { data, error } = await supabase.rpc('catalogo_excluir_material', { p_alvos: alvos })
      if (error) throw error
      return data as number
    },
    onSuccess: () => invalidarCatalogo(qc),
  })
}

/** Fornecedores ativos, para o seletor da correção. */
export function useFornecedoresCatalogo() {
  return useQuery({
    queryKey: ['catalogo-fornecedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estoque_fornecedores')
        .select('id, nome')
        .eq('ativo', true)
        .order('nome')
      if (error) throw error
      return (data ?? []) as { id: string; nome: string }[]
    },
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
