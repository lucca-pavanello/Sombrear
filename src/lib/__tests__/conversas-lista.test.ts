import { describe, expect, it } from 'vitest'
import {
  agruparPorDia, buscar, contarPorFiltro, conversasDasMensagens, doCelular, falhou, juntaComAnterior, linkDoMapa,
  passaFiltro, previaDaConversa, quandoNaLista, rotuloDoDia, telefoneLegivel, tipoDoAnexo, type Conversa, type Mensagem,
} from '@/lib/conversas/lista'

const conversa = (o: Partial<Conversa> = {}): Conversa => ({
  conversa_id: 1, inbox_id: 5, telefone: '+5517999990000', lead_id: null, nome: 'Juliana Prado',
  ultima_mensagem_em: '2026-11-20T15:00:00Z', ultimo_autor: 'cliente', ultimo_conteudo: 'oi', ultimo_anexo_tipo: null,
  ultima_recebida_em: '2026-11-20T15:00:00Z', total_mensagens: 1, status: 'open', ia_pausada: false, nao_lida: false, ...o,
})

const msg = (o: Partial<Mensagem> = {}): Mensagem => ({
  id: 1, conversa_id: 100, lead_id: null, telefone: '+5517999990000', autor: 'cliente', autor_nome: null,
  canal_envio: null, privada: false, conteudo: 'oi', anexos: [], excluida: false, enviada_em: '2026-11-20T15:00:00Z', ...o,
})

describe('filtros', () => {
  const xs = [
    conversa({ conversa_id: 1, nao_lida: true }),
    conversa({ conversa_id: 2, ultimo_autor: 'equipe', ia_pausada: true }),
    conversa({ conversa_id: 3, ultimo_autor: 'ia' }),
    conversa({ conversa_id: 4, status: 'resolved', nao_lida: true, ia_pausada: true }),
  ]

  it('a encerrada só aparece em Encerradas', () => {
    expect(xs.filter(c => passaFiltro(c, 'todas')).map(c => c.conversa_id)).toEqual([1, 2, 3])
    expect(xs.filter(c => passaFiltro(c, 'encerradas')).map(c => c.conversa_id)).toEqual([4])
    expect(xs.filter(c => passaFiltro(c, 'nao_lidas')).map(c => c.conversa_id)).toEqual([1])
    expect(xs.filter(c => passaFiltro(c, 'humano')).map(c => c.conversa_id)).toEqual([2])
  })

  it('aguardando = o cliente falou por último; IA = a Amanda não está pausada', () => {
    expect(xs.filter(c => passaFiltro(c, 'aguardando')).map(c => c.conversa_id)).toEqual([1])
    expect(xs.filter(c => passaFiltro(c, 'ia')).map(c => c.conversa_id)).toEqual([1, 3])
  })

  it('conta cada filtro', () => {
    expect(contarPorFiltro(xs)).toEqual({ todas: 3, nao_lidas: 1, aguardando: 1, humano: 1, ia: 2, encerradas: 1 })
  })
})

describe('buscar', () => {
  const xs = [conversa({ conversa_id: 1, nome: 'João Araújo', telefone: '+5517999990000' }), conversa({ conversa_id: 2, nome: null, telefone: '+5511988887777' })]

  it('por nome sem acento e por pedaço do telefone', () => {
    expect(buscar(xs, 'joao arau').map(c => c.conversa_id)).toEqual([1])
    expect(buscar(xs, '8888-7777').map(c => c.conversa_id)).toEqual([2])
    expect(buscar(xs, '  ')).toHaveLength(2)
  })

  it('dois dígitos soltos não buscam por telefone', () => {
    expect(buscar(xs, '17')).toEqual([])
  })
})

describe('o que mostrar', () => {
  it('telefone do Brasil com e sem o 55; o resto volta como veio', () => {
    expect(telefoneLegivel('+5517999990000')).toBe('(17) 99999-0000')
    expect(telefoneLegivel('1732221111')).toBe('(17) 3222-1111')
    expect(telefoneLegivel('+351912345678')).toBe('+351912345678')
    expect(telefoneLegivel(null)).toBe('Sem telefone')
  })

  it('prévia: quem falou, o texto em uma linha, ou o tipo do anexo', () => {
    expect(previaDaConversa({ ultimo_autor: 'cliente', ultimo_conteudo: 'bom\ndia', ultimo_anexo_tipo: null })).toBe('bom dia')
    expect(previaDaConversa({ ultimo_autor: 'ia', ultimo_conteudo: 'Olá!', ultimo_anexo_tipo: null })).toBe('IA: Olá!')
    expect(previaDaConversa({ ultimo_autor: 'equipe', ultimo_conteudo: null, ultimo_anexo_tipo: 'audio' })).toBe('Equipe: Áudio')
    expect(previaDaConversa({ ultimo_autor: 'cliente', ultimo_conteudo: null, ultimo_anexo_tipo: null })).toBe('Mensagem apagada')
  })

  it('anexo: os tipos do Chatwoot; o que a tela não conhece é documento', () => {
    expect(['image', 'audio', 'video', 'location', 'file', 'fallback', null].map(tipoDoAnexo))
      .toEqual(['imagem', 'audio', 'video', 'localizacao', 'documento', 'documento', 'documento'])
    expect(linkDoMapa({ lat: -20.8, lng: -49.38 })).toBe('https://www.google.com/maps?q=-20.8,-49.38')
    expect(linkDoMapa({})).toBeNull()
  })

  it('entrega: falhou com status failed ou com erro parado em enviada', () => {
    expect(falhou({ status_entrega: 'failed', erro_entrega: null })).toBe(true)
    expect(falhou({ status_entrega: 'sent', erro_entrega: '131053' })).toBe(true)
    expect(falhou({ status_entrega: 'delivered', erro_entrega: '131053' })).toBe(false)
    expect(falhou({})).toBe(false)
  })

  it('do celular: a coluna nova, ou o canal quando o banco ainda não tem a coluna', () => {
    expect(doCelular({ do_celular: true, canal_envio: 'chatwoot' })).toBe(true)
    expect(doCelular({ canal_envio: 'celular' })).toBe(true)
    expect(doCelular({ canal_envio: 'chatwoot' })).toBe(false)
  })
})

