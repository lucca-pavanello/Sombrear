/**
 * Edge Function: simular
 * Simulador de balcão — calcula o orçamento no servidor com o MESMO motor do
 * dash (calc.ts = cópia de src/lib/simulador.ts), sem expor custos ao cliente.
 *
 * acao 'calcular' → valores de venda (custos/margem só quando o chamador é admin)
 * acao 'salvar'   → grava direto em orcamentos (fonte='simulador', status FEITO)
 * acao 'detalhar' → reconstrói a quebra por item de uma venda antiga (só se conferir)
 *
 * Qualquer usuário APROVADO usa; custo e margem nunca saem para não-admin.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { simular } from './calc.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_EMAIL = 'luccapavanallo@gmail.com'
const MODELOS = new Set(['Rolo', 'Double', 'Romana', 'PV', 'PH_Aluminio', 'PH_50', 'Rolo Motorizado'])
const ACABAMENTOS = new Set(['nenhum', 'bando_branco', 'bando_preto', 'barra', 'kit_box'])
/** caminho inverso do rótulo: o que está salvo em orcamentos.acabamentos */
const ACABAMENTO_DA_VENDA: Record<string, string> = {
  'Bando Branco': 'bando_branco', 'Bando Preto': 'bando_preto',
  'Barra Niveladora': 'barra', 'Kit Box': 'kit_box', 'Sem': 'nenhum',
}
const ROTULO_ACABAMENTO: Record<string, string> = {
  nenhum: 'Sem', bando_branco: 'Bando Branco', bando_preto: 'Bando Preto',
  barra: 'Barra Niveladora', kit_box: 'Kit Box',
}

const round2c = (v: number) => Math.round((v + 1e-9) * 100) / 100

