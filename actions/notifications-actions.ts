'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/actions/_shared/user-role'

export type NotificationType = 'new_request' | 'billing_approved' | 'billing_rejected'

export type NotificationItem = {
  id: string
  type: NotificationType
  read_at: string | null
  created_at: string
  billing: {
    id: string
    doc_no: string | number | null
    type: string | null
    contractor_name: string | null
    project_name: string | null
  } | null
}

type NotificationRow = {
  id: string
  type: NotificationType
  read_at: string | null
  created_at: string
  billings:
    | {
        id: string
        doc_no: string | number | null
        type: string | null
        contractors: { name: string | null } | Array<{ name: string | null }> | null
        projects: { name: string | null } | Array<{ name: string | null }> | null
      }
    | Array<{
        id: string
        doc_no: string | number | null
        type: string | null
        contractors: { name: string | null } | Array<{ name: string | null }> | null
        projects: { name: string | null } | Array<{ name: string | null }> | null
      }>
    | null
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

export async function getMyNotifications(limit = 30): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) return { items: [], unreadCount: 0 }

  const [listRes, countRes] = await Promise.all([
    supabase
      .from('notifications')
      .select(`
        id, type, read_at, created_at,
        billings ( id, doc_no, type, contractors (name), projects (name) )
      `)
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .is('read_at', null),
  ])

  if (listRes.error) throw new Error(listRes.error.message)
  if (countRes.error) throw new Error(countRes.error.message)

  const items: NotificationItem[] = ((listRes.data || []) as NotificationRow[]).map((row) => {
    const billing = asSingle(row.billings)
    return {
      id: row.id,
      type: row.type,
      read_at: row.read_at,
      created_at: row.created_at,
      billing: billing
        ? {
            id: billing.id,
            doc_no: billing.doc_no,
            type: billing.type,
            contractor_name: asSingle(billing.contractors)?.name ?? null,
            project_name: asSingle(billing.projects)?.name ?? null,
          }
        : null,
    }
  })

  return { items, unreadCount: countRes.count || 0 }
}

export async function markNotificationRead(id: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('recipient_id', user.id)

  if (error) throw new Error(error.message)
}

export async function markAllNotificationsRead() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', user.id)
    .is('read_at', null)

  if (error) throw new Error(error.message)
}
