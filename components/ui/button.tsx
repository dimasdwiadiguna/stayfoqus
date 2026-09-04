"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0 [&_svg]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:opacity-90 active:opacity-80",
        secondary:
          "bg-surface-2 text-fg hover:bg-surface-3 active:bg-surface-3 border border-border",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
        danger: "bg-danger text-white hover:opacity-90",
        outline: "border border-border-strong text-fg hover:bg-surface-2",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        // §10 a11y: interactive targets are >= 44px tall unless explicitly compact.
        default: "h-11 px-4",
        sm: "h-9 px-3 text-[13px]",
        lg: "h-12 px-6 text-base",
        icon: "size-11",
        // An icon button is 36 px because it lives in a toolbar row, and
        // `tap-44` is what keeps that legal: the band it adds is invisible and
        // costs no layout. `sm` deliberately does not get it — it appears in
        // stacked list rows, where the band would reach into the row below.
        iconSm: "tap-44 size-9",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "secondary", size: "default", block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      // Buttons inside forms should not submit unless asked to.
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
