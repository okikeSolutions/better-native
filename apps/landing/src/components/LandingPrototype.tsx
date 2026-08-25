import { useEffect, useState, type ComponentProps } from "react"
import * as stylex from "@stylexjs/stylex"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleIcon,
  OrbitIcon,
  SparklesIcon,
} from "lucide-react"

const styles = stylex.create({
  code: {
    color: "var(--muted-foreground)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
    lineHeight: "24px",
    "@media (min-width: 640px)": { fontSize: 12 },
  },
  primaryText: { color: "var(--primary)" },
  foregroundText: { color: "var(--foreground)" },
  mutedText: { color: "var(--muted-foreground)" },
  marginTop4: { marginTop: 16 },
  paddingLeft4: { paddingLeft: 16 },
  resultBox: {
    alignItems: "center",
    backgroundColor: "var(--background)",
    borderColor: "var(--border)",
    borderRadius: "var(--radius)",
    borderStyle: "solid",
    borderWidth: 1,
    display: "flex",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    gap: 12,
    paddingBlock: 16,
    paddingInline: 12,
  },
  icon16Primary: { color: "var(--primary)", height: 16, width: 16 },
  icon12Primary: { color: "var(--primary)", height: 12, width: 12 },
  icon20Primary: { color: "var(--primary)", height: 20, width: 20 },
  icon20Muted: {
    color: "var(--muted-foreground)",
    height: 20,
    transition: "color 180ms ease",
    width: 20,
  },
  marginLeftAuto: { marginLeft: "auto" },
  wordmark: {
    alignItems: "center",
    display: "flex",
    fontWeight: 500,
    gap: 10,
    letterSpacing: "-0.04em",
  },
  wordmarkLogo: {
    borderRadius: 10.4,
    display: "grid",
    height: 36,
    overflow: "hidden",
    position: "relative",
    transition: "transform 300ms ease",
    width: 36,
    ":hover": { transform: "rotate(-6deg)" },
  },
  wordmarkImage: {
    height: "100%",
    mixBlendMode: "screen",
    objectFit: "cover",
    transform: "scale(1.7)",
    width: "100%",
  },
  wordmarkText: { fontSize: 15 },
  runtimeStage: {
    display: "grid",
    gap: 32,
    "@media (min-width: 1024px)": {
      alignItems: "center",
      gap: 40,
      gridTemplateColumns: "minmax(0,1fr) minmax(20rem,22rem)",
    },
  },
  runtimeShell: {
    backgroundColor: "var(--card)",
    borderColor: "var(--border)",
    borderRadius: "calc(var(--radius) * 1.8)",
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: "0 25px 50px -12px rgb(0 0 0 / 30%)",
    overflow: "hidden",
    position: "relative",
  },
  runtimeHeader: {
    alignItems: "center",
    borderBottomColor: "var(--border)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    justifyContent: "space-between",
    paddingBlock: 12,
    paddingInline: 16,
    "@media (min-width: 640px)": { paddingInline: 20 },
  },
  runtimeLabel: {
    alignItems: "center",
    color: "var(--muted-foreground)",
    display: "flex",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10,
    gap: 8,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
  },
  pingWrap: { display: "flex", height: 8, position: "relative", width: 8 },
  ping: {
    animationName: stylex.keyframes({ "75%, 100%": { opacity: 0, transform: "scale(2)" } }),
    animationDuration: "1s",
    animationIterationCount: "infinite",
    backgroundColor: "var(--primary)",
    borderRadius: 999,
    display: "inline-flex",
    height: "100%",
    opacity: 0.6,
    position: "absolute",
    width: "100%",
  },
  pingDot: {
    backgroundColor: "var(--primary)",
    borderRadius: 999,
    display: "inline-flex",
    height: 8,
    position: "relative",
    width: 8,
  },
  tabsNoGap: { gap: 0 },
  tabsList: { marginInline: 16, marginTop: 16, "@media (min-width: 640px)": { marginInline: 20 } },
  tabsContent: {
    margin: 0,
    paddingBlockEnd: 20,
    paddingBlockStart: 16,
    paddingInline: 16,
    "@media (min-width: 640px)": { paddingInline: 20 },
  },
  phaseGrid: {
    borderTopColor: "var(--border)",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    color: "var(--muted-foreground)",
    display: "grid",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10,
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    letterSpacing: "0.12em",
    textAlign: "center",
    textTransform: "uppercase",
  },
  phaseCell: { paddingBlock: 12, paddingInline: 8, position: "relative" },
  phaseActive: { color: "var(--foreground)" },
  phaseDivider: {
    backgroundColor: "var(--border)",
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 1,
  },
  phoneWrap: {
    marginInline: "auto",
    width: 176,
    "@media (min-width: 640px)": { width: 256 },
    "@media (min-width: 1024px)": { marginInline: 0, width: 352 },
  },
  phoneMockup: { aspectRatio: 0.502, position: "relative" },
  phoneSvg: {
    bottom: 0,
    height: "100%",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%",
  },
  phoneScreen: {
    backgroundColor: "var(--card)",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    paddingBlockEnd: 16,
    paddingBlockStart: 32,
    paddingInline: 16,
    width: "100%",
    "@media (min-width: 1024px)": { paddingBlockEnd: 28, paddingBlockStart: 56, paddingInline: 28 },
  },
  phoneStatus: {
    alignItems: "center",
    color: "var(--muted-foreground)",
    display: "flex",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 8,
    justifyContent: "space-between",
    "@media (min-width: 1024px)": { fontSize: 10 },
  },
  phoneTitleWrap: { marginTop: 28, "@media (min-width: 1024px)": { marginTop: 48 } },
  phoneTitle: {
    color: "var(--foreground)",
    fontSize: 10,
    fontWeight: 500,
    "@media (min-width: 1024px)": { fontSize: 16 },
  },
  phoneKicker: {
    color: "var(--muted-foreground)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 8,
    letterSpacing: "0.12em",
    marginTop: 4,
    textTransform: "uppercase",
    "@media (min-width: 1024px)": { fontSize: 10, marginTop: 8 },
  },
  deviceOrb: {
    alignItems: "center",
    backgroundColor: "var(--background)",
    borderColor: "var(--border)",
    borderRadius: 999,
    borderStyle: "solid",
    borderWidth: 1,
    display: "grid",
    height: 80,
    justifyItems: "center",
    marginInline: "auto",
    marginTop: 28,
    width: 80,
    "@media (min-width: 1024px)": { height: 160, marginTop: 48, width: 160 },
  },
  deviceIcon: {
    color: "var(--primary)",
    height: 28,
    width: 28,
    "@media (min-width: 1024px)": { height: 56, width: 56 },
  },
  deviceCopy: { marginTop: 24, "@media (min-width: 1024px)": { marginTop: 40 } },
  deviceTitle: {
    color: "var(--foreground)",
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.25,
    "@media (min-width: 1024px)": { fontSize: 20 },
  },
  deviceDescription: {
    color: "var(--muted-foreground)",
    fontSize: 10,
    lineHeight: "16px",
    marginTop: 8,
    "@media (min-width: 1024px)": { fontSize: 12, lineHeight: "20px", marginTop: 16 },
  },
  deviceMeter: {
    backgroundColor: "var(--muted)",
    borderRadius: 999,
    height: 6,
    marginTop: 20,
    overflow: "hidden",
    "@media (min-width: 1024px)": { height: 12, marginTop: 32 },
  },
  deviceMeterFill: {
    backgroundColor: "var(--primary)",
    borderRadius: "inherit",
    display: "block",
    height: "100%",
    transition: "width 620ms cubic-bezier(0.2, 0.85, 0.25, 1)",
  },
  meterResolve: { width: "33%" },
  meterRun: { width: "67%" },
  meterResult: { width: "100%" },
  deviceFooter: {
    alignItems: "center",
    color: "var(--muted-foreground)",
    display: "flex",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 8,
    justifyContent: "space-between",
    letterSpacing: "0.1em",
    marginTop: 12,
    textTransform: "uppercase",
    "@media (min-width: 1024px)": { fontSize: 10, marginTop: 20 },
  },
  main: { backgroundColor: "var(--background)", color: "var(--foreground)", overflowX: "clip" },
  hero: { isolation: "isolate", minHeight: "100svh", overflow: "hidden", position: "relative" },
  dotGrid: {
    backgroundImage:
      "radial-gradient(circle at 1px 1px, color-mix(in oklch, var(--foreground) 18%, transparent) 1px, transparent 0)",
    backgroundSize: "24px 24px",
    bottom: 0,
    left: 0,
    maskImage: "linear-gradient(to bottom, black 0%, transparent 84%)",
    pointerEvents: "none",
    position: "absolute",
    right: 0,
    top: 0,
  },
  dotGridHalf: { opacity: 0.5 },
  header: {
    alignItems: "center",
    display: "flex",
    height: 80,
    justifyContent: "space-between",
    marginInline: "auto",
    maxWidth: 1280,
    paddingInline: 20,
    position: "relative",
    zIndex: 10,
    "@media (min-width: 640px)": { paddingInline: 32 },
  },
  nav: {
    alignItems: "center",
    color: "var(--muted-foreground)",
    display: "none",
    fontSize: 14,
    gap: 24,
    "@media (min-width: 768px)": { display: "flex" },
  },
  navLink: { transition: "color 180ms ease", ":hover": { color: "var(--foreground)" } },
  heroInner: {
    marginInline: "auto",
    maxWidth: 1280,
    paddingBlockEnd: 48,
    paddingBlockStart: 48,
    paddingInline: 20,
    position: "relative",
    "@media (min-width: 640px)": { paddingInline: 32 },
    "@media (min-width: 1024px)": { paddingBlockEnd: 80, paddingBlockStart: 64 },
  },
  maxWidth5xl: { maxWidth: 1024 },
  heroKicker: {
    color: "var(--muted-foreground)",
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: "-0.02em",
    marginTop: 32,
  },
  heroHeading: {
    fontSize: 48,
    fontWeight: 600,
    letterSpacing: "-0.075em",
    lineHeight: 0.92,
    marginTop: 12,
    maxWidth: 1024,
    textWrap: "balance",
    "@media (min-width: 640px)": { fontSize: 60 },
    "@media (min-width: 1024px)": { fontSize: 72 },
  },
  heroBody: {
    color: "var(--muted-foreground)",
    fontSize: 16,
    lineHeight: "28px",
    marginTop: 28,
    maxWidth: 576,
    textWrap: "pretty",
    "@media (min-width: 640px)": { fontSize: 18 },
  },
  actionRow: { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12, marginTop: 36 },
  facts: {
    borderBottomColor: "var(--border)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderTopColor: "var(--border)",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    display: "grid",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10,
    letterSpacing: "0.11em",
    marginTop: 32,
    maxWidth: 672,
    textTransform: "uppercase",
    "@media (min-width: 640px)": { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
  },
  fact: { paddingBlock: 12 },
  factMiddle: {
    borderTopColor: "var(--border)",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    paddingBlock: 12,
    "@media (min-width: 640px)": {
      borderLeftColor: "var(--border)",
      borderLeftStyle: "solid",
      borderLeftWidth: 1,
      borderTopWidth: 0,
      paddingInline: 16,
    },
  },
  factLast: {
    borderTopColor: "var(--border)",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    paddingBlock: 12,
    "@media (min-width: 640px)": {
      borderLeftColor: "var(--border)",
      borderLeftStyle: "solid",
      borderLeftWidth: 1,
      borderTopWidth: 0,
      paddingLeft: 16,
    },
  },
  factValue: { color: "var(--foreground)", marginTop: 4 },
  factValuePrimary: { color: "var(--primary)", marginTop: 4 },
  previewWrap: {
    marginLeft: "auto",
    marginTop: 48,
    maxWidth: 1024,
    position: "relative",
    width: "100%",
    "@media (min-width: 1024px)": { marginTop: 64 },
  },
  previewCaption: {
    alignItems: "center",
    color: "var(--muted-foreground)",
    display: "flex",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10,
    gap: 8,
    letterSpacing: "0.12em",
    marginTop: 16,
    textTransform: "uppercase",
  },
  borderedCardSection: {
    backgroundColor: "var(--card)",
    borderBottomColor: "var(--border)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderTopColor: "var(--border)",
    borderTopStyle: "solid",
    borderTopWidth: 1,
  },
  foundationGrid: {
    display: "grid",
    marginInline: "auto",
    maxWidth: 1280,
    "@media (min-width: 1024px)": { gridTemplateColumns: "0.7fr 1.3fr" },
  },
  foundationAside: {
    borderBottomColor: "var(--border)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: 224,
    padding: 24,
    "@media (min-width: 640px)": { padding: 32 },
    "@media (min-width: 1024px)": {
      borderBottomWidth: 0,
      borderRightColor: "var(--border)",
      borderRightStyle: "solid",
      borderRightWidth: 1,
      minHeight: 320,
      padding: 40,
    },
  },
  sectionLabel: {
    color: "var(--muted-foreground)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
  },
  asideCopy: {
    fontSize: 20,
    fontWeight: 500,
    letterSpacing: "-0.04em",
    lineHeight: 1.25,
    maxWidth: 224,
  },
  foundationContent: {
    display: "grid",
    gap: 32,
    padding: 24,
    "@media (min-width: 640px)": { padding: 32 },
    "@media (min-width: 1024px)": {
      alignItems: "end",
      gridTemplateColumns: "1.1fr 0.9fr",
      padding: 40,
    },
  },
  sectionHeading: {
    fontSize: 30,
    fontWeight: 500,
    letterSpacing: "-0.055em",
    lineHeight: 1.25,
    textWrap: "balance",
    "@media (min-width: 640px)": { fontSize: 36 },
  },
  sectionBody: {
    color: "var(--muted-foreground)",
    lineHeight: "28px",
    marginTop: 20,
    maxWidth: 576,
  },
  foundationStats: {
    display: "grid",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    gap: 12,
  },
  stat: { alignItems: "center", display: "flex", justifyContent: "space-between" },
  standardSection: {
    marginInline: "auto",
    maxWidth: 1280,
    paddingBlock: 80,
    paddingInline: 20,
    "@media (min-width: 640px)": { paddingBlock: 112, paddingInline: 32 },
  },
  maxWidth2xl: { maxWidth: 672 },
  operatingHeading: {
    fontSize: 30,
    fontWeight: 500,
    letterSpacing: "-0.055em",
    marginTop: 20,
    textWrap: "balance",
    "@media (min-width: 640px)": { fontSize: 48 },
  },
  operatingGrid: {
    borderBottomColor: "var(--border)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderTopColor: "var(--border)",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    display: "grid",
    marginTop: 56,
    "@media (min-width: 768px)": { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
  },
  operatingItem: {
    borderBottomColor: "var(--border)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    paddingBlock: 32,
    "@media (min-width: 768px)": { borderBottomWidth: 0, paddingInline: 28 },
  },
  operatingNumber: {
    color: "var(--primary)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
  },
  operatingTitle: {
    fontSize: 24,
    fontWeight: 500,
    letterSpacing: "-0.045em",
    marginTop: 40,
    transition: "transform 300ms ease",
    ":hover": { transform: "translateX(4px)" },
  },
  operatingBody: {
    color: "var(--muted-foreground)",
    lineHeight: "28px",
    marginTop: 12,
    maxWidth: 320,
  },
  marginTop8: { marginTop: 32 },
  roadmapGrid: {
    display: "grid",
    gap: 48,
    marginInline: "auto",
    maxWidth: 1280,
    paddingBlock: 80,
    paddingInline: 20,
    "@media (min-width: 640px)": { paddingBlock: 112, paddingInline: 32 },
    "@media (min-width: 1024px)": { gridTemplateColumns: "0.75fr 1.25fr" },
  },
  roadmapHeading: {
    fontSize: 30,
    fontWeight: 500,
    letterSpacing: "-0.055em",
    marginTop: 20,
    maxWidth: 448,
    textWrap: "balance",
    "@media (min-width: 640px)": { fontSize: 36 },
  },
  roadmapList: { borderTopColor: "var(--border)", borderTopStyle: "solid", borderTopWidth: 1 },
  roadmapItem: {
    borderBottomColor: "var(--border)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "grid",
    gap: 16,
    paddingBlock: 28,
    "@media (min-width: 640px)": { alignItems: "center", gridTemplateColumns: "7rem 1fr auto" },
  },
  roadmapTitle: { fontSize: 18, fontWeight: 500, letterSpacing: "-0.035em" },
  roadmapBody: { color: "var(--muted-foreground)", lineHeight: "24px", marginTop: 4 },
  roadmapDot: {
    color: "var(--primary)",
    display: "none",
    height: 12,
    width: 12,
    "@media (min-width: 640px)": { display: "block" },
  },
  questionsGrid: {
    display: "grid",
    gap: 48,
    marginInline: "auto",
    maxWidth: 1280,
    paddingBlock: 80,
    paddingInline: 20,
    "@media (min-width: 640px)": { paddingBlock: 112, paddingInline: 32 },
    "@media (min-width: 1024px)": { gridTemplateColumns: "0.8fr 1.2fr" },
  },
  cta: {
    backgroundColor: "var(--primary)",
    borderTopColor: "var(--border)",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    color: "var(--primary-foreground)",
    overflow: "hidden",
    paddingBlock: 80,
    paddingInline: 20,
    position: "relative",
    "@media (min-width: 640px)": { paddingBlock: 112, paddingInline: 32 },
  },
  dotGridLight: { opacity: 0.2 },
  ctaInner: {
    alignItems: "flex-start",
    display: "flex",
    flexDirection: "column",
    gap: 40,
    justifyContent: "space-between",
    marginInline: "auto",
    maxWidth: 1280,
    position: "relative",
    "@media (min-width: 1024px)": { alignItems: "flex-end", flexDirection: "row" },
  },
  ctaCopy: { maxWidth: 768 },
  ctaLabel: {
    color: "color-mix(in oklch, var(--primary-foreground) 65%, transparent)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 10,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
  },
  ctaHeading: {
    fontSize: 36,
    fontWeight: 600,
    letterSpacing: "-0.065em",
    lineHeight: 0.98,
    marginTop: 16,
    textWrap: "balance",
    "@media (min-width: 640px)": { fontSize: 60 },
  },
  footer: {
    color: "var(--muted-foreground)",
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
    gap: 16,
    marginInline: "auto",
    maxWidth: 1280,
    paddingBlock: 32,
    paddingInline: 20,
    "@media (min-width: 640px)": {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingInline: 32,
    },
  },
})

const githubUrl = "https://github.com/okikeSolutions/better-native"

function GitHubLogo(props: ComponentProps<"svg">) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 1024 1024" {...props}>
      <path
        clipRule="evenodd"
        d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  )
}

