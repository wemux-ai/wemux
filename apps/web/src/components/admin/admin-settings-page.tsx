// [INPUT]: /api/admin/settings/account-system + /api/admin/admins + /api/admin/settings/community-channels
// [OUTPUT]: /admin/settings 总账号体系页（管理员列表 / 系统开关 / 社区渠道，仅 owner）
// [POS]: admin 总账号体系 UI；权限以 server 为准
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, ImagePlus, MessageCircle, RefreshCw, Shield, Settings2, Upload } from 'lucide-react'
import type { AdminUserRecord, CommunityChannelsConfig } from '@/lib/api/types'
import { api } from '@/lib/api'
import { clearCommunityChannelsCache } from '@/lib/community-channels'
import { useTranslation } from '@/lib/i18n/react'
import { Badge } from '@/components/ui-admin/badge'
import { Button } from '@/components/ui-admin/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui-admin/card'
import { Checkbox } from '@/components/ui-admin/checkbox'
import { Input } from '@/components/ui-admin/input'
import { Label } from '@/components/ui-admin/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui-admin/table'
import { formatDate } from '@/lib/utils'
import { PageContainer, PageHeader, EmptyState } from './page-container'

const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  admin: 'secondary',
}

export function AdminSettingsPage() {
  const { t } = useTranslation()
  const [admins, setAdmins] = useState<AdminUserRecord[]>([])
  const [openRegistration, setOpenRegistration] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [accountResponse, channelsResponse] = await Promise.all([
        api.getAccountSystemSettings(),
        api.getCommunityChannelSettings(),
      ])
      setAdmins(accountResponse.admins)
      setOpenRegistration(Boolean(accountResponse.settings.openRegistration))
      setChannels(channelsResponse.channels)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('admin.settings.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const toggleOpenRegistration = async () => {
    setSaving(true)
    setError('')
    setInfo('')
    try {
      await api.updateAccountSystemSettings({ openRegistration: !openRegistration })
      setOpenRegistration((current) => !current)
      setInfo(t('admin.settings.saved'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('admin.settings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const [channels, setChannels] = useState<CommunityChannelsConfig>({})
  const [channelsSaving, setChannelsSaving] = useState(false)
  const [channelsUploading, setChannelsUploading] = useState(false)
  const [channelsInfo, setChannelsInfo] = useState('')
  const qrFileInputRef = useRef<HTMLInputElement>(null)

  const saveChannels = async () => {
    setChannelsSaving(true)
    setError('')
    setChannelsInfo('')
    try {
      const response = await api.updateCommunityChannelSettings(channels)
      setChannels(response.channels)
      clearCommunityChannelsCache()
      setChannelsInfo(t('admin.settings.channelsSaved'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('admin.settings.saveFailed'))
    } finally {
      setChannelsSaving(false)
    }
  }

  const handleQrFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    setChannelsUploading(true)
    setError('')
    setChannelsInfo('')
    try {
      const response = await api.uploadCommunityWechatQr(file)
      setChannels((current) => ({ ...current, wechatQrUrl: response.url }))
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('admin.settings.uploadFailed'))
    } finally {
      setChannelsUploading(false)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('admin.settings.title')}
        description={t('admin.settings.subtitle')}
      />

      {error ? <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
      {info ? <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">{info}</div> : null}

      <div className="grid gap-5 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" /> {t('admin.settings.adminsTitle')}</CardTitle>
              <CardDescription>{t('admin.settings.adminsDesc')}</CardDescription>
            </div>
            <Button variant="outline" size="icon" onClick={() => void load()} title={t('admin.settings.refresh')}><RefreshCw className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6"><EmptyState icon={Shield} title={t('admin.settings.loadingAdmins')} description="" /></div>
            ) : admins.length === 0 ? (
              <div className="p-6"><EmptyState icon={Shield} title={t('admin.settings.noAdmins')} description={t('admin.settings.noAdminsDesc')} /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.settings.colAdmin')}</TableHead>
                    <TableHead>{t('admin.settings.colRole')}</TableHead>
                    <TableHead>{t('admin.settings.colStatus')}</TableHead>
                    <TableHead>{t('admin.settings.colLastLogin')}</TableHead>
                    <TableHead>{t('admin.settings.colRegistered')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admins.map((admin) => (
                    <TableRow key={admin.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {admin.avatarUrl ? <img src={admin.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : admin.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{admin.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{admin.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant={ROLE_VARIANTS[admin.role] || 'secondary'}>{admin.role}</Badge></TableCell>
                      <TableCell><span className="text-sm">{admin.status}</span></TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{admin.lastLoginAt ? formatDate(admin.lastLoginAt) : '—'}</span></TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">{formatDate(admin.createdAt ?? '')}</span></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Settings2 className="h-4 w-4" /> {t('admin.settings.systemSwitches')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox checked={openRegistration} disabled={saving} onCheckedChange={() => void toggleOpenRegistration()} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t('admin.settings.openRegistration')}</span>
                    <span className="block text-xs text-muted-foreground">{t('admin.settings.openRegistrationDesc')}</span>
                  </span>
                </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><MessageCircle className="h-4 w-4" /> {t('admin.settings.communityChannels')}</CardTitle>
              <CardDescription>{t('admin.settings.communityChannelsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="community-telegram-url">{t('admin.settings.telegramLabel')}</Label>
                <Input
                  id="community-telegram-url"
                  value={channels.telegramUrl ?? ''}
                  onChange={(event) => setChannels((current) => ({ ...current, telegramUrl: event.target.value }))}
                  placeholder="https://t.me/..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="community-feishu-url">{t('admin.settings.feishuLabel')}</Label>
                <Input
                  id="community-feishu-url"
                  value={channels.feishuUrl ?? ''}
                  onChange={(event) => setChannels((current) => ({ ...current, feishuUrl: event.target.value }))}
                  placeholder="https://applink.feishu.cn/..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="community-wechat-qr-url">{t('admin.settings.wechatQrLabel')}</Label>
                <div className="flex items-start gap-3">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-muted bg-muted/40">
                    {channels.wechatQrUrl ? (
                      <img src={channels.wechatQrUrl} alt={t('admin.settings.wechatQrAlt')} className="h-full w-full object-contain" />
                    ) : (
                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      id="community-wechat-qr-url"
                      value={channels.wechatQrUrl ?? ''}
                      onChange={(event) => setChannels((current) => ({ ...current, wechatQrUrl: event.target.value }))}
                      placeholder={t('admin.settings.qrPlaceholder')}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        ref={qrFileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(event) => void handleQrFileChange(event)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={channelsUploading}
                        onClick={() => qrFileInputRef.current?.click()}
                      >
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                        {channelsUploading ? t('admin.settings.uploading') : t('admin.settings.uploadQr')}
                      </Button>
                      {channels.wechatQrUrl ? (
                        <a href={channels.wechatQrUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                          {t('admin.settings.view')} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <Button type="button" size="sm" disabled={channelsSaving} onClick={() => void saveChannels()}>
                {channelsSaving ? t('admin.settings.savingChannels') : t('admin.settings.saveChannels')}
              </Button>
              {channelsInfo ? <p className="text-xs text-emerald-600">{channelsInfo}</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{t('admin.settings.ownerProtection')}</CardTitle></CardHeader>
            <CardContent className="text-xs leading-5 text-muted-foreground">
              <p>{t('admin.settings.ownerProtectionDesc')}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  )
}
