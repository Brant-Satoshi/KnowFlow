'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  useTheme as useNextTheme,
  type ThemeProviderProps,
} from 'next-themes'

const TRANSITION_CLASS = 'theme-transitioning'
const TRANSITION_DURATION_MS = 350

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}

export function useThemeWithTransition() {
  const { theme, setTheme, resolvedTheme, systemTheme, themes } = useNextTheme()
  const timeoutRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const setThemeWithTransition = React.useCallback(
    (value: string) => {
      const root = document.documentElement
      root.classList.add(TRANSITION_CLASS)
      setTheme(value)
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = window.setTimeout(() => {
        root.classList.remove(TRANSITION_CLASS)
        timeoutRef.current = null
      }, TRANSITION_DURATION_MS)
    },
    [setTheme],
  )

  return { theme, setTheme: setThemeWithTransition, resolvedTheme, systemTheme, themes }
}
