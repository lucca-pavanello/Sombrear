import { useRef } from 'react'
import type { MouseEvent } from 'react'

// Props para o fundo (backdrop) de um modal: só fecha se o clique COMEÇOU e
// terminou no fundo. Sem isso, trocar de aba (Radix troca no mousedown e o painel
// encolhe) ou arrastar para selecionar texto e soltar fora gerava um `click` no
// fundo e fechava o modal sozinho.
export function useFecharNoFundo(aoFechar: () => void) {
  const comecouNoFundo = useRef(false)
  return {
    onMouseDown: (e: MouseEvent) => {
      comecouNoFundo.current = e.target === e.currentTarget
    },
    onClick: (e: MouseEvent) => {
      if (comecouNoFundo.current && e.target === e.currentTarget) aoFechar()
      comecouNoFundo.current = false
    },
  }
}
