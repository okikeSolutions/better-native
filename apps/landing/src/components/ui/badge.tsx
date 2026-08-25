import * as stylex from "@stylexjs/stylex"
import type { StyleXStyles } from "@stylexjs/stylex"
import type { ComponentProps } from "react"

type BadgeVariant = "default" | "secondary" | "outline"

const styles = stylex.create({
  base: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 999,
    borderStyle: "solid",
    borderWidth: 1,
    display: "inline-flex",
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 500,
    gap: 4,
    height: 20,
    justifyContent: "center",
    overflow: "hidden",
    paddingBlock: 2,
    paddingInline: 8,
    transition: "background-color 180ms ease, color 180ms ease",
    whiteSpace: "nowrap",
    width: "fit-content",
  },
  default: { backgroundColor: "var(--primary)", color: "var(--primary-foreground)" },
  secondary: { backgroundColor: "var(--secondary)", color: "var(--secondary-foreground)" },
  outline: { borderColor: "var(--border)", color: "var(--foreground)" },
})

type BadgeProps = ComponentProps<"span"> & {
  variant?: BadgeVariant
  xstyle?: StyleXStyles
}

function Badge({ variant = "default", xstyle, ...props }: BadgeProps) {
  return <span {...stylex.props(styles.base, styles[variant], xstyle)} {...props} />
}

export { Badge }
