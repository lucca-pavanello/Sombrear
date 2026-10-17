import { supabase } from "@/lib/supabase"
import type { NomeTool } from "./tools"
import { acharMaterial, descrever, type MaterialCandidato } from "@/lib/catalogo/acharMaterial"
import { gravarCustoManual } from "@/lib/catalogo/gravarCusto"

export interface ResultadoTool {
  sucesso: boolean
  mensagem: string
  dados?: unknown
}

/** Campos do catálogo de custos que o chat precisa, na ordem do SELECT. */
const CAMPOS_CUSTO =
  "item_id, descricao, codigo_fornecedor, fornecedor, fornecedor_id, categoria, cor, largura_m, unidade_canonica, custo_unitario, referencia, data_documento"

interface LinhaCusto extends MaterialCandidato {
  fornecedor_id: string | null
  categoria: string
  referencia: string
  data_documento: string | null
}

/**
 * O que `consultar_custo_material` já mostrou nesta sessão.
 *
 * Serve só para o cartão de confirmação dizer "Microfibra 3.00M Bege, da
 * Corttex: R$ 6,30 → R$ 7,00" em vez de repetir um uuid. O preview é
 * síncrono e não pode ir ao banco; a gravação em si NUNCA usa este cache,
 * relê a linha pelo id na hora de escrever.
 */
const vistosNaSessao = new Map<string, LinhaCusto>()

