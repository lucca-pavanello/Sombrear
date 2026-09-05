import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * Fotos dos tecidos, para os anúncios do Mercado Livre.
 *
 * São por TECIDO+COR, não por peça: as 153 sobras cabem em ~30 combinações, e todas as
 * peças do mesmo tecido compartilham o mesmo jogo de fotos. É o que torna "publicar
 * sozinho" viável — fotografar peça a peça não escala.
 *
 * O bucket é público de propósito: o Mercado Livre baixa a imagem pela URL na hora de
 * publicar. Se ele tomar 403, o anúncio trava em `picture downloading pending`.
 */
/**
 * A ORDEM aqui é a ordem das fotos no anúncio — `ordem` sai do índice deste array.
 *
 * A primeira é a capa, a única que aparece na busca. Ela é um AMBIENTE porque é o que os
 * anúncios que vendem nessa categoria fazem: o campeão de vendas que serviu de referência
 * (+500 vendidos) abre com a persiana instalada num quarto montado, e deixa o fundo branco
 * lá pro meio, junto dos componentes.
 */
export const TIPOS_FOTO = [
  { id: 'ambiente',     rotulo: 'Ambiente', dica: 'É a CAPA — a única que aparece na busca. Persiana instalada na janela, cômodo montado. Sem texto e sem marca d’água.' },
  { id: 'ambiente_2',   rotulo: 'Ambiente 2', dica: 'Outro cômodo ou outro ângulo, pra quem clicou ver que funciona em mais de um lugar.' },
  { id: 'zoom',         rotulo: 'Zoom da textura', dica: 'Close no tecido: é o que responde "como ele é de perto?".' },
  { id: 'medida',       rotulo: 'Medida', dica: 'A persiana com as cotas. Nessa categoria o comprador escolhe pela medida antes de tudo.' },
  { id: 'fundo_branco', rotulo: 'Fundo branco', dica: 'O tecido e os componentes (mecanismo, suportes) recortados no branco.' },
  { id: 'explicativa',  rotulo: 'Explicativa', dica: 'Pode ter texto e ícones: o que o tecido faz (bloqueia luz, filtra sol...).' },
] as const

export type TipoFoto = (typeof TIPOS_FOTO)[number]['id']

export type SobraFoto = {
  id: string
  created_at: string
  familia: string
  abertura: string | null
  cor: string
  tipo: TipoFoto
  url: string
  ordem: number
  ativo: boolean
}

/** Especificação que o Mercado Livre pede — usada na validação do upload e na tela. */
export const SPEC_FOTO = {
  ladoIdeal: 1200,
  ladoMinimo: 500,
  tamanhoMaxMb: 10,
  tipos: ['image/jpeg', 'image/png', 'image/webp'],
} as const

export function useSobrasFotos() {
  return useQuery({
    queryKey: ['sobras-fotos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sobras_fotos')
        .select('*')
        .eq('ativo', true)
        .order('familia')
        .order('cor')
        .order('ordem')
      if (error) throw error
      return (data ?? []) as SobraFoto[]
    },
    retry: 1,
    refetchOnWindowFocus: false,
  })
}

/** Chave de um jogo de fotos: o tecido, não a peça. */
export function chaveTecido(t: { familia: string; abertura: string | null; cor: string }): string {
  return [t.familia, t.abertura ?? '', t.cor].join('|')
}

export function useEnviarFoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      { arquivo, familia, abertura, cor, tipo }:
      { arquivo: File; familia: string; abertura: string | null; cor: string; tipo: TipoFoto },
    ) => {
      if (!SPEC_FOTO.tipos.includes(arquivo.type as typeof SPEC_FOTO.tipos[number])) {
        throw new Error('O Mercado Livre aceita JPG, PNG ou WebP.')
      }
      if (arquivo.size > SPEC_FOTO.tamanhoMaxMb * 1024 * 1024) {
        throw new Error(`A imagem passa de ${SPEC_FOTO.tamanhoMaxMb} MB, que é o limite do ML.`)
      }

      const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      // caminho previsível por tecido: dá pra achar e substituir sem consultar o banco
      const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const caminho = `${slug(familia)}/${slug(abertura ?? 'sem-abertura')}-${slug(cor)}/${tipo}.${ext}`

      const { error: erroUp } = await supabase.storage
        .from('sobras-fotos')
        .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type })
      if (erroUp) throw erroUp

      const { data: pub } = supabase.storage.from('sobras-fotos').getPublicUrl(caminho)

      // upsert pela chave (familia+abertura+cor+tipo): re-enviar a mesma foto substitui,
      // não cria linha nova
      const { error } = await supabase.from('sobras_fotos').upsert(
        {
          familia, abertura, cor, tipo,
          url: pub.publicUrl,
          ordem: TIPOS_FOTO.findIndex(t => t.id === tipo),
          ativo: true,
        },
        { onConflict: 'familia,abertura,cor,tipo' },
      )
      if (error) throw error
      return pub.publicUrl
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sobras-fotos'] }),
  })
}

export function useRemoverFoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sobras_fotos').update({ ativo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sobras-fotos'] }),
  })
}