const runtimePhases = [
  {
    id: "resolve",
    index: "01",
    label: "Resolve",
    traceLabel: "resolving contract",
    deviceTitle: "Resolve requirement",
    deviceDescription: "Checking the native module surface.",
    code: (
      <div {...stylex.props(styles.code)}>
        <p>
          <span {...stylex.props(styles.primaryText)}>import</span> &#123; Battery &#125;{" "}
          <span {...stylex.props(styles.primaryText)}>from</span>{" "}
          <span {...stylex.props(styles.foregroundText)}>"@better-native/battery"</span>
        </p>
        <p>
          <span {...stylex.props(styles.primaryText)}>import</span> * as Effect{" "}
          <span {...stylex.props(styles.primaryText)}>from</span>{" "}
          <span {...stylex.props(styles.foregroundText)}>"effect/Effect"</span>
        </p>
        <p {...stylex.props(styles.marginTop4, styles.foregroundText)}>
          const power = Battery.getPowerStateAsync.pipe(
        </p>
        <p {...stylex.props(styles.paddingLeft4)}>Effect.provide(Battery.live),</p>
        <p {...stylex.props(styles.foregroundText)}>)</p>
      </div>
    ),
  },
  {
    id: "run",
    index: "02",
    label: "Run",
    traceLabel: "running native adapter",
    deviceTitle: "Run native work",
    deviceDescription: "Reading battery state from the device.",
    code: (
      <div {...stylex.props(styles.code)}>
        <p>
          <span {...stylex.props(styles.primaryText)}>expo-battery</span> / Effect live layer
        </p>
        <p {...stylex.props(styles.marginTop4, styles.foregroundText)}>request: native module</p>
        <p>platform: iOS · Android · Web</p>
        <p>contract: normalized</p>
      </div>
    ),
  },
  {
    id: "result",
    index: "03",
    label: "Result",
    traceLabel: "result verified",
    deviceTitle: "Typed result",
    deviceDescription: "A known value returned with no unchecked paths.",
    code: (
      <div {...stylex.props(styles.resultBox)}>
        <CheckIcon {...stylex.props(styles.icon16Primary)} />
        <span {...stylex.props(styles.foregroundText)}>Battery: 82%</span>
        <span {...stylex.props(styles.marginLeftAuto, styles.mutedText)}>verified</span>
      </div>
    ),
  },
] as const

