import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { EstoqueVenda, EstoqueVendaItem } from '@/lib/supabase'

// ─── Tipos locais ──────────────────────────────────────────────────────────────

export type VendaComContagem = EstoqueVenda & {
  num_itens: number
  vendedor_nome: string | null
  vendedor: string | null
}

export type VendaDetalhe = EstoqueVenda & {
  vendedor_nome: string | null
  vendedor: string | null
  estoque_venda_itens: (EstoqueVendaItem & {
    estoque_produtos: { nome: string; unidade: string; codigo: string | null } | null
  })[]
}

export type NovaVendaPayload = {
  data: string
  cliente?: string
  observacao?: string
  vendedor?: string
  vendedor_id?: string
  itens: {
    produto_id: string
    quantidade: number
    preco_unitario: number
    desconto: number
  }[]
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Nome de quem registrou a venda. `vendedor_id` aponta para auth.users, não para
 * `profiles`, então o PostgREST não consegue embutir `profiles(...)` na consulta
 * (erro PGRST200, que derrubava o histórico inteiro). Busca à parte e, se falhar,
 * a tela segue com o texto livre de `vendedor`.
 */
async function nomesPorVendedorId(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((id): id is string => !!id))]
  const nomes = new Map<string, string>()
  if (unicos.length === 0) return nomes
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', unicos)
  for (const p of data ?? []) {
    const nome = p.full_name ?? p.email
    if (nome) nomes.set(p.id, nome)
  }
  return nomes
}

export function useVendas() {
  return useQuery({
    queryKey: ['estoque-vendas'],
    queryFn: async (): Promise<VendaComContagem[]> => {
      const { data, error } = await supabase
        .from('estoque_vendas')
        .select(`
          id, data, cliente, total, vendedor_id, vendedor, created_at, observacao,
          estoque_venda_itens(count)
        `)
        .order('data', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      const nomes = await nomesPorVendedorId((data ?? []).map((row: any) => row.vendedor_id))

      return (data ?? []).map((row: any) => ({
        id: row.id,
        created_at: row.created_at,
        data: row.data,
        cliente: row.cliente,
        total: row.total,
        vendedor_id: row.vendedor_id,
        vendedor: row.vendedor ?? null,
        observacao: row.observacao,
        num_itens: row.estoque_venda_itens?.[0]?.count ?? 0,
        vendedor_nome: nomes.get(row.vendedor_id) ?? null,
      }))
    },
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useVendaDetalhe(id: string | null) {
  return useQuery({
    queryKey: ['estoque-venda-detalhe', id],
    enabled: !!id,
    queryFn: async (): Promise<VendaDetalhe | null> => {
      if (!id) return null

      const { data, error } = await supabase
        .from('estoque_vendas')
        .select(`
          id, data, cliente, total, vendedor_id, vendedor, created_at, observacao,
          estoque_venda_itens(
            id, venda_id, produto_id, quantidade, preco_unitario, desconto, subtotal,
            estoque_produtos(nome, unidade, codigo)
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      if (!data) return null

      const row = data as any
      const nomes = await nomesPorVendedorId([row.vendedor_id])
      return {
        id: row.id,
        created_at: row.created_at,
        data: row.data,
        cliente: row.cliente,
        total: row.total,
        vendedor_id: row.vendedor_id,
        vendedor: row.vendedor ?? null,
        observacao: row.observacao,
        vendedor_nome: nomes.get(row.vendedor_id) ?? null,
        estoque_venda_itens: row.estoque_venda_itens ?? [],
      }
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useVendedores() {
  return useQuery({
    queryKey: ['estoque_vendedores'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('estoque_vendas')
        .select('vendedor')
        .not('vendedor', 'is', null)
        .neq('vendedor', '')
        .order('vendedor')
      if (error) throw error
      return [...new Set((data ?? []).map((r: any) => r.vendedor as string).filter(Boolean))]
    },
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

// ─── Mutação ──────────────────────────────────────────────────────────────────

export function useRegistrarVenda() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (payload: NovaVendaPayload): Promise<string> => {
      // 1. Insert venda-pai
      const { data: venda, error: vendaErr } = await supabase
        .from('estoque_vendas')
        .insert({
          data: payload.data,
          cliente: payload.cliente?.trim() || null,
          observacao: payload.observacao?.trim() || null,
          vendedor: payload.vendedor?.trim() || null,
          vendedor_id: payload.vendedor_id ?? null,
        })
        .select('id')
        .single()

      if (vendaErr) throw vendaErr

      // 2. Insert itens em bulk
      const itensRows = payload.itens.map((item) => ({
        venda_id: venda.id,
        produto_id: item.produto_id,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        desconto: item.desconto,
      }))

      const { error: itensErr } = await supabase
        .from('estoque_venda_itens')
        .insert(itensRows)

      // 3. Rollback manual se itens falharam
      if (itensErr) {
        await supabase.from('estoque_vendas').delete().eq('id', venda.id)
        throw itensErr
      }

      return venda.id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['estoque-vendas'] })
      qc.invalidateQueries({ queryKey: ['estoque_vendedores'] })
      qc.invalidateQueries({ queryKey: ['estoque-produtos'] })
      qc.invalidateQueries({ queryKey: ['estoque-movimentacoes'] })
    },
  })
}
