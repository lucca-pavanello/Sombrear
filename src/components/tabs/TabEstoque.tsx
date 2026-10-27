import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEstoqueProdutos, useEstoqueProdutosAlerta } from '@/hooks/useEstoqueProdutos'
import { useProfile } from '@/hooks/useProfile'
import EstoqueDashboard from '@/components/estoque/dashboard/EstoqueDashboard'
import EstoqueProdutosTable from '@/components/estoque/EstoqueProdutosTable'
import NovoProdutoForm from '@/components/estoque/NovoProdutoForm'
import NovaMovimentacaoForm from '@/components/estoque/NovaMovimentacaoForm'
import FornecedoresTable from '@/components/estoque/FornecedoresTable'
import EntradaRapidaForm from '@/components/estoque/EntradaRapidaForm'
import EntradasHistoricoTable from '@/components/estoque/EntradasHistoricoTable'
import LocalizacoesTable from '@/components/estoque/LocalizacoesTable'
import SobrasTable from '@/components/estoque/SobrasTable'
import MercadoLivreView from '@/components/estoque/MercadoLivreView'
import AnalisesView from '@/components/estoque/AnalisesView'
import AcoesView from '@/components/estoque/AcoesView'
import SugestaoCompraView from '@/components/estoque/sugestao/SugestaoCompraView'
import RegistroVendasView from '@/components/estoque/RegistroVendasView'
import VendaDetalheView from '@/components/estoque/VendaDetalheView'
import LeadTimeView from '@/components/estoque/LeadTimeView'
import PontoPedidoView from '@/components/estoque/PontoPedidoView'
import MoverItensView from '@/components/estoque/MoverItensView'
import ConfiguracaoView from '@/components/estoque/ConfiguracaoView'
import { ChatTrigger } from '@/components/estoque/chat/ChatTrigger'
import { ChatDrawer } from '@/components/estoque/chat/ChatDrawer'
import { ConfirmacaoAcao } from '@/components/estoque/chat/ConfirmacaoAcao'
import { isAIEstoqueEnabled } from '@/components/estoque/chat/featureFlag'
import type { EstoqueProduto, EstoqueProdutoAlerta } from '@/lib/supabase'
import type { ToastType } from '@/hooks/useToast'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type TipoMov = 'entrada' | 'saida' | 'ajuste' | 'perda'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  toast: (type: ToastType, message: string) => void
  resetKey?: number
  subTab: string
}

// ─── Componente principal ─────────────────────────────────────────────────────

const SUBTAB_ORDER = ['visao-geral', 'entradas', 'vendas', 'produtos', 'fornecedores', 'localizacoes', 'sobras', 'mercado-livre', 'analises', 'acoes', 'configuracao', 'lead-time', 'mover', 'sugestao', 'ponto-pedido']

