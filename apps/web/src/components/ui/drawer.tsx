"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "../../lib/utils"

type DrawerDirection = "top" | "right" | "bottom" | "left"

interface DrawerProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root> {
  direction?: DrawerDirection
  handleOnly?: boolean
}

const DrawerDirectionContext = React.createContext<DrawerDirection>("bottom")

const Drawer = ({
  direction = "bottom",
  handleOnly: _handleOnly = direction === "left" || direction === "right",
  ...props
}: DrawerProps) => (
  <DrawerDirectionContext.Provider value={direction}>
    <DialogPrimitive.Root {...props} />
  </DrawerDirectionContext.Provider>
)

const DrawerTrigger = DialogPrimitive.Trigger

const DrawerPortal = DialogPrimitive.Portal

const DrawerClose = DialogPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-slate-950/72 backdrop-blur-[3px]", className)}
    {...props}
  />
))
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DrawerContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  overlayClassName?: string
}

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ className, overlayClassName, children, ...props }, ref) => {
  const direction = React.useContext(DrawerDirectionContext)

  return (
    <DrawerPortal>
      <DrawerOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        data-vaul-drawer-direction={direction}
        className={cn(
          "fixed z-50 flex flex-col bg-background/98 shadow-2xl shadow-slate-950/20 backdrop-blur-xl",
          "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:h-auto data-[vaul-drawer-direction=bottom]:max-h-[calc(100vh-1rem)] data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:overflow-hidden data-[vaul-drawer-direction=bottom]:rounded-t-[1.25rem] data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=bottom]:border-border/70",
          "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:h-auto data-[vaul-drawer-direction=top]:max-h-[calc(100vh-1rem)] data-[vaul-drawer-direction=top]:w-full data-[vaul-drawer-direction=top]:overflow-hidden data-[vaul-drawer-direction=top]:rounded-b-[1.25rem] data-[vaul-drawer-direction=top]:border-b data-[vaul-drawer-direction=top]:border-border/70",
          "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:h-full data-[vaul-drawer-direction=left]:w-full data-[vaul-drawer-direction=left]:max-w-[720px] data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:border-border/70",
          "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:max-w-[720px] data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:border-border/70",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DrawerPortal>
  )
})
DrawerContent.displayName = DialogPrimitive.Content.displayName

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
    {...props}
  />
)
DrawerHeader.displayName = "DrawerHeader"

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
    {...props}
  />
)
DrawerFooter.displayName = "DrawerFooter"

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
DrawerTitle.displayName = DialogPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DrawerDescription.displayName = DialogPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