export async function executarTool(
  nome: NomeTool,
  args: Record<string, unknown>
): Promise<ResultadoTool> {
  try {
    switch (nome) {
      // ━━━ NÍVEL 1 ━━━
      case "consultar_estoque_resumo": {
        const { data, error } = await supabase.rpc("estoque_chat_contexto")
        if (error) throw error
        return { sucesso: true, mensagem: "Resumo obtido", dados: data.resumo }
      }

      case "listar_produtos_classe_a": {
        const limite = (args.limite as number) || 10
        // Os nomes reais das colunas são codigo/quantidade_atual/
        // custo_unitario/classificacao_abc. O apelido `sku` existe só na RPC
        // estoque_chat_contexto, e é por ele que o snapshot chama o produto —
        // então o alias aqui mantém as duas respostas falando a mesma língua.
        const { data, error } = await supabase
          .from("estoque_produtos")
          .select(
            "sku:codigo, nome, estoque_atual:quantidade_atual, custo_medio:custo_unitario, preco_venda"
          )
          .eq("classificacao_abc", "A")
          .eq("ativo", true)
          .limit(limite)
        if (error) throw error
        return { sucesso: true, mensagem: `${data.length} produtos classe A`, dados: data }
      }

      case "listar_produtos_parados": {
        const dias = (args.dias_minimos as number) || 90
        const { data, error } = await supabase
          .from("estoque_vw_lead_time")
          .select("*")
          .gte("dias_em_estoque", dias)
          .order("dias_em_estoque", { ascending: false })
          .limit(20)
        if (error) throw error
        return { sucesso: true, mensagem: `${data.length} produtos parados`, dados: data }
      }

      case "listar_sugestoes_compra": {
        const { data, error } = await supabase
          .from("estoque_vw_sugestao_compra")
          .select("*")
          .neq("urgencia", "ok")
        if (error) throw error
        return { sucesso: true, mensagem: `${data.length} sugestões`, dados: data }
      }

      case "recalcular_curva_abc": {
        const { error } = await supabase.rpc("estoque_recalcular_abc")
        if (error) throw error
        return { sucesso: true, mensagem: "Curva ABC recalculada com sucesso" }
      }

      case "gerar_pedido_compra_csv": {
        let query = supabase.from("estoque_vw_sugestao_compra").select("*").neq("urgencia", "ok")
        if (args.fornecedor_id) {
          query = query.eq("fornecedor_id", args.fornecedor_id as string)
        }
        const { data, error } = await query
        if (error) throw error
        const csv =
          "SKU,Nome,Quantidade,Fornecedor\n" +
          data
            .map(
              (d: Record<string, unknown>) =>
                `${d.sku},"${d.nome}",${d.lec_sugerido},"${d.fornecedor_nome}"`
            )
            .join("\n")
        return { sucesso: true, mensagem: "CSV gerado", dados: { csv, total_itens: data.length } }
      }

      case "consultar_custo_material": {
        const { data, error } = await supabase
          .from("catalogo_custo_vigente")
          .select(CAMPOS_CUSTO)
        if (error) throw error

        const linhas = (data ?? []) as unknown as LinhaCusto[]
        const r = acharMaterial(linhas, {
          termo: String(args.material ?? ""),
          fornecedor: (args.fornecedor as string) ?? null,
          cor: (args.cor as string) ?? null,
          larguraM: (args.largura_m as number) ?? null,
        })

        if (r.tipo === "nenhum") {
          return { sucesso: false, mensagem: r.mensagem }
        }
        if (r.tipo === "ambiguo") {
          // Devolve a lista nomeada em vez de eleger um. Escolher sozinho
          // entre as três microfibras do catálogo (R$ 6,30 e R$ 13,90, em
          // dois fornecedores) erraria dois terços das vezes, e o erro só
          // apareceria semanas depois num orçamento.
          for (const c of r.candidatos) vistosNaSessao.set(c.item_id, c as LinhaCusto)
          return {
            sucesso: false,
            mensagem: r.mensagem,
            dados: {
              precisa_escolher: true,
              candidatos: r.candidatos.map((c) => ({
                material_id: c.item_id,
                descricao: c.descricao,
                fornecedor: c.fornecedor,
                codigo_fornecedor: c.codigo_fornecedor,
                cor: c.cor,
                largura_m: c.largura_m,
                custo_unitario: c.custo_unitario,
                unidade: c.unidade_canonica,
              })),
            },
          }
        }

        const m = r.material as LinhaCusto
        vistosNaSessao.set(m.item_id, m)
        return {
          sucesso: true,
          mensagem: descrever(m),
          dados: {
            material_id: m.item_id,
            descricao: m.descricao,
            fornecedor: m.fornecedor,
            codigo_fornecedor: m.codigo_fornecedor,
            categoria: m.categoria,
            cor: m.cor,
            largura_m: m.largura_m,
            custo_unitario: m.custo_unitario,
            unidade: m.unidade_canonica,
            veio_de: m.referencia,
            data_documento: m.data_documento,
          },
        }
      }

      // ━━━ NÍVEL 2 — CADASTROS ━━━
      case "atualizar_custo_material": {
        const materialId = String(args.material_id ?? "")
        const custoNovo = Number(args.custo_novo)

        // Relê a linha pelo id: o cache da sessão serve ao cartão de
        // confirmação, nunca à gravação.
        const { data, error } = await supabase
          .from("catalogo_custo_vigente")
          .select(CAMPOS_CUSTO)
          .eq("item_id", materialId)
        if (error) throw error

        const atual = (data ?? [])[0] as unknown as LinhaCusto | undefined
        if (!atual) {
          return {
            sucesso: false,
            mensagem:
              "Esse material não está mais no custo vigente — provavelmente alguém mexeu nele agora. " +
              "Consulte de novo antes de alterar.",
          }
        }
        if (!atual.fornecedor_id) {
          return {
            sucesso: false,
            mensagem: `"${atual.descricao}" está sem fornecedor no catálogo, e o custo é por fornecedor. Corrija pela tela de Custos.`,
          }
        }

        const custoAntes = atual.custo_unitario
        await gravarCustoManual({
          fornecedorId: atual.fornecedor_id,
          fornecedorNome: atual.fornecedor ?? "",
          codigoFornecedor: atual.codigo_fornecedor,
          descricao: atual.descricao,
          categoria: atual.categoria,
          cor: atual.cor,
          larguraM: atual.largura_m,
          custoUnitario: custoNovo,
          unidadeCanonica: atual.unidade_canonica as "m" | "m2" | "un" | "kg",
          motivo: args.motivo
            ? `Pelo assistente de estoque: ${String(args.motivo)}`
            : "Alterado pelo assistente de estoque.",
        })

        // A prova é o estado depois, não a resposta da gravação: relê o
        // custo vigente e confere que foi ele mesmo que mudou.
        const { data: depois } = await supabase
          .from("catalogo_custo_vigente")
          .select(CAMPOS_CUSTO)
          .eq("fornecedor_id", atual.fornecedor_id)
          .eq("descricao", atual.descricao)
        const confirmado = (depois ?? [])[0] as unknown as LinhaCusto | undefined

        if (!confirmado || Math.abs(confirmado.custo_unitario - custoNovo) > 0.00005) {
          return {
            sucesso: false,
            mensagem:
              `Gravei, mas ao reler o catálogo o custo vigente de ${atual.descricao} ` +
              `não ficou ${custoNovo}. NÃO diga que deu certo — peça para conferir na aba Custos.`,
            dados: { custo_relido: confirmado?.custo_unitario ?? null },
          }
        }

        vistosNaSessao.set(confirmado.item_id, confirmado)
        return {
          sucesso: true,
          mensagem:
            `${atual.descricao} (${atual.fornecedor}): ${custoAntes} → ${custoNovo} ` +
            `por ${atual.unidade_canonica}. Confirmado no catálogo.`,
          dados: {
            descricao: atual.descricao,
            fornecedor: atual.fornecedor,
            custo_antes: custoAntes,
            custo_depois: confirmado.custo_unitario,
            unidade: atual.unidade_canonica,
          },
        }
      }

      case "cadastrar_produto": {
        // `categoria_id` é NOT NULL com FK, e a unidade tem CHECK de quatro
        // valores minúsculos. Resolver aqui, e recusar com a lista do que
        // vale, evita jogar no banco um insert que só voltaria como erro
        // cru de constraint.
        const nomeCategoria = String(args.categoria ?? "").trim()
        const { data: cats, error: eCat } = await supabase
          .from("estoque_categorias")
          .select("id, nome, tipo")
        if (eCat) throw eCat

        const achatar = (s: string) =>
          s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
        const categoria = (cats ?? []).find(
          (c: { nome: string }) => achatar(c.nome) === achatar(nomeCategoria)
        ) as { id: string; nome: string } | undefined

        if (!categoria) {
          return {
            sucesso: false,
            mensagem:
              `"${nomeCategoria}" não é uma categoria cadastrada. Escolha uma destas: ` +
              (cats ?? []).map((c: { nome: string }) => c.nome).join(", ") + ".",
          }
        }

        const unidade = String(args.unidade ?? "").toLowerCase().trim()
        if (!["m", "m2", "un", "kg"].includes(unidade)) {
          return {
            sucesso: false,
            mensagem: `Unidade "${args.unidade}" não existe. Use m, m2, un ou kg.`,
          }
        }

        // `estoque_produtos.fornecedor` é TEXT, não FK — o contexto do chat
        // entrega ids, então converte aqui em vez de gravar um uuid como se
        // fosse nome de fornecedor.
        let fornecedorNome: string | null = null
        if (args.fornecedor_id) {
          const { data: f } = await supabase
            .from("estoque_fornecedores")
            .select("nome")
            .eq("id", args.fornecedor_id as string)
            .maybeSingle()
          fornecedorNome = (f as { nome: string } | null)?.nome ?? null
          if (!fornecedorNome) {
            return {
              sucesso: false,
              mensagem: "Esse fornecedor não existe. Confira a lista do contexto.",
            }
          }
        }

        const { data, error } = await supabase
          .from("estoque_produtos")
          .insert({
            nome: args.nome,
            codigo: (args.codigo as string)?.trim() || null,
            categoria_id: categoria.id,
            unidade,
            custo_unitario: (args.custo_inicial as number) ?? null,
            preco_venda: (args.preco_venda as number) ?? null,
            quantidade_minima: (args.quantidade_minima as number) ?? 0,
            fornecedor: fornecedorNome,
            ativo: true,
          })
          .select("id, nome, codigo, unidade")
          .single()

        if (error) {
          // `codigo` é UNIQUE: dizer isso é mais útil que repassar o 23505.
          if (error.code === "23505") {
            return {
              sucesso: false,
              mensagem: `Já existe um produto com o código "${args.codigo}". Use outro código.`,
            }
          }
          throw error
        }
        const p = data as Record<string, unknown>
        return {
          sucesso: true,
          mensagem: `${p.nome} cadastrado em ${categoria.nome}, medido em ${unidade}.`,
          dados: data,
        }
      }

      case "cadastrar_fornecedor": {
        const { data, error } = await supabase
          .from("estoque_fornecedores")
          .insert({
            nome: args.nome,
            contato: (args.contato as string) || null,
            telefone: (args.telefone as string) || null,
            cnpj: (args.cnpj as string) || null,
            lead_time_medio_dias: (args.lead_time_dias as number) || 7,
            ativo: true,
          })
          .select()
          .single()
        if (error) throw error
        return { sucesso: true, mensagem: `Fornecedor ${(data as Record<string,unknown>).nome} cadastrado!`, dados: data }
      }

      case "cadastrar_localizacao": {
        const { data, error } = await supabase
          .from("estoque_localizacoes")
          .insert({
            codigo: args.codigo,
            setor: args.setor,
            prateleira: (args.prateleira as string) || null,
            posicao: (args.posicao as string) || null,
            nivel_acesso: args.nivel_acesso,
            ativo: true,
          })
          .select()
          .single()
        if (error) throw error
        return { sucesso: true, mensagem: `Localização ${(data as Record<string,unknown>).codigo} cadastrada!`, dados: data }
      }

      case "editar_configuracao": {
        const { data, error } = await supabase
          .from("estoque_config")
          .upsert({ chave: args.chave, valor: args.valor })
          .select()
          .single()
        if (error) throw error
        return { sucesso: true, mensagem: `Configuração ${args.chave} atualizada`, dados: data }
      }

      // ━━━ NÍVEL 3 — OPERAÇÕES CRÍTICAS ━━━
      case "registrar_entrada": {
        const { data, error } = await supabase
          .from("estoque_lotes")
          .insert({
            produto_id: args.produto_id,
            quantidade_inicial: args.quantidade,
            quantidade_atual: args.quantidade,
            custo_unitario: args.custo_unitario,
            fornecedor_id: (args.fornecedor_id as string) || null,
            nota_fiscal: (args.nota_fiscal as string) || null,
          })
          .select()
          .single()
        if (error) throw error
        return { sucesso: true, mensagem: "Entrada registrada com sucesso", dados: data }
      }

      case "registrar_venda": {
        const { data: venda, error: vendaError } = await supabase
          .from("estoque_vendas")
          .insert({
            cliente: (args.cliente as string) || null,
            vendedor: args.vendedor,
            data: new Date().toISOString(),
          })
          .select()
          .single()
        if (vendaError) throw vendaError

        const itens = args.itens as Array<{
          produto_id: string
          quantidade: number
          preco_unitario: number
          desconto?: number
        }>
        const itensInsert = itens.map((i) => ({
          venda_id: (venda as Record<string, unknown>).id,
          produto_id: i.produto_id,
          quantidade: i.quantidade,
          preco_unitario: i.preco_unitario,
          desconto: i.desconto || 0,
          subtotal: i.quantidade * i.preco_unitario - (i.desconto || 0),
        }))
        const { error: itensError } = await supabase
          .from("estoque_venda_itens")
          .insert(itensInsert)
        if (itensError) throw itensError

        return { sucesso: true, mensagem: "Venda registrada", dados: venda }
      }

      case "mover_item_localizacao": {
        const { data, error } = await supabase
          .from("estoque_produtos")
          .update({ localizacao_id: args.localizacao_destino_id })
          .eq("id", args.produto_id as string)
          .select()
          .single()
        if (error) throw error
        return { sucesso: true, mensagem: "Produto movido", dados: data }
      }

      case "inativar_produto": {
        const { data, error } = await supabase
          .from("estoque_produtos")
          .update({ ativo: false })
          .eq("id", args.produto_id as string)
          .select()
          .single()
        if (error) throw error
        return { sucesso: true, mensagem: "Produto inativado", dados: data }
      }

      default: {
        const _exhaustive: never = nome
        return { sucesso: false, mensagem: `Tool ${_exhaustive} não implementada` }
      }
    }
  } catch (error) {
    return {
      sucesso: false,
      mensagem: error instanceof Error ? error.message : "Erro desconhecido",
    }
  }
}

