import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Eraser, History, Loader2, Mic, Send, Sparkles, Undo2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { usePrecosMutations } from '@/hooks/usePrecos'
import { formatarSegundos, useGravadorAudio, type AudioGravado } from '@/hooks/useGravadorAudio'
import { blocosDaResposta, partesDoTexto, type Bloco } from '@/lib/respostaIA'
import { ultimoLote, type LinhaAuditoria } from '@/lib/precos-ia/lotes'
import { Button } from '@/components/ui/primitives'
import { campo } from '@/components/shared/estilos'

interface Props {
  toast: (type: 'success' | 'error', message: string, opts?: { duration?: number }) => void
}

interface Acao { tipo: string; suspeita?: boolean; motivo?: string; [k: string]: unknown }
interface Mensagem {
  papel: 'user' | 'ia'
  texto: string
  acoes?: Acao[]
  aplicado?: boolean
  /** mensagem do usuário que veio por voz: `texto` é a transcrição devolvida pelo servidor */
  audio?: boolean
  pendente?: boolean
  /** índices das ações suspeitas que o admin confirmou de propósito */
  confirmadas?: number[]
  loteId?: string
  desfeito?: boolean
}
type Auditoria = LinhaAuditoria

const fmtNum = (v: unknown) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 })

function descreverAcao(a: Acao): string {
  switch (a.tipo) {
    case 'criar_promocao':
      return `Promoção: ${a.tecido} com −${a.desconto_pct}% de ${a.inicio} até ${a.fim}`
    case 'remover_promocao':
      return `Remover promoção #${a.id}`
    case 'atualizar_preco_tecido':
      return `Preço do tecido ${a.nome}${a.largura != null ? ` (largura ${a.largura}m)` : ' (todas as larguras)'} → R$ ${Number(a.preco).toFixed(2)}`
    case 'atualizar_parametro':
      return `Parâmetro ${a.chave}${a.atual != null ? `: ${fmtNum(a.atual)}` : ''} → ${fmtNum(a.valor)}`
    case 'atualizar_preco_artigo':
      return `Artigo ${a.nome} (${a.categoria}) → R$ ${Number(a.preco).toFixed(2)}`
    case 'atualizar_componente_ferragem': {
      const antes = a.antes as { item?: string; familia?: string; cor?: string } | undefined
      const nome = antes?.item ?? a.item ?? `componente #${a.id}`
      const fam = antes?.familia ? ` (${[antes.familia, antes.cor].filter(Boolean).join(' ')})` : ''
      return `Ferragem: ${nome}${fam} → R$ ${Number(a.valor).toFixed(2)}`
    }
    case 'atualizar_ph50':
      return `PH 50 ${a.modelo} ${a.cor}: ${a.campo} → R$ ${Number(a.valor).toFixed(2)}`
    case 'atualizar_bando_param':
      return `Bandô ${a.cor}: ${a.campo} → R$ ${Number(a.valor).toFixed(2)}`
    case 'atualizar_colocacao': {
      const antes = a.antes as { ml_min?: number; ml_max?: number } | undefined
      const faixa = antes ? ` (${antes.ml_min}–${antes.ml_max}ml)` : ` #${a.id}`
      return `Instalação${faixa} → R$ ${Number(a.preco).toFixed(2)}`
    }
    case 'atualizar_barra_faixa':
      return `Barra: a partir de ${a.largura_min}m → ${a.qtd_presilhas} presilhas`
    case 'atualizar_motor_componente':
      return `Motor: ${a.item} → R$ ${Number(a.custo).toFixed(2)}`
    case 'atualizar_motor_estrutura': {
      const antes = a.antes as { largura?: number; alt_faixa?: string } | undefined
      const linha = antes ? ` (${antes.largura}m, ${antes.alt_faixa})` : ` #${a.id}`
      return `Motor estrutura${linha} → R$ ${Number(a.valor).toFixed(2)}`
    }
    case 'atualizar_romana':
      return `Romana ${a.largura}×${a.altura}m → R$ ${Number(a.custo).toFixed(2)}`
    case 'editar_grade': {
      const depois = (a.depois ?? {}) as Record<string, unknown>
      const campos = Object.entries(depois).map(([k, v]) => `${k} → ${v}`).join(', ')
      return `Edição manual (${String(a.tabela ?? '').replace('precos_', '')}): ${campos}`
    }
    case 'excluir_grade':
      return `Exclusão manual (${String(a.tabela ?? '').replace('precos_', '')})`
    default:
      return JSON.stringify(a)
  }
}

