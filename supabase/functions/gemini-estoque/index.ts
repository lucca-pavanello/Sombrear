/**
 * Edge Function: gemini-estoque
 * Proxy para o chat de IA do módulo de estoque (useChatAPI.ts / useChat.ts).
 * O nome é histórico: desde 10/11/2026 quem responde é o Muse (_shared/muse.ts),
 * com o pedido e a resposta ainda no formato do Gemini, function calling incluso.
 *
 * Só usuário logado, aprovado e com acesso ao Estoque (_shared/acesso.ts).
 */

import { exigirAcesso } from '../_shared/acesso.ts'
import { gerarConteudo } from '../_shared/muse.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const recusa = await exigirAcesso(req, 'estoque')
    if (recusa) return recusa

    // Recebe o pedido no formato do Gemini ({ contents, tools?, systemInstruction?,
    // generationConfig? }) e devolve no mesmo formato (candidates), para o chat do
    // Estoque não mudar. Quem responde é o Muse; o `model` que o cliente manda é ignorado.
    const body = await req.json()
    const r = await gerarConteudo({
      contents: body.contents,
      tools: body.tools,
      systemInstruction: body.systemInstruction,
      generationConfig: body.generationConfig,
    })

    if (!r.ok) {
      console.error('[gemini-estoque] Muse falhou:', r.status, r.erro)
      return new Response(JSON.stringify({ error: r.erro }), {
        status: r.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(r.dados), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
