/**
 * Lotes de alterações da IA. `precos_auditoria` não tem coluna de lote (e não se
 * cria migration pra isso): o `lote_id` mora dentro do `detalhe` (jsonb) de cada
 * linha gravada pela Edge Function no mesmo "Aplicar".
 *
 * "Desfazer tudo" deve ser idempotente:
 *  - ao terminar, o front grava uma linha-marca `acao: 'desfazer_lote'` com
 *    `detalhe { lote_id, completo, revertidas: [ids da auditoria] }`;
 *  - lote com marca `completo` não é mais oferecido;
 *  - numa nova tentativa (falha parcial) só as linhas ainda não revertidas são tentadas;
 *  - cada alteração só é revertida se o valor atual ainda for o "depois" do lote
 *    (senão é conflito: alguém mexeu depois e a gente não pisa em cima).
 * Tudo aqui é função pura (testada no vitest); as consultas ao banco ficam na tela.
 */
import { numeroDoValor } from './sanidade'

export const ACAO_DESFAZER_LOTE = 'desfazer_lote'

export interface LinhaAuditoria {
  id: number
  usuario: string
  acao: string
  detalhe: Record<string, unknown>
  criado_em: string
}

export interface LoteAplicado {
  loteId: string
  /** na ordem em que devem ser DESFEITAS: da última aplicada para a primeira */
  linhas: LinhaAuditoria[]
  criadoEm: string
}

export const ehMarcaDesfazer = (l: LinhaAuditoria) => l.acao === ACAO_DESFAZER_LOTE

/** Ids de lote já desfeitos por completo (têm marca `completo`). */
export function lotesDesfeitos(auditoria: LinhaAuditoria[]): Set<string> {
  const s = new Set<string>()
  for (const l of auditoria) {
    if (ehMarcaDesfazer(l) && l.detalhe?.completo === true && typeof l.detalhe.lote_id === 'string') s.add(l.detalhe.lote_id)
  }
  return s
}

/** Ids de auditoria já revertidos de um lote (união de todas as marcas, parciais ou não). */
export function idsRevertidos(marcas: LinhaAuditoria[], loteId: string): Set<number> {
  const s = new Set<number>()
  for (const m of marcas) {
    if (!ehMarcaDesfazer(m) || m.detalhe?.lote_id !== loteId) continue
    const lista = m.detalhe.revertidas
    if (Array.isArray(lista)) for (const x of lista) if (typeof x === 'number') s.add(x)
  }
  return s
}

/** Último lote aplicado pela IA que ainda NÃO foi desfeito (ignora as linhas-marca). */
export function ultimoLote(auditoria: LinhaAuditoria[], extraDesfeitos?: Iterable<string>): LoteAplicado | null {
  const desfeitos = lotesDesfeitos(auditoria)
  for (const id of extraDesfeitos ?? []) desfeitos.add(id)
  const ordenadas = [...auditoria].filter(l => !ehMarcaDesfazer(l)).sort((a, b) => b.id - a.id)
  const primeira = ordenadas.find(l => typeof l.detalhe?.lote_id === 'string' && !desfeitos.has(String(l.detalhe.lote_id)))
  if (!primeira) return null
  const loteId = String(primeira.detalhe.lote_id)
  const linhas = ordenadas.filter(l => l.detalhe?.lote_id === loteId)
  return { loteId, linhas, criadoEm: primeira.criado_em }
}

/** Separa o que a consulta por lote_id devolveu em alterações (da última p/ primeira) e marcas. */
export function separarLote(rows: LinhaAuditoria[]): { linhas: LinhaAuditoria[]; marcas: LinhaAuditoria[] } {
  return {
    linhas: rows.filter(l => !ehMarcaDesfazer(l)).sort((a, b) => b.id - a.id),
    marcas: rows.filter(ehMarcaDesfazer),
  }
}

