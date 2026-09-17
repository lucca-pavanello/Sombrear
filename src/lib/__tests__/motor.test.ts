/**
 * Casos golden do motor de preços — números que viram dinheiro pago.
 *
 * Cada valor esperado aqui foi conferido contra uma fonte externa REAL:
 * vendas fechadas pela loja, o baseline do harness de QA do n8n, ou contas
 * feitas à mão pela dona. As fixtures congelam os preços de 13/08/2026 —
 * o teste protege as REGRAS; mudança de preço se faz no banco, não aqui.
 *
 * Se um destes quebrar, algum orçamento vai sair diferente do que a loja
 * cobra. Não "ajuste o teste": entenda o que mudou.
 */
import { describe, expect, it } from 'vitest'
import { simular, type DadosSim, type EntradaSim } from '../simulador'
import { calcularAmbientesCortina, calcularCortina, type DadosCortina, type EntradaCortina } from '../cortina'
import persianaFix from './fixtures/precos-persiana.json'
import cortinaFix from './fixtures/precos-cortina.json'

const dPersiana = persianaFix as unknown as DadosSim
const dCortina = cortinaFix as unknown as DadosCortina

const rolo = (extra: Partial<EntradaSim>): EntradaSim => ({
  modelo: 'Rolo', tecido: 'BK BRANCO', corFerragem: 'BRANCA',
  largura: 1.2, altura: 1.4, quantidade: 1, acabamento: 'nenhum',
  incluirInstalacao: false, ...extra,
})

const okOuFalha = (r: ReturnType<typeof simular>) => {
  if ('erro' in r) throw new Error(`motor recusou: ${r.erro}`)
  return r
}

describe('persiana — casos conferidos com vendas reais', () => {
  it('Romana BK BRANCO 1,70×1,20 com bandô — a venda do Fernando (R$ 873,30)', () => {
    const r = okOuFalha(simular(rolo({
      modelo: 'Romana', largura: 1.7, altura: 1.2, acabamento: 'bando_branco',
    }), dPersiana))
    expect(r.total4x).toBeCloseTo(873.30, 2)
    expect(r.valorParceiro).toBeCloseTo(396.45, 2)   // o que foi pago à parceira
  })

  it('Romana BK NAPOLES CREME NOVO 1,70×1,50 — a venda da Cintia (parceira R$ 343,95)', () => {
    const r = okOuFalha(simular(rolo({
      modelo: 'Romana', tecido: 'BK NAPOLES CREME NOVO', largura: 1.7, altura: 1.5,
    }), dPersiana))
    expect(r.valorParceiro).toBeCloseTo(343.95, 2)
  })
})

describe('bandô de peça única — porta dividida (áudio da loja)', () => {
  const base = rolo({ tecido: 'SCREEN 3% CINZA', largura: 1.95, altura: 2.5, quantidade: 3, acabamento: 'bando_branco' })

  it('3 bandôs de 1,95m (padrão): R$ 2.593,30', () => {
    expect(okOuFalha(simular(base, dPersiana)).total4x).toBeCloseTo(2593.30, 2)
  })

  it('1 bandô de 5,20m (peça única): R$ 2.526,20 — R$ 67,10 a menos', () => {
    const r = okOuFalha(simular({ ...base, bandoLargura: 5.2, bandoQuantidade: 1 }, dPersiana))
    expect(r.total4x).toBeCloseTo(2526.20, 2)
  })
})

/* Aproveitamento de tecido (28/08): peças estreitas do MESMO tecido/pedido cabem lado
   a lado no rolo escolhido — cobra o corte (comprimento) uma vez por fileira, não uma
   vez por peça. BK BRANCO 1,4m de altura → alturaUsada 1,6m; peça de 0,7m de largura
   cai no rolo de 1,5m (menor faixa cadastrada ≥ 0,7m) e 2 peças de 0,7m cabem juntas
   nesse mesmo corte de 1,5m (0,7 × 2 = 1,4 ≤ 1,5). Custo de 1 corte = 1,5 × 1,6 × 34 =
   R$ 81,60. */
const achaTecido = (r: ReturnType<typeof simular>) =>
  ('erro' in r ? undefined : r.detalhe.find(d => /^Tecido/.test(d.parte)))

