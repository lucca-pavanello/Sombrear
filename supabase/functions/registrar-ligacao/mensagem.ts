/**
 * Os textos que saem depois de uma ligação: as mensagens ao cliente no WhatsApp, a nota
 * interna da equipe no Chatwoot e o lembrete na memória da Amanda do WhatsApp. Montados pelo
 * código, nunca pelo modelo: são as mesmas palavras toda vez e não inventam valor.
 */

export type Assunto = 'orcamento' | 'duvida' | 'outro'

/** o último orçamento da ligação, do jeito que a calculadora devolveu */
export type Orcamento = {
  modelo?: string | null
  tecido: string
  largura: number
  altura: number
  quantidade?: number | null
  total4x: number
  totalAvista: number
  instalacao?: number | 'sob_consulta' | null
  maisBarato?: boolean
}

export type Fala = { quem: 'cliente' | 'amanda'; texto: string; em?: string }

const NOME_MODELO: Record<string, string> = {
  Rolo: 'Rolô', 'Rolo Motorizado': 'Rolô Motorizada', Double: 'Double Vision', Romana: 'Romana',
  PV: 'Persiana Vertical', PH_Aluminio: 'Persiana Horizontal de Alumínio', PH_50: 'Persiana Horizontal 50 mm',
}

export function reais(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function medida(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome ?? '').trim().split(/\s+/)[0] ?? ''
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''
}

/** "dd/mm às HH:MM" no horário de São Paulo */
export function quando(iso: string): string {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return `${dia} às ${hora}`
}

export function blocoOrcamento(o: Orcamento, nome: string | null): string {
  const qtd = String(o.quantidade || 1).padStart(2, '0')
  const modelo = o.modelo ? (NOME_MODELO[o.modelo] ?? o.modelo) + ' ' : ''
  const linhas = [
    `*Orçamento${nome ? ' - ' + primeiroNome(nome) : ''}*`,
    `• ${qtd} ${modelo}${o.tecido} ${medida(o.largura)} x ${medida(o.altura)}`,
    `*Valor total:* ${o.maisBarato ? 'a partir de ' : ''}${reais(o.total4x)} em até 4x, ou ${reais(o.totalAvista)} à vista`,
  ]
  if (typeof o.instalacao === 'number') linhas.push(`- Instalação opcional: acréscimo de ${reais(o.instalacao)}`)
  else if (o.instalacao === 'sob_consulta') linhas.push('- Instalação: sob consulta de localidade')
  return linhas.join('\n')
}

/** Como alguém da loja escreveria: a primeira cumprimenta e lembra da ligação, a segunda segue o
 * assunto. No máximo uma pergunta por mensagem (regra da loja). */
export function mensagensCliente(p: { nome: string | null; assunto: Assunto; resumo: string; orcamento?: Orcamento | null }): string[] {
  const primeiro = primeiroNome(p.nome)
  const primeira = primeiro
    ? `Oi, ${primeiro}, tudo bem? Aqui é da Sombrear, a gente se falou agora há pouco por telefone 😊`
    : 'Oi! Aqui é da Sombrear, a gente se falou agora há pouco por telefone 😊 Com quem eu falo?'
  if (p.assunto === 'outro') {
    return [primeira, 'Já passei seu recado pro pessoal da loja. Eles te respondem por aqui mesmo.']
  }
  const segunda = p.orcamento
    ? `Te mando aqui o valor que passei na ligação:\n\n${blocoOrcamento(p.orcamento, p.nome)}\n\nSe puder, me manda uma foto da janela que eu confiro as medidas certinho.`
    : 'Me manda uma foto da janela por aqui que eu já vejo tudo certinho pra você.'
  return [primeira, segunda]
}

const ROTULO_ASSUNTO: Record<Assunto, string> = { orcamento: 'orçamento', duvida: 'dúvida', outro: 'outro assunto' }
const LIMITE_CONVERSA = 3000

export function notaEquipe(p: {
  inicio: string; fim?: string | null; nome: string | null; telefone: string | null; telefoneChamador: string | null
  assunto: Assunto; resumo: string; orcamento?: Orcamento | null; transcricao: Fala[]; equipeAssumiu: boolean
}): string {
  const min = p.fim ? Math.max(1, Math.round((Date.parse(p.fim) - Date.parse(p.inicio)) / 60000)) : null
  const linhas = [
    `📞 Ligação atendida pela Amanda de voz, ${quando(p.inicio)}${min ? ` (${min} min)` : ''}`,
    `Nome dito: ${p.nome?.trim() || 'não informado'} (pode ter vindo errado pela voz)`,
    `Telefone confirmado: ${p.telefone ?? 'não informado'}${p.telefoneChamador && p.telefoneChamador !== p.telefone ? ` · número da linha: ${p.telefoneChamador}` : ''}`,
    `Assunto: ${ROTULO_ASSUNTO[p.assunto]}`,
    `Resumo: ${p.resumo.trim()}`,
  ]
  if (p.orcamento) linhas.push('', blocoOrcamento(p.orcamento, p.nome))
  if (p.equipeAssumiu) linhas.push('', '⚠️ A equipe já atendia esse cliente: nada foi mandado pra ele, só esta nota.')
  else if (p.assunto === 'outro') linhas.push('', '👉 Precisa de alguém da equipe: o cliente foi avisado que o time responde por aqui.')
  let conversa = p.transcricao.map(f => `${f.quem === 'cliente' ? 'Cliente' : 'Amanda'}: ${f.texto}`).join('\n')
  if (conversa.length > LIMITE_CONVERSA) conversa = conversa.slice(0, LIMITE_CONVERSA) + '\n[…conversa completa no Dash]'
  if (conversa) linhas.push('', 'Conversa:', conversa)
  return linhas.join('\n')
}

/** O que a Amanda do WhatsApp lê na memória para continuar de onde a ligação parou. */
export function lembreteMemoria(p: { inicio: string; resumo: string; orcamento?: Orcamento | null; mensagens: string[] }): string {
  const partes = [`[Ligação de ${quando(p.inicio)}, atendida pela Amanda de voz] ${p.resumo.trim()}`]
  if (p.orcamento) {
    const o = p.orcamento
    partes.push(`Valor passado na ligação: ${o.maisBarato ? 'a partir de ' : ''}${reais(o.total4x)} em até 4x (${o.tecido}, ${medida(o.largura)} x ${medida(o.altura)}).`)
  }
  if (p.mensagens.length) partes.push(`Mandei no WhatsApp logo depois: ${p.mensagens.join(' / ')}`)
  return partes.join('\n')
}
