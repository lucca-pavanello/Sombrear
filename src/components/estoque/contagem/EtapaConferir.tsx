import { useMemo } from 'react'
import { Plus, Trash2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/primitives'
import { tabela, campoCompacto } from '@/components/shared/estilos'
import SeletorMaterial, { unidadeLabel } from '@/components/estoque/SeletorMaterial'
import type { EstoqueProduto } from '@/lib/supabase'
import {
  diferenca, formatarNumero, linhaManual, podeIncluir, problemaDaLinha,
  type LinhaContagem, type Resumo,
} from '@/lib/estoque/contagem'

interface Props {
  linhas: LinhaContagem[]
  onChange: (linhas: LinhaContagem[]) => void
  ilegivel: string[]
  produtos: EstoqueProduto[]
  resumo: Resumo
  onVoltar: () => void
  onContinuar: () => void
}

const ROTULO_CONFIANCA = { baixa: 'Confiança baixa', media: 'Confiança média', alta: '' } as const

export default function EtapaConferir({ linhas, onChange, ilegivel, produtos, resumo, onVoltar, onContinuar }: Props) {
  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos])

  function atualizar(uid: string, patch: Partial<LinhaContagem>) {
    onChange(linhas.map((l) => {
      if (l.uid !== uid) return l
      const prox = { ...l, ...patch }
      const eraValida = podeIncluir(l)
      const ficouValida = podeIncluir(prox)
      // linha que deixa de ser válida sai da contagem; a que passa a ser válida entra
      if (!ficouValida) prox.incluir = false
      else if (!eraValida && !('incluir' in patch)) prox.incluir = true
      return prox
    }))
  }

  const nomesDuplicados = [...resumo.duplicados].map((id) => porId.get(id)?.nome ?? id)
  const baixas = linhas.filter((l) => l.confianca === 'baixa').length

  return (
    <div className="space-y-4">
      {ilegivel.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> A leitura não conseguiu ver
          </p>
          <ul className="mt-1 list-disc pl-6 text-xs text-muted-foreground">
            {ilegivel.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">Confira o caderno e adicione essas linhas à mão se precisar.</p>
        </div>
      )}

      {nomesDuplicados.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 px-3 py-2.5 text-sm text-destructive">
          Material repetido em mais de uma linha: <strong>{nomesDuplicados.join(', ')}</strong>. Desmarque ou remova uma das linhas de cada para continuar.
        </div>
      )}

      {baixas > 0 && (
        <p className="text-xs text-muted-foreground">
          {baixas} linha{baixas > 1 ? 's' : ''} com confiança baixa aparece{baixas > 1 ? 'm' : ''} primeiro. Confira o número com o caderno.
        </p>
      )}

      <div className={tabela.container}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className={tabela.theadRow}>
                <th className={cn(tabela.th, 'w-10')} scope="col"><span className="sr-only">Incluir</span></th>
                <th className={tabela.th} scope="col">No caderno</th>
                <th className={cn(tabela.th, 'min-w-[240px]')} scope="col">Material</th>
                <th className={cn(tabela.th, 'text-right')} scope="col">Saldo no sistema</th>
                <th className={cn(tabela.th, 'text-right')} scope="col">Contado</th>
                <th className={cn(tabela.th, 'text-right')} scope="col">Diferença</th>
                <th className={cn(tabela.th, 'w-10')} scope="col"><span className="sr-only">Remover</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr><td colSpan={7} className={tabela.vazio}>Nenhuma linha lida. Adicione as linhas à mão ou volte e tire outra foto.</td></tr>
              )}
              {linhas.map((l) => {
                const p = porId.get(l.materialId)
                const dif = p ? diferenca(l.contado, p.quantidade_atual) : null
                const problema = problemaDaLinha(l, resumo.duplicados)
                const baixa = l.confianca === 'baixa'
                const unid = unidadeLabel(p?.unidade)
                return (
                  <tr key={l.uid} className={cn(tabela.tr, !l.incluir && 'opacity-60')}>
                    <td className={cn(tabela.td, baixa && 'border-l-2 border-l-amber-500')}>
                      <input
                        type="checkbox"
                        checked={l.incluir}
                        disabled={!podeIncluir(l)}
                        onChange={(e) => atualizar(l.uid, { incluir: e.target.checked })}
                        aria-label="Incluir esta linha na contagem"
                        className="h-4 w-4 accent-primary"
                      />
                    </td>
                    <td className={cn(tabela.td, 'max-w-[220px]')}>
                      {l.manual ? (
                        <span className="text-xs text-muted-foreground">Adicionada à mão</span>
                      ) : (
                        <span className="block font-medium">{l.textoLido || '—'}</span>
                      )}
                      {l.confianca !== 'alta' && (
                        <span className={cn('mt-0.5 block text-[11px] font-semibold', baixa ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                          {ROTULO_CONFIANCA[l.confianca]}
                        </span>
                      )}
                      {l.observacao && <span className="mt-0.5 block text-[11px] text-muted-foreground">{l.observacao}</span>}
                    </td>
                    <td className={tabela.td}>
                      <SeletorMaterial
                        produtos={produtos}
                        value={l.materialId}
                        mostrarSaldo={false}
                        invalido={problema === 'sem_material' || problema === 'duplicado'}
                        placeholder="Escolher material…"
                        onChange={(id) => atualizar(l.uid, { materialId: id })}
                      />
                      {problema === 'duplicado' && <span className="mt-1 block text-[11px] font-semibold text-destructive">Material repetido</span>}
                      {problema === 'sem_material' && l.incluir === false && !l.manual && (
                        <span className="mt-1 block text-[11px] text-muted-foreground">Não casou com nenhum material</span>
                      )}
                    </td>
                    <td className={cn(tabela.td, 'text-right tabular-nums whitespace-nowrap')}>
                      {p ? `${formatarNumero(Number(p.quantidade_atual) || 0)} ${unid}` : '—'}
                    </td>
                    <td className={cn(tabela.td, 'text-right')}>
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={l.contado}
                          onChange={(e) => atualizar(l.uid, { contado: e.target.value })}
                          aria-label="Quantidade contada"
                          aria-invalid={problema === 'sem_quantidade'}
                          placeholder="0"
                          className={cn(campoCompacto, 'w-24 text-right tabular-nums', problema === 'sem_quantidade' && 'border-destructive')}
                        />
                        {unid && <span className="text-xs text-muted-foreground w-6 text-left">{unid}</span>}
                      </div>
                    </td>
                    <td className={cn(tabela.td, 'text-right tabular-nums whitespace-nowrap font-semibold',
                      dif === null || dif === 0 ? 'text-muted-foreground' : dif > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                      {dif === null ? '—' : dif === 0 ? 'igual' : `${dif > 0 ? '+' : ''}${formatarNumero(dif)} ${unid}`}
                    </td>
                    <td className={tabela.td}>
                      <button
                        type="button"
                        onClick={() => onChange(linhas.filter((x) => x.uid !== l.uid))}
                        aria-label="Remover linha"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={() => onChange([...linhas, linhaManual()])}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Adicionar linha
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-sm">
          <p className="font-semibold tabular-nums">
            {resumo.ajustes.length} {resumo.ajustes.length === 1 ? 'material será ajustado' : 'materiais serão ajustados'}, {resumo.semMudanca} sem mudança
          </p>
          {resumo.bloqueadas > 0 && (
            <p className="text-xs text-destructive">
              {resumo.bloqueadas} linha{resumo.bloqueadas > 1 ? 's marcadas têm' : ' marcada tem'} problema (material repetido ou número inválido).
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onVoltar}>Voltar às fotos</Button>
          <Button onClick={onContinuar} disabled={resumo.ajustes.length === 0 || resumo.bloqueadas > 0}>
            Revisar e salvar
          </Button>
        </div>
      </div>
    </div>
  )
}