/** Linhas do lote que ainda faltam reverter (retry depois de falha parcial). */
export function pendentesDoLote(linhas: LinhaAuditoria[], marcas: LinhaAuditoria[], loteId: string): LinhaAuditoria[] {
  const feitas = idsRevertidos(marcas, loteId)
  return linhas.filter(l => !ehMarcaDesfazer(l) && !feitas.has(l.id))
}

// ── Conflito: só reverte se o valor atual ainda é o "depois" ───────────────

/** Compara valores de banco: numérico por valor ("2.80" == 2.8), o resto por igualdade. */
export function mesmoValor(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null
  const na = typeof a === 'string' || typeof a === 'number' ? numeroDoValor(a) : null
  const nb = typeof b === 'string' || typeof b === 'number' ? numeroDoValor(b) : null
  if (na != null && nb != null) return Math.abs(na - nb) < 1e-9
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface AlvoReversao {
  tabela: string
  match: Record<string, unknown>
  /** campos e valores a restaurar */
  antes: Record<string, unknown>
  /** valores que o lote deixou (o atual tem de ser igual a isto) */
  depois: Record<string, unknown>
}

export type PlanoReversao =
  | { tipo: 'atualizar'; alvos: AlvoReversao[] }
  /** criar_promocao desfeita = apagar a promoção, se ainda for a mesma */
  | { tipo: 'apagar'; tabela: string; match: Record<string, unknown>; depois: Record<string, unknown> }
  /** remover_promocao / excluir_grade desfeitas = reinserir, se não existir igual */
  | { tipo: 'inserir'; tabela: string; linha: Record<string, unknown>; procura: Record<string, unknown> }

const semId = (row: Record<string, unknown>) => {
  const { id: _id, ...resto } = row
  return resto
}

/** Só colunas escalares preenchidas servem de filtro `.eq` (null/objeto não casam bem). */
export function filtroDeBusca(row: Record<string, unknown>): Record<string, unknown> {
  const f: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue
    if (typeof v === 'object') continue
    if (k.endsWith('_at') || k === 'criado_em' || k === 'atualizado_em') continue // timestamps: formato muda na ida e volta
    f[k] = v
  }
  return f
}

/**
 * Traduz uma linha de auditoria em plano de reversão. Devolve null se faltam dados
 * (a tela mostra "sem dados do valor anterior").
 */