describe('datas', () => {
  // 20/11/2026 é sexta; meio-dia em São Paulo (o TZ dos testes)
  const agora = new Date('2026-11-20T15:00:00Z')

  it('hoje, ontem, dia da semana e data', () => {
    expect(rotuloDoDia('2026-11-20T03:30:00Z', agora)).toBe('Hoje')
    // 02:30 UTC ainda é dia 19 em São Paulo
    expect(rotuloDoDia('2026-11-20T02:30:00Z', agora)).toBe('Ontem')
    expect(rotuloDoDia('2026-11-17T15:00:00Z', agora)).toBe('terça-feira')
    expect(rotuloDoDia('2026-11-01T15:00:00Z', agora)).toBe('01/11/2026')
  })

  it('na lista: hora, ontem ou data curta', () => {
    expect(quandoNaLista('2026-11-20T14:05:00Z', agora)).toBe('11:05')
    expect(quandoNaLista('2026-11-19T14:05:00Z', agora)).toBe('ontem')
    expect(quandoNaLista('2026-11-01T14:05:00Z', agora)).toBe('01/11')
  })

  it('agrupa por dia local e cola bolhas seguidas do mesmo autor', () => {
    const ms = [
      msg({ id: 1, enviada_em: '2026-11-19T20:00:00Z' }),
      msg({ id: 2, enviada_em: '2026-11-20T12:00:00Z' }),
      msg({ id: 3, enviada_em: '2026-11-20T12:02:00Z' }),
      msg({ id: 4, enviada_em: '2026-11-20T12:03:00Z', autor: 'ia' }),
      msg({ id: 5, enviada_em: '2026-11-20T12:30:00Z', autor: 'ia' }),
    ]
    const g = agruparPorDia(ms, agora)
    expect(g.map(x => [x.rotulo, x.itens.length])).toEqual([['Ontem', 1], ['Hoje', 4]])
    expect(juntaComAnterior(ms[2], ms[1])).toBe(true)
    expect(juntaComAnterior(ms[3], ms[2])).toBe(false)
    expect(juntaComAnterior(ms[4], ms[3])).toBe(false)
    expect(juntaComAnterior(ms[0], undefined)).toBe(false)
  })
})

describe('conversasDasMensagens (banco ainda sem a 0039)', () => {
  it('uma por conversa, com a última visível ao cliente, a última recebida e o lead', () => {
    const cs = conversasDasMensagens([
      msg({ id: 1, conversa_id: 100, enviada_em: '2026-11-20T12:00:00Z' }),
      msg({ id: 2, conversa_id: 100, lead_id: 'L1', autor: 'ia', conteudo: 'Olá!', enviada_em: '2026-11-20T12:01:00Z' }),
      msg({ id: 3, conversa_id: 100, autor: 'equipe', privada: true, conteudo: 'nota', enviada_em: '2026-11-20T12:02:00Z' }),
      msg({ id: 4, conversa_id: 200, conteudo: null, anexos: [{ tipo: 'image', url: 'x', nome: 'f.jpg' }], enviada_em: '2026-11-20T13:00:00Z' }),
    ], [{ id: 'L1', nome: 'Juliana', chatwoot_labels: 'orcado, Humano', precisa_humano: null }])
    const a = cs.find(c => c.conversa_id === 100)!
    expect(a).toMatchObject({ nome: 'Juliana', lead_id: 'L1', ultimo_autor: 'ia', ultimo_conteudo: 'Olá!', ultima_recebida_em: '2026-11-20T12:00:00Z', total_mensagens: 2, ia_pausada: true, status: 'open', nao_lida: false })
    expect(cs.find(c => c.conversa_id === 200)).toMatchObject({ nome: null, ultimo_conteudo: null, ultimo_anexo_tipo: 'image', ia_pausada: false })
  })
})