type RuntimePhase = (typeof runtimePhases)[number]["id"]

const isRuntimePhase = (value: string): value is RuntimePhase =>
  runtimePhases.some((phase) => phase.id === value)

function Wordmark() {
  return (
    <a aria-label="Better Native home" {...stylex.props(styles.wordmark)} href="#top">
      <span {...stylex.props(styles.wordmarkLogo)}>
        <img alt="" {...stylex.props(styles.wordmarkImage)} src="/better-native-logo.png" />
      </span>
      <span {...stylex.props(styles.wordmarkText)}>Better Native</span>
    </a>
  )
}

function RuntimePreview() {
  const [phase, setPhase] = useState<RuntimePhase>("resolve")
  const activePhase = runtimePhases.find((item) => item.id === phase) ?? runtimePhases[0]
  const meterStyle = {
    resolve: styles.meterResolve,
    run: styles.meterRun,
    result: styles.meterResult,
  }[phase]

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPhase((currentPhase) => {
        const currentIndex = runtimePhases.findIndex((item) => item.id === currentPhase)
        return runtimePhases[(currentIndex + 1) % runtimePhases.length].id
      })
    }, 2600)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <div {...stylex.props(styles.runtimeStage)} data-phase={phase}>
      <div {...stylex.props(styles.runtimeShell)}>
        <div {...stylex.props(styles.runtimeHeader)}>
          <div {...stylex.props(styles.runtimeLabel)}>
            <span {...stylex.props(styles.pingWrap)}>
              <span {...stylex.props(styles.ping)} />
              <span {...stylex.props(styles.pingDot)} />
            </span>
            Compatibility harness
          </div>
          <Badge variant="outline">{activePhase.traceLabel}</Badge>
        </div>

        <Tabs
          xstyle={styles.tabsNoGap}
          onValueChange={(value) => {
            if (isRuntimePhase(value)) setPhase(value)
          }}
          value={phase}
        >
          <TabsList xstyle={styles.tabsList} variant="line">
            {runtimePhases.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {runtimePhases.map((item) => (
            <TabsContent xstyle={styles.tabsContent} key={item.id} value={item.id}>
              {item.code}
            </TabsContent>
          ))}
        </Tabs>

        <div {...stylex.props(styles.phaseGrid)}>
          {runtimePhases.map((item, index) => (
            <div
              {...stylex.props(styles.phaseCell, item.id === phase && styles.phaseActive)}
              data-active={item.id === phase}
              key={item.id}
            >
              {index < runtimePhases.length - 1 ? (
                <span {...stylex.props(styles.phaseDivider)} />
              ) : null}
              <span {...stylex.props(styles.primaryText)}>{item.index}</span> {item.label}
            </div>
          ))}
        </div>
      </div>

      <div {...stylex.props(styles.phoneWrap)} data-phase={phase}>
        <div {...stylex.props(styles.phoneMockup)}>
          <svg {...stylex.props(styles.phoneSvg)} viewBox="0 0 366 729">
            <defs>
              <clipPath id="better-native-phone-screen">
                <rect height="684" rx="36" width="316" x="24" y="24" />
              </clipPath>
            </defs>
            <path
              d="M363.315 64.213C363.315 22.99 341.312 1 300.092 1H66.751C25.53 1 3.528 22.99 3.528 64.213v44.68l-.857.143A2 2 0 0 0 1 111.009v24.611a2 2 0 0 0 1.671 1.973l.95.158a2.26 2.26 0 0 1-.093.236v26.173c.212.1.398.296.541.643l-1.398.233A2 2 0 0 0 1 167.009v47.611a2 2 0 0 0 1.671 1.973l1.368.228c-.139.319-.314.533-.511.653v16.637c.221.104.414.313.56.689l-1.417.236A2 2 0 0 0 1 237.009v47.611a2 2 0 0 0 1.671 1.973l1.347.225c-.135.294-.302.493-.49.607v377.681c0 41.213 22 63.208 63.223 63.208h95.074c.947-.504 2.717-.843 4.745-.843l.141.001h.194l.086-.001 33.704.005c1.849.043 3.442.37 4.323.838h95.074c41.222 0 63.223-21.999 63.223-63.212v-394.63c-.259-.275-.48-.796-.63-1.47l-.011-.133 1.655-.276A2 2 0 0 0 366 266.62v-77.611a2 2 0 0 0-1.671-1.973l-1.712-.285c.148-.839.396-1.491.698-1.811V64.213Z"
              fill="#171719"
            />
            <path
              d="M16 59c0-23.748 19.252-43 43-43h246c23.748 0 43 19.252 43 43v615c0 23.196-18.804 42-42 42H58c-23.196 0-42-18.804-42-42V59Z"
              fill="#090a0b"
            />
            <foreignObject
              clipPath="url(#better-native-phone-screen)"
              height="684"
              width="316"
              x="24"
              y="24"
            >
              <div {...stylex.props(styles.phoneScreen)}>
                <div {...stylex.props(styles.phoneStatus)}>
                  <span>9:41</span>
                  <span>5G</span>
                </div>
                <div {...stylex.props(styles.phoneTitleWrap)}>
                  <p {...stylex.props(styles.phoneTitle)}>Effect Mobile</p>
                  <p {...stylex.props(styles.phoneKicker)}>native trace</p>
                </div>
                <div {...stylex.props(styles.deviceOrb)}>
                  {phase === "result" ? (
                    <CheckIcon {...stylex.props(styles.deviceIcon)} />
                  ) : (
                    <OrbitIcon {...stylex.props(styles.deviceIcon)} />
                  )}
                </div>
                <div {...stylex.props(styles.deviceCopy)}>
                  <p {...stylex.props(styles.deviceTitle)}>{activePhase.deviceTitle}</p>
                  <p {...stylex.props(styles.deviceDescription)}>{activePhase.deviceDescription}</p>
                </div>
                <div {...stylex.props(styles.deviceMeter)}>
                  <span {...stylex.props(styles.deviceMeterFill, meterStyle)} />
                </div>
                <div {...stylex.props(styles.deviceFooter)}>
                  <span>{activePhase.index} / 03</span>
                  <span>{phase === "result" ? "ready" : "working"}</span>
                </div>
              </div>
            </foreignObject>
            <rect fill="#1B1B1B" height="22" rx="11" width="82" x="142" y="38" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function LandingPrototype() {
  return (
    <main id="top" {...stylex.props(styles.main)}>
      <section {...stylex.props(styles.hero)}>
        <div {...stylex.props(styles.dotGrid, styles.dotGridHalf)} />

        <header {...stylex.props(styles.header)}>
          <Wordmark />
          <nav {...stylex.props(styles.nav)}>
            <a {...stylex.props(styles.navLink)} href="#foundation">
              Foundation
            </a>
            <a {...stylex.props(styles.navLink)} href="#roadmap">
              Roadmap
            </a>
          </nav>
          <a
            {...stylex.props(buttonVariants({ size: "sm", variant: "outline" }))}
            href={githubUrl}
            rel="noreferrer"
            target="_blank"
          >
            <GitHubLogo data-icon="inline-start" />
            GitHub
          </a>
        </header>

        <div {...stylex.props(styles.heroInner)}>
          <div {...stylex.props(styles.maxWidth5xl)}>
            <Badge variant="secondary">
              <SparklesIcon data-icon="inline-start" />
              Building in public
            </Badge>
            <p {...stylex.props(styles.heroKicker)}>Effect × Expo</p>
            <h1 {...stylex.props(styles.heroHeading)}>
              Reliable Expo APIs,{" "}
              <span {...stylex.props(styles.primaryText)}>by construction.</span>
            </h1>
            <p {...stylex.props(styles.heroBody)}>
              Effect-native APIs for Expo, starting with a compatibility suite that validates the
              native surface before you build on it.
            </p>
            <div {...stylex.props(styles.actionRow)}>
              <a
                {...stylex.props(buttonVariants({ size: "lg" }))}
                href={githubUrl}
                rel="noreferrer"
                target="_blank"
              >
                <GitHubLogo data-icon="inline-start" />
                Follow the project
                <ArrowUpRightIcon data-icon="inline-end" />
              </a>
              <a
                {...stylex.props(buttonVariants({ size: "lg", variant: "outline" }))}
                href="#foundation"
              >
                Explore the harness
                <ArrowDownRightIcon data-icon="inline-end" />
              </a>
            </div>
            <dl {...stylex.props(styles.facts)}>
              <div {...stylex.props(styles.fact)}>
                <dt {...stylex.props(styles.mutedText)}>Pinned runtime</dt>
                <dd {...stylex.props(styles.factValue)}>Effect 4 RC</dd>
              </div>
              <div {...stylex.props(styles.factMiddle)}>
                <dt {...stylex.props(styles.mutedText)}>Target SDK</dt>
                <dd {...stylex.props(styles.factValue)}>Expo 57</dd>
              </div>
              <div {...stylex.props(styles.factLast)}>
                <dt {...stylex.props(styles.mutedText)}>Current work</dt>
                <dd {...stylex.props(styles.factValuePrimary)}>Capability prototypes</dd>
              </div>
            </dl>
          </div>

          <div {...stylex.props(styles.previewWrap)}>
            <RuntimePreview />
            <div {...stylex.props(styles.previewCaption)}>
              <OrbitIcon {...stylex.props(styles.icon12Primary)} />
              The same execution model, from device to service.
            </div>
          </div>
        </div>
      </section>

      <section id="foundation" {...stylex.props(styles.borderedCardSection)}>
        <div {...stylex.props(styles.foundationGrid)}>
          <div {...stylex.props(styles.foundationAside)}>
            <span {...stylex.props(styles.sectionLabel)}>01 / Foundation</span>
            <p {...stylex.props(styles.asideCopy)}>Compatibility is a feature, not a footnote.</p>
          </div>
          <div {...stylex.props(styles.foundationContent)}>
            <div>
              <h2 {...stylex.props(styles.sectionHeading)}>
                A disciplined bridge between Effect and the Expo ecosystem.
              </h2>
              <p {...stylex.props(styles.sectionBody)}>
                The harness tests each capability package against a concrete surface derived from
                pinned upstream revisions.
              </p>
            </div>
            <div {...stylex.props(styles.foundationStats)}>
              <div {...stylex.props(styles.stat)}>
                <span {...stylex.props(styles.mutedText)}>runtime</span>
                <span>Effect 4.0 RC</span>
              </div>
              <Separator />
              <div {...stylex.props(styles.stat)}>
                <span {...stylex.props(styles.mutedText)}>platform</span>
                <span>Expo 57</span>
              </div>
              <Separator />
              <div {...stylex.props(styles.stat)}>
                <span {...stylex.props(styles.mutedText)}>status</span>
                <span {...stylex.props(styles.primaryText)}>four native prototypes</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section {...stylex.props(styles.standardSection)}>
        <div {...stylex.props(styles.maxWidth2xl)}>
          <span {...stylex.props(styles.sectionLabel)}>The operating model</span>
          <h2 {...stylex.props(styles.operatingHeading)}>
            One predictable path from native work to application code.
          </h2>
        </div>
        <div {...stylex.props(styles.operatingGrid)}>
          {[
            [
              "01",
              "Discover",
              "Derive the surface area from the pinned Expo and Effect revisions.",
            ],
            ["02", "Validate", "Execute a real compatibility denominator before abstraction."],
            [
              "03",
              "Compose",
              "Expose Effect-native capabilities with typed errors and requirements.",
            ],
          ].map(([number, title, body], index) => (
            <article {...stylex.props(styles.operatingItem)} key={title}>
              <span {...stylex.props(styles.operatingNumber)}>{number}</span>
              <h3 {...stylex.props(styles.operatingTitle)}>{title}</h3>
              <p {...stylex.props(styles.operatingBody)}>{body}</p>
              {index < 2 ? (
                <ArrowDownRightIcon {...stylex.props(styles.marginTop8, styles.icon20Muted)} />
              ) : (
                <CheckIcon {...stylex.props(styles.marginTop8, styles.icon20Primary)} />
              )}
            </article>
          ))}
        </div>
      </section>

      <section id="roadmap" {...stylex.props(styles.borderedCardSection)}>
        <div {...stylex.props(styles.roadmapGrid)}>
          <div>
            <span {...stylex.props(styles.sectionLabel)}>02 / Roadmap</span>
            <h2 {...stylex.props(styles.roadmapHeading)}>
              Build the base once. Let every capability inherit it.
            </h2>
          </div>
          <ol {...stylex.props(styles.roadmapList)}>
            {[
              [
                "Now",
                "Capability prototypes",
                "Battery, Network, KeepAwake, and SecureStore on the shared harness.",
              ],
              [
                "Next",
                "Native evidence",
                "Expand paired device runs and blind developer-experience pilots.",
              ],
              [
                "Then",
                "Developer preview",
                "A stable surface for application teams to evaluate in production.",
              ],
            ].map(([status, title, body]) => (
              <li {...stylex.props(styles.roadmapItem)} key={title}>
                <Badge variant={status === "Now" ? "default" : "outline"}>{status}</Badge>
                <div>
                  <h3 {...stylex.props(styles.roadmapTitle)}>{title}</h3>
                  <p {...stylex.props(styles.roadmapBody)}>{body}</p>
                </div>
                <CircleIcon {...stylex.props(styles.roadmapDot)} fill="currentColor" />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section {...stylex.props(styles.questionsGrid)}>
        <div>
          <span {...stylex.props(styles.sectionLabel)}>Questions, before code</span>
          <h2 {...stylex.props(styles.roadmapHeading)}>
            A small surface, with deliberate decisions.
          </h2>
        </div>
        <Accordion>
          <AccordionItem value="item-1">
            <AccordionTrigger>Is this ready for production?</AccordionTrigger>
            <AccordionContent>
              Not yet. Four private capability prototypes are implemented, but platform evidence,
              blind pilots, publishing, and stable-version guarantees are still incomplete.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-2">
            <AccordionTrigger>Why pair Effect with Expo?</AccordionTrigger>
            <AccordionContent>
              Expo provides a productive route to native devices. Effect gives application code a
              disciplined model for failures, dependencies, concurrency, and observability.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="item-3">
            <AccordionTrigger>How can I follow along?</AccordionTrigger>
            <AccordionContent>
              Track the repository for the generated compatibility artifacts, capability package
              work, and the developer preview.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      <section {...stylex.props(styles.cta)}>
        <div {...stylex.props(styles.dotGrid, styles.dotGridLight)} />
        <div {...stylex.props(styles.ctaInner)}>
          <div {...stylex.props(styles.ctaCopy)}>
            <p {...stylex.props(styles.ctaLabel)}>better-native / 0.0.0</p>
            <h2 {...stylex.props(styles.ctaHeading)}>The reliable path to native.</h2>
          </div>
          <a
            {...stylex.props(buttonVariants({ size: "lg", variant: "secondary" }))}
            href={githubUrl}
            rel="noreferrer"
            target="_blank"
          >
            View the repository
            <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </div>
      </section>

      <footer {...stylex.props(styles.footer)}>
        <Wordmark />
        <p>Open source · MIT licensed</p>
      </footer>
    </main>
  )
}

export default LandingPrototype
