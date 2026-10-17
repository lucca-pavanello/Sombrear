export type NivelConfirmacao = 1 | 2 | 3

export type RoleMensagem = 'user' | 'assistant' | 'system' | 'tool'

export interface MensagemChat {
  id: string
  role: RoleMensagem
  content: string
  timestamp: Date
  toolCall?: {
    nome: string
    args: Record<string, unknown>
    nivelConfirmacao: NivelConfirmacao
    confirmada?: boolean
    executada?: boolean
    resultado?: unknown
  }
}

export interface ChatContextoEstoque {
  gerado_em: string
  resumo: {
    total_produtos_ativos: number
    valor_total_estoque: number
    unidades_em_estoque: number
    produtos_classe_a: number
    produtos_classe_b: number
    produtos_classe_c: number
    produtos_sem_dados: number
    produtos_sem_localizacao: number
  }
  giro: {
    giro_reais: number
    estoque_atual_reais: number
    vendas_reais_12m: number
  }
  top_produtos_por_valor: Array<{
    sku: string
    nome: string
    classificacao_abc: string
    estoque_atual: number
    custo_unitario: number
  }>
  sugestoes_compra: Array<{
    sku: string
    nome: string
    urgencia: string
    estoque_atual: number
    lec_sugerido: number
    fornecedor_nome: string
  }>
  produtos_parados: Array<{
    sku: string
    nome: string
    dias_em_estoque: number
    valor_parado_reais: number
  }>
  fornecedores: Array<{ id: string; nome: string; lead_time_dias: number }>
  localizacoes: Array<{ id: string; codigo: string; setor: string; nivel_acesso: string }>
  /**
   * `estoque_produtos.categoria_id` é NOT NULL, então sem esta lista a IA não
   * tem como cadastrar produto nenhum. Entrou na RPC em 17/10/2026.
   */
  categorias: Array<{ id: string; nome: string; tipo: string }>
  configuracoes: Record<string, string>
}
