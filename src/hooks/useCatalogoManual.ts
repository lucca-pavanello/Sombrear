import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  referenciaManual,
  hojeIso,
  validarCorrecao,
  type CorrecaoCusto,
} from '@/lib/catalogo/manual'

/**
 * Escrita no catálogo de custos. As leituras ficam em useCatalogoCustos.ts.
 *
 * Toda gravação aqui confere PERSISTÊNCIA, não a resposta da chamada: pede
 * `.select()` e trata zero linhas como erro. Sem isso, uma linha barrada pela
 * RLS volta como 204 com zero linhas e `error === null`, e a tela diz
 * "Salvo!" sem ter salvado nada. Foi exatamente assim que o Semanário passou
 * semanas deixando a venda sumir sem avisar.
 */

export function useSalvarCustoManual() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (c: CorrecaoCusto) => {
      const problema = validarCorrecao(c)
      if (problema) throw new Error(problema)

      const dia = hojeIso()
      const referencia = referenciaManual(c.fornecedorNome, dia)

      // 1. O documento manual DO DIA. O upsert faz o segundo ajuste do mesmo
      //    dia cair no mesmo documento, em vez de criar outro.
      const { data: docs, error: eDoc } = await supabase
        .from('catalogo_documentos')
        .upsert(
          {
            fornecedor_id: c.fornecedorId,
            tipo: 'lista_manual',
            referencia,
            data_documento: dia,
            observacoes: 'Custos informados pela loja, sem documento do fornecedor.',
          },
          { onConflict: 'fornecedor_id,referencia' }
        )
        .select('id')
      if (eDoc) throw eDoc
      if (!docs || docs.length === 0) {
        throw new Error('Não deu para abrir a lista manual deste fornecedor — nada foi gravado.')
      }
      const documentoId = docs[0].id as string

      // 2. Um registro por produto por dia: corrigir duas vezes no mesmo dia
      //    substitui, não empilha.
      const base = supabase.from('catalogo_itens').delete().eq('documento_id', documentoId)
      const { error: eDel } = c.codigoFornecedor
        ? await base.eq('codigo_fornecedor', c.codigoFornecedor)
        : await base.eq('descricao', c.descricao.trim())
      if (eDel) throw eDel

      // Quantidade 1 mantém verdadeira a invariante do catálogo
      // (quantidade × custo = subtotal) sem inventar uma compra que não houve.
      const { data: itens, error: eIns } = await supabase
        .from('catalogo_itens')
        .insert({
          documento_id: documentoId,
          codigo_fornecedor: c.codigoFornecedor,
          descricao: c.descricao.trim(),
          categoria: c.categoria,
          cor: c.cor,
          largura_m: c.larguraM,
          quantidade_documento: 1,
          unidade_documento: c.unidadeCanonica.toUpperCase(),
          preco_bruto: c.custoUnitario,
          desconto_pct: 0,
          preco_liquido: c.custoUnitario,
          subtotal: Math.round(c.custoUnitario * 100) / 100,
          unidade_canonica: c.unidadeCanonica,
          quantidade_canonica: 1,
          custo_unitario: c.custoUnitario,
          observacao: c.motivo?.trim() || null,
        })
        .select('id')
      if (eIns) throw eIns
      if (!itens || itens.length === 0) {
        throw new Error(
          'O banco não confirmou a gravação, então o custo NÃO foi alterado. ' +
            'Pode ser falta de permissão de administrador.'
        )
      }
      return itens[0].id as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalogo-custo-vigente'] })
      qc.invalidateQueries({ queryKey: ['catalogo-historico'] })
    },
  })
}

/** Fornecedores ativos, para o seletor da correção. */
export function useFornecedoresCatalogo() {
  return useQuery({
    queryKey: ['catalogo-fornecedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estoque_fornecedores')
        .select('id, nome')
        .eq('ativo', true)
        .order('nome')
      if (error) throw error
      return (data ?? []) as { id: string; nome: string }[]
    },
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