describe('aproveitamento de tecido — peças da mesma largura no mesmo rolo', () => {
  it('2 peças de 0,70m cabem juntas no rolo de 1,5m: 1 corte em vez de 2 (R$ 81,60)', () => {
    const r = okOuFalha(simular(rolo({ largura: 0.7, quantidade: 2 }), dPersiana))
    expect(achaTecido(r)?.tabela).toBeCloseTo(81.60, 2)
  })

  it('3 peças de 0,70m (sobra ímpar): 2 cortes, não 3 (R$ 163,20)', () => {
    const r = okOuFalha(simular(rolo({ largura: 0.7, quantidade: 3 }), dPersiana))
    expect(achaTecido(r)?.tabela).toBeCloseTo(163.20, 2)
  })

  it('2 peças de 1,40m NÃO cabem 2× no rolo de 1,5m: continua 2 cortes (sem regressão)', () => {
    const r = okOuFalha(simular(rolo({ largura: 1.4, quantidade: 2 }), dPersiana))
    expect(achaTecido(r)?.tabela).toBeCloseTo(163.20, 2)
  })
})

/* Ferragem mínima (17/09/2026): precos_ferragem_familias começa em larg_min = 1,00m para
   Rolo e Double. Os orçamentos reais (n8n) e a tela de preços já cobravam esse mínimo; o
   simulador cobrava a largura real e saía mais barato em peça estreita — a cliente comparou
   o simulador com o orçamento enviado e achou o orçamento caro. */
const achaFerragem = (r: ReturnType<typeof simular>) =>
  ('erro' in r ? undefined : r.detalhe.find(d => /^Ferragem/.test(d.parte)))

describe('ferragem — mínimo cobrado da tabela (larg_min 1,00m)', () => {
  it('Rolo de 0,70m paga ferragem de 1,00m (tubo 32: R$ 48,11 em vez de R$ 39,89)', () => {
    const r = okOuFalha(simular(rolo({ largura: 0.7 }), dPersiana))
    expect(achaFerragem(r)?.tabela).toBeCloseTo(48.11, 2)
  })

  it('Rolo de 0,70m e de 1,00m pagam a MESMA ferragem', () => {
    const estreita = okOuFalha(simular(rolo({ largura: 0.7 }), dPersiana))
    const minima = okOuFalha(simular(rolo({ largura: 1.0 }), dPersiana))
    expect(achaFerragem(estreita)?.tabela).toBeCloseTo(achaFerragem(minima)?.tabela ?? -1, 2)
  })

  it('acima do mínimo nada muda: Rolo de 1,20m continua pagando 1,20m', () => {
    const r = okOuFalha(simular(rolo({ largura: 1.2 }), dPersiana))
    const minima = okOuFalha(simular(rolo({ largura: 1.0 }), dPersiana))
    expect(achaFerragem(r)?.tabela ?? 0).toBeGreaterThan(achaFerragem(minima)?.tabela ?? 0)
  })

  it('Double de 0,70m paga ferragem de 1,00m (R$ 63,65)', () => {
    const r = okOuFalha(simular(rolo({ modelo: 'Double', tecido: 'DOUBLE  NATURAL', largura: 0.7 }), dPersiana))
    expect(achaFerragem(r)?.tabela).toBeCloseTo(63.65, 2)
  })

  it('sem a tabela de famílias carregada, cai no comportamento antigo (não quebra quem não passa familias)', () => {
    const { familias: _sem, ...semFamilias } = dPersiana
    const r = okOuFalha(simular(rolo({ largura: 0.7 }), semFamilias as DadosSim))
    expect(achaFerragem(r)?.tabela).toBeCloseTo(39.89, 2)
  })
})

