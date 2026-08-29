import { useEffect, useRef, useState } from 'react'

export type AnimationVariant = 'fade-up' | 'fade-in' | 'scale' | 'slide-left' | 'slide-right'

interface UseScrollAnimationOptions {
  threshold?: number
  rootMargin?: string
  triggerOnce?: boolean
  delay?: number
}

export function useScrollAnimation(
  variant: AnimationVariant = 'fade-up',
  options: UseScrollAnimationOptions = {}
) {
  const { threshold = 0.1, rootMargin = '0px 0px -100px 0px', triggerOnce = true, delay = 0 } = options
  const ref = useRef<HTMLElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            setIsVisible(true)
          }, delay)
          if (triggerOnce) {
            observer.unobserve(element)
          }
        } else if (!triggerOnce) {
          setIsVisible(false)
        }
      },
      { threshold, rootMargin }
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [threshold, rootMargin, triggerOnce, delay])

  const animationClass = isVisible ? `animate-${variant}-in` : `animate-${variant}-out`

  return { ref, isVisible, className: animationClass }
}

export function useStaggeredAnimation(
  count: number,
  variant: AnimationVariant = 'fade-up',
  options: UseScrollAnimationOptions & { staggerDelay?: number } = {}
) {
  const { staggerDelay = 100, ...restOptions } = options
  const animations = Array.from({ length: count }, (_, index) =>
    useScrollAnimation(variant, { ...restOptions, delay: index * staggerDelay })
  )

  return animations
}
