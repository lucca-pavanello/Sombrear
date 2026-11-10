-- 0038: saldo do material e lotes passam a andar juntos
--
-- O que estava errado (conferido no banco em 10/11/2026: 73 materiais com saldo,
-- nenhum lote e nenhuma movimentação):
--
--   a) A venda só era aceita se houvesse saldo em LOTES
--      (estoque_lote_itens.quantidade_restante). Saldo que entrou por cadastro,
--      ajuste ou contagem não tem lote, então a venda era recusada com
--      "Estoque insuficiente" mesmo com saldo na tela.
--   b) Lote novo nascia com quantidade_restante = 0 (default da 0005; nada
--      preenchia no insert), ou seja, nem a entrada por lote liberava a venda.
--   c) Ajuste, perda e saída manual mudavam o saldo e deixavam os lotes como
--      estavam, inflando "valor parado" nas análises.
--
-- O que muda:
--   1. Lote novo nasce cheio (quantidade_restante = quantidade).
--   2. estoque_consumir_peps valida contra o SALDO do material (o número da
--      tela). Consome os lotes do mais antigo para o mais novo; a parte do
--      saldo que não tem lote sai ao custo do cadastro do material.
--   3. Depois de ajuste, perda ou saída, os lotes são aparados (PEPS) para nunca
--      somarem mais que o saldo.
--
-- Rodar um bloco por vez no SQL Editor (o WAF do Supabase barra vários DDL juntos).
-- Não altera nenhuma linha existente.

-- ---------------------------------------------------------------
-- 1. Lote novo nasce cheio
-- ---------------------------------------------------------------
create or replace function _lote_item_restante_inicial()
returns trigger language plpgsql as $$
begin
  new.quantidade_restante := new.quantidade;
  return new;
end $$;

drop trigger if exists trg_lote_item_restante_inicial on estoque_lote_itens;
create trigger trg_lote_item_restante_inicial
  before insert on estoque_lote_itens
  for each row execute function _lote_item_restante_inicial();

-- ---------------------------------------------------------------
-- 2. PEPS valida contra o saldo do material
--    Mesma assinatura e mesmo formato de retorno da 0005. A mensagem
--    "Estoque insuficiente" é lida pelo dash (RegistroVendasView) — não mudar.
-- ---------------------------------------------------------------
create or replace function estoque_consumir_peps(
  p_produto_id uuid,
  p_quantidade numeric(12,2)
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_saldo               numeric(12,3);
  v_custo_cadastro      numeric(12,4);
  v_restante_a_consumir numeric(12,3);
  v_lotes               jsonb := '[]'::jsonb;
  v_custo_total         numeric(12,2) := 0;
  l                     record;
  v_consumir            numeric(12,3);
begin
  select coalesce(quantidade_atual, 0), coalesce(custo_unitario, 0)
    into v_saldo, v_custo_cadastro
  from estoque_produtos
  where id = p_produto_id
  for update;

  if not found then
    raise exception 'Material % não encontrado', p_produto_id;
  end if;

  if v_saldo < p_quantidade then
    raise exception
      'Estoque insuficiente para produto %: disponivel %, solicitado %',
      p_produto_id, v_saldo, p_quantidade;
  end if;

  v_restante_a_consumir := p_quantidade;

  -- PEPS: do lote mais antigo para o mais novo
  for l in
    select li.id, li.quantidade_restante, li.custo_unitario
    from estoque_lote_itens li
    join estoque_lotes lo on lo.id = li.lote_id
    where li.produto_id = p_produto_id and li.quantidade_restante > 0
    order by lo.data_entrada asc, li.created_at asc
  loop
    exit when v_restante_a_consumir <= 0;

    v_consumir := least(v_restante_a_consumir, l.quantidade_restante);

    update estoque_lote_itens
      set quantidade_restante = quantidade_restante - v_consumir
      where id = l.id;

    v_custo_total := v_custo_total + v_consumir * coalesce(l.custo_unitario, 0);

    v_lotes := v_lotes || jsonb_build_object(
      'lote_item_id',   l.id,
      'quantidade',     v_consumir,
      'custo_unitario', l.custo_unitario
    );

    v_restante_a_consumir := v_restante_a_consumir - v_consumir;
  end loop;

  -- Saldo sem lote (cadastro inicial, ajuste, contagem): sai ao custo do cadastro
  if v_restante_a_consumir > 0 then
    v_custo_total := v_custo_total + v_restante_a_consumir * v_custo_cadastro;

    v_lotes := v_lotes || jsonb_build_object(
      'lote_item_id',   null,
      'quantidade',     v_restante_a_consumir,
      'custo_unitario', v_custo_cadastro
    );
  end if;

  return jsonb_build_object(
    'custo_total',           v_custo_total,
    'custo_medio_consumido', case when p_quantidade > 0
                               then round(v_custo_total / p_quantidade, 2)
                               else 0 end,
    'lotes', v_lotes
  );
end $$;

-- ---------------------------------------------------------------
-- 3. Lotes nunca somam mais que o saldo
--    Nome com "zz" de propósito: triggers AFTER do mesmo evento rodam em ordem
--    alfabética, e este precisa rodar DEPOIS do trg_mov_estoque, que é quem
--    atualiza estoque_produtos.quantidade_atual.
-- ---------------------------------------------------------------
create or replace function _mov_reconciliar_lotes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_saldo   numeric(12,3);
  v_excesso numeric(12,3);
  l         record;
  v_tirar   numeric(12,3);
begin
  select greatest(coalesce(quantidade_atual, 0), 0) into v_saldo
  from estoque_produtos
  where id = new.produto_id;

  select coalesce(sum(quantidade_restante), 0) - coalesce(v_saldo, 0) into v_excesso
  from estoque_lote_itens
  where produto_id = new.produto_id and quantidade_restante > 0;

  if v_excesso <= 0 then
    return new;
  end if;

  for l in
    select li.id, li.quantidade_restante
    from estoque_lote_itens li
    join estoque_lotes lo on lo.id = li.lote_id
    where li.produto_id = new.produto_id and li.quantidade_restante > 0
    order by lo.data_entrada asc, li.created_at asc
  loop
    exit when v_excesso <= 0;

    v_tirar := least(v_excesso, l.quantidade_restante);

    update estoque_lote_itens
      set quantidade_restante = quantidade_restante - v_tirar
      where id = l.id;

    v_excesso := v_excesso - v_tirar;
  end loop;

  return new;
end $$;

drop trigger if exists trg_mov_zz_reconciliar_lotes on estoque_movimentacoes;
create trigger trg_mov_zz_reconciliar_lotes
  after insert on estoque_movimentacoes
  for each row
  when (new.tipo::text in ('ajuste', 'perda', 'saida'))
  execute function _mov_reconciliar_lotes();

-- ---------------------------------------------------------------
-- Conferir depois de rodar
-- ---------------------------------------------------------------
-- 1. Nenhum material com lotes acima do saldo (deve voltar vazio):
--    select p.nome, p.quantidade_atual, sum(li.quantidade_restante) as em_lotes
--    from estoque_produtos p join estoque_lote_itens li on li.produto_id = p.id
--    group by p.id having sum(li.quantidade_restante) > p.quantidade_atual;
-- 2. No dash: Estoque > Vendas, vender 1 unidade de um material com saldo.
--    A venda entra, o saldo desce 1 e aparece no histórico.
--
-- Desfazer: reaplicar a função estoque_consumir_peps da 0005 e
--    drop trigger trg_mov_zz_reconciliar_lotes on estoque_movimentacoes;
--    drop trigger trg_lote_item_restante_inicial on estoque_lote_itens;