export function gerarPreviewAcao(
  toolName: NomeTool,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case "atualizar_custo_material": {
      const m = vistosNaSessao.get(String(args.material_id ?? ""))
      const novo = Number(args.custo_novo)
      if (!m) {
        // Não conferiu o material antes: diz isso em vez de fingir que sabe
        // qual é. O usuário pode cancelar e pedir a consulta.
        return (
          `Alterar custo de material:\n- Material: (não consultado antes — confira na aba Custos)\n` +
          `- Novo custo: R$ ${novo.toFixed(4)}` +
          `${args.motivo ? `\n- Motivo: ${args.motivo}` : ""}`
        )
      }
      const unid = m.unidade_canonica
      return (
        `Alterar custo de ${m.descricao}` +
        `${m.cor ? ` (${m.cor})` : ""}:\n` +
        `- Fornecedor: ${m.fornecedor ?? "—"}\n` +
        `- Hoje: R$ ${m.custo_unitario.toFixed(4)} por ${unid}, de ${m.referencia}\n` +
        `- Novo: R$ ${novo.toFixed(4)} por ${unid}` +
        `${args.motivo ? `\n- Motivo: ${args.motivo}` : ""}\n\n` +
        `Isto muda o que a loja PAGA. Não altera preço de venda nem orçamento já emitido.`
      )
    }

    case "cadastrar_produto":
      return (
        `Cadastrar produto:\n- Nome: ${args.nome}\n- Categoria: ${args.categoria}\n` +
        `- Medido em: ${String(args.unidade ?? "").toLowerCase()}` +
        `${args.codigo ? `\n- Código: ${args.codigo}` : ""}` +
        `${args.custo_inicial != null ? `\n- Custo: R$ ${Number(args.custo_inicial).toFixed(2)}` : ""}` +
        `${args.preco_venda != null ? `\n- Preço de venda: R$ ${Number(args.preco_venda).toFixed(2)}` : ""}`
      )

    case "cadastrar_fornecedor":
      return `Cadastrar fornecedor:\n- Nome: ${args.nome}${args.cnpj ? `\n- CNPJ: ${args.cnpj}` : ""}${args.lead_time_dias ? `\n- Lead time: ${args.lead_time_dias} dias` : ""}`

    case "cadastrar_localizacao":
      return `Cadastrar localização:\n- Código: ${args.codigo}\n- Setor: ${args.setor}\n- Nível: ${args.nivel_acesso}`

    case "editar_configuracao":
      return `Alterar configuração:\n- Chave: ${args.chave}\n- Novo valor: ${args.valor}`

    case "registrar_entrada": {
      const total =
        (args.quantidade as number) * (args.custo_unitario as number)
      return `Registrar entrada:\n- Produto ID: ${args.produto_id}\n- Quantidade: ${args.quantidade}\n- Custo unit.: R$ ${(args.custo_unitario as number).toFixed(2)}\n- Total: R$ ${total.toFixed(2)}${args.nota_fiscal ? `\n- NF: ${args.nota_fiscal}` : ""}`
    }

    case "registrar_venda": {
      const itens = args.itens as Array<{
        quantidade: number
        preco_unitario: number
        desconto?: number
      }>
      const totalItens = itens.reduce(
        (acc, i) => acc + i.quantidade * i.preco_unitario - (i.desconto || 0),
        0
      )
      return `Registrar venda:\n- Vendedor: ${args.vendedor}\n- Cliente: ${args.cliente || "não informado"}\n- Itens: ${itens.length}\n- Total: R$ ${totalItens.toFixed(2)}`
    }

    case "mover_item_localizacao":
      return `Mover produto:\n- Produto ID: ${args.produto_id}\n- Para localização ID: ${args.localizacao_destino_id}`

    case "inativar_produto":
      return `Inativar produto:\n- Produto ID: ${args.produto_id}\n\nEsta ação oculta o produto do catálogo. Não pode ser desfeita facilmente.`

    default:
      return `Executar ${toolName}:\n${JSON.stringify(args, null, 2)}`
  }
}
