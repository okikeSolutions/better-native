import { Button as ButtonPrimitive } from "@base-ui/react/button"
import * as stylex from "@stylexjs/stylex"
import type { StyleXStyles } from "@stylexjs/stylex"

type ButtonVariant = "default" | "outline" | "secondary"
type ButtonSize = "default" | "sm" | "lg"

const styles = stylex.create({
  base: {
    alignItems: "center",
    backgroundClip: "padding-box",
    borderColor: "transparent",
    borderRadius: "var(--radius)",
    borderStyle: "solid",
    borderWidth: 1,
    cursor: "pointer",
    display: "inline-flex",
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 500,
    justifyContent: "center",
    outline: "none",
    transition:
      "background-color 180ms ease, border-color 180ms ease, color 180ms ease, transform 180ms ease",
    userSelect: "none",
    whiteSpace: "nowrap",
    ":focus-visible": {
      borderColor: "var(--ring)",
      boxShadow: "0 0 0 3px color-mix(in oklch, var(--ring) 50%, transparent)",
    },
    ":active": { transform: "translateY(1px)" },
  },
  default: {
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
    ":hover": { backgroundColor: "color-mix(in oklch, var(--primary) 80%, transparent)" },
  },
  outline: {
    backgroundColor: "var(--background)",
    borderColor: "var(--border)",
    color: "var(--foreground)",
    ":hover": { backgroundColor: "var(--muted)" },
  },
  secondary: {
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
    ":hover": {
      backgroundColor: "color-mix(in oklch, var(--secondary), var(--foreground) 5%)",
    },
  },
  sizeDefault: { gap: 6, height: 32, paddingInline: 10 },
  sizeSm: {
    borderRadius: "min(var(--radius-md), 12px)",
    fontSize: 12.8,
    gap: 4,
    height: 28,
    paddingInline: 10,
  },
  sizeLg: { gap: 6, height: 36, paddingInline: 10 },
})

function buttonVariants({
  variant = "default",
  size = "default",
}: {
  variant?: ButtonVariant
  size?: ButtonSize
} = {}): StyleXStyles[] {
  const sizeStyles = {
    default: styles.sizeDefault,
    sm: styles.sizeSm,
    lg: styles.sizeLg,
  }

  return [styles.base, styles[variant], sizeStyles[size]]
}

type ButtonProps = ButtonPrimitive.Props & {
  variant?: ButtonVariant
  size?: ButtonSize
  xstyle?: StyleXStyles
}

function Button({ variant, size, xstyle, ...props }: ButtonProps) {
  return <ButtonPrimitive {...stylex.props(buttonVariants({ variant, size }), xstyle)} {...props} />
}

export { Button, buttonVariants }