describe('Rolo Motorizado — baseline golden do harness de QA (2026-08-03)', () => {
  /* VIRADA DE PREÇO 24/08: a Stella mandou duas tabelas novas de estrutura motorizada
     (até 3,00m sem junção · com junção ou acima de 3,00m). O baseline subiu R$ 13,26 no
     custo — exatamente a diferença da estrutura de 1,50m (82,95 → 96,21). O resto da
     conta (tecido, motor, controle) não mudou. */
  it('BK BRANCO 1,20×1,40: custo tabela 655,31 · venda 1.542,00 (tabelas de 24/08)', () => {
    const r = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado' }), dPersiana))
    expect(r.custoTabela).toBeCloseTo(655.31, 2)
    expect(r.total4x).toBeCloseTo(1542.00, 2)
    expect(r.observacoes.join(' ')).toMatch(/41\/sem-juncao/i)
  })

  /* o exemplo que a Stella mandou pra conferir (24/08): "Rolo de 2,50 x 3,00 com 1 motor
     e controle de 1 canal". Fica na tabela sem junção (2,50m ≤ 3,00m) = R$ 135,07 de
     estrutura. Os valores de motor/controle aqui são os da fixture de 13/08. */
  /* a dona conferiu o print e apontou: "quase tudo certo, só o lucro que é 1,45" (24/08).
     O parâmetro `parceiro_motor` = 1,45 já estava no banco desde 10/08, mas o motor de
     preços pedia a chave `parceiro_motorizacao`, que não existe — e caía no padrão
     `custo_parceiro` = 1,40. Nenhum teste cobria o fator da motorização, por isso passou. */
  it('motorização usa o fator 1,45 da loja, não o padrão 1,40', () => {
    const r = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado' }), dPersiana))
    const partes = r.detalhe.filter(d => /^(Estrutura|Motor|Controle|Junção)/.test(d.parte))
    expect(partes.length).toBeGreaterThan(0)
    partes.forEach(p => expect(p.fator).toBeCloseTo(1.45, 4))
    // o tecido continua no fator dele
    expect(r.detalhe.find(d => /^Tecido/.test(d.parte))?.fator).toBeCloseTo(1.40, 4)
  })

  it('exemplo da Stella: rolô 2,50 × 3,00, 1 motor, 1 controle de 1 canal', () => {
    const r = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', largura: 2.5, altura: 3.0,
      motorQtd: 1, controleQtd: 1, controleCanais: 1 }), dPersiana))
    const acha = (re: RegExp) => r.detalhe.find(d => re.test(d.parte))
    expect(acha(/^Estrutura/)?.tabela).toBeCloseTo(135.07, 2)
    expect(r.observacoes.join(' ')).toMatch(/41\/sem-juncao/i)
    expect(acha(/^Controle 1 canal/)?.parte).toBe('Controle 1 canal')
  })

  it('recusa medidas acima de 6,00m em vez de chutar', () => {
    // largura estoura o rolo de tecido antes do motor — o limite se testa pela ALTURA
    const r = simular(rolo({ modelo: 'Rolo Motorizado', altura: 6.2 }), dPersiana)
    expect('erro' in r && /6,00/.test(r.erro)).toBe(true)
  })

  /* pedido da loja (16/08, refinado 22/08 pela dona): 6 rolôs numa parede não são
     6 motores + 6 controles — peças que dividem o MESMO motor usam junção, e isso
     sempre força tubo/suporte 53mm (regra dela: "sempre que dois rolôs, independente
     da medida, compartilharem o mesmo motor, usa junção... tubo de 53 e kit suporte
     de 53"). O controle é do pedido (1 de 6 canais). Medidas aqui usam 4,5×5,5 —
     únicas que a tabela hoje precifica em 53mm (ver teste da faixa estreita abaixo:
     é gap de CADASTRO, não deste motor de cálculo). */
  it('6 peças, 3 motores, 1 controle de 6 canais: quantidades são do PEDIDO, não da peça', () => {
    const r = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', quantidade: 6,
      motorQtd: 3, controleQtd: 1, controleCanais: 6 }), dPersiana))
    const acha = (re: RegExp) => r.detalhe.find(d => re.test(d.parte))
    expect(acha(/^Estrutura/)?.parte).toMatch(/× 6$/)
    expect(acha(/^Motor/)?.parte).toMatch(/× 3$/)
    expect(acha(/^Controle 6 canais/)?.parte).toBe('Controle 6 canais')   // 1 só, sem "× n"
    expect(r.observacoes.join(' ')).toMatch(/6 peças com 3 motores/)
  })

  it('padrão de 6 peças sem escolha = 6 motores e 6 controles de 1 canal, 41mm (comportamento antigo)', () => {
    const r = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', quantidade: 6 }), dPersiana))
    const acha = (re: RegExp) => r.detalhe.find(d => re.test(d.parte))
    expect(acha(/^Motor/)?.parte).toMatch(/× 6$/)
    // controle passou a ser do PEDIDO: padrão 1 controle, não 6
    expect(acha(/^Controle 1 canal/)?.parte).toBe('Controle 1 canal')
    expect(r.observacoes.join(' ')).not.toMatch(/grupo 53/)
  })

  it('a conta bate: 3 motores em vez de 6 baixa o custo da motorização', () => {
    const seis = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', quantidade: 6 }), dPersiana))
    const tres = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', quantidade: 6, motorQtd: 3 }), dPersiana))
    expect(tres.custoTabela).toBeLessThan(seis.custoTabela)
    expect(tres.total4x).toBeLessThan(seis.total4x)
  })

  /* pedido da dona da loja (22/08, confirmado em áudio 24/08): "sempre que dois rolôs,
     independente da medida, compartilharem o mesmo motor, usa junção... tubo de 53 e kit
     suporte de 53". A JUNÇÃO decide a bitola, não a medida da peça — e como a tabela
     53mm hoje começa em 4,00m, qualquer largura menor é RECUSADA em vez de cair na linha
     de cima (que cobraria R$ 258,85 no lugar de ~R$ 110, em silêncio). */
  /* a Stella mandou a tabela de junção em 24/08 ("usar esta tabela sempre que pedir
     junção para motor — tubo de 53 + kit de 53"), cobrindo 1,00 a 6,00m. Antes disso
     junção era recusada por falta de cadastro; agora calcula, e é a JUNÇÃO que decide
     a bitola, não a medida da peça. */
  it('junção decide a bitola e usa a tabela própria da loja (1,20m → R$ 101,76 de estrutura)', () => {
    const semJuncao = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', largura: 1.2, altura: 5.5 }), dPersiana))
    expect(semJuncao.observacoes.join(' ')).toMatch(/grupo 41/)

    const comJuncao = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado',
      largura: 1.2, altura: 5.5, quantidade: 2, motorQtd: 1, controleQtd: 1, juncaoQtd: 1 }), dPersiana))
    expect(comJuncao.observacoes.join(' ')).toMatch(/grupo 53\/JUNCAO/i)
    // estrutura da largura 1,50 (menor faixa ≥ 1,20) na tabela de junção,
    // já multiplicada pelas 2 peças do pedido: 125,95 × 2
    const estrutura = comJuncao.detalhe.find(d => /^Estrutura/.test(d.parte))
    expect(estrutura?.tabela).toBeCloseTo(125.95 * 2, 2)
  })

  /* GAP DE CADASTRO, não de código: a tabela só tem preço 53mm (com junção) pra
     medidas grandes (largura ≥4,0m, a maioria com altura ≥5,01m) — não existe linha
     53mm pra uma altura típica pequena, tipo 1,40m. Antes desta correção (22/08) o
     sistema silenciosamente usava 41mm nesse caso, cobrando errado por baixo. Agora
     ele RECUSA em vez de adivinhar — o próximo passo é a loja completar a tabela
     `precos_motor_estrutura` com faixas 53mm pra alturas menores, se esse pedido for
     comum (2 rolôs pequenos dividindo motor). */
  it('junção em medida pequena agora calcula (a tabela da Stella cobre 1,00 a 6,00m)', () => {
    const r = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', juncaoQtd: 1, motorQtd: 1, quantidade: 2 }), dPersiana))
    expect(r.observacoes.join(' ')).toMatch(/grupo 53\/JUNCAO/i)
  })

  /* o exemplo que a própria dona deu no áudio (24/08): "uma rolô motorizada de 2,10 por
     6m de altura, eu consigo usar o kit de 41. Só que se eu falar que vou ter que usar
     junção, preciso mudar tudo pro kit de 53". Com a tabela que ela mandou, os dois lados
     do exemplo passaram a funcionar: sem junção fica no 41mm, com junção vai pra 53mm
     usando a faixa de 2,50m (menor ≥ 2,10) = R$ 174,33. */
  it('o exemplo da dona: 2,10 × 6m sai 41mm sozinha e 53mm quando tem junção', () => {
    const semJuncao = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', largura: 2.1, altura: 6 }), dPersiana))
    expect(semJuncao.observacoes.join(' ')).toMatch(/grupo 41/)

    const comJuncao = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', largura: 2.1, altura: 6,
      juncaoQtd: 1, motorQtd: 1, quantidade: 2 }), dPersiana))
    expect(comJuncao.observacoes.join(' ')).toMatch(/grupo 53\/JUNCAO/i)
    const estrutura = comJuncao.detalhe.find(d => /^Estrutura/.test(d.parte))
    expect(estrutura?.tabela).toBeCloseTo(174.33 * 2, 2)   // × 2 peças do pedido
    // e o preço com junção é maior que sem — o 53mm é mais caro, como ela disse
    expect(comJuncao.custoTabela).toBeGreaterThan(semJuncao.custoTabela)
  })

  /* pedido da dona da loja (22/08): força do motor é ESCOLHA da equipe (6N/10N/20N/WiFi),
     não inferência automática — a peça grande na frente delas decide. Sem escolha,
     o padrão continua 6N (comportamento de sempre). */
  it('motorForca escolhe o item certo — 6N (padrão), 10N, 20N e WiFi', () => {
    const seisN = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado' }), dPersiana))
    const dezN = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', motorForca: '10N' }), dPersiana))
    const vinteN = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', motorForca: '20N' }), dPersiana))
    const wifi = okOuFalha(simular(rolo({ modelo: 'Rolo Motorizado', motorForca: 'WIFI' }), dPersiana))
    expect(seisN.observacoes.join(' ')).toMatch(/6N ATÉ 18 KG/)
    expect(dezN.observacoes.join(' ')).toMatch(/10N ATÉ 23 KG/)
    expect(vinteN.observacoes.join(' ')).toMatch(/20N ATÉ 45 KG/)
    expect(wifi.observacoes.join(' ')).toMatch(/WiFi/)
    // motor mais forte custa mais — a conta tem que refletir
    expect(dezN.custoTabela).toBeGreaterThan(seisN.custoTabela)
    expect(vinteN.custoTabela).toBeGreaterThan(dezN.custoTabela)
  })
})