const TIPOS_REVERSIVEIS = new Set([
  'editar_grade', 'excluir_grade', 'criar_promocao', 'remover_promocao',
  'atualizar_preco_tecido', 'atualizar_parametro', 'atualizar_preco_artigo',
  'atualizar_componente_ferragem', 'atualizar_ph50', 'atualizar_bando_param',
  'atualizar_colocacao', 'atualizar_barra_faixa', 'atualizar_motor_componente',
  'atualizar_motor_estrutura', 'atualizar_romana',
])

const semId = (row: Record<string, unknown>) => {
  const { id: _id, ...resto } = row
  return resto
}

/** Valor que existia antes da mudança — vem do 'antes' gravado na auditoria. */
function valorAnterior(detalhe: Record<string, unknown>): string | null {
  const antes = detalhe?.antes as Record<string, unknown> | Array<Record<string, unknown>> | undefined
  if (!antes) return null
  const bruto = Array.isArray(antes)
    ? antes.map(x => x.preco ?? x.valor).filter(v => v != null)
    : [antes.valor ?? antes.preco ?? antes.custo ?? antes.qtd_presilhas]
  const nums = bruto.filter(v => v != null && !isNaN(Number(v))).map(v => Number(v))
  if (nums.length === 0) return null
  return [...new Set(nums)].map(n => `R$ ${n.toFixed(2)}`).join(' / ')
}

/** O motivo real vem no corpo da resposta 4xx — sem isso o admin só via "deu erro". */
async function motivoDoErro(error: unknown, data: unknown): Promise<string | undefined> {
  let motivo = (data as { error?: string } | null)?.error
  try {
    const ctx = (error as { context?: Response } | null)?.context
    if (ctx) motivo = (await ctx.json())?.error ?? motivo
  } catch { /* corpo não-JSON: fica no genérico */ }
  return motivo || undefined
}

const CHAVE_CONVERSA = 'sombrear-precos-ia-conversa'
const MAX_GUARDADAS = 15

const SAUDACAO: Mensagem = {
  papel: 'ia',
  texto: 'Oi! Posso mudar preços e margens — "coloca o SCREEN 3% BEGE com 10% de desconto até o fim do mês", "sobe o markup de venda para 2,9 e o de PV para 1,85" — por texto ou pelo microfone. Também respondo: "quais são todas as margens que estamos usando?", "quanto o Fernando pagou?", "qual foi o valor anterior do tubo 32?". Nas mudanças eu preparo e você só confirma.',
}

/** Conversa guardada no aparelho: ao voltar na aba o admin continua de onde parou. */
function carregarConversa(): Mensagem[] {
  try {
    const bruto = localStorage.getItem(CHAVE_CONVERSA)
    if (!bruto) return [SAUDACAO]
    const salvas = JSON.parse(bruto) as Mensagem[]
    if (!Array.isArray(salvas) || salvas.length === 0) return [SAUDACAO]
    // propostas não sobrevivem ao recarregar: os dados podem ter mudado nesse meio-tempo
    return salvas.map(m => ({ ...m, acoes: undefined, pendente: undefined }))
  } catch { return [SAUDACAO] }
}

// ── Resposta da IA em blocos (parágrafo, lista, tabela) ───────────
// Mesmo parser do copilot: a tabela que o Gemini manda não sai como `|` cru.
function Texto({ texto }: { texto: string }) {
  return <>{partesDoTexto(texto).map((p, i) => (p.negrito
    ? <strong key={i} className="font-semibold text-foreground">{p.texto}</strong>
    : <span key={i}>{p.texto}</span>))}</>
}