function resposta(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── Auth: usuário aprovado ──────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return resposta(401, { error: 'Não autorizado' })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const callerClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser()
    if (authError || !caller) return resposta(401, { error: 'Token inválido' })

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: perfil } = await db.from('profiles')
      .select('approved, is_admin, full_name, email').eq('id', caller.id).single()
    if (perfil?.approved !== true) return resposta(403, { error: 'Acesso pendente de aprovação' })
    const isAdmin = caller.email === ADMIN_EMAIL || perfil?.is_admin === true

    const body = await req.json()
    const acao = String(body.acao ?? 'calcular')

    // ══════════════ OPÇÕES (nomes apenas, sem preços) ══════════════
    if (acao === 'opcoes') {
      const [{ data: tec }, { data: art }, { data: p50 }] = await Promise.all([
        db.from('precos_tecidos_vigentes').select('nome').order('nome'),
        db.from('precos_artigos').select('categoria, nome').order('nome'),
        db.from('precos_ph50').select('modelo, cor').order('modelo'),
      ])
      return resposta(200, {
        tecidos: [...new Set((tec ?? []).map(t => t.nome))],
        artigosPV: (art ?? []).filter(a => a.categoria === 'PV').map(a => a.nome),
        artigosPH: (art ?? []).filter(a => a.categoria === 'PH_ALUMINIO').map(a => a.nome),
        ph50: (p50 ?? []).map(p => ({ valor: `${p.modelo}|${p.cor}`, label: `${String(p.modelo).trim()} · ${p.cor}` })),
      })
    }

    /* ══════════════ DETALHAR ══════════════
       Venda antiga (veio do WhatsApp ou é anterior à quebra por item) não tem
       custos_detalhe. Aqui a gente recalcula pelos dados guardados e SÓ grava
       se o número bater com o que já estava salvo — senão seria chute. */
    let idDetalhar: string | null = null
    if (acao === 'detalhar') {
      if (!isAdmin && perfil?.pode_fechamento !== true) {
        return resposta(403, { error: 'Sem acesso ao fechamento' })
      }
      const { data: o } = await db.from('orcamentos')
        .select('id, modelo, tecido, largura, altura, quantidade, cor_ferragem_motor, acabamentos, custo_tecido, custo_acabamento, valor_parceiro, custos_detalhe')
        .eq('id', String(body.id ?? '')).single()
      if (!o) return resposta(404, { error: 'Orçamento não encontrado' })
      if (o.custos_detalhe) return resposta(200, { erro: 'Essa venda já tem a quebra.' })
      if (!MODELOS.has(String(o.modelo))) {
        return resposta(200, {
          erro: `${o.modelo} não passa pelo motor do simulador (o motor não entra no cálculo), então a quebra teria que ser chutada.`,
        })
      }
      const acab = String(o.acabamentos ?? '')
      const ehPH50 = o.modelo === 'PH_50'
      idDetalhar = o.id
      body.entrada = {
        modelo: o.modelo,
        tecido: o.tecido,
        artigo: o.tecido,
        corFerragem: /pret/i.test(String(o.cor_ferragem_motor ?? '')) ? 'PRETA' : 'BRANCA',
        largura: o.largura, altura: o.altura, quantidade: o.quantidade ?? 1,
        acabamento: ACABAMENTO_DA_VENDA[acab] ?? 'nenhum',
        ph50Acabamento: /fita/i.test(acab) ? 'fita' : 'cadarco',
        ph50Bando: ehPH50 && /band/i.test(acab),
        incluirInstalacao: false,
      }
      body.vendaOriginal = o
    }

    // ── Entrada saneada ─────────────────────────────────────
    const e = body.entrada ?? {}
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
    const entrada = {
      modelo: String(e.modelo ?? ''),
      tecido: e.tecido ? String(e.tecido) : undefined,
      artigo: e.artigo ? String(e.artigo) : undefined,
      ph50Acabamento: e.ph50Acabamento === 'fita' ? 'fita' as const : 'cadarco' as const,
      ph50Bando: e.ph50Bando === true,
      corFerragem: e.corFerragem === 'PRETA' ? 'PRETA' as const : 'BRANCA' as const,
      largura: num(e.largura),
      altura: num(e.altura),
      quantidade: Math.max(1, Math.round(num(e.quantidade) || 1)),
      acabamento: ACABAMENTOS.has(String(e.acabamento)) ? String(e.acabamento) : 'nenhum',
      motorForca: (['6N', '10N', '20N', 'WIFI'].includes(String(e.motorForca ?? '').toUpperCase())
        ? (String(e.motorForca).toUpperCase() as '6N' | '10N' | '20N' | 'WIFI')
        : undefined),
      // motorização do pedido (16/08): motores, controles (1/6/16 canais) e junções
      motorQtd: num(e.motorQtd) > 0 ? Math.round(num(e.motorQtd)) : undefined,
      controleQtd: e.controleQtd != null && num(e.controleQtd) >= 0 ? Math.round(num(e.controleQtd)) : undefined,
      controleCanais: [1, 6, 16].includes(num(e.controleCanais)) ? (num(e.controleCanais) as 1 | 6 | 16) : undefined,
      juncaoQtd: num(e.juncaoQtd) > 0 ? Math.round(num(e.juncaoQtd)) : undefined,
      // bandô de peça única numa porta dividida: medida e quantidade próprias
      bandoLargura: num(e.bandoLargura) > 0 ? num(e.bandoLargura) : undefined,
      bandoQuantidade: num(e.bandoQuantidade) > 0 ? Math.round(num(e.bandoQuantidade)) : undefined,
      incluirInstalacao: e.incluirInstalacao === true,
    }
    if (!MODELOS.has(entrada.modelo)) return resposta(400, { error: 'Modelo inválido' })

    // ── Dados de preço (service role — RLS admin não bloqueia o cálculo) ──
    const [
      { data: tecidos }, { data: componentes }, { data: bandos }, { data: bandoParams },
      { data: barraFaixas }, { data: colocacao }, { data: artigos }, { data: ph50 },
      { data: parametros }, { data: romana }, { data: motorEstrutura }, { data: motorComponentes },
      { data: familias },
    ] = await Promise.all([
      db.from('precos_tecidos_vigentes').select('*'),
      db.from('precos_ferragem_componentes').select('*'),
      db.from('precos_bandos').select('*'),
      db.from('precos_bandos_params').select('*'),
      db.from('precos_barra_faixas').select('*'),
      db.from('precos_colocacao').select('*'),
      db.from('precos_artigos').select('*'),
      db.from('precos_ph50').select('*'),
      db.from('precos_parametros').select('*'),
      db.from('precos_romana_matriz').select('*'),
      db.from('precos_motor_estrutura').select('*'),
      db.from('precos_motor_componentes').select('*'),
      db.from('precos_ferragem_familias').select('*'),
    ])

    // deno-lint-ignore no-explicit-any
    const r = simular(entrada as any, {
      tecidos: tecidos ?? [], componentes: componentes ?? [], bandos: bandos ?? [],
      bandoParams: bandoParams ?? [], barraFaixas: barraFaixas ?? [], colocacao: colocacao ?? [],
      artigos: artigos ?? [], ph50: ph50 ?? [], parametros: parametros ?? [], romana: romana ?? [],
      motorEstrutura: motorEstrutura ?? [], motorComponentes: motorComponentes ?? [],
      familias: familias ?? [],
      // deno-lint-ignore no-explicit-any
    } as any)
    if ('erro' in r) return resposta(200, { erro: r.erro })

    const publico = {
      total4x: r.total4x,
      totalAvista: r.totalAvista,
      vendaProduto: r.vendaProduto,
      vendaAcabamento: r.vendaAcabamento,
      instalacao: r.instalacao,
      emPromocao: r.emPromocao,
      descontoPct: r.descontoPct,
      observacoes: r.observacoes,
    }

    // ══════════════ DETALHAR: confere e grava ══════════════
    if (acao === 'detalhar' && idDetalhar) {
      const o = body.vendaOriginal
      const custoRealTotal = round2c(r.custoProduto + r.custoAcabamento)
      const parceiraSalva = Number(o.valor_parceiro ?? 0)
      const custoSalvo = round2c(Number(o.custo_tecido ?? 0) + Number(o.custo_acabamento ?? 0))

      // bate com a parceira (venda nova) ou com o custo de tabela (venda do n8n)?
      const bateParceira = parceiraSalva > 0 && Math.abs(r.valorParceiro - parceiraSalva) < 0.02
      const bateTabela = custoSalvo > 0 && Math.abs(r.custoTabela - custoSalvo) < 0.02
      if (!bateParceira && !bateTabela) {
        return resposta(200, {
          erro: 'Os preços de hoje não reproduzem o valor desta venda — provavelmente a tabela mudou desde então. Reconstruir aqui seria inventar número, então preferi não gravar.',
        })
      }

      const patch: Record<string, unknown> = { custos_detalhe: r.detalhe }
      // venda do n8n não tinha o repasse calculado; agora tem
      if (!(parceiraSalva > 0)) patch.valor_parceiro = r.valorParceiro
      const { error: erroGravar } = await db.from('orcamentos').update(patch).eq('id', idDetalhar)
      if (erroGravar) return resposta(500, { error: erroGravar.message })

      return resposta(200, {
        ok: true,
        detalhe: r.detalhe,
        valorParceiro: r.valorParceiro,
        conferiu: bateParceira ? 'parceira' : 'custo',
      })
    }

    // ══════════════ CALCULAR ══════════════
    if (acao === 'calcular') {
      if (!isAdmin) return resposta(200, publico)
      return resposta(200, { ...publico, custoProduto: r.custoProduto, custoAcabamento: r.custoAcabamento })
    }

    // ══════════════ SALVAR ══════════════
    if (acao === 'salvar') {
      const cliente = String(body.cliente ?? '').trim() || 'Balcão'
      const telefone = String(body.telefone ?? '').trim() || null
      const ambiente = String(body.ambiente ?? '').trim() || null
      const instalacaoNum = typeof r.instalacao === 'number' ? r.instalacao : null
      // desconto/acréscimo dado na mão: o que o cliente REALMENTE pagou
      const cobradoBruto = Number(body.valor_cobrado)
      const valorCobrado = Number.isFinite(cobradoBruto) && cobradoBruto > 0 ? Math.round(cobradoBruto * 100) / 100 : null
      const FORMAS = new Set(['a_vista', 'cartao_4x', 'outro'])
      const formaPagamento = FORMAS.has(String(body.forma_pagamento)) ? String(body.forma_pagamento) : null
      // agrupa itens do mesmo pedido (metadados só — dinheiro continua por item)
      const pedidoId = typeof body.pedido_id === 'string' && body.pedido_id.trim() ? body.pedido_id.trim() : null
      const receita = r.total4x + (instalacaoNum ?? 0)
      const custoTotal = r.custoProduto + r.custoAcabamento
      const margem = receita > 0 ? ((receita - custoTotal) / receita) * 100 : null
      const obs = [
        'Criado no Simulador de balcão.',
        r.instalacao === 'sob_consulta' ? 'Instalação sob consulta.' : null,
        r.emPromocao ? `Tecido em promoção (−${r.descontoPct ?? '?'}%).` : null,
        ...r.observacoes,
      ].filter(Boolean).join(' ')

      const { data: novo, error: insertError } = await db.from('orcamentos').insert({
        responsavel: perfil?.full_name || perfil?.email || 'Balcão',
        cliente,
        telefone,
        ambiente,
        modelo: entrada.modelo,
        tecido: entrada.tecido ?? entrada.artigo ?? null,
        largura: entrada.largura || null,
        altura: entrada.altura || null,
        quantidade: entrada.quantidade,
        cor_ferragem_motor: entrada.corFerragem === 'PRETA' ? 'Preta' : 'Branca',
        acabamentos: ROTULO_ACABAMENTO[entrada.acabamento] ?? 'Sem',
        valor_venda: r.total4x,
        instalacao: instalacaoNum,
        custo_tecido: custoTotal,
        custo_acabamento: r.custoAcabamento,
        valor_parceiro: r.valorParceiro ?? 0,
        valor_cobrado: valorCobrado,
        forma_pagamento: formaPagamento,
        forma_pagamento_real: typeof body.forma_pagamento_real === 'string' && body.forma_pagamento_real.trim()
          ? String(body.forma_pagamento_real).trim().slice(0, 120)
          : null,
        custos_detalhe: r.detalhe ?? null,
        pedido_id: pedidoId,
        margem,
        // 'FEITO' NÃO existe no check da tabela — venda vira 'fechado', consulta vira 'CALCULADO'
        status: body.fechado === true ? 'fechado' : 'CALCULADO',
        fechado: body.fechado === true,
        fonte: body.fechado === true ? 'fechamento' : 'simulador',
        user_id: caller.id,
        observacoes: obs,
      }).select('id').single()

      if (insertError) return resposta(500, { error: `Falha ao salvar: ${insertError.message}` })
      return resposta(200, { ...publico, id: novo.id, cliente })
    }

    return resposta(400, { error: 'Ação inválida' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return resposta(500, { error: message })
  }
})
