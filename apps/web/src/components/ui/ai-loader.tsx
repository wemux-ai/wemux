import * as React from 'react'

import { cn } from '@/lib/utils'

interface AiLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number
  text?: string
  overlay?: boolean
  textClassName?: string
  ringClassName?: string
  variant?: 'ring' | 'cubes'
}

export function AiLoader({
  size = 180,
  text = '',
  overlay = false,
  className,
  textClassName,
  ringClassName,
  style,
  variant = 'ring',
  ...props
}: AiLoaderProps) {
  const letters = text.trim() ? text.split('') : []
  const thickness = Math.max(size * 0.16, 2)

  return (
    <div
      className={cn(
        overlay
          ? 'fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-b from-[#1a3379] via-[#0f172a] to-black dark:from-gray-100 dark:via-gray-200 dark:to-gray-300'
          : 'inline-flex items-center justify-center',
        className,
      )}
      {...props}
    >
      <div
        className="relative flex items-center justify-center select-none"
        style={{
          width: size,
          height: size,
          ...style,
          ['--ai-loader-thickness' as string]: `${thickness}px`,
        }}
      >
        {letters.length > 0 ? (
          <div className="relative z-10 flex items-center justify-center gap-[0.02em]">
            {letters.map((letter, index) => (
              <span
                key={`${letter}-${index}`}
                className={cn(
                  'inline-block text-white/85 opacity-40 dark:text-gray-800',
                  'animate-[ai-loader-letter_3s_infinite]',
                  textClassName,
                )}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {letter}
              </span>
            ))}
          </div>
        ) : null}

        {variant === 'cubes' ? (
          <div className="ai-loader-cubes absolute inset-0 grid grid-cols-3 gap-[10%] p-[10%]">
            {Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                className="ai-loader-cube rounded-sm"
                style={{ animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </div>
        ) : (
          <div
            className={cn(
              'ai-loader-circle absolute inset-0 rounded-full',
              ringClassName,
            )}
          />
        )}
      </div>
    </div>
  )
}

export const Component = AiLoader
