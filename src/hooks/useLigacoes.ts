/**
 * Ligações atendidas pela Amanda de voz (tabela `ligacoes`, 0032; gravação na 0033).
 *
 * Quem grava é a edge function registrar-ligacao quando a ligação termina; aqui é só leitura.
 * A gravação fica no bucket privado `ligacoes-audio` e toca por link assinado, pedido só quando
 * alguém abre a ligação.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export type FalaLigacao = { quem: 'cliente' | 'amanda'; texto: string; em?: string }

export type OrcamentoLigacao = {
  modelo?: string | null; tecido: string; largura: number; altura: number; quantidade?: number | null
  total4x: number; totalAvista: number; instalacao?: number | 'sob_consulta' | null; maisBarato?: boolean
}

export type Ligacao = {
  id: string
  ref: string
  inicio: string
  fim: string | null
  telefone_chamador: string | null
  telefone: string | null
  nome: string | null
  assunto: 'orcamento' | 'duvida' | 'outro' | null
  resumo: string | null
  orcamento: OrcamentoLigacao | null
  transcricao: FalaLigacao[]
  lead_id: string | null
  conversa_chatwoot: string | null
  whatsapp_status: 'pendente' | 'enviado' | 'so_nota' | 'sem_telefone' | 'erro'
  whatsapp_erro: string | null
  /** só existe depois da 0033; antes vem indefinido */
  audio_path?: string | null
}

export const BUCKET_AUDIO = 'ligacoes-audio'
export const LIMITE_LIGACOES = 200

export function useLigacoes() {
  return useQuery({
    queryKey: ['ligacoes'],
    queryFn: async (): Promise<Ligacao[]> => {
      // `*` e não a lista de colunas: antes da 0033 rodar, pedir audio_path quebraria a tela inteira
      const { data, error } = await supabase.from('ligacoes').select('*')
        .order('inicio', { ascending: false })
        .limit(LIMITE_LIGACOES)
      if (error) throw new Error(error.message)
      return (data ?? []).map(l => ({ ...l, transcricao: Array.isArray(l.transcricao) ? l.transcricao : [] })) as Ligacao[]
    },
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

/** link de 1 hora para tocar a gravação; só pede quando há gravação */
export function useAudioLigacao(caminho: string | null | undefined) {
  return useQuery({
    queryKey: ['ligacao-audio', caminho],
    enabled: !!caminho,
    staleTime: 50 * 60_000,
    queryFn: async (): Promise<string> => {
      const { data, error } = await supabase.storage.from(BUCKET_AUDIO).createSignedUrl(caminho!, 3600)
      if (error || !data?.signedUrl) throw new Error(error?.message ?? 'sem link')
      return data.signedUrl
    },
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
