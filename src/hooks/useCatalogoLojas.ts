import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { GrupoCatalogo } from '@/hooks/useCatalogoCustos'
import { SEM_FORNECEDOR } from '@/lib/catalogo/pivo'

/**
 * As duas coisas que a loja decide na tela de custos e que precisam durar:
 * quais lojas viram coluna, e de qual loja ela comprou cada material.
 *
 * Toda escrita aqui confere PERSISTÊNCIA com `.select()` e trata zero linhas
 * como erro. Sem isso, uma linha barrada pela RLS volta 204, sem linhas e com
 * `error === null` — e a tela diz "Salvo!" sem ter salvado nada. Estas duas
 * tabelas são graváveis só por admin, então é o caminho mais provável de dar
 * errado em silêncio justamente aqui.
 */

// ─── Quais lojas viram coluna ─────────────────────────────────────────────────

/**
 * Uma loja aparece como coluna por estar fixada aqui OU por já ter item no
 * grupo. A fixação existe para quebrar o impasse do primeiro preço: para
 * informar quanto a Tapeçaria Americana cobra por um acessório é preciso que
 * a coluna exista, e sem isto ela só existiria depois do primeiro preço.
 */
export function useColunasFornecedor(grupo: GrupoCatalogo) {
  return useQuery({
    queryKey: ['catalogo-colunas', grupo],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('catalogo_colunas_fornecedor')
        .select('fornecedor_id')
        .eq('grupo', grupo)
      if (error) throw error
      return (data ?? []).map(l => l.fornecedor_id as string)
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useFixarColuna() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { grupo: GrupoCatalogo; fornecedorId: string }) => {
      const { data, error } = await supabase
        .from('catalogo_colunas_fornecedor')
        .upsert({ grupo: v.grupo, fornecedor_id: v.fornecedorId }, { onConflict: 'grupo,fornecedor_id' })
        .select('fornecedor_id')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error(
          'O banco não confirmou a gravação, então a coluna NÃO foi criada. ' +
            'Pode ser falta de permissão de administrador.'
        )
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['catalogo-colunas', v.grupo] }),
  })
}

/**
 * Tirar a coluna não apaga preço nenhum: se a loja tiver item no grupo, a
 * coluna continua aparecendo, porque esconder um custo que existe seria pior
 * que uma coluna a mais. Só some a coluna que estava vazia.
 */
export function useSoltarColuna() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { grupo: GrupoCatalogo; fornecedorId: string }) => {
      const { error } = await supabase
        .from('catalogo_colunas_fornecedor')
        .delete()
        .eq('grupo', v.grupo)
        .eq('fornecedor_id', v.fornecedorId)
      if (error) throw error
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['catalogo-colunas', v.grupo] }),
  })
}

/**
 * Cadastrar uma loja que ainda não existe, direto de onde ela faz falta.
 *
 * Só o nome é obrigatório em `estoque_fornecedores`; CNPJ, contato e prazo
 * entram depois pelo cadastro de fornecedores. Obrigar os dados completos
 * aqui faria a dona abandonar o preço que ela veio digitar.
 */
export function useCriarFornecedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (nome: string): Promise<string> => {
      const limpo = nome.trim()
      if (!limpo) throw new Error('O nome da loja não pode ficar vazio.')

      // Nome repetido viraria duas colunas iguais e dois custos "vigentes"
      // para o mesmo material. A comparação ignora caixa e espaço.
      const { data: existentes, error: eBusca } = await supabase
        .from('estoque_fornecedores')
        .select('id, nome')
        .ilike('nome', limpo)
      if (eBusca) throw eBusca
      if (existentes && existentes.length > 0) {
        throw new Error(`Já existe uma loja chamada "${existentes[0].nome}".`)
      }

      const { data, error } = await supabase
        .from('estoque_fornecedores')
        .insert({ nome: limpo })
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error(
          'O banco não confirmou a gravação, então a loja NÃO foi criada. ' +
            'Pode ser falta de permissão de administrador.'
        )
      }
      return data[0].id as string
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalogo-fornecedores'] }),
  })
}

// ─── De qual loja a Sombrear comprou ──────────────────────────────────────────

/**
 * Material → loja onde foi comprado. A chave é a mesma do pivô da tela: a
 * descrição normalizada.
 *
 * O valor pode ser `SEM_FORNECEDOR` (string vazia): é a coluna "Sem
 * fornecedor", escolha legítima enquanto os 11 tecidos da lista da dona não
 * tiverem dono. Quem distingue "não marcou" de "marcou sem fornecedor" é a
 * chave existir no mapa.
 */
export function useCompraEscolhida() {
  return useQuery({
    queryKey: ['catalogo-compra-escolhida'],
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from('catalogo_compra_escolhida')
        .select('material_chave, fornecedor_id')
      if (error) throw error
      return new Map(
        (data ?? []).map(l => [
          l.material_chave as string,
          (l.fornecedor_id as string | null) ?? SEM_FORNECEDOR,
        ])
      )
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useMarcarCompra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { materialChave: string; fornecedorId: string | null }) => {
      // Desmarcar apaga a linha: ausência é "não sei de onde comprei", que é
      // diferente de "comprei de ninguém".
      if (v.fornecedorId === null) {
        const { error } = await supabase
          .from('catalogo_compra_escolhida')
          .delete()
          .eq('material_chave', v.materialChave)
        if (error) throw error
        return
      }

      const { data: sessao } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('catalogo_compra_escolhida')
        .upsert(
          {
            material_chave: v.materialChave,
            // A coluna "Sem fornecedor" é id vazio na tela e NULL no banco.
            fornecedor_id: v.fornecedorId === SEM_FORNECEDOR ? null : v.fornecedorId,
            marcado_em: new Date().toISOString(),
            marcado_por: sessao?.user?.id ?? null,
          },
          { onConflict: 'material_chave' }
        )
        .select('material_chave')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error(
          'O banco não confirmou a gravação, então a marcação NÃO foi salva. ' +
            'Pode ser falta de permissão de administrador.'
        )
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalogo-compra-escolhida'] }),
  })
}
