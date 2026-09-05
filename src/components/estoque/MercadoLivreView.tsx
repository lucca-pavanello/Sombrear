import { useState, useMemo, useRef } from 'react'
import { Check, AlertCircle, Upload, X, ImageOff, Pencil } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { tbl } from './shared/tableStyles'
import MlSemanaCard from './MlSemanaCard'
import { useEstoqueSobras } from '@/hooks/useEstoqueSobras'
import { usePrecosMl, useSalvarPrecoMl, acharPrecoMl, precoDoAnuncio, type PrecoMl } from '@/hooks/usePrecosMl'
import {
  useSobrasFotos, useEnviarFoto, TIPOS_FOTO, SPEC_FOTO, chaveTecido,
  type TipoFoto, type SobraFoto,
} from '@/hooks/useSobrasFotos'

interface Props {
  toast: (type: 'success' | 'error' | 'info', message: string) => void
}

type Tecido = {
  chave: string
  familia: string
  abertura: string | null
  cor: string
  pecas: number
  areaTotal: number
  menorArea: number
  maiorArea: number
  preco: PrecoMl | null
  fotos: SobraFoto[]
}

const fmt = (n: number) => n.toFixed(2).replace('.', ',')

/**
 * Preparação dos anúncios do Mercado Livre.
 *
 * A tela responde uma pergunta só: **o que ainda falta pra este tecido poder ser
 * anunciado?** Um anúncio precisa de preço e de foto, e nenhum dos dois existia no
 * sistema — então sem um lugar que mostre o que falta, "publicar automaticamente" ia
 * falhar peça a peça sem ninguém entender por quê.
 *
 * Agrupa por TECIDO, não por peça: as 153 sobras cabem em ~30 combinações de
 * família+abertura+cor, e preço e fotos são definidos uma vez por tecido e valem pra
 * todas as peças dele.
 *
 * Publicar de fato ainda não acontece aqui — depende de credencial do ML e da prova de
 * fogo (um anúncio à mão pela API) que valida se foto é mesmo obrigatória, que frete a
 * categoria aceita e se anúncios parecidos sobrevivem à moderação por duplicidade.
 */
