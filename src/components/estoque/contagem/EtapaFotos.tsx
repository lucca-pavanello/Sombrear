import { useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, Lightbulb, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { reduzirImagem, type FotoPreparada, type EstadoLeitura } from '@/hooks/useContagemFoto'
import { MAX_IMAGENS } from '@/lib/estoque/contagem-resposta'
import type { ToastType } from '@/hooks/useToast'

interface Props {
  fotos: FotoPreparada[]
  onChange: (fotos: FotoPreparada[]) => void
  leitura: EstadoLeitura
  onLer: () => void
  onVoltarConferencia?: () => void
  toast: (type: ToastType, message: string) => void
}

const DICAS = [
  'Boa luz, sem sombra da mão ou do celular em cima da página.',
  'A página inteira na foto, com as bordas visíveis.',
  'Uma página por foto, o mais reta possível (de cima, não de lado).',
  `No máximo ${MAX_IMAGENS} fotos por vez.`,
]

export default function EtapaFotos({ fotos, onChange, leitura, onLer, onVoltarConferencia, toast }: Props) {
  const camRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)
  const [preparando, setPreparando] = useState(false)
  const lendo = leitura.fase === 'lendo'

  async function adicionar(files: FileList | null) {
    if (!files || files.length === 0) return
    const lista = Array.from(files).filter((f) => f.type.startsWith('image/'))
    const vagas = MAX_IMAGENS - fotos.length
    if (vagas <= 0) { toast('error', `Limite de ${MAX_IMAGENS} fotos. Remova uma para adicionar outra.`); return }
    if (lista.length > vagas) toast('error', `Só cabem mais ${vagas} foto${vagas > 1 ? 's' : ''}; as outras foram ignoradas.`)
    setPreparando(true)
    const novas: FotoPreparada[] = []
    for (const f of lista.slice(0, vagas)) {
      try {
        novas.push(await reduzirImagem(f))
      } catch {
        toast('error', `Não consegui abrir "${f.name}". Use uma foto JPEG, PNG ou WebP.`)
      }
    }
    setPreparando(false)
    if (novas.length) onChange([...fotos, ...novas])
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Para a leitura sair certa
        </p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
          {DICAS.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <input ref={camRef} type="file" accept="image/*" capture="environment" multiple className="hidden"
          onChange={(e) => { void adicionar(e.target.files); e.target.value = '' }} />
        <input ref={galeriaRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { void adicionar(e.target.files); e.target.value = '' }} />
        <Button variant="outline" onClick={() => camRef.current?.click()} disabled={preparando || lendo || fotos.length >= MAX_IMAGENS}>
          <Camera className="h-4 w-4" aria-hidden="true" /> Tirar foto
        </Button>
        <Button variant="outline" onClick={() => galeriaRef.current?.click()} disabled={preparando || lendo || fotos.length >= MAX_IMAGENS}>
          <ImagePlus className="h-4 w-4" aria-hidden="true" /> Escolher da galeria
        </Button>
        {preparando && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Preparando fotos…
          </span>
        )}
      </div>

      {fotos.length > 0 ? (
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {fotos.map((f, i) => (
            <li key={f.id} className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
              <img src={f.previa} alt={`Página ${i + 1} do caderno`} className="aspect-[3/4] w-full object-cover" />
              <span className="absolute left-1.5 top-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">{i + 1}</span>
              <button
                type="button"
                onClick={() => onChange(fotos.filter((x) => x.id !== f.id))}
                disabled={lendo}
                aria-label={`Remover foto ${i + 1}`}
                className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 text-foreground shadow-sm hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma foto ainda. Tire foto das páginas do caderno ou escolha da galeria.
        </p>
      )}

      {leitura.fase === 'erro' && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 px-3 py-2.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{leitura.mensagem}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {onVoltarConferencia && (
          <Button variant="ghost" onClick={onVoltarConferencia} disabled={lendo}>Voltar para a conferência</Button>
        )}
        <Button onClick={onLer} loading={lendo} disabled={fotos.length === 0 || preparando}>
          {lendo ? 'Lendo as fotos…' : leitura.fase === 'erro' ? 'Tentar de novo' : 'Ler fotos'}
        </Button>
      </div>
      {lendo && <p className="text-right text-xs text-muted-foreground">Pode levar até um minuto. Suas fotos ficam aqui se der erro.</p>}
    </div>
  )
}
