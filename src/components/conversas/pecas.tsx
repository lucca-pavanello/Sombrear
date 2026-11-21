import type { ButtonHTMLAttributes, ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

/** Peças pequenas que a lista, o chat e o campo de envio dividem. */

/** Iniciais num círculo neutro: numa lista de cem conversas, cem círculos laranja gritariam. */
export function Iniciais({ nome, className }: { nome: string; className?: string }) {
  const letras = nome.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()
  return (
    <span aria-hidden="true" className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground', className)}>
      {letras || '#'}
    </span>
  )
}

/** Botão só de ícone, com o rótulo no title e no leitor de tela. */
export function BotaoIcone({ rotulo, ativo, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string; ativo?: boolean }) {
  return (
    <button
      type="button" title={rotulo} aria-label={rotulo}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50',
        ativo ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

const OVERLAY = 'fixed inset-0 z-[60] bg-black/50 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

/** Pergunta antes de agir (pausar a IA, encerrar): mesmo modal do "Excluir esta venda?". */
export function Confirmar({ aberto, titulo, children, rotuloConfirmar, ocupado, erro, aoConfirmar, aoFechar }: {
  aberto: boolean
  titulo: string
  children: ReactNode
  rotuloConfirmar: string
  ocupado?: boolean
  erro?: string | null
  aoConfirmar: () => void
  aoFechar: () => void
}) {
  return (
    <Dialog.Root open={aberto} onOpenChange={a => { if (!a && !ocupado) aoFechar() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <Dialog.Title className="font-display text-base font-semibold">{titulo}</Dialog.Title>
          <div className="mt-2 text-sm text-muted-foreground">{children}</div>
          {erro && <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{erro}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={aoFechar} disabled={ocupado}>Cancelar</Button>
            <Button onClick={aoConfirmar} loading={ocupado}>{rotuloConfirmar}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A foto em tela cheia; Esc ou clique fora fecha. */
export function ImagemAmpliada({ url, aoFechar }: { url: string | null; aoFechar: () => void }) {
  return (
    <Dialog.Root open={!!url} onOpenChange={a => { if (!a) aoFechar() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(OVERLAY, 'bg-black/80')} />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-[70] max-h-[92dvh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 outline-none">
          <Dialog.Title className="sr-only">Imagem ampliada</Dialog.Title>
          {url && <img src={url} alt="Imagem ampliada" className="mx-auto max-h-[88dvh] max-w-full rounded-lg object-contain" />}
          <Dialog.Close title="Fechar" aria-label="Fechar" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
            <X className="h-4 w-4" aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
