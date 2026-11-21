import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type Profile = {
  id: string
  email: string
  full_name: string
  approved: boolean | null  // null = pendente, true = aprovado, false = revogado
  is_admin: boolean
  pode_orcamento: boolean | null
  pode_estoque: boolean | null
  pode_agente_ia: boolean | null
  pode_precos: boolean | null
  pode_fechamento: boolean | null
  /** aba Conversas (migration 0039); undefined enquanto o banco não tiver a coluna */
  pode_conversas?: boolean | null
  created_at: string
}

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (error) throw error
      return data as Profile
    },
  })
}

export function useAllProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Profile[]
    },
  })
}

export function usePendingCount() {
  return useQuery({
    queryKey: ['profiles-pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .is('approved', null)
      if (error) return 0
      return count ?? 0
    },
    refetchInterval: 30000,
  })
}
