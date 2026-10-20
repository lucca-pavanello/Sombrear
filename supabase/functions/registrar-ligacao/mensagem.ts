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

/** "Bom dia" / "Boa tarde" / "Boa noite" pelo horário de São Paulo */
export function saudacao(iso: string): string {
  const h = Number(new Date(iso).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false })) % 24
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

// cômodos que pedem "da"; o resto vai com "do" (quarto, escritório, banheiro, closet...)
const FEMININO = new Set(['sala', 'cozinha', 'varanda', 'sacada', 'suíte', 'suite', 'área', 'area', 'lavanderia',
  'copa', 'edícula', 'loja', 'recepção', 'academia', 'brinquedoteca', 'biblioteca', 'porta', 'janela'])

/** "da janela da sala", "das janelas do quarto e da sala"; só "da janela" quando ele não disse o cômodo */
export function janelaDe(ambientes?: string[] | null): string {
  const nomes = (ambientes ?? []).map(a => String(a).trim().toLowerCase().replace(/^(o|a|os|as)\s+/, '')).filter(Boolean)
  if (!nomes.length) return 'da janela'
  const com = nomes.map(n => (FEMININO.has(n.split(/\s+/)[0]) ? 'da ' : 'do ') + n)
  const lista = com.length === 1 ? com[0] : `${com.slice(0, -1).join(', ')} e ${com[com.length - 1]}`
  return `${com.length === 1 ? 'da janela' : 'das janelas'} ${lista}`
}

/** No tom da Amanda do WhatsApp (prompt do n8n): mensagens curtas, uma ideia por mensagem, sem emoji.
 * 1) cumprimenta e lembra da ligação; 2) confere o nome (a voz não sabe a grafia: Stella ou Estela?);
 * 3) segue o assunto, citando o cômodo que ele falou, para ver que a gente prestou atenção. */
export function mensagensCliente(p: {
  nome: string | null; assunto: Assunto; resumo: string; orcamento?: Orcamento | null
  ambientes?: string[] | null; quando: string
}): string[] {
  const primeiro = primeiroNome(p.nome)
  const oi = `${saudacao(p.quando)}${primeiro ? ', ' + primeiro : ''}, tudo bem? Aqui é da Sombrear, a gente acabou de se falar por telefone.`
  const nome = p.nome?.trim() ? `Anotei seu nome como ${p.nome.trim()}, é assim que escreve?` : 'Qual o seu nome?'
  if (p.assunto === 'outro') {
    return [oi, nome, 'Já passei seu recado pro pessoal da loja, eles te respondem por aqui mesmo.']
  }
  const foto = janelaDe(p.ambientes)
  const segue = p.orcamento
    ? `Te mando aqui o valor que passei na ligação:\n\n${blocoOrcamento(p.orcamento, p.nome)}\n\nSe puder, me manda uma foto ${foto} que eu confiro as medidas.`
    : `E me manda uma foto ${foto} por aqui, que eu já te passo tudo certinho.`
  return [oi, nome, segue]
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
