import { useState, Suspense } from 'react'
import { lazyComRecarga } from '@/lib/lazyComRecarga'
import { cn } from '@/lib/utils'
import { segmentado } from '@/components/shared/estilos'
import type { ToastType } from '@/hooks/useToast'
import TabCalculoCusto from '@/components/tabs/TabCalculoCusto'

// Só baixa o catálogo (e roda as consultas dele) quando a seção abre.
const CatalogoCustosView = lazyComRecarga(() => import('@/components/estoque/CatalogoCustosView'))

/**
 * Orçamentos › Custos: o custo de compra dos materiais e o custo de cada
 * orçamento no mesmo lugar (pedido do Lucca, 27/10). O catálogo morava em
 * Estoque › Custos, mas é custo, não estoque físico.
 *
 * Materiais é só do admin: a aba Orçamentos é aberta por vendedor, e custo
 * de compra por loja não é coisa de vendedor. Quem não é admin vê só a
 * planilha de sempre, sem seletor.
 */

interface Props {
  podeVerMateriais: boolean
  isLoading?: boolean
  error?: boolean
  toast: (type: ToastType, message: string) => void
}

type Secao = 'materiais' | 'orcamentos'

export default function TabCustos({ podeVerMateriais, isLoading, error, toast }: Props) {
  const [secao, setSecao] = useState<Secao>('materiais')

  if (!podeVerMateriais) return <TabCalculoCusto isLoading={isLoading} error={error} toast={toast} />

  return (
    <div className="space-y-4">
      <div className={cn(segmentado.trilho, 'mx-auto w-fit')}>
        {([['materiais', 'Materiais'], ['orcamentos', 'Custos por orçamento']] as const).map(([id, rotulo]) => (
          <button key={id} onClick={() => setSecao(id)} aria-pressed={secao === id}
            className={cn(segmentado.item, secao === id ? segmentado.ativo : segmentado.inativo)}>
            {rotulo}
          </button>
        ))}
      </div>

      {secao === 'materiais' ? (
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted/40" />}>
          <CatalogoCustosView toast={toast} />
        </Suspense>
      ) : (
        <TabCalculoCusto isLoading={isLoading} error={error} toast={toast} />
      )}
    </div>
  )
}
