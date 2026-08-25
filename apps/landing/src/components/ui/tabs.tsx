import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import * as stylex from "@stylexjs/stylex"
import type { StyleXStyles } from "@stylexjs/stylex"

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: 8 },
  noGap: { gap: 0 },
  list: {
    alignItems: "center",
    color: "var(--muted-foreground)",
    display: "inline-flex",
    height: 32,
    justifyContent: "center",
    width: "fit-content",
  },
  listDefault: { backgroundColor: "var(--muted)", borderRadius: "var(--radius)", padding: 3 },
  listLine: { backgroundColor: "transparent", borderRadius: 0, gap: 4, padding: 3 },
  trigger: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: "calc(var(--radius) * .8)",
    borderStyle: "solid",
    borderWidth: 1,
    color: "var(--muted-foreground)",
    cursor: "pointer",
    display: "inline-flex",
    flex: 1,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 500,
    gap: 6,
    height: "calc(100% - 1px)",
    justifyContent: "center",
    outline: "none",
    paddingBlock: 2,
    paddingInline: 6,
    position: "relative",
    transition: "color 180ms ease, background-color 180ms ease",
    whiteSpace: "nowrap",
    ":hover": { color: "var(--foreground)" },
    ":focus-visible": {
      borderColor: "var(--ring)",
      boxShadow: "0 0 0 3px color-mix(in oklch, var(--ring) 50%, transparent)",
    },
  },
  content: { flex: 1, fontSize: 14, outline: "none" },
})

function Tabs({ xstyle, ...props }: TabsPrimitive.Root.Props & { xstyle?: StyleXStyles }) {
  return <TabsPrimitive.Root {...stylex.props(styles.root, xstyle)} {...props} />
}

function TabsList({
  xstyle,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & { xstyle?: StyleXStyles; variant?: "default" | "line" }) {
  return (
    <TabsPrimitive.List
      data-variant={variant}
      {...stylex.props(
        styles.list,
        variant === "line" ? styles.listLine : styles.listDefault,
        xstyle,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ xstyle, ...props }: TabsPrimitive.Tab.Props & { xstyle?: StyleXStyles }) {
  return <TabsPrimitive.Tab {...stylex.props(styles.trigger, xstyle)} {...props} />
}

function TabsContent({ xstyle, ...props }: TabsPrimitive.Panel.Props & { xstyle?: StyleXStyles }) {
  return <TabsPrimitive.Panel {...stylex.props(styles.content, xstyle)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