describe('ferragem preta — regra da loja', () => {
  it('tubo 32 preto vira 38 (a loja não trabalha o 32 preto)', () => {
    const r = okOuFalha(simular(rolo({ corFerragem: 'PRETA' }), dPersiana))
    expect(r.observacoes.join(' ')).toMatch(/38mm/)
  })
})

describe('cortina Wave — os 4 orçamentos fechados à mão pela loja', () => {
  const cortina = (extra: Partial<EntradaCortina>): EntradaCortina => ({
    largura: 2.5, altura: 2.55, tecido: 'Tecido padrão', suporte: 'trilho_simples', ...extra,
  })
  const okC = (r: ReturnType<typeof calcularCortina>) => {
    if ('erro' in r) throw new Error(`cortina recusou: ${r.erro}`)
    return r
  }

  it('2,50×2,55 trilho: subtotal 610,42 · parcelado 647,04 (o centavo do arredondar-no-fim)', () => {
    const r = okC(calcularCortina(cortina({}), dCortina))
    expect(r.consumo).toBeCloseTo(6.25, 2)
    expect(r.subtotal).toBeCloseTo(610.42, 2)
    expect(r.parcelado).toBeCloseTo(647.04, 2)   // 6% sobre o subtotal SEM arredondar antes
  })

  it('1,60×2,55 trilho: subtotal 390,67 · parcelado 414,11', () => {
    const r = okC(calcularCortina(cortina({ largura: 1.6 }), dCortina))
    expect(r.subtotal).toBeCloseTo(390.67, 2)
    expect(r.parcelado).toBeCloseTo(414.11, 2)
  })

  it('2,20×5,00: 2,20 alturas viram 2,5 — consumo 13,25m (o caso que o GPT errava)', () => {
    const r = okC(calcularCortina(cortina({ largura: 2.2, altura: 5 }), dCortina))
    expect(r.alturas).toBe(2.5)
    expect(r.consumo).toBeCloseTo(13.25, 2)
  })

  it('6,00×5,00: 6 alturas exatas — consumo 31,80m', () => {
    const r = okC(calcularCortina(cortina({ largura: 6, altura: 5 }), dCortina))
    expect(r.consumo).toBeCloseTo(31.80, 2)
  })

  it('varão duplo sem preço cadastrado é recusado, não chutado', () => {
    const r = calcularCortina(cortina({ suporte: 'varao_duplo' }), dCortina)
    expect('erro' in r).toBe(true)
  })
})

