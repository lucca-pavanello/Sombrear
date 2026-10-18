import { useMemo, useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/CustomSelect'
import SectionCard from './shared/SectionCard'
import { useCustosVigentes } from '@/hooks/useCatalogoCustos'
import { useCustoTecidoCortina, useLigarTecidoAoCatalogo } from '@/hooks/useCustoTecidoCortina'
import { formatarMargem, margemDoTecido, sinalDaMargem } from '@/lib/catalogo/margem'
import type { ToastType } from '@/hooks/useToast'

/**
 * Dizer qual material comprado vira cada tecido de venda.
 *
 * Existe porque os dois lados não se reconhecem sozinhos: a calculadora diz
 * "Microfibra 90g (3,00m)" e a nota do fornecedor diz "MICROFIBRA 3.00M
 * BEGE". Rodei o resolvedor do catálogo sobre os 12 tecidos de venda contra
 * os 9 do catálogo: NENHUM dos 12 casou. Afrouxar o casamento seria pior —
 * ele passaria a escolher entre a Microfibra da Corttex (R$ 6,30/m) e a
 * Clássica 3,30 da TA Decor (R$ 13,90/m), que não são o mesmo pano.
 *
 * Então quem sabe diz, uma vez por tecido. A margem aparece na hora, que é
 * como a loja percebe se ligou no material errado.
 */

const SEM_LIGACAO = '__nenhum__'

export default function LigarTecidosVenda({ toast }: { toast: (t: ToastType, m: string) => void }) {
  const { data: custos = [] } = useCustosVigentes()
  const { porNome, tecidos } = useCustoTecidoCortina()
  const ligar = useLigarTecidoAoCatalogo()
  const [salvando, setSalvando] = useState<number | null>(null)

  // Só tecido do catálogo entra na lista: ligar um varão a um tecido de
  // venda seria erro garantido.
  const opcoes = useMemo(() => {
    const doCatalogo = custos
      .filter(c => c.categoria === 'tecido')
      .map(c => ({
        value: `${c.fornecedor_id ?? ''}|${c.descricao}|${c.codigo_fornecedor ?? ''}`,
        label: `${c.descricao} — ${c.fornecedor} — ${formatCusto(c.custo_unitario)}/m`,
      }))
    return [{ value: SEM_LIGACAO, label: 'Sem ligação' }, ...doCatalogo]
  }, [custos])

  const ligados = tecidos.filter(t => porNome.has(t.nome)).length

  if (tecidos.length === 0) return null

  async function escolher(tecidoId: number, nome: string, valor: string) {
    setSalvando(tecidoId)
    try {
      if (valor === SEM_LIGACAO) {
        await ligar.mutateAsync({ tecidoId, fornecedorId: null, descricao: null, codigo: null })
        toast('success', `${nome} ficou sem ligação.`)
      } else {
        const [fornecedorId, descricao, codigo] = valor.split('|')
        await ligar.mutateAsync({
          // Material da lista da loja nao tem fornecedor; a descricao basta.
          tecidoId, fornecedorId: fornecedorId || null, descricao, codigo: codigo || null,
        })
        toast('success', `${nome} agora puxa o custo de ${descricao}.`)
      }
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Não deu para salvar a ligação.')
    } finally {
      setSalvando(null)
    }
  }

  return (
    <SectionCard
      icon={Link2}
      title="Tecido de venda × material comprado"
      subtitle="Ligue uma vez e a calculadora de cortina passa a mostrar a margem"
      badge={{
        label: `${ligados} de ${tecidos.length} ligados`,
        variant: ligados === tecidos.length ? 'info' : 'warning',
      }}
    >
      <div className="px-4 pb-4 pt-1">
        <p className="mb-3 text-xs text-muted-foreground">
          Os nomes não batem sozinhos: a loja chama de “Microfibra 90g (3,00m)” o que a
          Corttex chama de “MICROFIBRA 3.00M BEGE”. Adivinhar aqui custaria caro, então
          quem sabe diz.
        </p>

        <div className="divide-y divide-border/60">
          {tecidos.map(t => {
            const custo = porNome.get(t.nome)
            const m = custo
              ? margemDoTecido(1, Number(t.preco), custo.custoPorMetro)
              : null
            const valor = t.catalogo_descricao
              ? `${t.catalogo_fornecedor_id ?? ''}|${t.catalogo_descricao}|${t.catalogo_codigo ?? ''}`
              : SEM_LIGACAO

            return (
              <div key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 sm:w-56">
                  <div className="truncate text-sm text-foreground">{t.nome}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    vende {formatCusto(Number(t.preco))}/m
                    {t.tipo === 'forro' && ' · forro'}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <CustomSelect
                    value={valor}
                    onChange={v => void escolher(t.id, t.nome, v)}
                    options={opcoes}
                  />
                </div>

                <div className="flex w-28 shrink-0 items-center justify-end gap-2">
                  {salvando === t.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {m && (
                    <span
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        sinalDaMargem(m.margem) === 'ok' && 'text-emerald-600 dark:text-emerald-400',
                        sinalDaMargem(m.margem) === 'apertada' && 'text-amber-600 dark:text-amber-400',
                        sinalDaMargem(m.margem) === 'prejuizo' && 'text-destructive'
                      )}
                      title={`paga ${formatCusto(custo!.custoPorMetro)}/m, cobra ${formatCusto(Number(t.preco))}/m`}
                    >
                      {formatarMargem(m.margem)}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </SectionCard>
  )
}

function formatCusto(v: number): string {
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
