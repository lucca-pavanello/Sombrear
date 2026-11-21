import { Headset } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A equipe assumiu a conversa — a IA está calada ali. Não é alerta: é informação de estado. */
export default function SeloComEquipe({ className }: { className?: string }) {
  return (
    <span
      title="Uma atendente assumiu esta conversa — a IA não responde aqui"
      className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap text-muted-foreground', className)}
    >
      <Headset className="h-2.5 w-2.5 shrink-0 text-sky-600 dark:text-sky-400" />
      com a equipe
    </span>
  )
}
