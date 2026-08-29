"use client"

import * as React from "react"

import { cn } from "../../lib/utils"

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <div data-radix-scroll-area-viewport className="scrollbar-subtle h-full w-full overflow-auto rounded-[inherit]">
      <div className="min-w-full">
        {children}
      </div>
    </div>
  </div>
))
ScrollArea.displayName = "ScrollArea"

const ScrollBar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { orientation?: "vertical" | "horizontal" }
>(({ className, orientation = "vertical", ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn(
      "pointer-events-none absolute flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "bottom-0 right-0 top-0 w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "bottom-0 left-0 right-0 h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <div className="relative flex-1 rounded-full bg-border opacity-0" />
  </div>
))
ScrollBar.displayName = "ScrollBar"

export { ScrollArea, ScrollBar }
