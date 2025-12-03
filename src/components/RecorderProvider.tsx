'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

interface RecorderOptions {
  campaign: string
  timeout?: number
}

interface Recorder {
  ready: Promise<void>
  startRecording(options: RecorderOptions): void
  stopRecording(): void
  isRecording(): boolean
  getCampaign(): string | null
  identify(email: string): Promise<any>
  setStatus(status: 'completed' | 'dropped_off'): Promise<any>
  getSessionId(): string | null
}

interface RecorderContextValue {
  recorder: Recorder | null
  isReady: boolean
  startRecording: (campaign?: string, timeout?: number) => void
  stopRecording: () => void
  isRecording: boolean
  identify: (email: string) => Promise<void>
  setStatus: (status: 'completed' | 'dropped_off') => Promise<void>
  getSessionId: () => string | null
}

const RecorderContext = createContext<RecorderContextValue | null>(null)

interface RecorderProviderProps {
  children: React.ReactNode
  campaign?: string
  autoStart?: boolean
  timeout?: number
  user?: { email?: string } | null
  serverUrl?: string
  token?: string
}

export function RecorderProvider({
  children,
  campaign,
  autoStart = false,
  timeout,
  user,
  serverUrl,
  token,
}: RecorderProviderProps) {
  const [isReady, setIsReady] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recorder, setRecorder] = useState<Recorder | null>(null)

  useEffect(() => {
    // Wait for recorder to be available
    if (typeof window !== 'undefined' && window.recorder) {
      window.recorder.ready.then(() => {
        setRecorder(window.recorder)
        setIsReady(true)
      })
    }
  }, [])

  // Auto-start recording if enabled
  useEffect(() => {
    if (isReady && autoStart && campaign && recorder) {
      recorder.startRecording({ campaign, timeout })
      setIsRecording(true)
    }
  }, [isReady, autoStart, campaign, timeout, recorder])

  // Auto-identify user when logged in
  useEffect(() => {
    if (isReady && user?.email && recorder) {
      recorder.identify(user.email).catch(err => {
        console.error('Recorder: Failed to identify user:', err)
      })
    }
  }, [isReady, user?.email, recorder])

  const startRecording = (campaignName?: string, timeoutMs?: number) => {
    if (!recorder) {
      console.warn('Recorder: Not ready yet')
      return
    }

    const finalCampaign = campaignName || campaign
    if (!finalCampaign) {
      console.error('Recorder: No campaign specified')
      return
    }

    recorder.startRecording({
      campaign: finalCampaign,
      timeout: timeoutMs || timeout,
    })
    setIsRecording(true)
  }

  const stopRecording = () => {
    if (!recorder) return
    recorder.stopRecording()
    setIsRecording(false)
  }

  const identify = async (email: string) => {
    if (!recorder) {
      console.warn('Recorder: Not ready yet')
      return
    }
    await recorder.identify(email)
  }

  const setStatus = async (status: 'completed' | 'dropped_off') => {
    if (!recorder) {
      console.warn('Recorder: Not ready yet')
      return
    }
    await recorder.setStatus(status)
  }

  const getSessionId = () => {
    if (!recorder) return null
    return recorder.getSessionId()
  }

  const value: RecorderContextValue = {
    recorder,
    isReady,
    startRecording,
    stopRecording,
    isRecording,
    identify,
    setStatus,
    getSessionId,
  }

  return (
    <RecorderContext.Provider value={value}>
      {children}
    </RecorderContext.Provider>
  )
}

export function useRecorder() {
  const context = useContext(RecorderContext)
  if (!context) {
    throw new Error('useRecorder must be used within RecorderProvider')
  }
  return context
}

declare global {
  interface Window {
    recorder: Recorder
    RRWEB_SERVER_URL?: string
  }
}
