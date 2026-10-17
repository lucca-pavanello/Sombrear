import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { gravarCustoManual } from '@/lib/catalogo/gravarCusto'
import type { CorrecaoCusto } from '@/lib/catalogo/manual'

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
