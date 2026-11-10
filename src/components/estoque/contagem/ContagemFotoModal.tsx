import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Camera, CheckCircle2, XCircle, Loader2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/primitives'
import { useFecharNoFundo } from '@/hooks/useFecharNoFundo'
import { useEstoqueProdutos } from '@/hooks/useEstoqueProdutos'
import { useRegistrarMovimentacao } from '@/hooks/useEstoqueMovimentacoes'
import { useLerFotoContagem, type FotoPreparada } from '@/hooks/useContagemFoto'
import { unidadeLabel } from '@/components/estoque/SeletorMaterial'
import { tabela } from '@/components/shared/estilos'
import type { ToastType } from '@/hooks/useToast'
import {
  formatarNumero, linhaDaIA, motivoContagem, ordenarPorConfianca, resumir,
  type Ajuste, type LinhaContagem, type ProdutoContagem,
} from '@/lib/estoque/contagem'
import EtapaFotos from './EtapaFotos'
import EtapaConferir from './EtapaConferir'

type Passo = 'fotos' | 'conferir' | 'salvar'
type EstadoAjuste = 'pendente' | 'fazendo' | 'ok' | 'erro'

const PASSOS: { id: Passo; rotulo: string }[] = [
  { id: 'fotos', rotulo: '1. Fotos' },
  { id: 'conferir', rotulo: '2. Conferir' },
  { id: 'salvar', rotulo: '3. Salvar' },
]

interface Props {
  open: boolean
  onClose: () => void
  toast: (type: ToastType, message: string) => void
  responsavel: string
  userId?: string
}

