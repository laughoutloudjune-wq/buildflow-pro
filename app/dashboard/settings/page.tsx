'use client'

import Link from 'next/link'
import { useState, useEffect, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { 
    getOrganizationSettings, 
    updateOrganizationSettings, 
    getUsers, 
    updateUserRole 
} from '@/actions/settings-actions'
import { Building, Banknote, Users, Hammer } from 'lucide-react'

type Settings = Awaited<ReturnType<typeof getOrganizationSettings>>
type User = Awaited<ReturnType<typeof getUsers>>[0]

// Tab Button Component
const TabButton = ({ label, icon, isActive, onClick }: any) => (
    <button
        onClick={onClick}
        className={`flex-1 py-3 text-sm font-bold transition flex items-center justify-center gap-2 ${isActive ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-slate-500 hover:bg-slate-50'}`}
    >
        {icon}
        {label}
    </button>
)

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState('company')
    const [settings, setSettings] = useState<Settings | null>(null)
    const [users, setUsers] = useState<User[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    useEffect(() => {
        async function loadData() {
            setIsLoading(true)
            const [settingsData, usersData] = await Promise.all([
                getOrganizationSettings(),
                getUsers()
            ])
            setSettings(settingsData)
            setUsers(usersData)
            setIsLoading(false)
        }
        loadData()
    }, [])

    const handleSettingsUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        
        startTransition(async () => {
            setError(null)
            setSuccess(null)
            try {
                await updateOrganizationSettings(formData)
                setSuccess("Settings updated successfully!")
            } catch (e: any) {
                setError(e.message)
            }
        })
    }

    const handleRoleChange = (userId: string, newRole: 'admin' | 'pm' | 'foreman') => {
        startTransition(async () => {
             try {
                await updateUserRole(userId, newRole)
                setUsers(users.map(u => u.id === userId ? {...u, role: newRole } : u))
                setSuccess(`User role updated for ${userId}`)
            } catch (e: any) {
                setError(e.message)
            }
        })
    }


    if (isLoading) {
        return <div className="p-4">Loading settings...</div>
    }

    return (
        <div className="container mx-auto p-4 space-y-6">
            <h1 className="text-2xl font-bold">Settings</h1>
            
            <div className="flex border-b">
                <TabButton label="Company Info" icon={<Building size={16}/>} isActive={activeTab === 'company'} onClick={() => setActiveTab('company')} />
                <TabButton label="Financial Defaults" icon={<Banknote size={16}/>} isActive={activeTab === 'financial'} onClick={() => setActiveTab('financial')} />
                <TabButton label="User Management" icon={<Users size={16}/>} isActive={activeTab === 'users'} onClick={() => setActiveTab('users')} />
                <Link href="/dashboard/settings/contractor-types" className="flex-1 py-3 text-sm font-bold transition flex items-center justify-center gap-2 text-slate-500 hover:bg-slate-50">
                    <Hammer size={16}/>
                    Contractor Types
                </Link>
            </div>

            {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">{error}</div>}
            {success && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative" role="alert">{success}</div>}

            <form onSubmit={handleSettingsUpdate}>
                {activeTab === 'company' && (
                    <Card className="p-6">
                        <h2 className="text-xl font-semibold mb-4">Company Information</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium">Company Name</label>
                                <input type="text" name="company_name" defaultValue={settings?.company_name || ''} className="mt-1 block w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Tax ID</label>
                                <input type="text" name="tax_id" defaultValue={settings?.tax_id || ''} className="mt-1 block w-full p-2 border rounded-md" />
                            </div>
                             <div>
                                <label className="block text-sm font-medium">Phone</label>
                                <input type="text" name="phone" defaultValue={settings?.phone || ''} className="mt-1 block w-full p-2 border rounded-md" />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium">Address</label>
                                <textarea name="address" defaultValue={settings?.address || ''} rows={3} className="mt-1 block w-full p-2 border rounded-md"></textarea>
                            </div>
                             <div>
                                <label className="block text-sm font-medium">Company Logo</label>
                                {settings?.logo_url && <img src={settings.logo_url} alt="company logo" className="h-16 w-auto my-2"/>}
                                <input type="file" name="logo_url" accept="image/*" className="mt-1 block w-full text-sm" />
                            </div>
                        </div>
                         <div className="mt-6 flex justify-end">
                            <button type="submit" disabled={isPending} className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                                {isPending ? 'Saving...' : 'Save Company Info'}
                            </button>
                        </div>
                    </Card>
                )}

                {activeTab === 'financial' && (
                    <Card className="p-6">
                        <h2 className="text-xl font-semibold mb-4">Financial Defaults</h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                             <div>
                                <label className="block text-sm font-medium">Default VAT (%)</label>
                                <input type="number" step="0.01" name="default_vat" defaultValue={settings?.default_vat || 0} className="mt-1 block w-full p-2 border rounded-md" />
                            </div>
                             <div>
                                <label className="block text-sm font-medium">Default WHT (%)</label>
                                <input type="number" step="0.01" name="default_wht" defaultValue={settings?.default_wht || 0} className="mt-1 block w-full p-2 border rounded-md" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium">Default Retention (%)</label>
                                <input type="number" step="0.01" name="default_retention" defaultValue={settings?.default_retention || 0} className="mt-1 block w-full p-2 border rounded-md" />
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button type="submit" disabled={isPending} className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                                {isPending ? 'Saving...' : 'Save Financial Settings'}
                            </button>
                        </div>
                    </Card>
                )}
            </form>

            {activeTab === 'users' && (
                <Card className="p-6">
                    <h2 className="text-xl font-semibold mb-4">User Management</h2>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {users.map(user => (
                                    <tr key={user.id}>
                                        <td className="px-6 py-4 whitespace-nowrap">{user.full_name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">{user.email}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <select 
                                                value={user.role || 'foreman'} 
                                                onChange={(e) => handleRoleChange(user.id, e.target.value as any)}
                                                disabled={isPending}
                                                className="p-1 border rounded-md"
                                            >
                                                <option value="admin">Admin</option>
                                                <option value="pm">Project Manager</option>
                                                <option value="foreman">Foreman</option>
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    )
}
