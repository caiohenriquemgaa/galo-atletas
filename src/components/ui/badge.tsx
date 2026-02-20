import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition",
  {
    variants: {
      variant: {
        default: "border-[var(--gold)]/40 bg-[var(--gold)]/15 text-[var(--gold)]",
        success: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
        destructive: "border-red-500/30 bg-red-500/15 text-red-300",
        outline: "border-white/20 text-white",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
