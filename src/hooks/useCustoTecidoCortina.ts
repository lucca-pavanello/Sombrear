import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { usePrecosCortinaTecidos } from '@/hooks/usePrecos'
import { useCustosVigentes } from '@/hooks/useCatalogoCustos'

/**
 * A ponte entre o que a loja COBRA pelo tecido e o que ela PAGA por ele.
 *
 * Os dois lados não se reconhecem pelo nome: a calculadora diz
 * "Microfibra 90g (3,00m)" e o fornecedor diz "MICROFIBRA 3.00M BEGE".
 * Rodei o resolvedor do catálogo sobre os 12 tecidos de venda contra os 9 do
 * catálogo e deu NENHUM nos 12 — por isso a ligação é dita pela loja e
 * guardada em `precos_cortina_tecidos.catalogo_*`.
 *
 * A junção é por fornecedor + descrição (+ código, quando existe), que é a
 * chave da view `catalogo_custo_vigente`. NÃO é por id de linha: cada
 * correção de custo cria uma linha nova, e um id guardado apontaria para o
 * custo velho no instante seguinte. Juntando pela chave, a correção de hoje
 * chega sozinha aqui.
 */

export interface CustoDeCompra {
  custoPorMetro: number
  fornecedor: string | null
  descricao: string
  /** De onde veio o número: pedido do fornecedor ou correção da loja. */
  referencia: string
  dataDocumento: string | null
}

export function useCustoTecidoCortina() {
  const { data: tecidos } = usePrecosCortinaTecidos()
  const { data: custos } = useCustosVigentes()

  /** Nome do tecido de venda → custo de compra, só para os ligados. */
  const porNome = useMemo(() => {
    const mapa = new Map<string, CustoDeCompra>()
    if (!tecidos?.length || !custos?.length) return mapa

    for (const t of tecidos) {
      // Fornecedor pode ser nulo: a lista de preços que a dona passou não diz
      // de quem são os materiais, e eles valem como custo do mesmo jeito.
      // O que não pode faltar é a descrição — sem ela não há o que procurar.
      if (!t.catalogo_descricao) continue
      const achado = custos.find(
        c =>
          (c.fornecedor_id ?? null) === (t.catalogo_fornecedor_id ?? null) &&
          c.descricao === t.catalogo_descricao &&
          (!t.catalogo_codigo || c.codigo_fornecedor === t.catalogo_codigo)
      )
      // Ligação apontando para material que saiu do catálogo não vira custo
      // zero: fica de fora, e a tela mostra "sem custo ligado".
      if (!achado) continue
      mapa.set(t.nome, {
        custoPorMetro: achado.custo_unitario,
        fornecedor: achado.fornecedor,
        descricao: achado.descricao,
        referencia: achado.referencia,
        dataDocumento: achado.data_documento,
      })
    }
    return mapa
  }, [tecidos, custos])

  return { porNome, tecidos: tecidos ?? [] }
}

export interface LigacaoTecido {
  tecidoId: number
  /** null desliga a ligação. */
  fornecedorId: string | null
  descricao: string | null
  codigo: string | null
}

/** Grava a ligação. Com `.select()` e zero linhas tratado como erro. */
export function useLigarTecidoAoCatalogo() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (l: LigacaoTecido) => {
      const { data, error } = await supabase
        .from('precos_cortina_tecidos')
        .update({
          catalogo_fornecedor_id: l.fornecedorId,
          catalogo_descricao: l.descricao,
          catalogo_codigo: l.codigo,
        })
        .eq('id', l.tecidoId)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) {
        throw new Error(
          'O banco não confirmou a gravação, então a ligação NÃO foi salva. ' +
            'Pode ser falta de permissão de administrador.'
        )
      }
      return data[0].id as number
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['precos', 'precos_cortina_tecidos'] })
    },
  })
}
