import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

const cursorGridStyle = {
  '--cursor-x': '50%',
  '--cursor-y': '18rem',
  '--grid-opacity': '0.28',
} as CSSProperties

const gridMask =
  'radial-gradient(18rem circle at var(--cursor-x) var(--cursor-y), rgba(0,0,0,1) 0%, rgba(0,0,0,0.86) 34%, transparent 72%)'

const gridGlowStyle = {
  maskImage: gridMask,
  WebkitMaskImage: gridMask,
} as CSSProperties

const cursorOrbStyle = {
  left: 'var(--cursor-x)',
  top: 'var(--cursor-y)',
} as CSSProperties

export function useCursorGrid<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)

  const onPointerMove = (event: ReactPointerEvent<T>) => {
    const element = ref.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    element.style.setProperty('--cursor-x', `${event.clientX - rect.left}px`)
    element.style.setProperty('--cursor-y', `${event.clientY - rect.top}px`)
    element.style.setProperty('--grid-opacity', '0.95')
  }

  const onPointerLeave = () => {
    ref.current?.style.setProperty('--grid-opacity', '0.28')
  }

  return {
    ref,
    onPointerLeave,
    onPointerMove,
    style: cursorGridStyle,
  }
}

export function LandingMotionStyles() {
  return (
    <style>
      {`
        @keyframes wemux-scan {
          0% { transform: translateY(-18%); opacity: 0; }
          18% { opacity: 0.7; }
          100% { transform: translateY(620%); opacity: 0; }
        }

        @keyframes wemux-signal {
          0%, 100% { opacity: 0; transform: translate3d(0, 5px, 0) scale(0.72); }
          18% { opacity: 0.22; }
          42% { opacity: 0.9; transform: translate3d(0, -2px, 0) scale(1); }
          66% { opacity: 0.5; transform: translate3d(0, -7px, 0) scale(0.88); }
          84% { opacity: 0; transform: translate3d(0, -12px, 0) scale(0.62); }
        }

        @keyframes wemux-flow {
          to { stroke-dashoffset: -22; }
        }

        @keyframes fade-up-in {
          from {
            opacity: 0;
            transform: translateY(32px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes scale-in {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes slide-left-in {
          from {
            opacity: 0;
            transform: translateX(32px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes slide-right-in {
          from {
            opacity: 0;
            transform: translateX(-32px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .animate-fade-up-out {
          opacity: 0;
          transform: translateY(32px);
        }

        .animate-fade-up-in {
          animation: fade-up-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .animate-fade-in-out {
          opacity: 0;
        }

        .animate-fade-in-in {
          animation: fade-in 0.6s ease-out forwards;
        }

        .animate-scale-out {
          opacity: 0;
          transform: scale(0.95);
        }

        .animate-scale-in {
          animation: scale-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .animate-slide-left-out {
          opacity: 0;
          transform: translateX(32px);
        }

        .animate-slide-left-in {
          animation: slide-left-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .animate-slide-right-out {
          opacity: 0;
          transform: translateX(-32px);
        }

        .animate-slide-right-in {
          animation: slide-right-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .wemux-flow-line {
          animation: wemux-flow 3.8s linear infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .wemux-motion,
          .wemux-signal,
          .wemux-flow-line,
          .animate-fade-up-in,
          .animate-fade-in-in,
          .animate-scale-in,
          .animate-slide-left-in,
          .animate-slide-right-in {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}
    </style>
  )
}

export function InteractiveHeroGrid() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="absolute h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/12 blur-3xl opacity-[var(--grid-opacity)] transition-opacity duration-300"
        style={cursorOrbStyle}
      />
      {heroSignals.map((signal) => (
        <FloatingSignal key={`${signal.left}-${signal.top}`} {...signal} />
      ))}
    </div>
  )
}

export function ConsoleMotionOverlay() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div
        className="wemux-motion absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/03 to-transparent"
        style={{ animation: 'wemux-scan 5.8s ease-in-out infinite' }}
      />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-300/35 to-transparent" />
    </div>
  )
}

const heroSignals = [
  { left: '8%', top: '8rem', tone: 'green' as const, delay: '0s', duration: '7.2s' },
  { left: '18%', top: '13rem', tone: 'white' as const, delay: '1.4s', duration: '8.6s' },
  { left: '31%', top: '23rem', tone: 'green' as const, delay: '3.1s', duration: '9.4s' },
  { left: '48%', top: '29rem', tone: 'white' as const, delay: '0.9s', duration: '7.8s' },
  { left: '63%', top: '16rem', tone: 'green' as const, delay: '4.2s', duration: '8.8s' },
  { left: '78%', top: '10rem', tone: 'white' as const, delay: '2.2s', duration: '9.8s' },
  { left: '90%', top: '24rem', tone: 'green' as const, delay: '5.4s', duration: '8.2s' },
] as const

function FloatingSignal({
  delay,
  duration,
  left,
  tone,
  top,
}: (typeof heroSignals)[number]) {
  const color = tone === 'green'
    ? 'bg-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.72)]'
    : 'bg-white shadow-[0_0_20px_rgba(255,255,255,0.58)]'

  return (
    <span
      className={`wemux-motion wemux-signal absolute h-1.5 w-1.5 rounded-full ${color}`}
      style={{ animation: `wemux-signal ${duration} ease-in-out ${delay} infinite both`, left, top }}
    />
  )
}
