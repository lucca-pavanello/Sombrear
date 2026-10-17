/**
 * Calculadora de cortina (Wave, Pregas e Franzida) — o que hoje a loja faz no GPT.
 *
 * Mesmo desenho do Calcular de persianas: ambientes → cortinas → medidas.
 * A conta roda no navegador com o motor de `@/lib/cortina`, lendo os preços
 * do banco. Cada medida mostra o próprio valor e memorial (é o que a loja
 * confere quando o número parece estranho); o total fecha o orçamento inteiro
 * com o acréscimo/desconto aplicado UMA vez sobre a soma — arredondar no fim,
 * como numa cortina só.
 */
import { useMemo, useState } from 'react'
import { campo, rotulo } from '@/components/shared/estilos'
import {
  Calculator, Check, ChevronDown, ClipboardCopy, Copy, Layers, Plus, Ruler, Trash2, TriangleAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { Button, EmptyState } from '@/components/ui/primitives'
import SectionHeader from '@/components/shared/SectionHeader'
import { usePrecosCortinaTecidos, usePrecosCortinaValores } from '@/hooks/usePrecos'
import { useCustoTecidoCortina } from '@/hooks/useCustoTecidoCortina'
import CustoDoTecido, { panosDaCortina, somarPanos } from './CustoDoTecido'
import { formatarMargem } from '@/lib/catalogo/margem'
import {
  calcularAmbientesCortina, type AmbienteCortina, type CortinaConfig,
  type ModeloCortina, type SuporteCortina,
} from '@/lib/cortina'

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const MODELOS: { id: ModeloCortina; label: string }[] = [
  { id: 'wave', label: 'Wave' },
  { id: 'pregas', label: 'Pregas' },
  { id: 'franzida', label: 'Franzida' },
]
const SUPORTES: { id: SuporteCortina; label: string }[] = [
  { id: 'trilho_simples', label: 'Trilho simples' },
  { id: 'trilho_duplo', label: 'Trilho duplo' },
  { id: 'varao_simples', label: 'Varão simples' },
  { id: 'varao_duplo', label: 'Varão duplo' },
]

/* receita compartilhada — ver src/components/shared/estilos.ts */
const labelCls = rotulo
const inputCls = campo
const cardCls = 'rounded-xl border bg-card p-4 shadow-sm sm:p-5'

let proximoId = 1
const novaMedida = () => ({ largura: '', altura: '', quantidade: '1' })
const novaCortina = (): CortinaConfig => ({
  id: proximoId++, modelo: 'wave', tecido: '', forro: null, suporte: 'trilho_simples',
  franzido: false, franzidoTecido: null, incluirColocacao: false, medidas: [novaMedida()],
})
const novoAmbiente = (): AmbienteCortina => ({ id: proximoId++, nome: '', cortinas: [novaCortina()] })

export default function CalculadoraCortina() {
  const { data: tecidos } = usePrecosCortinaTecidos()
  const { data: valores } = usePrecosCortinaValores()

  const [cliente, setCliente] = useState('')
  const [ambientes, setAmbientes] = useState<AmbienteCortina[]>([novoAmbiente()])
  const [memorialAberto, setMemorialAberto] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const opcoesTecido = useMemo(
    () => (tecidos ?? []).filter(t => t.tipo === 'tecido').map(t => t.nome), [tecidos])
  const opcoesForro = useMemo(
    () => ['Sem forro', ...(tecidos ?? []).filter(t => t.tipo === 'forro').map(t => t.nome)], [tecidos])

  /* ── mutações da árvore ambientes → cortinas → medidas ────── */
  const setAmb = (id: number, patch: Partial<AmbienteCortina>) =>
    setAmbientes(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
  const setCort = (ambId: number, cortId: number, patch: Partial<CortinaConfig>) =>
    setAmbientes(prev => prev.map(a => a.id !== ambId ? a : {
      ...a, cortinas: a.cortinas.map(c => c.id === cortId ? { ...c, ...patch } : c),
    }))
  const setMedida = (ambId: number, cortId: number, idx: number, campo: 'largura' | 'altura' | 'quantidade', valor: string) =>
    setAmbientes(prev => prev.map(a => a.id !== ambId ? a : {
      ...a, cortinas: a.cortinas.map(c => c.id !== cortId ? c : {
        ...c, medidas: c.medidas.map((m, i) => i === idx ? { ...m, [campo]: valor } : m),
      }),
    }))

  const resultado = useMemo(() => {
    if (!tecidos?.length || !valores?.length) return null
    return calcularAmbientesCortina(ambientes, { tecidos, valores })
  }, [tecidos, valores, ambientes])

  /**
   * Custo de compra do pano, do catálogo de custos. Só informa: nada aqui
   * entra no valor cobrado, e o texto copiado para o cliente não muda.
   */
  const { porNome: custosDoPano } = useCustoTecidoCortina()
  const panosPorItem = useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof panosDaCortina>>()
    for (const [idx, i] of (resultado?.ok ?? []).entries()) {
      mapa.set(`${i.cortina.id}-${idx}`, panosDaCortina(
        i.cortina.tecido, i.cortina.forro, i.resultado.consumo, i.resultado.quantidade,
        tecidos ?? [], custosDoPano))
    }
    return mapa
  }, [resultado, tecidos, custosDoPano])

  const custoTotalPano = useMemo(
    () => somarPanos([...panosPorItem.values()].flat()), [panosPorItem])

  const temItens = (resultado?.ok.length ?? 0) > 0
  const observacoes = useMemo(
    () => [...new Set((resultado?.ok ?? []).flatMap(i => i.resultado.observacoes))],
    [resultado])

  /** Mesmo formato que a loja já manda no WhatsApp — agora ambiente a ambiente */
  const textoOrcamento = () => {
    if (!resultado || !temItens) return ''
    const linhas: string[] = [
      'ORÇAMENTO – Sombrear Cortinas e Persianas', '',
      `Cliente: ${cliente || '—'}`, '',
    ]
    const porAmbiente = new Map<string, typeof resultado.ok>()
    for (const i of resultado.ok) {
      const chave = i.ambiente.trim() || 'Ambiente'
      porAmbiente.set(chave, [...(porAmbiente.get(chave) ?? []), i])
    }
    const variosAmbientes = porAmbiente.size > 1
    for (const [nome, itens] of porAmbiente) {
      if (variosAmbientes || nome !== 'Ambiente') linhas.push(`${nome.toUpperCase()}:`)
      for (const i of itens) {
        const qtd = i.resultado.quantidade
        const desc = i.cortina.forro ? `${i.cortina.tecido} com ${i.cortina.forro.toLowerCase()}` : i.cortina.tecido
        const modelo = MODELOS.find(m => m.id === i.cortina.modelo)?.label ?? 'Wave'
        const sup = SUPORTES.find(s => s.id === i.cortina.suporte)?.label.toLowerCase() ?? ''
        linhas.push(
          `(${String(qtd).padStart(2, '0')}) Cortina modelo ${modelo} em ${desc}` +
          `${i.cortina.franzido ? ' com franzido atrás' : ''}, em ${sup}` +
          `${i.cortina.incluirColocacao ? ', colocada' : ''}.`,
          `Medida: ${i.medida.largura.replace('.', ',')} × ${i.medida.altura.replace('.', ',')} — ${brl(i.resultado.subtotal)}`,
          '')
      }
    }
    linhas.push(
      `Valor: ${brl(resultado.parcelado)}`, '',
      'Condições de pagamento',
      'Até 4x no cartão.',
      `À vista com 5% de desconto: ${brl(resultado.avista)}.`, '',
      `Observação: ${resultado.ok.some(i => i.cortina.incluirColocacao)
        ? 'Colocação inclusa (sob consulta de localidade).' : 'Colocação não inclusa.'}`,
      'Prazo de produção: 20 a 25 dias úteis.', '',
      'Sombrear Cortinas e Persianas',
      'Avenida Fernando Costa, 984 – Vila Maceno.')
    return linhas.join('\n')
  }

  const copiar = async () => {
    await navigator.clipboard.writeText(textoOrcamento())
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1800)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      {/* ── entrada ── */}
      <section>
        <SectionHeader step="1" icon={<Ruler className="h-3.5 w-3.5" />} title="Cortinas"
          hint="ambientes, modelos e medidas — igual ao Calcular" />

        <div className={cn(cardCls, 'mt-3')}>
          <label className={labelCls}>Cliente</label>
          <input className={inputCls} value={cliente} onChange={e => setCliente(e.target.value)}
            placeholder="Nome do cliente" />
        </div>

        {ambientes.map((amb, ambIdx) => (
          <div key={amb.id} className={cn(cardCls, 'mt-3 space-y-3')}>
            <div className="flex items-center gap-2">
              <input
                className={cn(inputCls, 'py-2 text-sm font-semibold')}
                value={amb.nome}
                onChange={e => setAmb(amb.id, { nome: e.target.value })}
                placeholder={`Ambiente ${ambIdx + 1} (ex.: Sala, Suíte…)`}
              />
              {ambientes.length > 1 && (
                <button type="button" title="Remover ambiente"
                  onClick={() => setAmbientes(prev => prev.filter(a => a.id !== amb.id))}
                  className="rounded-md p-2 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {amb.cortinas.map((c, cIdx) => (
              <div key={c.id} className="rounded-lg border border-border/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/45">
                    Cortina {cIdx + 1}
                  </p>
                  <span className="flex items-center gap-0.5">
                    <button type="button" title="Duplicar esta cortina"
                      onClick={() => setAmb(amb.id, {
                        cortinas: [...amb.cortinas, { ...c, id: proximoId++, medidas: [novaMedida()] }],
                      })}
                      className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {amb.cortinas.length > 1 && (
                      <button type="button" title="Remover cortina"
                        onClick={() => setAmb(amb.id, { cortinas: amb.cortinas.filter(x => x.id !== c.id) })}
                        className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Modelo</label>
                    <CustomSelect value={c.modelo} onChange={v => setCort(amb.id, c.id, { modelo: v as ModeloCortina })}
                      options={MODELOS.map(m => ({ value: m.id, label: m.label }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Suporte</label>
                    <CustomSelect value={c.suporte} onChange={v => setCort(amb.id, c.id, { suporte: v as SuporteCortina })}
                      options={SUPORTES.map(s => ({ value: s.id, label: s.label }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Tecido</label>
                    <CustomSelect value={c.tecido} onChange={v => setCort(amb.id, c.id, { tecido: v })}
                      options={opcoesTecido} placeholder={tecidos ? 'Escolha o tecido…' : 'Carregando…'} />
                  </div>
                  <div>
                    <label className={labelCls}>Forro costurado junto</label>
                    <CustomSelect value={c.forro ?? 'Sem forro'}
                      onChange={v => setCort(amb.id, c.id, { forro: v === 'Sem forro' ? null : v })}
                      options={opcoesForro} />
                  </div>
                </div>

                <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/30">
                  <input type="checkbox" checked={c.franzido}
                    onChange={e => setCort(amb.id, c.id, { franzido: e.target.checked })}
                    className="h-4 w-4 accent-[hsl(var(--primary))]" />
                  <span className="text-xs font-medium">Painel franzido atrás (forro separado)</span>
                </label>
                {c.franzido && (
                  <div className="mt-2">
                    <label className={labelCls}>Tecido do franzido</label>
                    <CustomSelect value={c.franzidoTecido ?? ''}
                      onChange={v => setCort(amb.id, c.id, { franzidoTecido: v || null })}
                      options={(tecidos ?? []).filter(t => t.tipo === 'forro').map(t => t.nome)}
                      placeholder="Escolha o forro do franzido…" />
                  </div>
                )}
                <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/30">
                  <input type="checkbox" checked={c.incluirColocacao}
                    onChange={e => setCort(amb.id, c.id, { incluirColocacao: e.target.checked })}
                    className="h-4 w-4 accent-[hsl(var(--primary))]" />
                  <span className="text-xs font-medium">Com colocação</span>
                </label>

                {/* medidas — cada vão desta cortina */}
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-foreground/45">Medidas</p>
                  {c.medidas.map((m, mIdx) => (
                    <div key={mIdx} className="flex items-end gap-2">
                      <div className="flex-1">
                        {mIdx === 0 && <label className={labelCls}>Largura (m)</label>}
                        <input className={inputCls} inputMode="decimal" value={m.largura}
                          onChange={e => setMedida(amb.id, c.id, mIdx, 'largura', e.target.value)}
                          placeholder="2,50" />
                      </div>
                      <div className="flex-1">
                        {mIdx === 0 && <label className={labelCls}>Altura (m)</label>}
                        <input className={inputCls} inputMode="decimal" value={m.altura}
                          onChange={e => setMedida(amb.id, c.id, mIdx, 'altura', e.target.value)}
                          placeholder="2,55" />
                      </div>
                      <div className="w-20">
                        {mIdx === 0 && <label className={labelCls}>Qtd.</label>}
                        <input className={inputCls} inputMode="numeric" value={m.quantidade}
                          onChange={e => setMedida(amb.id, c.id, mIdx, 'quantidade', e.target.value)} />
                      </div>
                      {c.medidas.length > 1 ? (
                        <button type="button" title="Remover medida"
                          onClick={() => setCort(amb.id, c.id, { medidas: c.medidas.filter((_, i) => i !== mIdx) })}
                          className="mb-1 rounded-md p-2 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : <span className="w-8" />}
                    </div>
                  ))}
                  <button type="button"
                    onClick={() => setCort(amb.id, c.id, { medidas: [...c.medidas, novaMedida()] })}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10">
                    <Plus className="h-3.5 w-3.5" /> Outra medida
                  </button>
                </div>
              </div>
            ))}

            <button type="button"
              onClick={() => setAmb(amb.id, { cortinas: [...amb.cortinas, novaCortina()] })}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10">
              <Plus className="h-3.5 w-3.5" /> Outra cortina neste ambiente
            </button>
          </div>
        ))}

        <Button variant="outline" className="mt-3" fullWidth
          onClick={() => setAmbientes(prev => [...prev, novoAmbiente()])}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Adicionar ambiente
        </Button>
      </section>

      {/* ── resultado ── */}
      <section>
        <SectionHeader step="2" icon={<Calculator className="h-3.5 w-3.5" />} title="Orçamento"
          hint="conta aberta, valor por medida" />

        <div className={cn(cardCls, 'mt-3')}>
          {!resultado ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando preços…</p>
          ) : !temItens ? (
            <EmptyState icon={Layers} titulo="Preencha uma medida"
              dica="Escolha o tecido e informe largura × altura — o valor aparece aqui na hora, com a conta aberta."
              className="px-4 py-10" />
          ) : (
            <div className="space-y-3">
              {resultado.ok.map((i, idx) => {
                const chave = `${i.cortina.id}-${idx}`
                const aberto = memorialAberto === chave
                return (
                  <div key={chave} className="rounded-lg border border-border/70">
                    <button type="button" onClick={() => setMemorialAberto(aberto ? null : chave)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left"
                      aria-expanded={aberto}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">
                          {(i.ambiente.trim() || 'Ambiente')} · {MODELOS.find(m => m.id === i.cortina.modelo)?.label}{' '}
                          {i.medida.largura}×{i.medida.altura}
                          {i.resultado.quantidade > 1 && ` (${i.resultado.quantidade}×)`}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">{i.cortina.tecido}</span>
                      </span>
                      <span className="font-display text-sm font-bold tabular-nums">{brl(i.resultado.subtotal)}</span>
                      <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform', aberto && 'rotate-180')} />
                    </button>
                    {aberto && (
                      <div className="border-t border-border/50 px-3 py-2">
                        <ul className="space-y-1 text-[11px] text-muted-foreground">
                          {i.resultado.memorial.map((l, k) => <li key={k}>{l}</li>)}
                        </ul>
                        <table className="mt-2 w-full text-xs">
                          <tbody className="divide-y divide-border/40">
                            {i.resultado.itens.map((it, k) => (
                              <tr key={k}>
                                <td className="py-1 pr-2">{it.item}
                                  <span className="block text-[10px] text-muted-foreground">{it.conta}</span>
                                </td>
                                <td className="py-1 text-right font-semibold tabular-nums">{brl(it.valor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <CustoDoTecido
                          panos={panosPorItem.get(chave) ?? []}
                          temFranzido={!!i.cortina.franzido}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="rounded-lg bg-muted/30 px-3 py-2.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span>
                  <span className="font-semibold tabular-nums">{brl(resultado.subtotal)}</span></div>
                <div className="mt-1 flex justify-between font-display text-base font-bold">
                  <span>Até 4x</span><span className="tabular-nums">{brl(resultado.parcelado)}</span></div>
                <div className="mt-0.5 flex justify-between text-xs text-emerald-600 dark:text-emerald-400">
                  <span>À vista (−5%)</span><span className="font-semibold tabular-nums">{brl(resultado.avista)}</span></div>
                {custoTotalPano && (
                  <div className="mt-2 flex justify-between border-t border-border/50 pt-2 text-xs text-muted-foreground">
                    <span>Pano: paga {brl(custoTotalPano.custo)}</span>
                    <span className="font-semibold tabular-nums">
                      margem {formatarMargem(custoTotalPano.margem)}
                    </span>
                  </div>
                )}
              </div>

              <Button onClick={copiar} fullWidth>
                {copiado ? <Check className="h-4 w-4" aria-hidden="true" /> : <ClipboardCopy className="h-4 w-4" aria-hidden="true" />}
                {copiado ? 'Copiado!' : 'Copiar orçamento'}
              </Button>
            </div>
          )}

          {resultado && resultado.erros.length > 0 && (
            <div className="mt-3 space-y-1">
              {resultado.erros.map((e, k) => (
                <p key={k} className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {e}
                </p>
              ))}
            </div>
          )}
          {observacoes.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              {observacoes.map((o, k) => <li key={k}>• {o}</li>)}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
