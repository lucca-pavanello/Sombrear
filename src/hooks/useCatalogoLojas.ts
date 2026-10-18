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
export interface ColunasDoGrupo {
  /** Lojas que a loja mandou mostrar, mesmo sem preço ainda. */
  fixadas: string[]
  /** Lojas que a loja tirou da tela. Têm a palavra final. */
  ocultas: string[]
}

export function useColunasFornecedor(grupo: GrupoCatalogo) {
  return useQuery({
    queryKey: ['catalogo-colunas', grupo],
    queryFn: async (): Promise<ColunasDoGrupo> => {
      const { data, error } = await supabase
        .from('catalogo_colunas_fornecedor')
        .select('fornecedor_id, oculta')
        .eq('grupo', grupo)
      if (error) throw error
      const linhas = data ?? []
      return {
        fixadas: linhas.filter(l => !l.oculta).map(l => l.fornecedor_id as string),
        ocultas: linhas.filter(l => l.oculta).map(l => l.fornecedor_id as string),
      }
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

/**
 * Mostrar a coluna. Serve tanto para a loja nova quanto para desfazer uma
 * exclusão — por isso grava `oculta: false` em vez de só inserir: a linha
 * de uma coluna escondida já existe, e um insert simples não a traria de
 * volta.
 */
export function useFixarColuna() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { grupo: GrupoCatalogo; fornecedorId: string }) => {
      const { data, error } = await supabase
        .from('catalogo_colunas_fornecedor')
        .upsert(
          { grupo: v.grupo, fornecedor_id: v.fornecedorId, oculta: false },
          { onConflict: 'grupo,fornecedor_id' }
        )
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
 * Excluir a coluna = esconder a coluna. Nenhum custo é apagado.
 *
 * Apagar os itens para sumir com a coluna destruiria o histórico que faz o
 * custo ser rastreável: o pedido 115104 continua dizendo que o trilho saiu a
 * R$ 8,736/m depois de a loja parar de comprar na Alumitec, e aquele número
 * ainda sustenta a margem de orçamentos já emitidos. Uma tela a menos nunca
 * deve custar um dado a menos.
 */
export function useOcultarColuna() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { grupo: GrupoCatalogo; fornecedorId: string }) => {
      const { data, error } = await supabase
        .from('catalogo_colunas_fornecedor')
        .upsert(
          { grupo: v.grupo, fornecedor_id: v.fornecedorId, oculta: true },
          { onConflict: 'grupo,fornecedor_id' }
        )
        .select('fornecedor_id')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error(
          'O banco não confirmou a gravação, então a coluna NÃO foi escondida. ' +
            'Pode ser falta de permissão de administrador.'
        )
      }
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['catalogo-colunas', v.grupo] }),
  })
}

/**
 * Renomear a loja. O nome é do FORNECEDOR, não da coluna: ele muda junto no
 * cadastro de fornecedores, nos lotes e em toda tela que mostre esse nome.
 * Quem chama avisa isso antes.
 */
export function useRenomearLoja() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { fornecedorId: string; nome: string }) => {
      const limpo = v.nome.trim()
      if (!limpo) throw new Error('O nome da loja não pode ficar vazio.')

      const { data: existentes, error: eBusca } = await supabase
        .from('estoque_fornecedores')
        .select('id, nome')
        .ilike('nome', limpo)
      if (eBusca) throw eBusca
      if (existentes?.some(f => f.id !== v.fornecedorId)) {
        throw new Error(`Já existe outra loja chamada "${limpo}".`)
      }

      const { data, error } = await supabase
        .from('estoque_fornecedores')
        .update({ nome: limpo })
        .eq('id', v.fornecedorId)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error(
          'O banco não confirmou a gravação, então o nome NÃO mudou. ' +
            'Pode ser falta de permissão de administrador.'
        )
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalogo-fornecedores'] })
      // O nome do fornecedor viaja dentro da view de custo vigente.
      qc.invalidateQueries({ queryKey: ['catalogo-custo-vigente'] })
    },
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
