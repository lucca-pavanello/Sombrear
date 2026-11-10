/**
 * Edge Function: gemini-estoque
 * Proxy para o chat de IA do módulo de estoque (useChatAPI.ts / useChat.ts).
 * Suporta function calling via REST API do Gemini.
 *
 * Só usuário logado, aprovado e com acesso ao Estoque (_shared/acesso.ts).
 */

import { exigirAcesso } from '../_shared/acesso.ts'

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

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Recebe o body completo que seria enviado à API do Gemini
    // { model, contents, tools?, systemInstruction? }
    const body = await req.json()
    const model = body.model ?? 'gemini-3.7-flash'
    // o nome do modelo entra na URL: só aceita nome de modelo Gemini, nada de caminho
    if (typeof model !== 'string' || !/^gemini-[a-z0-9.-]+$/.test(model)) {
      return new Response(JSON.stringify({ error: 'modelo inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: body.contents,
        ...(body.tools ? { tools: body.tools } : {}),
        ...(body.systemInstruction ? { systemInstruction: body.systemInstruction } : {}),
        ...(body.generationConfig ? { generationConfig: body.generationConfig } : {}),
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(data), {
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
