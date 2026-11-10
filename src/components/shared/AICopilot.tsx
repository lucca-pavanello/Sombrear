import { useState, useRef, useEffect, memo, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { X, Send, Sparkles, RotateCcw, Mic, MicOff, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGemini } from '@/hooks/useGemini'
import { blocosDaResposta, partesDoTexto, type Bloco } from '@/lib/respostaIA'

// Só pergunta que as ferramentas do copilot respondem. A lista muda com a área do dash em que
// a pessoa está (rota); fora das áreas conhecidas vale a lista de vendas e leads.
type Area = 'orcamentos' | 'vendas' | 'agente-ia' | 'geral'

const SUGESTOES_GERAIS = [
  'Qual modelo mais vendeu este mês?',
  'Quem está quente e ainda não fechou?',
  'Como está a margem deste mês contra o mês passado?',
  'Quais leads estão parados há mais de 7 dias?',
]

const AREAS: Record<Area, { sugestoes: string[]; dica: string }> = {
  orcamentos: {
    dica: 'Pergunte sobre a fila de orçamentos',
    sugestoes: [
      'Quanto tenho parado em orçamentos em aberto?',
      'Quais orçamentos estão há mais de 30 dias sem resposta?',
      'Por que perdemos orçamentos este mês?',
      'Quais são os 5 maiores orçamentos em aberto?',
    ],
  },
  vendas: {
    dica: 'Pergunte sobre as vendas',
    sugestoes: SUGESTOES_GERAIS,
  },
  'agente-ia': {
    dica: 'Pergunte sobre os leads',
    sugestoes: [
      'Quem está quente e ainda não fechou?',
      'Quais leads estão parados há mais de 7 dias?',
      'Qual canal trouxe mais leads este mês?',
      'Qual canal converte melhor?',
    ],
  },
  geral: { dica: 'Pergunte, por exemplo', sugestoes: SUGESTOES_GERAIS },
}

/** Rota -> área. As abas de orçamento moram em /orcamentos/* e também em rotas soltas legadas. */
function areaDaRota(pathname: string): Area {
  const raiz = pathname.replace(/^\/+/, '').split('/')[0]
  if (['orcamentos', 'acompanhar', 'planilha', 'calcular-orcamento'].includes(raiz)) return 'orcamentos'
  if (['fechamento', 'relatorios', 'analises'].includes(raiz)) return 'vendas'
  if (raiz === 'agente-ia') return 'agente-ia'
  return 'geral'
}

interface Props {
  open: boolean
  onClose: () => void
  /** vendedor em foco no dash: o copilot passa a olhar só as vendas dele */
  responsavel?: string | null
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-1 px-3 py-2.5">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  )
}

// ── Resposta em blocos ────────────────────────────────────────────
// O balão não preservava quebra de linha e o markdown saía cru (`**`, `|`).
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
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-center text-xs tabular-nums">
        <thead>
          <tr className="border-b border-border">
            {bloco.cabecalho.map((c, i) => (
              <th key={i} scope="col" className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                <Texto texto={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bloco.linhas.map((l, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {l.map((c, j) => <td key={j} className="px-2 py-1.5 whitespace-nowrap"><Texto texto={c} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Resposta({ texto }: { texto: string }) {
  const blocos = blocosDaResposta(texto)
  return <div className="space-y-2">{blocos.map((b, i) => <BlocoResposta key={i} bloco={b} />)}</div>
}

// ── Web Speech API types ──────────────────────────────────────────
type SpeechRecognitionAny = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (e: { results: { [key: number]: { [key: number]: { transcript: string } }; length: number } }) => void
  onerror: () => void
  onend: () => void
  start: () => void
  stop: () => void
  abort: () => void
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionAny
    webkitSpeechRecognition?: new () => SpeechRecognitionAny
  }
}

const hasSpeech = typeof window !== 'undefined' && (!!window.SpeechRecognition || !!window.webkitSpeechRecognition)

function AICopilot({ open, onClose, responsavel }: Props) {
  const { messages, isLoading, sendMessage, repetir, clearChat } = useGemini()
  const { pathname } = useLocation()
  const area = AREAS[areaDaRota(pathname)]
  const [input, setInput] = useState('')
  const [isListening, setIsListening] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognitionAny | null>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  function handleSend() {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    sendMessage(text, { responsavel })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSuggestion(s: string) {
    sendMessage(s, { responsavel })
  }

  const toggleVoice = useCallback(() => {
    if (!hasSpeech) return
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = 'pt-BR'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      setInput(prev => prev ? prev + ' ' + transcript : transcript)
    }
    rec.onerror = () => { setIsListening(false) }
    rec.onend = () => { setIsListening(false) }
    recognitionRef.current = rec
    rec.start()
    setIsListening(true)
  }, [isListening])

  // Stop recognition when panel closes
  useEffect(() => {
    if (!open && isListening) {
      recognitionRef.current?.abort()
      setIsListening(false)
    }
  }, [open, isListening])

  if (!open) return null

  return (
    <>
      {/* Backdrop sutil */}
      <div className="fixed inset-0 z-[489]" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="copilot-titulo"
        className={cn(
        'fixed bottom-20 right-4 z-[490] flex flex-col',
        'w-[min(360px,calc(100vw-2rem))] max-h-[min(560px,calc(100dvh-6.5rem))] min-h-[200px]',
        'rounded-2xl border-2 border-primary/20 bg-card shadow-2xl',
        'dark:bg-card/90 dark:backdrop-blur-xl',
        'animate-in slide-in-from-bottom-4 fade-in duration-200',
      )}>
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3 rounded-t-2xl bg-primary/[0.04]">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-gradient shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p id="copilot-titulo" className="text-sm font-semibold leading-none">Copilot Sombrear</p>
            {/* o escopo, não o fornecedor: "consulta" diz que ele não mexe em nada */}
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {responsavel ? `Foco em ${responsavel}: vendas, orçamentos e leads` : 'Consulta vendas, orçamentos e leads'}
            </p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Limpar conversa"
              aria-label="Limpar conversa"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Fechar (Esc)"
            aria-label="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Área de mensagens */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 min-h-0" aria-live="polite">
          {messages.length === 0 && !isLoading && (
            <div className="space-y-3">
              <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pt-2">
                {area.dica}
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {area.sugestoes.map(s => (
                  <button
                    key={s}
                    data-sugestao
                    onClick={() => handleSuggestion(s)}
                    className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-left text-xs text-foreground/80 hover:bg-muted hover:text-foreground transition-colors leading-snug"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => m.erro ? (
            // aviso, não resposta: frase pronta do hook e o jeito de tentar de novo ali mesmo
            <div
              key={i}
              role="alert"
              className={cn(
                'mr-auto max-w-[88%] rounded-2xl rounded-bl-sm bg-destructive/[0.07] px-3.5 py-2.5 text-sm leading-relaxed text-destructive ring-1 ring-inset ring-destructive/20',
                'animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
              )}
            >
              <p className="flex items-start gap-1.5">
                <AlertCircle className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {m.text}
              </p>
              {i === messages.length - 1 && (
                <button
                  type="button"
                  onClick={repetir}
                  disabled={isLoading}
                  className="mt-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold text-destructive underline-offset-2 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                >
                  Tentar de novo
                </button>
              )}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                m.role === 'user'
                  ? 'ml-auto bg-primary/[0.12] text-foreground rounded-br-sm'
                  : 'mr-auto bg-muted/70 text-foreground rounded-bl-sm',
                'animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
              )}
            >
              {m.role === 'user' ? m.text : <Resposta texto={m.text} />}
            </div>
          ))}

          {isLoading && (
            <div className="mr-auto bg-muted/70 rounded-2xl rounded-bl-sm animate-in fade-in duration-150">
              <TypingIndicator />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border/60 p-3">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 focus-within:border-primary/50 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte algo… (Enter para enviar)"
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 max-h-24"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            {hasSpeech && (
              <button
                onClick={toggleVoice}
                className={cn(
                  'shrink-0 rounded-lg p-1.5 transition-all active:scale-95',
                  isListening
                    ? 'bg-rose-500/15 text-rose-500 animate-pulse'
                    : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted'
                )}
                title={isListening ? 'Parar gravação' : 'Ditado por voz (pt-BR)'}
                aria-label={isListening ? 'Parar gravação' : 'Falar'}
              >
                {isListening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="shrink-0 rounded-lg bg-primary p-1.5 text-white disabled:opacity-40 hover:bg-primary/90 transition-all active:scale-95"
              aria-label="Enviar"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export default memo(AICopilot)
