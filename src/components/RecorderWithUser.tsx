'use client'

import { RecorderProvider } from './RecorderProvider'
import { useUserStore } from '@/store/userStore'

interface RecorderWithUserProps {
  children: React.ReactNode
  campaign?: string
  autoStart?: boolean
  timeout?: number
}

export function RecorderWithUser({
  children,
  campaign = 'app_usage',
  autoStart = true,
  timeout,
}: RecorderWithUserProps) {
  const user = useUserStore((state) => state.user)

  return (
    <RecorderProvider
      campaign={campaign}
      autoStart={autoStart}
      timeout={timeout}
      user={user}
    >
      {children}
    </RecorderProvider>
  )
}