export default function MercadoLivreView({ toast }: Props) {
  const { data: sobras = [] } = useEstoqueSobras({ incluirVendidas: false })
  const { data: precos = [] } = usePrecosMl()
  const { data: fotos = [] } = useSobrasFotos()
  const salvarPreco = useSalvarPrecoMl()
  const enviarFoto = useEnviarFoto()

  const [aberto, setAberto] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<{ preco_m2: string; preco_minimo: string }>({ preco_m2: '', preco_minimo: '' })
  const [enviando, setEnviando] = useState<string | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const tecidos = useMemo<Tecido[]>(() => {
    const mapa = new Map<string, Tecido>()
    for (const s of sobras) {
      const chave = chaveTecido(s)
      const at = mapa.get(chave) ?? {
        chave, familia: s.familia, abertura: s.abertura, cor: s.cor,
        pecas: 0, areaTotal: 0, menorArea: Infinity, maiorArea: 0,
        preco: null, fotos: [],
      }
      at.pecas++
      at.areaTotal += s.area_m2
      at.menorArea = Math.min(at.menorArea, s.area_m2)
      at.maiorArea = Math.max(at.maiorArea, s.area_m2)
      mapa.set(chave, at)
    }
    for (const t of mapa.values()) {
      t.preco = acharPrecoMl(precos, t)
      t.fotos = fotos.filter(f => chaveTecido(f) === t.chave)
    }
    return [...mapa.values()].sort((a, b) => b.pecas - a.pecas)
  }, [sobras, precos, fotos])

  const prontos = tecidos.filter(t => t.preco && t.fotos.length === TIPOS_FOTO.length)
  const pecasProntas = prontos.reduce((s, t) => s + t.pecas, 0)

  function abrir(t: Tecido) {
    if (aberto === t.chave) { setAberto(null); return }
    setAberto(t.chave)
    setRascunho({
      preco_m2: t.preco ? String(t.preco.preco_m2).replace('.', ',') : '',
      preco_minimo: t.preco ? String(t.preco.preco_minimo).replace('.', ',') : '',
    })
  }

  async function salvar(t: Tecido) {
    const m2 = parseFloat(rascunho.preco_m2.replace(',', '.'))
    const min = parseFloat(rascunho.preco_minimo.replace(',', '.') || '0')
    if (!Number.isFinite(m2) || m2 <= 0) { toast('error', 'Informe o preço por m² maior que zero.'); return }
    try {
      await salvarPreco.mutateAsync({
        id: t.preco?.id,
        familia: t.familia, abertura: t.abertura, cor: t.cor,
        preco_m2: m2, preco_minimo: Number.isFinite(min) ? min : 0, ativo: true,
      })
      toast('success', `Preço de ${t.familia} ${t.cor} salvo.`)
    } catch {
      toast('error', 'Não consegui salvar o preço.')
    }
  }

  async function subir(t: Tecido, tipo: TipoFoto, arquivo: File | undefined) {
    if (!arquivo) return
    const id = `${t.chave}|${tipo}`
    setEnviando(id)
    try {
      await enviarFoto.mutateAsync({ arquivo, familia: t.familia, abertura: t.abertura, cor: t.cor, tipo })
      toast('success', 'Foto enviada.')
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Não consegui enviar a foto.')
    } finally {
      setEnviando(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* A medição de domingo vem primeiro: é o que já aconteceu lá fora. O resto da tela
          é preparação, e preparação sem leitura do mercado é chute. */}
      <MlSemanaCard />

      {/* Prontidão: o número que diz se dá pra começar ou não */}
      <div className={cn(tbl.container, 'px-5 py-4')}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-display text-sm font-semibold">
            {prontos.length} de {tecidos.length} tecidos prontos para anunciar
          </span>
          <span className="text-xs text-muted-foreground">
            — cobrem {pecasProntas} das {sobras.length} peças disponíveis
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Um tecido fica pronto quando tem <strong className="font-medium text-foreground">preço</strong> e as{' '}
          <strong className="font-medium text-foreground">{TIPOS_FOTO.length} fotos</strong>. Preço e fotos valem
          para todas as peças daquele tecido — define uma vez, serve pras {sobras.length}.
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          As imagens vão para o Mercado Livre pela URL, então precisam ser{' '}
          <strong className="font-medium">{SPEC_FOTO.ladoIdeal}×{SPEC_FOTO.ladoIdeal} px</strong> (mínimo{' '}
          {SPEC_FOTO.ladoMinimo}×{SPEC_FOTO.ladoMinimo}), JPG/PNG/WebP, até {SPEC_FOTO.tamanhoMaxMb} MB.
        </p>
      </div>

      <div className={tbl.container}>
        <div className="overflow-auto">
          <table className="w-full text-sm" style={{ minWidth: '760px' }}>
            <thead>
              <tr className={tbl.theadRow}>
                <th className={cn(tbl.th, 'text-left')}>Tecido</th>
                <th className={tbl.th}>Peças</th>
                <th className={tbl.th}>Área (menor–maior)</th>
                <th className={tbl.th}>Preço</th>
                <th className={tbl.th}>Fotos</th>
                <th className={cn(tbl.th, 'border-r-0')}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {tecidos.map(t => {
                const completo = !!t.preco && t.fotos.length === TIPOS_FOTO.length
                const estaAberto = aberto === t.chave
                return (
                  <>
                    <tr
                      key={t.chave}
                      onClick={() => abrir(t)}
                      className={cn(tbl.tbodyRow, 'cursor-pointer')}
                    >
                      <td className={cn(tbl.td, 'text-left font-medium')}>
                        {[t.familia, t.abertura, t.cor].filter(Boolean).join(' ')}
                      </td>
                      <td className={cn(tbl.td, 'tabular-nums')}>{t.pecas}</td>
                      <td className={cn(tbl.td, 'tabular-nums text-muted-foreground')}>
                        {fmt(t.menorArea)} – {fmt(t.maiorArea)} m²
                      </td>
                      <td className={cn(tbl.td, 'tabular-nums')}>
                        {t.preco
                          ? <>{formatCurrency(t.preco.preco_m2)}<span className="text-muted-foreground">/m²</span></>
                          : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className={cn(tbl.td, 'tabular-nums')}>
                        <span className={t.fotos.length === TIPOS_FOTO.length ? '' : 'text-muted-foreground'}>
                          {t.fotos.length}/{TIPOS_FOTO.length}
                        </span>
                      </td>
                      <td className={cn(tbl.td, 'border-r-0')}>
                        {completo ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <Check className="h-3 w-3" aria-hidden="true" /> Pronto
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            <AlertCircle className="h-3 w-3" aria-hidden="true" />
                            {!t.preco && t.fotos.length === 0 ? 'Falta tudo'
                              : !t.preco ? 'Falta preço'
                              : `Faltam ${TIPOS_FOTO.length - t.fotos.length} foto${TIPOS_FOTO.length - t.fotos.length > 1 ? 's' : ''}`}
                          </span>
                        )}
                      </td>
                    </tr>

                    {estaAberto && (
                      <tr key={t.chave + '-painel'}>
                        <td colSpan={6} className="border-b bg-muted/20 px-5 py-4">
                          <div className="grid gap-5 md:grid-cols-[minmax(0,300px)_1fr]">
                            {/* Preço */}
                            <div>
                              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                                <Pencil className="h-3 w-3 text-primary" aria-hidden="true" /> Preço no Mercado Livre
                              </h4>
                              <div className="space-y-2">
                                <label className="block">
                                  <span className="mb-1 block text-[11px] text-muted-foreground">Preço por m²</span>
                                  <input
                                    value={rascunho.preco_m2}
                                    onChange={e => setRascunho(r => ({ ...r, preco_m2: e.target.value }))}
                                    inputMode="decimal" placeholder="180,00"
                                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1 block text-[11px] text-muted-foreground">Valor mínimo do anúncio</span>
                                  <input
                                    value={rascunho.preco_minimo}
                                    onChange={e => setRascunho(r => ({ ...r, preco_minimo: e.target.value }))}
                                    inputMode="decimal" placeholder="150,00"
                                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                                  />
                                </label>
                                {(() => {
                                  const m2 = parseFloat(rascunho.preco_m2.replace(',', '.'))
                                  const min = parseFloat(rascunho.preco_minimo.replace(',', '.') || '0')
                                  if (!Number.isFinite(m2) || m2 <= 0) return null
                                  const falso = { preco_m2: m2, preco_minimo: Number.isFinite(min) ? min : 0 } as PrecoMl
                                  return (
                                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                                      As peças deste tecido sairiam de{' '}
                                      <span className="font-semibold tabular-nums text-foreground">{formatCurrency(precoDoAnuncio(t.menorArea, falso))}</span>{' '}
                                      a{' '}
                                      <span className="font-semibold tabular-nums text-foreground">{formatCurrency(precoDoAnuncio(t.maiorArea, falso))}</span>.
                                    </p>
                                  )
                                })()}
                                <button
                                  onClick={() => salvar(t)}
                                  disabled={salvarPreco.isPending}
                                  className="w-full rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow-brand transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
                                >
                                  {salvarPreco.isPending ? 'Salvando…' : 'Salvar preço'}
                                </button>
                              </div>
                            </div>

                            {/* Fotos */}
                            <div>
                              <h4 className="mb-2 text-xs font-semibold">Fotos deste tecido</h4>
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                {TIPOS_FOTO.map(tp => {
                                  const foto = t.fotos.find(f => f.tipo === tp.id)
                                  const id = `${t.chave}|${tp.id}`
                                  return (
                                    <div key={tp.id}>
                                      <button
                                        onClick={() => inputRefs.current[id]?.click()}
                                        className="group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border bg-background transition-colors hover:border-primary/50"
                                      >
                                        {foto ? (
                                          <img src={foto.url} alt={tp.rotulo} className="h-full w-full object-cover" />
                                        ) : (
                                          <ImageOff className="h-5 w-5 text-muted-foreground/40" aria-hidden="true" />
                                        )}
                                        <span className="absolute inset-0 flex items-center justify-center bg-background/80 opacity-0 transition-opacity group-hover:opacity-100">
                                          {enviando === id
                                            ? <span className="text-[11px] font-medium">Enviando…</span>
                                            : <Upload className="h-4 w-4 text-primary" aria-hidden="true" />}
                                        </span>
                                      </button>
                                      <input
                                        ref={el => { inputRefs.current[id] = el }}
                                        type="file"
                                        accept={SPEC_FOTO.tipos.join(',')}
                                        className="hidden"
                                        onChange={e => { subir(t, tp.id, e.target.files?.[0]); e.target.value = '' }}
                                      />
                                      <p className="mt-1 text-[11px] font-medium">
                                        {tp.rotulo}
                                        {tp.id === 'fundo_branco' && <span className="ml-1 text-primary">capa</span>}
                                      </p>
                                      <p className="text-[10px] leading-snug text-muted-foreground">{tp.dica}</p>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}

              {tecidos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <X className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                    <p className="text-sm font-medium">Nenhuma sobra disponível</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Cadastre sobras em Estoque → Sobras para preparar os anúncios.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