function BlocoResposta({ bloco }: { bloco: Bloco }) {
  if (bloco.tipo === 'paragrafo') return <p className="whitespace-pre-wrap"><Texto texto={bloco.texto} /></p>
  if (bloco.tipo === 'lista') {
    const Tag = bloco.numerada ? 'ol' : 'ul'
    return (
      <Tag className={cn('space-y-0.5 pl-4', bloco.numerada ? 'list-decimal' : 'list-disc marker:text-primary')}>
        {bloco.itens.map((it, i) => <li key={i}><Texto texto={it} /></li>)}
      </Tag>
    )
  }
  return (
    <div className="-mx-1 overflow-x-auto rounded-lg border border-border/60 bg-card/60">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border">
            {bloco.cabecalho.map((c, i) => (
              <th key={i} scope="col" className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                <Texto texto={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bloco.linhas.map((l, i) => (
            <tr key={i} className="border-b border-border/60 align-top last:border-0">
              {l.map((c, j) => (
                <td key={j} className={cn('px-2.5 py-1.5', j === 0 && 'font-mono text-[11px] whitespace-nowrap', j === 1 && 'font-semibold tabular-nums whitespace-nowrap')}>
                  <Texto texto={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Resposta({ texto }: { texto: string }) {
  return <div className="space-y-2">{blocosDaResposta(texto).map((b, i) => <BlocoResposta key={i} bloco={b} />)}</div>
}

export default function PrecosIA({ toast }: Props) {
  const [mensagens, setMensagens] = useState<Mensagem[]>(carregarConversa)

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_CONVERSA, JSON.stringify(mensagens.filter(m => !m.pendente).slice(-MAX_GUARDADAS)))
    } catch { /* cota cheia: seguir sem persistir */ }
  }, [mensagens])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [desfazendo, setDesfazendo] = useState<number | null>(null)
  const [desfazendoLote, setDesfazendoLote] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { updateRow, insertRow, deleteRow } = usePrecosMutations()

  const gravador = useGravadorAudio({ maxSegundos: 90, aoFinalizar: audio => { void enviar(audio) } })

  /** Reverte UMA alteração da auditoria. Lança erro se não der (o chamador decide o que dizer). */
  async function reverter(a: Auditoria): Promise<void> {
    const d = a.detalhe
    if (a.acao === 'editar_grade') {
      await updateRow(String(d.tabela), d.match as Record<string, unknown>,
        d.antes as Record<string, unknown>, d.depois as Record<string, unknown>)
    } else if (a.acao === 'excluir_grade') {
      await insertRow(String(d.tabela), semId(d.antes as Record<string, unknown>))
    } else if (a.acao === 'criar_promocao' && d.promo_id != null) {
      await deleteRow('precos_promocoes', { id: d.promo_id })
    } else if (a.acao === 'remover_promocao' && d.antes) {
      await insertRow('precos_promocoes', semId(d.antes as Record<string, unknown>))
    } else if (a.acao === 'atualizar_preco_tecido' && Array.isArray(d.antes)) {
      for (const linha of d.antes as { id: number; preco: number }[]) {
        await updateRow('precos_tecidos', { id: linha.id }, { preco: linha.preco }, { preco: d.preco })
      }
    } else if (a.acao === 'atualizar_parametro' && d.antes) {
      await updateRow('precos_parametros', { chave: d.chave },
        { valor: (d.antes as { valor: number }).valor }, { valor: d.valor })
    } else if (a.acao === 'atualizar_preco_artigo' && d.antes) {
      await updateRow('precos_artigos', { categoria: d.categoria, nome: d.nome },
        { preco: (d.antes as { preco: number }).preco }, { preco: d.preco })
    } else if (a.acao === 'atualizar_componente_ferragem' && d.antes) {
      await updateRow('precos_ferragem_componentes', { id: d.id },
        { valor: (d.antes as { valor: number }).valor }, { valor: d.valor })
    } else if (a.acao === 'atualizar_ph50' && d.antes) {
      const campoPh = String(d.campo)
      await updateRow('precos_ph50', { modelo: d.modelo, cor: d.cor },
        { [campoPh]: (d.antes as Record<string, number>)[campoPh] }, { [campoPh]: d.valor })
    } else if (a.acao === 'atualizar_bando_param' && d.antes) {
      const campoBando = String(d.campo)
      await updateRow('precos_bandos_params', { cor: d.cor },
        { [campoBando]: (d.antes as Record<string, number>)[campoBando] }, { [campoBando]: d.valor })
    } else if (a.acao === 'atualizar_colocacao' && d.antes) {
      await updateRow('precos_colocacao', { id: d.id },
        { preco: (d.antes as { preco: number }).preco }, { preco: d.preco })
    } else if (a.acao === 'atualizar_barra_faixa' && d.antes) {
      await updateRow('precos_barra_faixas', { largura_min: d.largura_min },
        { qtd_presilhas: (d.antes as { qtd_presilhas: number }).qtd_presilhas }, { qtd_presilhas: d.qtd_presilhas })
    } else if (a.acao === 'atualizar_motor_componente' && d.antes) {
      await updateRow('precos_motor_componentes', { item: d.item },
        { custo: (d.antes as { custo: number }).custo }, { custo: d.custo })
    } else if (a.acao === 'atualizar_motor_estrutura' && d.antes) {
      await updateRow('precos_motor_estrutura', { id: d.id },
        { valor: (d.antes as { valor: number }).valor }, { valor: d.valor })
    } else if (a.acao === 'atualizar_romana' && d.antes) {
      await updateRow('precos_romana_matriz', { largura: d.largura, altura: d.altura },
        { custo: (d.antes as { custo: number }).custo }, { custo: d.custo })
    } else {
      throw new Error('Essa alteração não tem dados suficientes para desfazer')
    }
  }

  async function desfazer(a: Auditoria) {
    setDesfazendo(a.id)
    try {
      await reverter(a)
      queryClient.invalidateQueries({ queryKey: ['precos'] })
      toast('success', 'Alteração desfeita!')
    } catch (err) {
      const semDados = err instanceof Error && err.message.startsWith('Essa alteração')
      toast('error', semDados ? err.message : 'Não consegui desfazer — confira a tabela')
    } finally {
      setDesfazendo(null)
    }
  }

  /**
   * "Desfazer tudo" de um lote: reverte uma a uma, da última aplicada para a primeira
   * (se a mesma chave mudou duas vezes, volta ao valor original). Falha numa não
   * interrompe as outras; no fim diz exatamente o que ficou.
   */
  async function desfazerLote(loteId: string) {
    setDesfazendoLote(true)
    try {
      const { data, error } = await supabase.from('precos_auditoria').select('*')
        .filter('detalhe->>lote_id', 'eq', loteId).order('id', { ascending: false })
      if (error) throw error
      const linhas = (data ?? []) as Auditoria[]
      if (linhas.length === 0) { toast('error', 'Não achei as alterações desse lote no histórico.'); return }

      const falhas: string[] = []
      let feitas = 0
      for (const linha of linhas) {
        try { await reverter(linha); feitas++ } catch (err) {
          const porque = err instanceof Error && err.message.startsWith('Essa alteração') ? ' (sem dados do valor anterior)' : ''
          falhas.push(`${descreverAcao({ tipo: linha.acao, ...linha.detalhe })}${porque}`)
        }
      }
      queryClient.invalidateQueries({ queryKey: ['precos'] })
      setMensagens(m => m.map(x => x.loteId === loteId ? { ...x, desfeito: falhas.length === 0 } : x))
      if (falhas.length === 0) {
        toast('success', `Lote desfeito: ${feitas} alteraç${feitas > 1 ? 'ões' : 'ão'} revertida${feitas > 1 ? 's' : ''}.`)
        setMensagens(m => [...m, { papel: 'ia', texto: `Desfeito! ${feitas} alteraç${feitas > 1 ? 'ões voltaram' : 'ão voltou'} ao valor anterior.` }])
      } else {
        toast('error', `Desfiz ${feitas} de ${linhas.length}. ${falhas.length} não voltaram — veja a conversa.`, { duration: 9000 })
        setMensagens(m => [...m, {
          papel: 'ia',
          texto: `Desfiz ${feitas} de ${linhas.length}. Estas NÃO voltaram e continuam como estão:\n${falhas.map(f => `- ${f}`).join('\n')}\nConfira nas tabelas ou use o Desfazer individual no histórico.`,
        }])
      }
    } catch {
      toast('error', 'Não consegui desfazer o lote — nada foi alterado ou confira o histórico.', { duration: 9000 })
    } finally {
      setDesfazendoLote(false)
    }
  }

  // 80 linhas: cabe um lote inteiro (máx. 60) para o "Desfazer tudo"; a lista mostra só as 10 mais novas
  const { data: auditoria } = useQuery<Auditoria[]>({
    queryKey: ['precos', 'auditoria'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('precos_auditoria').select('*').order('criado_em', { ascending: false }).limit(80)
      if (error) throw error
      return data as Auditoria[]
    },
  })
  const lote = ultimoLote(auditoria ?? [])

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mensagens, pensando])

  async function enviar(audio?: AudioGravado) {
    const msg = texto.trim()
    if ((!msg && !audio) || pensando) return
    setTexto('')
    const historico = mensagens.filter(m => !m.pendente).slice(-6).map(m => ({ papel: m.papel, texto: m.texto }))
    const indice = mensagens.length
    setMensagens(m => [...m, audio
      ? { papel: 'user', audio: true, pendente: true, texto: msg || `Áudio de ${formatarSegundos(audio.duracaoSeg)} — transcrevendo…` }
      : { papel: 'user', texto: msg }])
    setPensando(true)
    try {
      const { data, error } = await supabase.functions.invoke('precos-ia', {
        body: {
          modo: 'propor', mensagem: msg, historico,
          ...(audio ? { audio: { mimeType: audio.mimeType, data: audio.data } } : {}),
        },
      })
      if (error) throw Object.assign(new Error(await motivoDoErro(error, data) ?? ''), { causa: error })
      const transcricao = String(data.transcricao ?? '').trim()
      if (audio) {
        // o usuário confere o que a IA entendeu: a bolha vira a transcrição
        const falado = transcricao || '(não reconheci fala nesse áudio)'
        setMensagens(m => m.map((x, i) => i === indice
          ? { ...x, pendente: false, texto: msg ? `${msg}\n${falado}` : falado } : x))
      }
      setMensagens(m => [...m, { papel: 'ia', texto: data.resposta || 'Certo!', acoes: data.acoes?.length ? data.acoes : undefined }])
    } catch (err) {
      const motivo = err instanceof Error && err.message ? err.message : null
      toast('error', motivo ?? 'A IA não respondeu — tenta de novo', { duration: motivo ? 9000 : undefined })
      setMensagens(m => {
        const base = audio ? m.map((x, i) => i === indice ? { ...x, pendente: false, texto: msg || 'Áudio não enviado' } : x) : m
        return [...base, { papel: 'ia', texto: motivo ?? 'Tive um problema aqui — pode repetir?' }]
      })
    } finally {
      setPensando(false)
    }
  }

  function alternarConfirmacao(indiceMsg: number, indiceAcao: number) {
    setMensagens(m => m.map((x, i) => {
      if (i !== indiceMsg) return x
      const atual = new Set(x.confirmadas ?? [])
      if (atual.has(indiceAcao)) atual.delete(indiceAcao); else atual.add(indiceAcao)
      return { ...x, confirmadas: [...atual] }
    }))
  }

  async function aplicar(indice: number, msg: Mensagem) {
    const acoes = msg.acoes ?? []
    const confirmadas = new Set(msg.confirmadas ?? [])
    // só as suspeitas que o admin marcou levam o carimbo de confirmação extra
    const envio = acoes.map((a, j) => a.suspeita && confirmadas.has(j) ? { ...a, confirmada_suspeita: true } : a)
    setAplicando(true)
    try {
      const { data, error } = await supabase.functions.invoke('precos-ia', {
        body: { modo: 'aplicar', acoes: envio },
      })
      if (error || !data?.ok) throw new Error(await motivoDoErro(error, data) ?? '')
      setMensagens(m => m.map((x, i) => i === indice ? { ...x, aplicado: true, loteId: data.lote_id } : x))
      setMensagens(m => [...m, { papel: 'ia', texto: `Aplicado! ✅\n${(data.aplicadas as string[]).join('\n')}\nSe quiser voltar atrás, use "Desfazer tudo" na proposta ou no histórico.` }])
      queryClient.invalidateQueries({ queryKey: ['precos'] })
      toast('success', `${acoes.length} mudança${acoes.length > 1 ? 's' : ''} aplicada${acoes.length > 1 ? 's' : ''}!`)
    } catch (err) {
      const motivo = err instanceof Error && err.message ? err.message : null
      toast('error', motivo ?? 'Erro ao aplicar — confira o histórico ao lado para ver o que entrou',
        { duration: 9000 })
      if (motivo) {
        setMensagens(m => [...m, { papel: 'ia', texto: `Não consegui aplicar: ${motivo}` }])
      }
    } finally {
      setAplicando(false)
    }
  }

  function descartar(indice: number) {
    setMensagens(m => m.map((msg, i) => i === indice ? { ...msg, aplicado: false, acoes: undefined } : msg))
    setMensagens(m => [...m, { papel: 'ia', texto: 'Beleza, descartei. Me diz como prefere então!' }])
  }

  const ocupadoGeral = pensando || aplicando || desfazendoLote
  const fimGravacao = gravador.maxSegundos - gravador.segundos

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Chat */}
      <div className="lg:col-span-2 rounded-xl border-2 bg-card shadow-sm overflow-hidden flex flex-col">
        <div className="flex items-center gap-2.5 border-b px-5 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <h2 className="font-display text-sm font-semibold tracking-wide">Assistente de Preços</h2>
          <span className="ml-auto rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
            propõe → você confirma
          </span>
          {mensagens.length > 1 && (
            <button
              type="button"
              onClick={() => setMensagens([SAUDACAO])}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Limpar conversa (as alterações continuam no histórico ao lado)"
              aria-label="Limpar conversa"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ maxHeight: 520, minHeight: 280 }}>
          {mensagens.map((m, i) => {
            const suspeitas = (m.acoes ?? []).flatMap((a, j) => a.suspeita ? [j] : [])
            const faltaConfirmar = suspeitas.some(j => !(m.confirmadas ?? []).includes(j))
            return (
              <div key={i} className={cn('flex', m.papel === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'rounded-2xl px-3.5 py-2.5 text-sm',
                  m.papel === 'user' ? 'max-w-[85%] whitespace-pre-wrap bg-brand-gradient text-white shadow-brand' : 'max-w-[92%] bg-muted text-foreground',
                )}>
                  {m.papel === 'user' ? (
                    <>
                      {m.audio && (
                        <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/80">
                          <Mic className="h-3 w-3" aria-hidden="true" /> o que entendi do áudio
                          {m.pendente && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                        </span>
                      )}
                      {m.texto}
                    </>
                  ) : <Resposta texto={m.texto} />}
                  {m.acoes && (
                    <div className="mt-2.5 space-y-1.5 rounded-xl border-2 border-primary/25 bg-card p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                        Mudanças propostas ({m.acoes.length})
                      </p>
                      {m.acoes.map((a, j) => a.suspeita ? (
                        <div key={j} className="rounded-lg border-2 border-amber-500/60 bg-amber-500/5 px-2.5 py-2">
                          <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>{descreverAcao(a)}</span>
                          </p>
                          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{a.motivo}</p>
                          {m.aplicado === undefined && (
                            <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-foreground">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-amber-500"
                                checked={(m.confirmadas ?? []).includes(j)}
                                onChange={() => alternarConfirmacao(i, j)}
                                disabled={aplicando}
                              />
                              Confirmo que o valor {fmtNum(a.valor)} é este mesmo
                            </label>
                          )}
                        </div>
                      ) : (
                        <p key={j} className="text-xs font-medium">• {descreverAcao(a)}</p>
                      ))}
                      {m.aplicado === undefined ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button variant="brand" size="sm" onClick={() => aplicar(i, m)}
                            disabled={aplicando || faltaConfirmar} loading={aplicando}
                            title={faltaConfirmar ? 'Marque a confirmação nas mudanças em destaque' : undefined}>
                            {!aplicando && <Check className="h-3.5 w-3.5" />}
                            Aplicar
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => descartar(i)} disabled={aplicando}>
                            <X className="h-3.5 w-3.5" /> Descartar
                          </Button>
                          {faltaConfirmar && (
                            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                              Confirme as mudanças em destaque para aplicar
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <p className={cn('text-xs font-bold', m.aplicado ? 'text-emerald-600' : 'text-muted-foreground')}>
                            {m.aplicado ? (m.desfeito ? '✓ Aplicado e depois desfeito' : '✓ Aplicado') : 'Descartado'}
                          </p>
                          {m.aplicado && m.loteId && !m.desfeito && (
                            <Button variant="outline" size="sm" onClick={() => desfazerLote(m.loteId!)}
                              disabled={desfazendoLote || desfazendo != null} loading={desfazendoLote}>
                              {!desfazendoLote && <Undo2 className="h-3 w-3" />} Desfazer tudo
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {pensando && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-muted px-3.5 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div ref={fimRef} />
        </div>

        {gravador.erro && (
          <div role="alert" className="flex items-start gap-2 border-t border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="flex-1">{gravador.erro}</span>
            <button type="button" onClick={gravador.limparErro} aria-label="Fechar aviso" className="rounded p-0.5 hover:bg-amber-500/10">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {gravador.ocupado ? (
          <div className="flex items-center gap-3 border-t px-4 py-3" role="status" aria-live="polite">
            {gravador.estado === 'gravando' ? (
              <>
                <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatarSegundos(gravador.segundos)} <span className="font-normal text-muted-foreground">/ {formatarSegundos(gravador.maxSegundos)}</span>
                </span>
                <span className="hidden flex-1 text-xs text-muted-foreground sm:block">
                  {fimGravacao <= 10 ? `Para sozinho em ${fimGravacao}s` : 'Fale o pedido; toque em Enviar quando terminar'}
                </span>
                <span className="flex-1 sm:hidden" />
                <Button variant="ghost" size="sm" onClick={gravador.cancelar} aria-label="Cancelar gravação">
                  <X className="h-3.5 w-3.5" /> Cancelar
                </Button>
                <Button variant="brand" size="sm" onClick={gravador.parar} aria-label="Parar gravação e enviar">
                  <Send className="h-3.5 w-3.5" /> Enviar
                </Button>
              </>
            ) : (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {gravador.estado === 'pedindo-permissao' ? 'Aguardando permissão do microfone…' : 'Preparando o áudio…'}
              </span>
            )}
          </div>
        ) : (
          <div className="flex gap-2 border-t px-4 py-3">
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar() } }}
              placeholder='Ex.: "quais são todas as margens?" ou "sobe o markup de venda para 2,9"'
              aria-label="Mensagem para o assistente de preços"
              className={cn(campo, 'flex-1')}
            />
            <Button variant="outline" onClick={() => void gravador.iniciar()} disabled={ocupadoGeral}
              title={gravador.indisponivel ?? 'Falar o pedido (até 90 s)'} aria-label="Gravar pedido por voz"
              className={gravador.indisponivel ? 'opacity-60' : undefined}>
              <Mic className="h-4 w-4 text-primary" />
            </Button>
            <Button variant="brand" onClick={() => void enviar()} disabled={ocupadoGeral || !texto.trim()} aria-label="Enviar">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Histórico */}
      <div className="rounded-xl border-2 bg-card shadow-sm overflow-hidden">
        <div className="flex items-center gap-2.5 border-b px-5 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <h2 className="font-display text-sm font-semibold tracking-wide">Últimas alterações</h2>
          <span className="ml-auto text-[10px] text-muted-foreground">o valor anterior fica guardado</span>
        </div>
        {lote && lote.linhas.length > 1 && (
          <div className="flex items-center gap-2 border-b bg-muted/40 px-5 py-2.5">
            <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              Último pedido aplicado: <strong className="text-foreground">{lote.linhas.length} alterações</strong>
              {' · '}{new Date(lote.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
            <Button variant="outline" size="sm" onClick={() => desfazerLote(lote.loteId)}
              disabled={desfazendoLote || desfazendo != null} loading={desfazendoLote}>
              {!desfazendoLote && <Undo2 className="h-3 w-3" />} Desfazer tudo
            </Button>
          </div>
        )}
        <div className="divide-y">
          {(auditoria ?? []).length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhuma alteração pela IA ainda.</p>
          )}
          {(auditoria ?? []).slice(0, 10).map(a => (
            <div key={a.id} className="flex items-start gap-2 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{descreverAcao({ tipo: a.acao, ...a.detalhe })}</p>
                {valorAnterior(a.detalhe) && (
                  <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">
                    antes: {valorAnterior(a.detalhe)}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {a.usuario} · {new Date(a.criado_em).toLocaleString('pt-BR')}
                </p>
              </div>
              {TIPOS_REVERSIVEIS.has(a.acao) && (
                <button onClick={() => desfazer(a)} disabled={desfazendo != null || desfazendoLote}
                  title="Desfazer esta alteração"
                  className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground active:scale-95 disabled:opacity-50">
                  {desfazendo === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                  Desfazer
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
