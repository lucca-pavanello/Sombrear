import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bot, FileText, Mic, Paperclip, Send, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { useEnviarMensagem } from '@/hooks/useConversas'
import { useGravadorVoz } from '@/hooks/useGravadorVoz'
import { ACEITA, problemaDoArquivo, tamanhoLegivel, tipoDoArquivo } from '@/lib/conversas/anexos'
import { podeGravarAudio, tempoDeGravacao } from '@/lib/conversas/audioMp3'
import { audioParaVoz, ehVoz } from '@/lib/conversas/audioOgg'
import type { Conversa } from '@/lib/conversas/lista'
import { cn } from '@/lib/utils'
import { BotaoIcone } from './pecas'

/**
 * Onde a equipe escreve. Enter envia no computador, Shift+Enter quebra linha; no celular o Enter
 * quebra linha e o botão envia. O texto só some quando o servidor confirmou o envio. O que ficou
 * escrito e não foi enviado espera em cada conversa até voltar nela (sessionStorage).
 * Adaptado do Compositor do CRM da MIP, sem respostas rápidas e sem modelos (V2).
 */
const chaveRascunho = (id: number) => `sombrear-rascunho-${id}`
const lerRascunho = (id: number) => { try { return sessionStorage.getItem(chaveRascunho(id)) ?? '' } catch { return '' } }

/** áudio que o WhatsApp aceita como arquivo quando o navegador não consegue transformar em voz */
const AUDIO_ACEITO = ['audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr']

