/**
 * Chamada ao Muse (Meta), formato OpenAI-compatível.
 *
 * É o mesmo endpoint e o mesmo modelo que os workflows do n8n passaram a usar
 * na migração de 24/09 — trocar por Gemini aqui faria as duas metades do
 * sistema responderem com modelos diferentes sem ninguém decidir isso.
 *
 * Timeout explícito: sem ele a plataforma mata o processo no meio e o erro que
 * chega ao chamador é "Failed to send a request to the Edge Function", que não
 * distingue "demorou" de "a function não existe".
 */
import { deMuse, paraMuse, type PedidoGemini, type RespostaGemini } from '../../../src/lib/ia/museGemini.ts'

const URL_MUSE = 'https://api.meta.ai/v1/chat/completions'
export const MODELO_PADRAO = 'muse-spark-1.3-contributor'

export type ResultadoMuse = { ok: true; texto: string } | { ok: false; erro: string }

export async function pedirTexto(
  prompt: string,
  opcoes: { modelo?: string; maxTokens?: number; timeoutMs?: number } = {},
): Promise<ResultadoMuse> {
  const chave = Deno.env.get('META_API_KEY')
  if (!chave) return { ok: false, erro: 'META_API_KEY não configurada' }

  try {
    const r = await fetch(URL_MUSE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opcoes.modelo ?? MODELO_PADRAO,
        max_tokens: opcoes.maxTokens ?? 4000,
        reasoning_effort: 'minimal',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 120_000),
    })
    if (!r.ok) return { ok: false, erro: `muse ${r.status}: ${(await r.text()).slice(0, 300)}` }

    const j = await r.json()
    const texto = j?.choices?.[0]?.message?.content
    if (typeof texto !== 'string' || !texto.trim()) return { ok: false, erro: 'resposta sem texto' }
    return { ok: true, texto }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'falha na chamada' }
  }
}

export type ResultadoConteudo =
  | { ok: true; dados: RespostaGemini }
  | { ok: false; status: number; erro: string }

/**
 * Pedido montado no formato `generateContent` do Gemini (system, contents com
 * texto/imagem/áudio, tools, generationConfig), respondido pelo Muse e devolvido
 * no formato `candidates` do Gemini. A tradução mora em src/lib/ia/museGemini.ts.
 *
 * `reasoning_effort: 'minimal'` é obrigatório: sem ele o raciocínio consome o
 * max_tokens e o conteúdo volta nulo.
 */
export async function gerarConteudo(
  pedido: PedidoGemini,
  opcoes: { modelo?: string; maxTokens?: number; timeoutMs?: number } = {},
): Promise<ResultadoConteudo> {
  const chave = Deno.env.get('META_API_KEY')
  if (!chave) return { ok: false, status: 500, erro: 'META_API_KEY não configurada' }

  try {
    const r = await fetch(URL_MUSE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opcoes.modelo ?? MODELO_PADRAO,
        max_tokens: opcoes.maxTokens ?? 4000,
        reasoning_effort: 'minimal',
        ...paraMuse(pedido),
      }),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 60_000),
    })
    if (!r.ok) return { ok: false, status: r.status, erro: `muse ${r.status}: ${(await r.text()).slice(0, 300)}` }

    const dados = deMuse(await r.json().catch(() => null))
    if (!dados) return { ok: false, status: 502, erro: 'resposta vazia' }
    return { ok: true, dados }
  } catch (e) {
    return { ok: false, status: 504, erro: e instanceof Error ? e.message : 'falha na chamada' }
  }
}
