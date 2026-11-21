import { describe, expect, it } from 'vitest'
import { problemaDoArquivo, tamanhoLegivel, tipoDoArquivo } from '@/lib/conversas/anexos'

const arq = (name: string, type: string, size = 1000) => ({ name, type, size })

describe('problemaDoArquivo', () => {
  it('aceita o que a Meta aceita', () => {
    expect(problemaDoArquivo(arq('a.jpg', 'image/jpeg'))).toBeNull()
    expect(problemaDoArquivo(arq('a.mp4', 'video/mp4'))).toBeNull()
    expect(problemaDoArquivo(arq('a.mp3', 'audio/mpeg'))).toBeNull()
    expect(problemaDoArquivo(arq('a.pdf', 'application/pdf'))).toBeNull()
  })
  it('recusa acima de 16 MB', () => {
    expect(problemaDoArquivo(arq('a.pdf', 'application/pdf', 17 * 1024 * 1024))).toMatch(/16 MB/)
    expect(problemaDoArquivo(arq('a.pdf', 'application/pdf', 16 * 1024 * 1024))).toBeNull()
  })
  it('avisa do .mov do iPhone', () => {
    expect(problemaDoArquivo(arq('v.mov', 'video/quicktime'))).toMatch(/\.mov/)
    expect(problemaDoArquivo(arq('v.MOV', ''))).toMatch(/\.mov/)
  })
  it('recusa formato desconhecido e webp', () => {
    expect(problemaDoArquivo(arq('a.webp', 'image/webp'))).toMatch(/JPEG/)
    expect(problemaDoArquivo(arq('a.zip', 'application/zip'))).toMatch(/não aceita/)
  })
})

describe('tipoDoArquivo e tamanho', () => {
  it('classifica por mime', () => {
    expect(tipoDoArquivo('image/png')).toBe('imagem')
    expect(tipoDoArquivo('audio/ogg')).toBe('audio')
    expect(tipoDoArquivo('text/plain')).toBe('documento')
    expect(tipoDoArquivo('x/y')).toBeNull()
  })
  it('tamanho em português', () => {
    expect(tamanhoLegivel(500)).toBe('1 KB')
    expect(tamanhoLegivel(2.5 * 1024 * 1024)).toBe('2,5 MB')
  })
})

describe('áudio vira voz (15/10/2026)', () => {
  it('qualquer áudio vale: com codec no tipo, m4a, wav, opus e sem tipo pela extensão', async () => {
    const { tipoDoArquivo, problemaDoArquivo } = await import('@/lib/conversas/anexos')
    expect(tipoDoArquivo('audio/ogg; codecs=opus')).toBe('audio')
    expect(tipoDoArquivo('audio/x-m4a')).toBe('audio')
    expect(tipoDoArquivo('audio/wav')).toBe('audio')
    expect(tipoDoArquivo('', 'recado.opus')).toBe('audio')
    expect(tipoDoArquivo('', 'planilha.csv')).toBeNull()
    expect(problemaDoArquivo({ name: 'voz.webm', type: 'audio/webm', size: 1000 })).toBeNull()
  })
})