export default function TabEstoque({ toast, subTab }: Props) {
  const navigate = useNavigate()
  function goTo(sub: string) { navigate(`/estoque/${sub}`) }

  // Subtab slide direction
  const prevSubRef = useRef(subTab)
  const [subDir, setSubDir] = useState<'right' | 'left'>('right')
  useEffect(() => {
    const prev = prevSubRef.current
    if (prev === subTab) return
    const prevIdx = SUBTAB_ORDER.indexOf(prev)
    const nextIdx = SUBTAB_ORDER.indexOf(subTab)
    setSubDir(nextIdx >= prevIdx ? 'right' : 'left')
    prevSubRef.current = subTab
  }, [subTab])

  // Modal states
  const [novoProdutoOpen, setNovoProdutoOpen] = useState(false)
  const [editandoProduto, setEditandoProduto] = useState<EstoqueProduto | null>(null)
  const [movOpen, setMovOpen] = useState(false)
  const [movTipo, setMovTipo] = useState<TipoMov>('entrada')
  const [movProduto, setMovProduto] = useState<EstoqueProduto | null>(null)
  const [vendaDetalheId, setVendaDetalheId] = useState<string | null>(null)

  // Data
  const { data: produtos = [] } = useEstoqueProdutos()
  const { data: alertas = [] } = useEstoqueProdutosAlerta()
  const { data: profile } = useProfile()

  const responsavel = profile?.full_name ?? profile?.email ?? 'Usuário'
  const userId = profile?.id

  function handleNovoProduto() {
    setEditandoProduto(null)
    setNovoProdutoOpen(true)
  }

  function handleEditarProduto(p: EstoqueProduto) {
    setEditandoProduto(p)
    setNovoProdutoOpen(true)
  }

  function handleMovimentar(p: EstoqueProduto | EstoqueProdutoAlerta, tipo: TipoMov) {
    setMovProduto(p as EstoqueProduto)
    setMovTipo(tipo)
    setMovOpen(true)
  }

  return (
    <div className="space-y-5">
      <div key={subTab} className={subDir === 'right' ? 'tab-active-right' : 'tab-active-left'}>
      {/* ── Drill-down breadcrumb (para lead-time / mover / sugestao) ── */}
      {(subTab === 'lead-time' || subTab === 'mover' || subTab === 'sugestao' || subTab === 'ponto-pedido') && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <button
            onClick={() => goTo('acoes')}
            className="hover:text-foreground hover:underline transition-colors"
          >
            Ações
          </button>
          <span>/</span>
          <span className="text-foreground font-medium">
            {subTab === 'lead-time' ? 'O que está parado' :
             subTab === 'mover' ? 'Como reorganizar' :
             subTab === 'ponto-pedido' ? 'Quando comprar' :
             'O que comprar agora'}
          </span>
        </div>
      )}

      {/* ── Conteúdo ── */}

      {subTab === 'visao-geral' && (
        <EstoqueDashboard
          toast={toast}
          produtos={produtos}
          alertas={alertas}
          onMovimentar={handleMovimentar}
          onNavigateToLeadTime={() => goTo('acoes')}
          onNavigateToAnalises={() => goTo('analises')}
          onNavigateToSugestao={() => goTo('acoes')}
          onNavigateToLocalizacoes={() => goTo('localizacoes')}
        />
      )}

      {subTab === 'analises' && <AnalisesView toast={toast} />}

      {subTab === 'acoes' && <AcoesView onDrillDown={(st) => goTo(st)} />}

      {subTab === 'produtos' && (
        <div className="space-y-5">
          <div>
            <h3 className="font-display text-sm font-semibold">Produtos</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cadastre tudo que você vende. Cada produto vira uma 'ficha' que o sistema usa pra todos os cálculos.
            </p>
          </div>
          <EstoqueProdutosTable
            toast={toast}
            onNovoProduto={handleNovoProduto}
            onEditar={handleEditarProduto}
            onMovimentar={handleMovimentar}
          />
        </div>
      )}

      {subTab === 'fornecedores' && (
        <div className="space-y-5">
          <div>
            <h3 className="font-display text-sm font-semibold">Fornecedores</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Quem te vende as matérias-primas. O tempo de entrega de cada um afeta os cálculos de quando comprar.
            </p>
          </div>
          <FornecedoresTable toast={toast} />
        </div>
      )}

      {subTab === 'localizacoes' && (
        <div className="space-y-5">
          <div>
            <h3 className="font-display text-sm font-semibold">Localizações</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Os lugares físicos da sua loja. Use isso pra organizar onde cada produto fica.
            </p>
          </div>
          <LocalizacoesTable toast={toast} />
        </div>
      )}

      {subTab === 'sobras' && (
        <div className="space-y-5">
          <div>
            <h3 className="font-display text-sm font-semibold">Sobras</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Peças que sobraram de produção e não vão ser refeitas — é a última unidade de cada uma.
              Filtre por largura e altura pra achar o que serve no cliente. As medidas são da peça
              pronta, não do vão: já saem no tamanho final, sem acréscimo.
            </p>
          </div>
          <SobrasTable toast={toast} />
        </div>
      )}

      {subTab === 'mercado-livre' && (
        <div className="space-y-5">
          <div>
            <h3 className="font-display text-sm font-semibold">Mercado Livre</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Preparação dos anúncios das sobras. Cada tecido precisa de preço e das 4 fotos —
              definidos uma vez por tecido e valendo para todas as peças dele. Publicar de verdade
              ainda depende da credencial do Mercado Livre.
            </p>
          </div>
          <MercadoLivreView toast={toast} />
        </div>
      )}

      {subTab === 'entradas' && (
        <div className="space-y-5">
          <div className="text-center">
            <h3 className="font-display text-base font-semibold">Entradas</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Toda compra que chega na loja. O estoque sobe automaticamente.
            </p>
          </div>
          <EntradaRapidaForm toast={toast} />
          <EntradasHistoricoTable />
        </div>
      )}

      {subTab === 'vendas' && (
        vendaDetalheId
          ? <VendaDetalheView vendaId={vendaDetalheId} onVoltar={() => setVendaDetalheId(null)} />
          : (
            <div className="space-y-5">
              <div className="text-center">
                <h3 className="font-display text-base font-semibold">Vendas</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Registre vendas com um ou mais itens. O estoque desce automaticamente.
                </p>
              </div>
              <RegistroVendasView toast={toast} responsavel={responsavel} userId={userId} onVerDetalhe={setVendaDetalheId} />
            </div>
          )
      )}

      {/* Drill-downs de Análises */}
      {subTab === 'lead-time'    && <LeadTimeView toast={toast} />}
      {subTab === 'mover'        && <MoverItensView toast={toast} />}
      {subTab === 'sugestao'     && <SugestaoCompraView toast={toast} />}
      {subTab === 'ponto-pedido' && <PontoPedidoView toast={toast} />}

      {subTab === 'configuracao' && (
        <div className="space-y-5">
          <div className="text-center">
            <h3 className="font-display text-base font-semibold">Configurações</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Parâmetros que afetam os cálculos do sistema. Mude com cuidado.
            </p>
          </div>
          <ConfiguracaoView toast={toast} />
        </div>
      )}
      </div>

      {/* ── Modais ── */}
      <NovoProdutoForm
        open={novoProdutoOpen}
        onClose={() => { setNovoProdutoOpen(false); setEditandoProduto(null) }}
        toast={toast}
        editando={editandoProduto}
        responsavel={responsavel}
      />

      <NovaMovimentacaoForm
        open={movOpen}
        onClose={() => { setMovOpen(false); setMovProduto(null) }}
        toast={toast}
        tipoInicial={movTipo}
        produtoInicial={movProduto}
        responsavel={responsavel}
        userId={userId}
      />

      {isAIEstoqueEnabled() && (
        <>
          <div className="flex justify-end">
            <ChatTrigger />
          </div>
          <ChatDrawer />
          <ConfirmacaoAcao />
        </>
      )}
    </div>
  )
}
