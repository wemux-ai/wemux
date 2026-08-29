import { cn } from "../../lib/utils"
import React from "react"

export const Section = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <section className={cn('rounded-xl border border-border bg-card', className)} {...props}>
    {children}
  </section>
)

export const SectionHeader = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center justify-between p-4 border-b border-border', className)} {...props}>
    {children}
  </div>
)

export const SectionContent = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-4', className)} {...props}>
    {children}
  </div>
)
