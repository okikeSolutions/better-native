import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import * as stylex from "@stylexjs/stylex"
import type { StyleXStyles } from "@stylexjs/stylex"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", width: "100%" },
  item: { borderBottomColor: "var(--border)", borderBottomStyle: "solid", borderBottomWidth: 1 },
  header: { display: "flex" },
  trigger: {
    alignItems: "flex-start",
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: "var(--radius)",
    borderStyle: "solid",
    borderWidth: 1,
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    flex: 1,
    fontFamily: "inherit",
    fontSize: 14,
    fontWeight: 500,
    justifyContent: "space-between",
    outline: "none",
    paddingBlock: 10,
    paddingInline: 0,
    position: "relative",
    textAlign: "left",
    transition: "border-color 180ms ease, box-shadow 180ms ease",
    ":hover": { textDecoration: "underline" },
    ":focus-visible": {
      borderColor: "var(--ring)",
      boxShadow: "0 0 0 3px color-mix(in oklch, var(--ring) 50%, transparent)",
    },
  },
  icon: {
    color: "var(--muted-foreground)",
    flexShrink: 0,
    height: 16,
    marginLeft: "auto",
    pointerEvents: "none",
    width: 16,
  },
  panel: { fontSize: 14, overflow: "hidden" },
  content: { paddingBottom: 10, paddingTop: 0 },
})

function Accordion({
  xstyle,
  ...props
}: AccordionPrimitive.Root.Props & { xstyle?: StyleXStyles }) {
  return <AccordionPrimitive.Root {...stylex.props(styles.root, xstyle)} {...props} />
}

function AccordionItem({
  xstyle,
  ...props
}: AccordionPrimitive.Item.Props & { xstyle?: StyleXStyles }) {
  return <AccordionPrimitive.Item {...stylex.props(styles.item, xstyle)} {...props} />
}

function AccordionTrigger({
  xstyle,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props & { xstyle?: StyleXStyles }) {
  return (
    <AccordionPrimitive.Header {...stylex.props(styles.header)}>
      <AccordionPrimitive.Trigger {...stylex.props(styles.trigger, xstyle)} {...props}>
        {children}
        <ChevronDownIcon data-accordion-icon="closed" {...stylex.props(styles.icon)} />
        <ChevronUpIcon data-accordion-icon="open" {...stylex.props(styles.icon)} />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  xstyle,
  children,
  ...props
}: AccordionPrimitive.Panel.Props & { xstyle?: StyleXStyles }) {
  return (
    <AccordionPrimitive.Panel {...stylex.props(styles.panel)} {...props}>
      <div {...stylex.props(styles.content, xstyle)}>{children}</div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
