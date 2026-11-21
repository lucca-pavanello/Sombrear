import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { lerTudo } from '@/lib/lerTudo'
import { conversasDasMensagens, type Conversa, type Mensagem } from '@/lib/conversas/lista'
import { destravarSom, minhaVez, somLigado, tocarAviso } from '@/lib/conversas/som'

/**
 * Aba Conversas: a tela lê o espelho do Chatwoot (`conversas_sombrear` e `mensagens_sombrear`)
 * e toda escrita passa pela edge function `conversas`. Mesmo padrão do useAgenteIA: React Query,
 * um canal Realtime que invalida as consultas e polling de reserva caso o canal caia.
 */

const CHAVE_LISTA = ['conversas'] as const
const chaveMensagens = (id: number) => ['conversas-mensagens', id] as const

/** quantos dias de mensagens a lista provisória lê enquanto o banco não tem a view */
const DIAS_SEM_VIEW = 30

/** o PostgREST não achou a view: a migration 0039 ainda não foi aplicada neste banco */
const viewAusente = (e: unknown) => {
  const codigo = (e as { code?: string } | null)?.code
  return codigo === 'PGRST205' || codigo === '42P01'
}

async function lerSemView(): Promise<Conversa[]> {
  const desde = new Date(Date.now() - DIAS_SEM_VIEW * 86_400_000).toISOString()
  const [mensagens, leads] = await Promise.all([
    lerTudo<Mensagem>((de, ate) => supabase
      .from('mensagens_sombrear')
      .select('id, conversa_id, lead_id, telefone, autor, autor_nome, canal_envio, privada, conteudo, anexos, excluida, enviada_em')
      .gte('enviada_em', desde)
      .order('enviada_em', { ascending: false })
      .order('id')
      .range(de, ate)),
    lerTudo<{ id: string; nome: string | null; chatwoot_labels: string | null; precisa_humano: string | null }>((de, ate) => supabase
      .from('crm_sombrear_ia')
      .select('id, nome, chatwoot_labels, precisa_humano')
      .order('id')
      .range(de, ate)),
  ])
  return conversasDasMensagens(mensagens, leads)
}

export type ListaConversas = {
  conversas: Conversa[]
  /** true = banco sem a 0039: lista montada das mensagens dos últimos 30 dias, sem encerradas nem não lidas */
  provisoria: boolean
}

export function useConversas({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: CHAVE_LISTA,
    enabled,
    queryFn: async (): Promise<ListaConversas> => {
      try {
        const conversas = await lerTudo<Conversa>((de, ate) => supabase
          .from('conversas_sombrear')
          .select('*')
          .order('ultima_mensagem_em', { ascending: false })
          .order('conversa_id')
          .range(de, ate))
        return { conversas, provisoria: false }
      } catch (e) {
        if (!viewAusente(e)) throw e
        const conversas = await lerSemView()
        conversas.sort((a, b) => Date.parse(b.ultima_mensagem_em) - Date.parse(a.ultima_mensagem_em))
        return { conversas, provisoria: true }
      }
    },
    retry: 1,
    refetchOnWindowFocus: false,
    // reserva caso o realtime caia (ou ainda não esteja ligado na tabela)
    refetchInterval: 60_000,
  })
}

/** as mensagens de uma conversa, da mais antiga para a mais nova; nota interna do Chatwoot fica de fora */
export function useMensagens(conversaId: number | null) {
  return useQuery({
    queryKey: chaveMensagens(conversaId ?? 0),
    enabled: conversaId != null,
    queryFn: () => lerTudo<Mensagem>((de, ate) => supabase
      .from('mensagens_sombrear')
      .select('*')
      .eq('conversa_id', conversaId!)
      .eq('privada', false)
      .order('enviada_em')
      .order('id')
      .range(de, ate)),
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: 20_000,
  })
}

/**
 * O canal da aba, ligado no Dashboard para quem tem acesso: mensagem nova atualiza a lista e a
 * conversa aberta em qualquer tela do dash; mensagem do CLIENTE chama `aoReceber` (contador no
 * título) e toca o aviso, uma vez por rajada e em uma aba só.
 */