export default function Compositor({ conversa }: { conversa: Conversa }) {
  const id = conversa.conversa_id
  const [texto, setTexto] = useState(() => lerRascunho(id))
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [preparando, setPreparando] = useState(false)
  const campo = useRef<HTMLTextAreaElement>(null)
  const seletor = useRef<HTMLInputElement>(null)
  const enviar = useEnviarMensagem()
  const gravador = useGravadorVoz()
  const ocupado = enviar.isPending || preparando
  const ehAudio = arquivo ? tipoDoArquivo(arquivo.type, arquivo.name) === 'audio' : false

  // rascunho por conversa: trocar de conversa no meio da frase não perde o texto
  useEffect(() => {
    try { if (texto) sessionStorage.setItem(chaveRascunho(id), texto); else sessionStorage.removeItem(chaveRascunho(id)) } catch { /* ok */ }
  }, [texto, id])

  // o campo cresce com o texto, até 6 linhas
  useEffect(() => {
    const el = campo.current
    if (!el) return
    el.style.height = 'auto'
    // + a borda (offsetHeight - clientHeight): sem ela sobram 2px e aparece uma barra de rolagem
    el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, 160)}px`
  }, [texto])

  const previa = useMemo(() => (arquivo && tipoDoArquivo(arquivo.type, arquivo.name) === 'imagem' ? URL.createObjectURL(arquivo) : null), [arquivo])
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa) }, [previa])

  const podeEnviar = !ocupado && (texto.trim().length > 0 || !!arquivo)
  const falhou = (e: Error) => setErro(e.message)

  function escolher(f: File | undefined) {
    if (!f) return
    const problema = problemaDoArquivo(f)
    if (problema) { setErro(problema); return }
    setErro(null)
    setArquivo(f)
    campo.current?.focus()
  }

  /** o áudio como sai: voz (OGG/Opus, converte se precisar) ou, sem conseguir, o arquivo como veio */
  async function prepararAudio(a: File): Promise<{ arquivo: File; voz: boolean }> {
    if (ehVoz(a)) return { arquivo: a, voz: true }
    setPreparando(true)
    try { return { arquivo: await audioParaVoz(a), voz: true } } catch {
      if (AUDIO_ACEITO.includes(a.type.split(';')[0]!)) return { arquivo: a, voz: false }
      throw new Error('Não consegui preparar esse áudio aqui. Mande em MP3 ou grave pelo microfone.')
    } finally { setPreparando(false) }
  }

  /** áudio escolhido pelo clipe: o texto, se tiver, sai antes como mensagem, e o áudio logo depois */
  async function mandarArquivoDeAudio(a: File) {
    try {
      const pronto = await prepararAudio(a)
      if (texto.trim()) { await enviar.mutateAsync({ conversaId: id, texto: texto.trim() }); setTexto('') }
      await enviar.mutateAsync({ conversaId: id, arquivo: pronto.arquivo, voz: pronto.voz })
      setArquivo(null)
    } catch (e) { falhou(e as Error) }
  }

  function mandar() {
    if (!podeEnviar) return
    setErro(null)
    if (arquivo && ehAudio) { void mandarArquivoDeAudio(arquivo); return }
    if (arquivo) {
      enviar.mutate({ conversaId: id, arquivo, texto }, { onSuccess: () => { setArquivo(null); setTexto('') }, onError: falhou })
    } else {
      enviar.mutate({ conversaId: id, texto: texto.trim() }, { onSuccess: () => { setTexto(''); campo.current?.focus() }, onError: falhou })
    }
  }

  async function gravar() {
    setErro(null)
    const e = await gravador.iniciar()
    if (e) setErro(e)
  }

  /** para, prepara como voz (OGG/Opus; MP3 se o navegador não der) e manda; se falhar, fica anexado */
  async function mandarGravacao() {
    let r: { arquivo: File; voz: boolean } | null = null
    try { r = await gravador.concluir() } catch { setErro('Não consegui preparar o áudio. Grave de novo.'); return }
    if (!r) { setErro('O áudio veio vazio. Grave de novo.'); return }
    const pronto = r.arquivo
    enviar.mutate({ conversaId: id, arquivo: pronto, voz: r.voz }, {
      onError: e => { setArquivo(pronto); setErro(`${e.message} O áudio ficou anexado: toque em enviar pra tentar de novo.`) },
    })
  }

  if (gravador.estado !== 'livre') {
    const convertendo = gravador.estado === 'convertendo'
    return (
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-3 sm:px-4" role="status">
        <BotaoIcone rotulo="Descartar gravação" onClick={gravador.cancelar} disabled={convertendo}><Trash2 className="h-4 w-4" aria-hidden="true" /></BotaoIcone>
        <span className="flex flex-1 items-center gap-2 text-sm">
          <span className={cn('h-2.5 w-2.5 rounded-full bg-destructive', gravador.estado === 'gravando' && !gravador.noTeto && 'animate-pulse')} aria-hidden="true" />
          <span className="font-semibold tabular-nums">{tempoDeGravacao(gravador.segundos)}</span>
          <span className="text-muted-foreground">
            {gravador.estado === 'pedindo' ? 'Liberando o microfone...' : convertendo ? 'Preparando o áudio...' : gravador.noTeto ? 'Limite de 5 min. Envie ou descarte.' : 'Gravando'}
          </span>
        </span>
        <Button onClick={() => void mandarGravacao()} disabled={gravador.estado !== 'gravando'} loading={convertendo}>
          {!convertendo && <Send className="h-4 w-4" aria-hidden="true" />}Enviar áudio
        </Button>
      </div>
    )
  }

  const microfone = !texto.trim() && !arquivo && podeGravarAudio()

  return (
    <form className="shrink-0 border-t border-border px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4" onSubmit={e => { e.preventDefault(); mandar() }}>
      {arquivo && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-2">
          {previa
            ? <img src={previa} alt="" className="h-12 w-12 rounded-md object-cover" />
            : <span className="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground"><FileText className="h-5 w-5" aria-hidden="true" /></span>}
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium">{arquivo.name}</p>
            <p className="text-xs text-muted-foreground">
              {tamanhoLegivel(arquivo.size)}
              {ehAudio ? (preparando ? ' · preparando o áudio de voz…' : ' · vai como áudio gravado; texto, se tiver, sai antes') : ' · escreva a legenda abaixo, se quiser'}
            </p>
          </div>
          <BotaoIcone rotulo="Tirar anexo" onClick={() => setArquivo(null)} disabled={ocupado}><X className="h-4 w-4" aria-hidden="true" /></BotaoIcone>
        </div>
      )}
      {erro && (
        <p role="alert" className="mb-2 flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {erro}
        </p>
      )}
      <div className="flex items-end gap-1.5">
        <input ref={seletor} type="file" accept={ACEITA} className="hidden" onChange={e => { escolher(e.target.files?.[0]); e.target.value = '' }} />
        <textarea
          ref={campo} rows={1} value={texto} onChange={e => setTexto(e.target.value)}
          onKeyDown={e => {
            // Enter envia só com mouse e teclado; no celular a tecla é de quebrar linha
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault()
              mandar()
            }
          }}
          placeholder={arquivo ? (ehAudio ? 'Texto opcional: sai antes do áudio' : 'Legenda (opcional)') : 'Mensagem'}
          aria-label="Mensagem"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-base leading-snug outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-muted-foreground/40 focus:border-primary focus:ring-2 focus:ring-primary/15 sm:text-sm"
        />
        <BotaoIcone rotulo="Anexar foto, vídeo, áudio ou documento (até 16 MB)" onClick={() => seletor.current?.click()} disabled={ocupado} className="h-10 w-10">
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </BotaoIcone>
        {microfone ? (
          <BotaoIcone rotulo="Gravar áudio" onClick={() => void gravar()} disabled={ocupado} className="h-10 w-10"><Mic className="h-4 w-4" aria-hidden="true" /></BotaoIcone>
        ) : (
          <Button type="submit" loading={ocupado} disabled={!podeEnviar} aria-label="Enviar" title="Enviar" className="h-10 shrink-0 px-3">
            {!ocupado && <Send className="h-4 w-4" aria-hidden="true" />}
          </Button>
        )}
      </div>
      {!conversa.ia_pausada && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Bot className="h-3 w-3" aria-hidden="true" /> Enviar por aqui pausa a IA nesta conversa.
        </p>
      )}
    </form>
  )
}