describe('cortina — os 2 orçamentos reais da resposta da loja (14/08/2026)', () => {
  const okC = (r: ReturnType<typeof calcularCortina>) => {
    if ('erro' in r) throw new Error(`cortina recusou: ${r.erro}`)
    return r
  }

  it('Opção 01 — Wave 2,00×2,30 + BK70 costurado junto, varão, colocada: 879,17 · 931,92', () => {
    // a MO conta os dois panos: (5,00 + 5,00) ÷ 1,50 × 40 = 266,67
    const r = okC(calcularCortina({
      largura: 2, altura: 2.3, tecido: 'Tecido padrão', forro: 'Blackout 70%',
      suporte: 'varao_simples', incluirColocacao: true,
    }, dCortina))
    expect(r.consumo).toBeCloseTo(5, 2)
    const mo = r.itens.find(i => i.item === 'Mão de obra')
    expect(mo?.valor).toBeCloseTo(266.67, 2)
    expect(r.subtotal).toBeCloseTo(879.17, 2)
    expect(r.parcelado).toBeCloseTo(931.92, 2)
  })

  it('Opção 02 — Wave 2,00×2,30 + franzido BK70 atrás, trilho duplo, colocada: 790,83 · 838,28', () => {
    // frente sem forro (MO só dela: 133,33); franzido 3,00m sem fita, MO 80;
    // trilho duplo = 2× a largura no preço do trilho (4,00m × 24 = 96).
    // HISTÓRICO: cobrado com fator 1,5 — no mesmo dia a loja fixou 1,8 como
    // regra (a fixture congela o 1,5 daquele orçamento; ver teste seguinte)
    const r = okC(calcularCortina({
      largura: 2, altura: 2.3, tecido: 'Tecido padrão',
      franzido: true, franzidoTecido: 'Blackout 70%',
      suporte: 'trilho_duplo', incluirColocacao: true,
    }, dCortina))
    expect(r.itens.find(i => i.item === 'Mão de obra')?.valor).toBeCloseTo(133.33, 2)
    expect(r.itens.find(i => i.item.startsWith('Franzido'))?.valor).toBeCloseTo(124.5, 2)
    expect(r.itens.find(i => i.item === 'Mão de obra do franzido')?.valor).toBeCloseTo(80, 2)
    expect(r.itens.some(i => i.item === 'Fita do franzido')).toBe(false)
    expect(r.itens.find(i => i.item === 'Trilho duplo')?.valor).toBeCloseTo(96, 2)
    expect(r.subtotal).toBeCloseTo(790.83, 2)
    expect(r.parcelado).toBeCloseTo(838.28, 2)
  })
})