export function useConversasAoVivo({ enabled = true, aoReceber }: {
  enabled?: boolean
  aoReceber?: (m: Mensagem) => void
} = {}) {
  const qc = useQueryClient()
  const aoReceberRef = useRef(aoReceber)
  aoReceberRef.current = aoReceber

  useEffect(() => {
    if (!enabled) return
    // o navegador só libera som depois de um gesto: o primeiro clique ou tecla destrava
    window.addEventListener('pointerdown', destravarSom)
    window.addEventListener('keydown', destravarSom)
    const canal = supabase
      .channel('conversas-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensagens_sombrear' }, (p) => {
        const m = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<Mensagem>
        qc.invalidateQueries({ queryKey: CHAVE_LISTA })
        if (m.conversa_id) qc.invalidateQueries({ queryKey: chaveMensagens(m.conversa_id) })
        if (p.eventType !== 'INSERT' || m.autor !== 'cliente' || m.privada) return
        aoReceberRef.current?.(m as Mensagem)
        if (somLigado() && minhaVez()) void tocarAviso()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversas_estado' },
        () => qc.invalidateQueries({ queryKey: CHAVE_LISTA }))
      .subscribe()
    return () => {
      window.removeEventListener('pointerdown', destravarSom)
      window.removeEventListener('keydown', destravarSom)
      void supabase.removeChannel(canal)
    }
  }, [qc, enabled])
}

// ── escrita: sempre pela edge function `conversas` ───────────────────────────

const ERRO_PADRAO = 'Não deu certo agora. Tente de novo.'

/** chama a function e devolve o corpo; a frase do erro vem do servidor, já em português */
async function chamar<T extends Record<string, unknown>>(body: Record<string, unknown> | FormData): Promise<T> {
  const { data, error } = await supabase.functions.invoke('conversas', { body })
  if (error) {
    let frase = ERRO_PADRAO
    try {
      const corpo = await (error as { context?: Response }).context?.json()
      if (typeof corpo?.erro === 'string') frase = corpo.erro
    } catch { /* resposta sem JSON: fica a frase padrão */ }
    throw new Error(frase)
  }
  if (!data || data.ok === false) throw new Error(typeof data?.erro === 'string' ? data.erro : ERRO_PADRAO)
  return data as T
}

export type Envio = { conversaId: number; texto?: string; arquivo?: File; voz?: boolean }

/** texto, ou arquivo com legenda; `voz` marca o áudio gravado. Enviar pausa a IA na conversa. */
export function useEnviarMensagem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversaId, texto = '', arquivo, voz }: Envio) => {
      if (!arquivo) return chamar({ acao: 'enviar', conversa_id: conversaId, texto })
      const form = new FormData()
      form.append('acao', 'enviar')
      form.append('conversa_id', String(conversaId))
      if (texto.trim()) form.append('texto', texto.trim())
      if (voz) form.append('voz', '1')
      form.append('arquivo', arquivo, arquivo.name)
      return chamar(form)
    },
    onSuccess: (_d, { conversaId }) => {
      qc.invalidateQueries({ queryKey: chaveMensagens(conversaId) })
      qc.invalidateQueries({ queryKey: CHAVE_LISTA })
    },
  })
}

export function useAlternarIA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversaId, ligada }: { conversaId: number; ligada: boolean }) =>
      chamar({ acao: 'ia', conversa_id: conversaId, ligada }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_LISTA }),
  })
}

export function useEncerrarConversa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (conversaId: number) => chamar({ acao: 'encerrar', conversa_id: conversaId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_LISTA }),
  })
}

/** lida ou não lida, para quem está logado (tabela `conversas_lidas`, uma linha por pessoa e conversa) */
export function useMarcarLeitura(userId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ conversaId, naoLida }: { conversaId: number; naoLida: boolean }) => {
      if (!userId) return
      const { error } = await supabase.from('conversas_lidas').upsert(
        { conversa_id: conversaId, user_id: userId, nao_lida: naoLida, ...(naoLida ? {} : { lida_em: new Date().toISOString() }) },
        { onConflict: 'conversa_id,user_id' })
      if (error) throw error
    },
    // a lista já muda antes da resposta: abrir a conversa apaga o ponto na hora
    onMutate: ({ conversaId, naoLida }) => {
      qc.setQueryData<ListaConversas>(CHAVE_LISTA, (antes) => antes && {
        ...antes, conversas: antes.conversas.map(c => c.conversa_id === conversaId ? { ...c, nao_lida: naoLida } : c),
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE_LISTA }),
  })
}
