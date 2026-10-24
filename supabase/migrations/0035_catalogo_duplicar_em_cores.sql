-- SOMBREAR — 0035 — duplicar um material em outras cores
--
-- Pedido da Stella (24/10): "acrescentar tudo igual, também nas cores branco,
-- cinza e marfim". O tecido é o mesmo, o preço em cada loja é o mesmo; muda
-- a cor. Feito à mão uma vez (29 + 10 preços), agora vira um botão na tela
-- de editar material.
--
-- Cada cópia é um registro da loja DE HOJE, na lista manual daquela loja — o
-- mesmo lugar onde a correção de custo grava (lib/catalogo/gravarCusto.ts).
-- Item de pedido nunca é copiado para dentro do pedido: o papel do
-- fornecedor diz bege, e só bege. A coluna "Sem fornecedor" não tem lista
-- manual por dia; a cópia dela vai para o mesmo documento de onde veio o
-- preço (a lista da dona).
--
-- Sem código: código é de cada cor no fornecedor, e repetir o do bege
-- inventaria um identificador que não existe.
--
-- Depende de 0033 (tabelas), 0034 (view ajustada). Rollback no fim.

-- O mesmo apelido de lib/catalogo/manual.ts (apelidoFornecedor): é ele que faz
-- a tela e esta função caírem no MESMO documento manual do dia, em vez de dois.
create or replace function catalogo_apelido_fornecedor(p_nome text)
returns text
language sql
immutable
as $$
  select left(
    regexp_replace(
      regexp_replace(
        -- translate ANTES de upper: com collation C, upper() não mexe em "ç".
        upper(translate(p_nome,
                  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                  'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
        '[^A-Z0-9]+', '-', 'g'),
      '^-|-$', '', 'g'),
    40)
$$;

-- p_alvos: as células do material (como em catalogo_editar_material).
-- p_variacoes: [{"descricao": "MICROFIBRA 3.30 BRANCO", "cor": "BRANCO"}, ...]
--   — os nomes vêm prontos da tela, que os mostrou à loja antes de salvar.
-- Devolve quantos preços criou. Cor que já existe naquela loja é pulada.
create or replace function catalogo_duplicar_material(p_alvos jsonb, p_variacoes jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_alvo   jsonb;
  v_var    jsonb;
  v_origem record;
  v_doc    uuid;
  v_nome   text;
  v_achados integer := 0;
  v_total  integer := 0;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Só administrador pode mexer no catálogo de custos.';
  end if;
  if jsonb_array_length(coalesce(p_variacoes, '[]'::jsonb)) = 0 then
    raise exception 'Diga ao menos uma cor.';
  end if;

  for v_alvo in select * from jsonb_array_elements(p_alvos) loop
    select v.*, f.nome as fornecedor_nome,
           (select i.documento_id from catalogo_itens i where i.id = v.item_id) as documento_origem
      into v_origem
      from catalogo_custo_vigente v
      left join estoque_fornecedores f on f.id = v.fornecedor_id
     where v.fornecedor_id is not distinct from nullif(v_alvo->>'fornecedor_id', '')::uuid
       and v.codigo_fornecedor is not distinct from nullif(v_alvo->>'codigo', '')
       and v.descricao = v_alvo->>'descricao'
     limit 1;
    if not found then
      continue;
    end if;
    v_achados := v_achados + 1;

    if v_origem.fornecedor_id is null then
      v_doc := v_origem.documento_origem;
    else
      insert into catalogo_documentos (fornecedor_id, tipo, referencia, data_documento, observacoes)
      values (
        v_origem.fornecedor_id, 'lista_manual',
        'MANUAL-' || catalogo_apelido_fornecedor(v_origem.fornecedor_nome) || '-' || to_char(v_hoje, 'YYYY-MM-DD'),
        v_hoje, 'Custos informados pela loja, sem documento do fornecedor.')
      on conflict (fornecedor_id, referencia) do update set data_documento = excluded.data_documento
      returning id into v_doc;
    end if;

    for v_var in select * from jsonb_array_elements(p_variacoes) loop
      v_nome := btrim(v_var->>'descricao');
      if v_nome is null or v_nome = '' then
        raise exception 'Uma das cores ficou sem nome.';
      end if;
      if exists (select 1 from catalogo_custo_vigente x
                  where x.fornecedor_id is not distinct from v_origem.fornecedor_id
                    and x.descricao = v_nome) then
        continue;
      end if;

      -- Quantidade 1 e líquido = custo: a mesma forma do registro manual
      -- (gravarCusto.ts), que mantém quantidade × custo = subtotal.
      insert into catalogo_itens (
        documento_id, codigo_fornecedor, descricao, categoria, cor, largura_m,
        quantidade_documento, unidade_documento, preco_bruto, desconto_pct, preco_liquido,
        subtotal, unidade_canonica, quantidade_canonica, custo_unitario, observacao)
      values (
        v_doc, null, v_nome, v_origem.categoria, nullif(btrim(v_var->>'cor'), ''), v_origem.largura_m,
        1, upper(v_origem.unidade_canonica), v_origem.custo_unitario, 0, v_origem.custo_unitario,
        round(v_origem.custo_unitario, 2), v_origem.unidade_canonica, 1, v_origem.custo_unitario,
        'Mesma linha de ' || v_origem.descricao || ', em outra cor.');
      v_total := v_total + 1;
    end loop;
  end loop;

  if v_achados = 0 then
    raise exception 'Não achei esse material no catálogo — nada foi criado. Recarregue a tela.';
  end if;
  return v_total;
end;
$$;

grant execute on function catalogo_duplicar_material(jsonb, jsonb) to authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop function if exists catalogo_duplicar_material(jsonb, jsonb);
-- drop function if exists catalogo_apelido_fornecedor(text);
-- (os preços criados são registros manuais comuns: excluir pela tela)