describe('cortina — regras da rodada 2 (respostas da loja, 14/08 à tarde)', () => {
  const okC = (r: ReturnType<typeof calcularCortina>) => {
    if ('erro' in r) throw new Error(`cortina recusou: ${r.erro}`)
    return r
  }
  /** fixture do dia + as decisões da tarde: fator 1,8 no forro, franzidor 2,50 */
  const dRodada2: DadosCortina = {
    tecidos: dCortina.tecidos.map(t =>
      t.nome === 'Blackout 70%' ? { ...t, fator_franzido: 1.8 }
      : t.nome === 'Blackout 100%' ? { ...t, fator_franzido: 1.5 }
      : t),
    valores: [
      ...dCortina.valores.map(v => v.chave === 'fator_franzido' ? { ...v, valor: 1.8 } : v),
      { chave: 'preco_franzidor', valor: 2.5 },
      { chave: 'fator_prega_franzida', valor: 3 },
      { chave: 'acrescimo_entretela_franzido', valor: 0.1 },
      { chave: 'preco_trilho_duplo', valor: 48 },
    ],
  }

  it('franzido BK70 atrás agora usa 1,8 (decisão da loja): 3,60m, subtotal 831,73', () => {
    const r = okC(calcularCortina({
      largura: 2, altura: 2.3, tecido: 'Tecido padrão',
      franzido: true, franzidoTecido: 'Blackout 70%',
      suporte: 'trilho_duplo', incluirColocacao: true,
    }, dRodada2))
    // frente 150 + 133,33 + 157; franzido 3,6×41,5=149,40 + MO 96; trilho 96; coloc 50
    expect(r.itens.find(i => i.item.startsWith('Franzido'))?.valor).toBeCloseTo(149.4, 2)
    expect(r.itens.find(i => i.item === 'Mão de obra do franzido')?.valor).toBeCloseTo(96, 2)
    expect(r.subtotal).toBeCloseTo(831.73, 2)
  })

  it('franzido BK100 atrás fica em 1,5 (fator no cadastro do tecido)', () => {
    const r = okC(calcularCortina({
      largura: 2, altura: 2.3, tecido: 'Tecido padrão',
      franzido: true, franzidoTecido: 'Blackout 100%',
      suporte: 'trilho_duplo',
    }, dRodada2))
    // 2,00 × 1,5 = 3,00m × 69,90
    expect(r.itens.find(i => i.item.startsWith('Franzido'))?.valor).toBeCloseTo(209.7, 2)
  })

  it('Pregas 2,00×2,30: fator 3 em qualquer altura e franzidor de 2,50 no lugar da fita', () => {
    const r = okC(calcularCortina({
      modelo: 'pregas', largura: 2, altura: 2.3, tecido: 'Tecido padrão',
      suporte: 'trilho_simples',
    }, dRodada2))
    expect(r.consumo).toBeCloseTo(6, 2)                       // 2,00 × 3
    const franzidor = r.itens.find(i => i.item === 'Franzidor')
    expect(franzidor?.valor).toBeCloseTo(15, 2)               // 6,00 × 2,50
    expect(r.itens.some(i => i.item === 'Fita/entretela')).toBe(false)
    // 180 (tecido) + 160 (MO) + 15 (franzidor) + 48 (trilho) = 403
    expect(r.subtotal).toBeCloseTo(403, 2)
  })

  it('Franzida alta (2,00×3,50): corte usa entretela de 10cm, não 12', () => {
    const r = okC(calcularCortina({
      modelo: 'franzida', largura: 2, altura: 3.5, tecido: 'Tecido padrão',
      suporte: 'trilho_simples',
    }, dRodada2))
    expect(r.corte).toBeCloseTo(3.78, 2)                      // 3,50 + 0,10 + 0,18
  })

  it('Wave segue decidindo a fita pela altura (confirmado pela loja)', () => {
    const alto = okC(calcularCortina({
      largura: 2, altura: 3.5, tecido: 'Tecido padrão', suporte: 'trilho_simples',
    }, dRodada2))
    expect(alto.fator).toBe(3)
    expect(alto.corte).toBeCloseTo(3.8, 2)                    // wave mantém 0,12
  })
})