export function planoReversao(l: LinhaAuditoria): PlanoReversao | null {
  const d = l.detalhe ?? {}
  const antes = d.antes as Record<string, unknown> | undefined
  const campoDe = (k: string) => (antes ? (antes as Record<string, unknown>)[k] : undefined)
  const um = (tabela: string, match: Record<string, unknown>, ant: Record<string, unknown>, dep: Record<string, unknown>): PlanoReversao =>
    ({ tipo: 'atualizar', alvos: [{ tabela, match, antes: ant, depois: dep }] })

  switch (l.acao) {
    case 'editar_grade':
      if (!d.tabela || !d.match || !d.antes || !d.depois) return null
      return um(String(d.tabela), d.match as Record<string, unknown>, d.antes as Record<string, unknown>, d.depois as Record<string, unknown>)
    case 'excluir_grade':
      if (!d.tabela || !antes) return null
      return { tipo: 'inserir', tabela: String(d.tabela), linha: semId(antes), procura: filtroDeBusca(semId(antes)) }
    case 'criar_promocao':
      if (d.promo_id == null) return null
      return { tipo: 'apagar', tabela: 'precos_promocoes', match: { id: d.promo_id }, depois: { desconto_pct: d.desconto_pct } }
    case 'remover_promocao':
      if (!antes) return null
      return {
        tipo: 'inserir', tabela: 'precos_promocoes', linha: semId(antes),
        procura: filtroDeBusca(Object.fromEntries(
          ['alvo_tipo', 'alvo_nome', 'desconto_pct', 'inicio', 'fim'].filter(k => k in antes).map(k => [k, antes[k]]))),
      }
    case 'atualizar_preco_tecido':
      if (!Array.isArray(d.antes)) return null
      return {
        tipo: 'atualizar',
        alvos: (d.antes as { id: number; preco: number }[]).map(r => ({
          tabela: 'precos_tecidos', match: { id: r.id }, antes: { preco: r.preco }, depois: { preco: d.preco },
        })),
      }
    case 'atualizar_parametro':
      return antes ? um('precos_parametros', { chave: d.chave }, { valor: campoDe('valor') }, { valor: d.valor }) : null
    case 'atualizar_preco_artigo':
      return antes ? um('precos_artigos', { categoria: d.categoria, nome: d.nome }, { preco: campoDe('preco') }, { preco: d.preco }) : null
    case 'atualizar_componente_ferragem':
      return antes ? um('precos_ferragem_componentes', { id: d.id }, { valor: campoDe('valor') }, { valor: d.valor }) : null
    case 'atualizar_ph50': {
      if (!antes) return null
      const c = String(d.campo)
      return um('precos_ph50', { modelo: d.modelo, cor: d.cor }, { [c]: campoDe(c) }, { [c]: d.valor })
    }
    case 'atualizar_bando_param': {
      if (!antes) return null
      const c = String(d.campo)
      return um('precos_bandos_params', { cor: d.cor }, { [c]: campoDe(c) }, { [c]: d.valor })
    }
    case 'atualizar_colocacao':
      return antes ? um('precos_colocacao', { id: d.id }, { preco: campoDe('preco') }, { preco: d.preco }) : null
    case 'atualizar_barra_faixa':
      return antes ? um('precos_barra_faixas', { largura_min: d.largura_min }, { qtd_presilhas: campoDe('qtd_presilhas') }, { qtd_presilhas: d.qtd_presilhas }) : null
    case 'atualizar_motor_componente':
      return antes ? um('precos_motor_componentes', { item: d.item }, { custo: campoDe('custo') }, { custo: d.custo }) : null
    case 'atualizar_motor_estrutura':
      return antes ? um('precos_motor_estrutura', { id: d.id }, { valor: campoDe('valor') }, { valor: d.valor }) : null
    case 'atualizar_romana':
      return antes ? um('precos_romana_matriz', { largura: d.largura, altura: d.altura }, { custo: campoDe('custo') }, { custo: d.custo }) : null
    default:
      return null
  }
}

export type EstadoReversao = 'reverter' | 'ja_revertido' | 'conflito'

const todosIguais = (atual: Record<string, unknown>, alvo: Record<string, unknown>) =>
  Object.entries(alvo).every(([k, v]) => mesmoValor(atual[k], v))

/**
 * Compara o que está no banco agora com o que o lote deixou.
 *  - igual ao "depois"  → pode reverter;
 *  - já igual ao "antes" → já revertido (retry; não escreve de novo);
 *  - qualquer outra coisa (ou linha sumiu) → conflito: alguém alterou depois.
 */
export function classificarAlvo(alvo: Pick<AlvoReversao, 'antes' | 'depois'>, atuais: Record<string, unknown>[]): EstadoReversao {
  if (atuais.length === 0) return 'conflito'
  let algumReverter = false
  for (const atual of atuais) {
    if (todosIguais(atual, alvo.antes)) continue
    if (todosIguais(atual, alvo.depois)) { algumReverter = true; continue }
    return 'conflito'
  }
  return algumReverter ? 'reverter' : 'ja_revertido'
}

/** Promoção criada pelo lote: some = já revertido; mudou (desconto) = conflito; igual = apagar. */
export function classificarApagar(depois: Record<string, unknown>, atuais: Record<string, unknown>[]): EstadoReversao {
  if (atuais.length === 0) return 'ja_revertido'
  return atuais.every(a => todosIguais(a, depois)) ? 'reverter' : 'conflito'
}

/** Reinserção só se não existe linha igual (evita DUPLICAR promoção/linha num retry). */
export function classificarInserir(existentes: unknown[]): EstadoReversao {
  return existentes.length > 0 ? 'ja_revertido' : 'reverter'
}
