/**
 * Tradutor entre o formato `generateContent` do Gemini e o chat do Muse (Meta,
 * compatível com OpenAI). Funções puras: usadas pelas Edge Functions
 * (`supabase/functions/_shared/muse.ts`) e testadas no vitest.
 *
 * Existe para as functions e o chat do Estoque continuarem montando o pedido
 * como já montam (systemInstruction, contents, tools, generationConfig) e só o
 * transporte mudar. O que o Muse aceita foi conferido na API em 10/11/2026:
 *  - ferramentas: sim, mas `tool_choice` só "auto" — para proibir chamada de
 *    ferramenta (mode NONE) as ferramentas simplesmente não são enviadas;
 *  - `response_format` json_object e json_schema: sim;
 *  - imagem: `image_url` com data URI em base64;
 *  - áudio: `input_audio` só declara "wav" ou "mp3", mas o conteúdo é lido pelo
 *    próprio arquivo — webm, ogg e mp4 passam declarados como "mp3".
 */

type Json = Record<string, unknown>

export interface ParteGemini {
  text?: string
  inline_data?: { mime_type?: string; data?: string }
  inlineData?: { mimeType?: string; data?: string }
  functionCall?: { name: string; args?: Json }
  functionResponse?: { name: string; response?: unknown }
  [k: string]: unknown
}

export interface ConteudoGemini { role?: string; parts?: ParteGemini[] }

export interface PedidoGemini {
  systemInstruction?: { parts?: { text?: string }[] }
  contents?: ConteudoGemini[]
  tools?: { functionDeclarations?: { name: string; description?: string; parameters?: unknown }[] }[]
  toolConfig?: { functionCallingConfig?: { mode?: string } }
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
    responseMimeType?: string
    responseSchema?: unknown
  }
}

export interface RespostaGemini {
  candidates: { content: { role: 'model'; parts: ParteGemini[] }; finishReason: string }[]
}

/** O Gemini aceita tipos em maiúsculo ("OBJECT") e `nullable`; JSON Schema não. */
export function esquemaJson(esquema: unknown): unknown {
  if (Array.isArray(esquema)) return esquema.map(esquemaJson)
  if (!esquema || typeof esquema !== 'object') return esquema
  const saida: Json = {}
  for (const [chave, valor] of Object.entries(esquema as Json)) {
    if (chave === 'nullable') continue
    saida[chave] = chave === 'type' && typeof valor === 'string' ? valor.toLowerCase() : esquemaJson(valor)
  }
  if ((esquema as Json).nullable === true && typeof saida.type === 'string') saida.type = [saida.type, 'null']
  return saida
}

function parteDeMidia(p: ParteGemini): Json | null {
  const mime = (p.inline_data?.mime_type ?? p.inlineData?.mimeType ?? '').split(';')[0].trim().toLowerCase()
  const data = p.inline_data?.data ?? p.inlineData?.data
  if (!mime || !data) return null
  if (mime.startsWith('image/')) return { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } }
  if (mime.startsWith('audio/')) {
    const wav = mime === 'audio/wav' || mime === 'audio/x-wav'
    return { type: 'input_audio', input_audio: { data, format: wav ? 'wav' : 'mp3' } }
  }
  return null
}

/** Pedido no formato do Gemini → corpo do chat do Muse (sem `model`). */
export function paraMuse(pedido: PedidoGemini): Json {
  const mensagens: Json[] = []
  const sistema = (pedido.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join('\n').trim()
  if (sistema) mensagens.push({ role: 'system', content: sistema })

  // O Gemini casa resposta de ferramenta pelo nome; o Muse, por id. Os ids são
  // criados aqui, na ordem em que as chamadas aparecem, e consumidos pela resposta.
  let pendentes: { id: string; name: string }[] = []
  let contador = 0

  for (const c of pedido.contents ?? []) {
    const partes = c.parts ?? []

    if (c.role === 'model') {
      const chamadas = partes.filter((p) => p.functionCall)
      const texto = partes.map((p) => p.text ?? '').join('')
      const msg: Json = { role: 'assistant', content: texto || null }
      if (chamadas.length > 0) {
        pendentes = chamadas.map((p) => ({ id: `call_${contador++}`, name: p.functionCall!.name }))
        msg.tool_calls = chamadas.map((p, i) => ({
          id: pendentes[i].id,
          type: 'function',
          function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) },
        }))
      }
      if (texto || chamadas.length > 0) mensagens.push(msg)
      continue
    }

    for (const p of partes.filter((x) => x.functionResponse)) {
      const nome = p.functionResponse!.name
      const i = Math.max(0, pendentes.findIndex((x) => x.name === nome))
      const [dona] = pendentes.splice(i, 1)
      mensagens.push({
        role: 'tool',
        tool_call_id: dona?.id ?? `call_${contador++}`,
        content: JSON.stringify(p.functionResponse!.response ?? {}),
      })
    }

    const conteudo: Json[] = []
    for (const p of partes) {
      if (p.functionResponse) continue
      if (typeof p.text === 'string' && p.text) conteudo.push({ type: 'text', text: p.text })
      const midia = parteDeMidia(p)
      if (midia) conteudo.push(midia)
    }
    if (conteudo.length === 0) continue
    const soTexto = conteudo.every((x) => x.type === 'text')
    mensagens.push({ role: 'user', content: soTexto ? conteudo.map((x) => x.text).join('\n') : conteudo })
  }

  const corpo: Json = { messages: mensagens }

  const declaradas = (pedido.tools ?? []).flatMap((t) => t.functionDeclarations ?? [])
  const proibido = pedido.toolConfig?.functionCallingConfig?.mode === 'NONE'
  if (declaradas.length > 0 && !proibido) {
    corpo.tools = declaradas.map((f) => ({
      type: 'function',
      function: {
        name: f.name,
        description: f.description ?? '',
        parameters: esquemaJson(f.parameters ?? { type: 'object', properties: {} }),
      },
    }))
  }

  const g = pedido.generationConfig ?? {}
  if (typeof g.temperature === 'number') corpo.temperature = g.temperature
  if (typeof g.maxOutputTokens === 'number') corpo.max_tokens = g.maxOutputTokens
  if (g.responseMimeType === 'application/json') {
    corpo.response_format = g.responseSchema
      ? { type: 'json_schema', json_schema: { name: 'resposta', schema: esquemaJson(g.responseSchema) } }
      : { type: 'json_object' }
  }
  return corpo
}

/** Resposta do Muse → formato `candidates` do Gemini. `null` quando veio vazia. */
export function deMuse(json: unknown): RespostaGemini | null {
  const escolha = (json as { choices?: { message?: Json; finish_reason?: string }[] } | null)?.choices?.[0]
  const msg = escolha?.message
  if (!msg) return null

  const parts: ParteGemini[] = []
  if (typeof msg.content === 'string' && msg.content.trim()) parts.push({ text: msg.content })
  for (const tc of (Array.isArray(msg.tool_calls) ? msg.tool_calls : []) as { function?: { name?: string; arguments?: string } }[]) {
    if (!tc.function?.name) continue
    let args: Json = {}
    try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* argumentos ilegíveis: segue sem */ }
    parts.push({ functionCall: { name: tc.function.name, args } })
  }
  if (parts.length === 0) return null

  return {
    candidates: [{
      content: { role: 'model', parts },
      finishReason: escolha?.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP',
    }],
  }
}