describe('cortina — orçamento de vários ambientes (o desenho do Calcular)', () => {
  const cortinaBase = {
    id: 1, modelo: 'wave' as const, tecido: 'Tecido padrão', forro: null,
    suporte: 'trilho_simples' as const, franzido: false, franzidoTecido: null,
    incluirColocacao: false,
  }

  it('soma os ambientes e aplica o acréscimo UMA vez, sobre a soma crua', () => {
    const r = calcularAmbientesCortina([
      { id: 1, nome: 'Sala', cortinas: [{ ...cortinaBase, medidas: [{ largura: '2,50', altura: '2,55', quantidade: '1' }] }] },
      { id: 2, nome: 'Suíte', cortinas: [{ ...cortinaBase, id: 2, medidas: [{ largura: '1,60', altura: '2,55', quantidade: '1' }] }] },
    ], dCortina)
    expect(r.ok).toHaveLength(2)
    // 610,42 + 390,67 nos goldens individuais
    expect(r.subtotal).toBeCloseTo(1001.08, 2)
    // 6% sobre a soma SEM arredondar antes — não sobre os subtotais arredondados
    expect(r.parcelado).toBeCloseTo(1061.15, 2)
  })

  it('medida vazia não vira item; erro de um item não derruba os outros', () => {
    const r = calcularAmbientesCortina([
      { id: 1, nome: '', cortinas: [{ ...cortinaBase, medidas: [
        { largura: '2,50', altura: '2,55', quantidade: '1' },
        { largura: '', altura: '', quantidade: '1' },          // em branco: ignora
      ] }] },
      { id: 2, nome: 'Varanda', cortinas: [{ ...cortinaBase, id: 3, suporte: 'varao_duplo',
        medidas: [{ largura: '2,00', altura: '2,30', quantidade: '1' }] }] },   // sem preço: erro
    ], dCortina)
    expect(r.ok).toHaveLength(1)
    expect(r.erros).toHaveLength(1)
    expect(r.subtotal).toBeCloseTo(610.42, 2)
  })

  it('quantidade 2 na medida dobra o item', () => {
    const r = calcularAmbientesCortina([
      { id: 1, nome: 'Sala', cortinas: [{ ...cortinaBase, medidas: [{ largura: '2,50', altura: '2,55', quantidade: '2' }] }] },
    ], dCortina)
    expect(r.subtotal).toBeCloseTo(1220.83, 2)   // 2 × 610,4166…, arredondado no fim
  })
})