export default function ContagemFotoModal({ open, onClose, toast, responsavel, userId }: Props) {
  const [passo, setPasso] = useState<Passo>('fotos')
  const [fotos, setFotos] = useState<FotoPreparada[]>([])
  const [linhas, setLinhas] = useState<LinhaContagem[]>([])
  const [ilegivel, setIlegivel] = useState<string[]>([])
  const [salvando, setSalvando] = useState(false)
  const [lote, setLote] = useState<Ajuste[]>([])
  const [estados, setEstados] = useState<Record<string, { estado: EstadoAjuste; msg?: string }>>({})
  const painelRef = useRef<HTMLDivElement>(null)
  const sessaoRef = useRef(0) // descarta respostas de leituras de uma sessão anterior

  const { data: produtos = [] } = useEstoqueProdutos()
  const registrar = useRegistrarMovimentacao()
  const { estado: leitura, ler, limparErro } = useLerFotoContagem()

  const mapa = useMemo(
    () => new Map<string, ProdutoContagem>(produtos.map((p) => [p.id, { id: p.id, nome: p.nome, unidade: p.unidade, quantidade_atual: Number(p.quantidade_atual) || 0 }])),
    [produtos],
  )
  const resumo = useMemo(() => resumir(linhas, mapa), [linhas, mapa])

  const lendo = leitura.fase === 'lendo'
  const temTrabalho = linhas.length > 0 && !salvando
  function tentarFechar() {
    if (salvando || lendo) return
    if (temTrabalho && !window.confirm('Fechar agora? As linhas conferidas ainda não foram salvas e serão perdidas.')) return
    onClose()
  }
  const fundoProps = useFecharNoFundo(tentarFechar)

  // zera tudo ao abrir
  useEffect(() => {
    if (!open) return
    sessaoRef.current += 1
    setPasso('fotos'); setFotos([]); setLinhas([]); setIlegivel([]); setLote([]); setEstados({}); setSalvando(false); limparErro()
    painelRef.current?.focus()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    function tecla(e: KeyboardEvent) { if (e.key === 'Escape') tentarFechar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  async function lerFotos() {
    if (linhas.length > 0 && !window.confirm('Ler de novo substitui as linhas que você já conferiu. Continuar?')) return
    const sessao = sessaoRef.current
    const r = await ler(fotos)
    if (!r || sessao !== sessaoRef.current) return
    setLinhas(ordenarPorConfianca(r.linhas.map(linhaDaIA)))
    setIlegivel(r.ilegivel)
    setPasso('conferir')
  }

  function irParaSalvar() {
    setLote(resumo.ajustes)
    setEstados(Object.fromEntries(resumo.ajustes.map((a) => [a.uid, { estado: 'pendente' as EstadoAjuste }])))
    setPasso('salvar')
  }

  async function aplicar(ajustes: Ajuste[]) {
    setSalvando(true)
    const motivo = motivoContagem()
    const ok = new Set<string>()
    for (const a of ajustes) {
      setEstados((s) => ({ ...s, [a.uid]: { estado: 'fazendo' } }))
      try {
        await registrar.mutateAsync({
          produto_id: a.produtoId,
          tipo: 'ajuste',
          quantidade: a.novo,            // ajuste = saldo final absoluto
          quantidade_anterior: a.anterior,
          motivo,
          responsavel,
          user_id: userId,
        })
        ok.add(a.uid)
        setEstados((s) => ({ ...s, [a.uid]: { estado: 'ok' } }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Erro ao registrar.'
        setEstados((s) => ({ ...s, [a.uid]: { estado: 'erro', msg } }))
      }
    }
    setSalvando(false)
    // o que deu certo sai da lista; o que falhou fica para tentar de novo
    setLinhas((ls) => ls.filter((l) => !ok.has(l.uid)))
    const falhas = ajustes.length - ok.size
    if (falhas === 0) {
      toast('success', `Contagem salva: ${ok.size} ${ok.size === 1 ? 'material ajustado' : 'materiais ajustados'}.`)
      onClose()
    } else {
      toast('error', `${ok.size} salvo${ok.size === 1 ? '' : 's'}, ${falhas} com erro. Os que falharam continuam aqui para tentar de novo.`)
    }
  }

  function tentarFalhasDeNovo() {
    const falhas = lote.filter((a) => estados[a.uid]?.estado === 'erro')
    // saldo pode ter mudado: recalcula a partir do mapa atual, mantendo o valor contado
    const frescas = falhas.map((a) => {
      const p = mapa.get(a.produtoId)
      const anterior = p?.quantidade_atual ?? a.anterior
      return { ...a, anterior, delta: Math.round((a.novo - anterior) * 1000) / 1000 }
    })
    // se o saldo recarregado já é o valor contado, não há o que registrar: marca como feito
    const jaIguais = frescas.filter((a) => a.delta === 0)
    const aFazer = frescas.filter((a) => a.delta !== 0)
    setLote(frescas)
    setEstados(Object.fromEntries(frescas.map((a) => [a.uid, { estado: (a.delta === 0 ? 'ok' : 'pendente') as EstadoAjuste }])))
    if (jaIguais.length > 0) {
      const iguais = new Set(jaIguais.map((a) => a.uid))
      setLinhas((ls) => ls.filter((l) => !iguais.has(l.uid)))
    }
    if (aFazer.length > 0) void aplicar(aFazer)
    else {
      toast('success', 'Contagem salva: os saldos já estavam iguais ao contado.')
      onClose()
    }
  }

  if (!open) return null

  const concluidos = lote.filter((a) => estados[a.uid]?.estado === 'ok').length
  const comErro = lote.filter((a) => estados[a.uid]?.estado === 'erro').length
  const iniciou = lote.some((a) => estados[a.uid]?.estado && estados[a.uid].estado !== 'pendente')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-contagem-foto"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-[2px] px-2 sm:px-4"
      {...fundoProps}
    >
      <div
        ref={painelRef}
        tabIndex={-1}
        className="flex max-h-[94dvh] w-full flex-col rounded-2xl bg-card shadow-elevated outline-none sm:max-w-5xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 id="titulo-contagem-foto" className="font-display text-base font-semibold">Contagem por foto</h2>
          </div>
          <button
            type="button"
            onClick={tentarFechar}
            disabled={salvando || lendo}
            aria-label="Fechar"
            className="rounded-lg p-1.5 transition-colors hover:bg-muted disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ol className="flex shrink-0 gap-1 border-b px-5 py-2.5 text-xs font-semibold" aria-label="Etapas">
          {PASSOS.map((p) => (
            <li
              key={p.id}
              aria-current={p.id === passo ? 'step' : undefined}
              className={cn('rounded-md px-2.5 py-1', p.id === passo ? 'text-primary' : 'text-muted-foreground')}
            >
              {p.rotulo}
            </li>
          ))}
        </ol>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {passo === 'fotos' && (
            <EtapaFotos
              fotos={fotos}
              onChange={setFotos}
              leitura={leitura}
              onLer={() => void lerFotos()}
              onVoltarConferencia={linhas.length > 0 ? () => setPasso('conferir') : undefined}
              toast={toast}
            />
          )}

          {passo === 'conferir' && (
            <EtapaConferir
              linhas={linhas}
              onChange={setLinhas}
              ilegivel={ilegivel}
              produtos={produtos}
              resumo={resumo}
              onVoltar={() => setPasso('fotos')}
              onContinuar={irParaSalvar}
            />
          )}

          {passo === 'salvar' && (
            <div className="space-y-4">
              <p className="text-sm">
                {iniciou
                  ? <>Salvando: <strong className="tabular-nums">{concluidos}</strong> de <strong className="tabular-nums">{lote.length}</strong> feitos{comErro > 0 && <>, <span className="font-semibold text-destructive">{comErro} com erro</span></>}.</>
                  : <>Você vai ajustar <strong className="tabular-nums">{lote.length}</strong> {lote.length === 1 ? 'material' : 'materiais'}. O saldo de cada um passa a ser o valor contado e fica registrado no histórico como “{motivoContagem()}”. Nada foi salvo até agora.</>}
              </p>

              <p className="text-xs text-muted-foreground">
                Este ajuste define o saldo que aparece na lista de Materiais.
              </p>

              <div className={tabela.container}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left">
                    <thead>
                      <tr className={tabela.theadRow}>
                        <th className={tabela.th} scope="col">Material</th>
                        <th className={cn(tabela.th, 'text-right')} scope="col">Saldo atual</th>
                        <th className={cn(tabela.th, 'text-right')} scope="col">Novo saldo</th>
                        <th className={cn(tabela.th, 'text-right')} scope="col">Diferença</th>
                        <th className={tabela.th} scope="col">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lote.map((a) => {
                        const e = estados[a.uid]?.estado ?? 'pendente'
                        const u = unidadeLabel(a.unidade)
                        return (
                          <tr key={a.uid} className={tabela.tr}>
                            <td className={tabela.td}>{a.nome}</td>
                            <td className={cn(tabela.td, 'text-right tabular-nums whitespace-nowrap')}>{formatarNumero(a.anterior)} {u}</td>
                            <td className={cn(tabela.td, 'text-right tabular-nums whitespace-nowrap font-semibold')}>{formatarNumero(a.novo)} {u}</td>
                            <td className={cn(tabela.td, 'text-right tabular-nums whitespace-nowrap font-semibold', a.delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
                              {a.delta > 0 ? '+' : ''}{formatarNumero(a.delta)} {u}
                            </td>
                            <td className={tabela.td}>
                              {e === 'pendente' && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Circle className="h-3.5 w-3.5" aria-hidden="true" /> Aguardando</span>}
                              {e === 'fazendo' && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Salvando…</span>}
                              {e === 'ok' && <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Salvo</span>}
                              {e === 'erro' && (
                                <span className="inline-flex items-start gap-1.5 text-xs font-semibold text-destructive">
                                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>Erro{estados[a.uid]?.msg ? `: ${estados[a.uid].msg}` : ''}</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                {!iniciou && (
                  <>
                    <Button variant="ghost" onClick={() => setPasso('conferir')} disabled={salvando}>Voltar e corrigir</Button>
                    <Button onClick={() => void aplicar(lote)} loading={salvando}>
                      Confirmar {lote.length} {lote.length === 1 ? 'ajuste' : 'ajustes'}
                    </Button>
                  </>
                )}
                {iniciou && comErro > 0 && !salvando && (
                  <>
                    <Button variant="ghost" onClick={() => setPasso('conferir')}>Voltar e corrigir</Button>
                    <Button onClick={tentarFalhasDeNovo}>Tentar de novo ({comErro})</Button>
                  </>
                )}
                {salvando && <span className="text-xs text-muted-foreground">Não feche esta janela até terminar.</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
