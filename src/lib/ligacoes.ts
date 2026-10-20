/**
 * Textos da aba Agente IA > Ligações: duração, telefone, assunto e o que foi feito no WhatsApp.
 * Separado da tela para dar para testar sem React.
 */
import type { Ligacao } from '@/hooks/useLigacoes'

/** "45 s", "2 min", "1 min 30 s"; vazio quando a ligação não tem fim gravado */
export function duracao(inicio: string, fim: string | null): string {
  if (!fim) return ''
  const s = Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const resto = s % 60
  return resto ? `${m} min ${resto} s` : `${m} min`
}

/** "17996185177" ou "5517996185177" → "(17) 99618-5177"; o que não reconhece volta como veio */
export function telefoneBonito(t: string | null | undefined): string {
  let d = String(t ?? '').replace(/\D/g, '')
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return String(t ?? '')
}

export const ROTULO_ASSUNTO: Record<NonNullable<Ligacao['assunto']>, string> = {
  orcamento: 'Orçamento', duvida: 'Dúvida', outro: 'Outro assunto',
}

/** o que aconteceu depois da ligação, em uma frase para a equipe */
export const ROTULO_WHATSAPP: Record<Ligacao['whatsapp_status'], string> = {
  enviado: 'Mensagem enviada no WhatsApp',
  so_nota: 'Equipe já atendia: só a nota no Chatwoot',
  sem_telefone: 'Sem telefone: nada foi enviado',
  pendente: 'Envio em andamento',
  erro: 'Falhou o envio no WhatsApp',
}

/** busca por nome ou telefone (com ou sem máscara) */
export function filtrarLigacoes(lista: Ligacao[], busca: string): Ligacao[] {
  const termo = busca.trim().toLowerCase()
  if (!termo) return lista
  const digitos = termo.replace(/\D/g, '')
  return lista.filter(l =>
    (l.nome ?? '').toLowerCase().includes(termo) ||
    (digitos.length >= 3 && [l.telefone, l.telefone_chamador].some(t => String(t ?? '').replace(/\D/g, '').includes(digitos))),
  )
}
