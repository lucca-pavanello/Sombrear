/**
 * Edge Function: n8n-cotacao
 * Proxy autenticado para o webhook do n8n — mantém a URL e o token
 * fora do bundle JavaScript do browser.
 *
 * Só usuário logado, aprovado e com acesso a Orçamentos (_shared/acesso.ts).
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
    const recusa = await exigirAcesso(req, 'orcamento')
    if (recusa) return recusa

    const webhookUrl = Deno.env.get('N8N_WEBHOOK_URL')
    if (!webhookUrl) {
      return new Response(JSON.stringify({ error: 'N8N_WEBHOOK_URL não configurada' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const payload = await req.json()

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    // Token de autenticação opcional (configurar Header Auth no n8n)
    const webhookSecret = Deno.env.get('N8N_WEBHOOK_SECRET')
    if (webhookSecret) {
      headers['x-webhook-secret'] = webhookSecret
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `n8n retornou HTTP ${res.status}` }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // n8n pode retornar texto ou JSON
    const contentType = res.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json') ? await res.json() : await res.text()

    return new Response(JSON.stringify({ ok: true, data: body }), {
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
