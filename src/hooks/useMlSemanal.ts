import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TendenciaSemana, AnuncioSemana } from '@/lib/mlSemanal'

/**
 * A medição semanal do Mercado Livre, gravada pelo workflow `Sombrear | ML semanal`
 * (n8n, domingo 07h). Aqui só se lê: escrever na mão seria adulterar o histórico, e é
 * justamente o histórico que responde "está melhorando?".
 *
 * Busca poucas semanas de propósito. A tela compara a última com a anterior; o resto do
 * arquivo serve pra quando alguém quiser olhar mais pra trás, e aí vale mudar o limite em
 * vez de carregar o banco inteiro toda vez.
 */
const SEMANAS_CARREGADAS = 8

export function useMlTendencias(semanas = SEMANAS_CARREGADAS) {
  return useQuery({
    queryKey: ['ml-tendencias', semanas],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ml_tendencias_semana')
        .select('semana, keyword, posicao')
        .order('semana', { ascending: false })
        .order('posicao')
        // 50 palavras por semana é o tamanho do ranking que o ML devolve
        .limit(semanas * 50)
      if (error) throw error
      return (data ?? []) as TendenciaSemana[]
    },
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

export function useMlAnuncios(semanas = SEMANAS_CARREGADAS) {
  return useQuery({
    queryKey: ['ml-anuncios', semanas],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ml_anuncios_semana')
        .select('semana, ml_item_id, titulo, status, preco, visitas, perguntas, vendidos')
        .order('semana', { ascending: false })
        .order('ml_item_id')
        .limit(semanas * 200)
      if (error) throw error
      return (data ?? []).map(a => ({
        ...a,
        // numeric do Postgres chega como string pelo PostgREST
        preco: a.preco == null ? null : Number(a.preco),
      })) as AnuncioSemana[]
    },
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
