import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, Flag, User, X } from 'lucide-react'
import SectionHeader from '@/components/shared/SectionHeader'
import SeloStatus from '@/components/agente/SeloStatus'
import SeloTemperatura from '@/components/agente/SeloTemperatura'
import { normalizarTelefone, useCrmLeads, useOrcamentosIA, type CrmLead, type OrcamentoIA } from '@/hooks/useAgenteIA'
import { nomeDaConversa, telefoneLegivel, type Conversa } from '@/lib/conversas/lista'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { BotaoIcone } from './pecas'

/**
 * O que o dash já sabe de quem está do outro lado: temperatura, estágio, orçamentos da IA e o
 * desfecho. Tudo vem de `crm_sombrear_ia` e `orcamentos_sombrear_ia`, pelos mesmos hooks da aba
 * Agente IA (a consulta é a mesma, então abrir aqui não lê o banco de novo).
 */

const DESFECHO: Record<string, { rotulo: string; cor: string }> = {
  fechou: { rotulo: 'Fechou', cor: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  perdido: { rotulo: 'Não fechou', cor: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  sumiu: { rotulo: 'Sumiu', cor: 'border-border bg-muted/60 text-muted-foreground' },
}

/** o total de venda de um orçamento da IA: base + acabamento + colocação */
const totalDoOrcamento = (o: OrcamentoIA) => (o.valor_venda_total_base ?? 0) + (o.valor_venda_acabamento_total ?? 0) + (o.valor_colocacao ?? 0)

function leadDaConversa(c: Conversa, leads: CrmLead[]): CrmLead | null {
  if (c.lead_id) { const l = leads.find(x => x.id === c.lead_id); if (l) return l }
  const porConversa = leads.find(x => x.id_conversa_chatwoot === String(c.conversa_id))
  if (porConversa) return porConversa
  const tel = normalizarTelefone(c.telefone)
  return tel ? leads.find(x => normalizarTelefone(x.whatsapp ?? x.identificador_usuario) === tel) ?? null : null
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  if (children == null || children === '' || children === false) return null
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{children}</dd>
    </div>
  )
}

export default function DetalheLead({ conversa, fechar }: { conversa: Conversa; fechar: () => void }) {
  const navegar = useNavigate()
  const leads = useCrmLeads()
  const orcamentos = useOrcamentosIA()
  const lead = useMemo(() => leadDaConversa(conversa, leads.data ?? []), [conversa, leads.data])
  const doLead = useMemo(() => {
    if (!lead) return []
    const tel = normalizarTelefone(lead.whatsapp ?? lead.identificador_usuario)
    return (orcamentos.data ?? []).filter(o => o.cliente_id === lead.id || (!!tel && normalizarTelefone(o.identificador_whats) === tel))
  }, [lead, orcamentos.data])
  const desfecho = lead?.desfecho ? DESFECHO[lead.desfecho.toLowerCase().trim()] ?? { rotulo: lead.desfecho, cor: DESFECHO.sumiu.cor } : null

  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label="Detalhes do lead">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{lead?.nome?.trim() || nomeDaConversa(conversa)}</p>
          <p className="truncate text-xs tabular-nums text-muted-foreground">{telefoneLegivel(conversa.telefone)}</p>
        </div>
        <BotaoIcone rotulo="Fechar detalhes" onClick={fechar}><X className="h-4 w-4" aria-hidden="true" /></BotaoIcone>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {leads.isLoading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Carregando o lead">
            {[70, 90, 55].map(w => <div key={w} style={{ width: `${w}%` }} className="h-4 rounded skeleton-shimmer" />)}
          </div>
        ) : !lead ? (
          <p className="text-sm text-muted-foreground">
            {leads.isError
              ? 'Não deu para ler os dados do lead agora.'
              : 'Esta conversa ainda não tem lead no CRM da Amanda. Ele aparece aqui quando a IA registrar o atendimento.'}
          </p>
        ) : (
          <>
            <section className="space-y-3">
              <SectionHeader step="1" icon={<User className="h-3.5 w-3.5" />} title="Lead" />
              <div className="flex flex-wrap items-center gap-1.5">
                <SeloTemperatura temperatura={lead.lead_temperatura} score={lead.lead_score} />
                <SeloStatus status={lead.status_lead} motivo={lead.status_motivo} />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                <Campo rotulo="Interesse">{lead.modelo_interesse}</Campo>
                <Campo rotulo="Ambiente">{lead.ambiente}</Campo>
                <Campo rotulo="Medidas">{lead.medidas_coletadas}</Campo>
                <Campo rotulo="Cidade">{lead.cidade}</Campo>
                <Campo rotulo="Último valor">{lead.ultimo_valor_cotado}</Campo>
                <Campo rotulo="Origem">{lead.origem}</Campo>
              </dl>
              {lead.lead_motivo && <p className="text-xs text-muted-foreground">{lead.lead_motivo}</p>}
            </section>

            <section className="space-y-3">
              <SectionHeader step="2" icon={<FileText className="h-3.5 w-3.5" />} title="Orçamentos" badge={doLead.length ? String(doLead.length) : undefined} />
              {orcamentos.isLoading ? (
                <div className="h-4 w-3/5 rounded skeleton-shimmer" aria-busy="true" aria-label="Carregando orçamentos" />
              ) : !doLead.length ? (
                <p className="text-sm text-muted-foreground">A IA ainda não gerou orçamento para este lead.</p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border">
                  {doLead.slice(0, 6).map(o => (
                    <li key={o.id} className="flex items-baseline gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{[o.modelo, o.tecido].filter(Boolean).join(' · ') || 'Orçamento'}</span>
                        <span className="block truncate text-[11px] tabular-nums text-muted-foreground">
                          {formatDate(o.created_at)}{o.largura && o.altura ? ` · ${o.largura} × ${o.altura} m` : ''}{o.ambiente ? ` · ${o.ambiente}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums">{formatCurrency(totalDoOrcamento(o))}</span>
                    </li>
                  ))}
                </ul>
              )}
              {doLead.length > 6 && <p className="text-[11px] text-muted-foreground">Mostrando os 6 mais recentes de {doLead.length}.</p>}
            </section>

            <section className="space-y-3">
              <SectionHeader step="3" icon={<Flag className="h-3.5 w-3.5" />} title="Desfecho" />
              {!desfecho ? (
                <p className="text-sm text-muted-foreground">Ainda sem desfecho: a leitura acontece depois do atendimento da equipe.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', desfecho.cor)}>{desfecho.rotulo}</span>
                    {lead.desfecho_valor != null && lead.desfecho_valor > 0 && <span className="text-sm font-bold tabular-nums">{formatCurrency(lead.desfecho_valor)}</span>}
                    {lead.desfecho_em && <span className="text-[11px] tabular-nums text-muted-foreground">{formatDate(lead.desfecho_em)}</span>}
                  </div>
                  {lead.desfecho_motivo && <p className="text-xs text-muted-foreground">{lead.desfecho_motivo}</p>}
                  {lead.atendente && <p className="text-xs text-muted-foreground">Atendente: {lead.atendente}</p>}
                </div>
              )}
            </section>

            <button
              type="button" onClick={() => navegar('/agente-ia')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Ver o lead e os orçamentos no Agente IA <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
