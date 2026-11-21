import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAllProfiles } from '@/hooks/useProfile'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
interface Props {
  toast: (type: 'success' | 'error', message: string) => void
}

// Uma coluna por hub — Admin não tem coluna (admins têm acesso total automático)
const MODULOS = [
  { field: 'pode_orcamento', label: 'Orçamento' },
  { field: 'pode_estoque',   label: 'Estoque' },
  { field: 'pode_agente_ia', label: 'Agente IA' },
  { field: 'pode_conversas', label: 'Conversas' },
  { field: 'pode_precos',    label: 'Tabela de Preços' },
  { field: 'pode_fechamento', label: 'Semanário' },
] as const
type CampoPermissao = typeof MODULOS[number]['field']

export default function PermissoesView({ toast }: Props) {
  const { data: profiles = [], isLoading } = useAllProfiles()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState<string | null>(null)

  async function togglePermission(id: string, field: CampoPermissao, current: boolean | null | undefined) {
    setSaving(`${id}-${field}`)
    const { error } = await supabase
      .from('profiles')
      .update({ [field]: !current })
      .eq('id', id)
    setSaving(null)
    if (error) {
      toast('error', 'Erro ao salvar permissão')
    } else {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const approved = profiles.filter(p => p.approved === true)
  const pending  = profiles.filter(p => p.approved === null)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Permissões de Acesso</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Controle quais módulos cada usuário pode acessar. Admins têm acesso total automaticamente.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Usuário</th>
              {MODULOS.map(m => (
                <th key={m.field} className="text-center px-4 py-3 font-semibold text-muted-foreground">{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {approved.map((p, i) => {
              const isAdminUser = p.is_admin
              return (
                <tr
                  key={p.id}
                  className={cn(
                    'border-b border-border/50 last:border-0 transition-colors',
                    i % 2 === 0 ? 'bg-card' : 'bg-muted/20',
                    'hover:bg-muted/40',
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-foreground leading-tight">
                        {p.full_name || '—'}
                        {isAdminUser && (
                          <span className="ml-1.5 text-[10px] font-semibold text-primary bg-primary/10 rounded px-1 py-0.5">admin</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.email}</span>
                    </div>
                  </td>
                  {MODULOS.map(m => {
                    const key = `${p.id}-${m.field}`
                    return (
                      <td key={m.field} className="px-4 py-3 text-center">
                        {isAdminUser ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={p[m.field] === true}
                            disabled={saving === key}
                            onChange={() => togglePermission(p.id, m.field, p[m.field])}
                            className={cn(
                              'h-4 w-4 rounded border-border accent-primary cursor-pointer',
                              saving === key && 'opacity-50 cursor-not-allowed',
                            )}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {approved.length === 0 && (
              <tr>
                <td colSpan={MODULOS.length + 1} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  Nenhum usuário aprovado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pending.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {pending.length} usuário{pending.length !== 1 ? 's' : ''} com aprovação pendente — gerencie em <strong>Usuários</strong>.
        </p>
      )}
    </div>
  )
}
