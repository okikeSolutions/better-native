import { useEffect, useState, type ComponentProps } from "react"
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
      <div className="font-mono text-[11px] leading-6 text-muted-foreground sm:text-xs">
        <p>
          <span className="text-primary">import</span> &#123; Effect, Schema &#125;{" "}
          <span className="text-primary">from</span>{" "}
          <span className="text-foreground">"effect"</span>
        </p>
        <p className="mt-4 text-foreground">const device = Effect.gen(function* () &#123;</p>
        <p className="pl-4">
          const battery = <span className="text-primary">yield*</span> Device.battery
        </p>
        <p className="pl-4">return Schema.decodeUnknown(Battery)(battery)</p>
        <p className="text-foreground">&#125;)</p>
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
      <div className="font-mono text-[11px] leading-6 text-muted-foreground sm:text-xs">
        <p>
          <span className="text-primary">expo-device</span> / battery adapter
        </p>
        <p className="mt-4 text-foreground">request: native module</p>
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
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-4 font-mono text-xs">
        <CheckIcon className="size-4 text-primary" />
        <span className="text-foreground">Battery: 82%</span>
        <span className="ml-auto text-muted-foreground">verified</span>
      </div>
    ),
  },
] as const

type RuntimePhase = (typeof runtimePhases)[number]["id"]

const isRuntimePhase = (value: string): value is RuntimePhase =>
  runtimePhases.some((phase) => phase.id === value)

function Wordmark() {
  return (
    <a
      aria-label="Better Native home"
      className="group flex items-center gap-2.5 font-medium tracking-[-0.04em]"
      href="#top"
    >
      <span className="relative grid size-9 overflow-hidden rounded-[0.65rem] transition-transform duration-300 group-hover:rotate-[-6deg]">
        <img
          alt=""
          className="size-full scale-[1.7] object-cover mix-blend-screen"
          src="/better-native-logo.png"
        />
      </span>
      <span className="text-[15px]">Better Native</span>
    </a>
  )
}

function RuntimePreview() {
  const [phase, setPhase] = useState<RuntimePhase>("resolve")
  const activePhase = runtimePhases.find((item) => item.id === phase) ?? runtimePhases[0]

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
    <div
      className="runtime-stage grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,22rem)] lg:items-center lg:gap-10"
      data-phase={phase}
    >
      <div className="runtime-shell relative overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Compatibility harness
          </div>
          <Badge variant="outline">{activePhase.traceLabel}</Badge>
        </div>

        <Tabs
          className="gap-0"
          onValueChange={(value) => {
            if (isRuntimePhase(value)) setPhase(value)
          }}
          value={phase}
        >
          <TabsList className="mx-4 mt-4 sm:mx-5" variant="line">
            {runtimePhases.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {runtimePhases.map((item) => (
            <TabsContent
              className="runtime-content m-0 px-4 pb-5 pt-4 sm:px-5"
              key={item.id}
              value={item.id}
            >
              {item.code}
            </TabsContent>
          ))}
        </Tabs>

        <div className="grid grid-cols-3 border-t border-border text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {runtimePhases.map((item, index) => (
            <div className="relative px-2 py-3" data-active={item.id === phase} key={item.id}>
              {index < runtimePhases.length - 1 ? (
                <span className="absolute inset-y-0 right-0 w-px bg-border" />
              ) : null}
              <span className="text-primary">{item.index}</span> {item.label}
            </div>
          ))}
        </div>
      </div>

      <div className="iphone-wrap mx-auto w-44 sm:w-64 lg:mx-0 lg:w-[22rem]" data-phase={phase}>
        <div className="iphone-mockup relative aspect-[0.502]">
          <svg className="phone-chassis absolute inset-0 size-full" viewBox="0 0 366 729">
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
              <div className="iphone-screen flex size-full flex-col bg-card px-4 pb-4 pt-8 lg:px-7 lg:pb-7 lg:pt-14">
                <div className="flex items-center justify-between font-mono text-[8px] text-muted-foreground lg:text-[10px]">
                  <span>9:41</span>
                  <span>5G</span>
                </div>
                <div className="mt-7 lg:mt-12">
                  <p className="text-[10px] font-medium text-foreground lg:text-base">
                    Effect Mobile
                  </p>
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground lg:mt-2 lg:text-[10px]">
                    native trace
                  </p>
                </div>
                <div className="device-orb mx-auto mt-7 grid size-20 place-items-center rounded-full border border-border bg-background lg:mt-12 lg:size-40">
                  {phase === "result" ? (
                    <CheckIcon className="size-7 text-primary lg:size-14" />
                  ) : (
                    <OrbitIcon className="size-7 text-primary lg:size-14" />
                  )}
                </div>
                <div className="mt-6 lg:mt-10">
                  <p className="text-xs font-medium leading-tight text-foreground lg:text-xl">
                    {activePhase.deviceTitle}
                  </p>
                  <p className="mt-2 text-[10px] leading-4 text-muted-foreground lg:mt-4 lg:text-xs lg:leading-5">
                    {activePhase.deviceDescription}
                  </p>
                </div>
                <div className="device-meter mt-5 h-1.5 overflow-hidden rounded-full bg-muted lg:mt-8 lg:h-3">
                  <span />
                </div>
                <div className="mt-3 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground lg:mt-5 lg:text-[10px]">
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
    <main id="top" className="overflow-x-clip bg-background text-foreground">
      <section className="landing-hero relative isolate min-h-svh overflow-hidden">
        <div className="pointer-events-none absolute inset-0 dot-grid opacity-50" />

        <header className="relative z-10 mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Wordmark />
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a className="transition-colors hover:text-foreground" href="#foundation">
              Foundation
            </a>
            <a className="transition-colors hover:text-foreground" href="#roadmap">
              Roadmap
            </a>
          </nav>
          <a
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href={githubUrl}
            rel="noreferrer"
            target="_blank"
          >
            <GitHubLogo data-icon="inline-start" />
            GitHub
          </a>
        </header>

        <div className="relative mx-auto max-w-7xl px-5 pb-12 pt-12 sm:px-8 lg:pb-20 lg:pt-16">
          <div className="max-w-5xl">
            <Badge variant="secondary">
              <SparklesIcon data-icon="inline-start" />
              Building in public
            </Badge>
            <p className="mt-8 text-sm font-medium tracking-[-0.02em] text-muted-foreground">
              Effect × Expo
            </p>
            <h1 className="mt-3 max-w-5xl text-balance text-5xl font-semibold leading-[0.92] tracking-[-0.075em] sm:text-6xl lg:text-7xl">
              Reliable Expo APIs, <span className="text-primary">by construction.</span>
            </h1>
            <p className="mt-7 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
              Effect-native APIs for Expo, starting with a compatibility suite that validates the
              native surface before you build on it.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a
                className={buttonVariants({ size: "lg" })}
                href={githubUrl}
                rel="noreferrer"
                target="_blank"
              >
                <GitHubLogo data-icon="inline-start" />
                Follow the project
                <ArrowUpRightIcon data-icon="inline-end" />
              </a>
              <a className={buttonVariants({ size: "lg", variant: "outline" })} href="#foundation">
                Explore the harness
                <ArrowDownRightIcon data-icon="inline-end" />
              </a>
            </div>
            <dl className="mt-8 grid max-w-2xl border-y border-border font-mono text-[10px] uppercase tracking-[0.11em] sm:grid-cols-3">
              <div className="py-3 sm:pr-4">
                <dt className="text-muted-foreground">Pinned runtime</dt>
                <dd className="mt-1 text-foreground">Effect 4 beta</dd>
              </div>
              <div className="border-t border-border py-3 sm:border-l sm:border-t-0 sm:px-4">
                <dt className="text-muted-foreground">Target SDK</dt>
                <dd className="mt-1 text-foreground">Expo 57</dd>
              </div>
              <div className="border-t border-border py-3 sm:border-l sm:border-t-0 sm:pl-4">
                <dt className="text-muted-foreground">Current work</dt>
                <dd className="mt-1 text-primary">Compatibility baseline</dd>
              </div>
            </dl>
          </div>

          <div className="relative ml-auto mt-12 w-full max-w-5xl lg:mt-16">
            <RuntimePreview />
            <div className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <OrbitIcon className="size-3 text-primary" />
              The same execution model, from device to service.
            </div>
          </div>
        </div>
      </section>

      <section id="foundation" className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-7xl lg:grid-cols-[0.7fr_1.3fr]">
          <div className="flex min-h-56 flex-col justify-between border-b border-border p-6 sm:p-8 lg:min-h-80 lg:border-b-0 lg:border-r lg:p-10">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              01 / Foundation
            </span>
            <p className="max-w-56 text-xl font-medium leading-tight tracking-[-0.04em]">
              Compatibility is a feature, not a footnote.
            </p>
          </div>
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:p-10">
            <div>
              <h2 className="max-w-xl text-balance text-3xl font-medium leading-tight tracking-[-0.055em] sm:text-4xl">
                A disciplined bridge between Effect and the Expo ecosystem.
              </h2>
              <p className="mt-5 max-w-xl leading-7 text-muted-foreground">
                The harness tests a concrete baseline against pinned revisions before capability
                packages are introduced.
              </p>
            </div>
            <div className="grid gap-3 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">runtime</span>
                <span>Effect 4.0 beta</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">platform</span>
                <span>Expo 57</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">status</span>
                <span className="text-primary">establishing baseline</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            The operating model
          </span>
          <h2 className="mt-5 text-balance text-3xl font-medium tracking-[-0.055em] sm:text-5xl">
            One predictable path from native work to application code.
          </h2>
        </div>
        <div className="mt-14 grid border-y border-border md:grid-cols-3">
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
            <article
              className="group border-b border-border py-8 last:border-b-0 md:border-b-0 md:px-7 md:first:pl-0 md:last:pr-0 md:not(:last-child):border-r"
              key={title}
            >
              <span className="font-mono text-xs text-primary">{number}</span>
              <h3 className="mt-10 text-2xl font-medium tracking-[-0.045em] transition-transform duration-300 group-hover:translate-x-1">
                {title}
              </h3>
              <p className="mt-3 max-w-xs leading-7 text-muted-foreground">{body}</p>
              {index < 2 ? (
                <ArrowDownRightIcon className="mt-8 size-5 text-muted-foreground transition-colors group-hover:text-primary" />
              ) : (
                <CheckIcon className="mt-8 size-5 text-primary" />
              )}
            </article>
          ))}
        </div>
      </section>

      <section id="roadmap" className="border-y border-border bg-card">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              02 / Roadmap
            </span>
            <h2 className="mt-5 max-w-md text-balance text-3xl font-medium tracking-[-0.055em] sm:text-4xl">
              Build the base once. Let every capability inherit it.
            </h2>
          </div>
          <ol className="border-t border-border">
            {[
              [
                "Now",
                "Compatibility harness",
                "Pinned revisions, generated manifest, and an executable suite.",
              ],
              [
                "Next",
                "Capability packages",
                "Small, explicit APIs around native and Expo features.",
              ],
              [
                "Then",
                "Developer preview",
                "A stable surface for application teams to evaluate in production.",
              ],
            ].map(([status, title, body]) => (
              <li
                className="grid gap-4 border-b border-border py-7 sm:grid-cols-[7rem_1fr_auto] sm:items-center"
                key={title}
              >
                <Badge variant={status === "Now" ? "default" : "outline"}>{status}</Badge>
                <div>
                  <h3 className="text-lg font-medium tracking-[-0.035em]">{title}</h3>
                  <p className="mt-1 leading-6 text-muted-foreground">{body}</p>
                </div>
                <CircleIcon className="hidden size-3 text-primary sm:block" fill="currentColor" />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Questions, before code
          </span>
          <h2 className="mt-5 text-balance text-3xl font-medium tracking-[-0.055em] sm:text-4xl">
            A small surface, with deliberate decisions.
          </h2>
        </div>
        <Accordion>
          <AccordionItem value="item-1">
            <AccordionTrigger>Is this ready for production?</AccordionTrigger>
            <AccordionContent>
              Not yet. The project is establishing the compatibility harness before it exposes
              capability packages. The landing page reflects that early, evidence-first stage.
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

      <section className="relative overflow-hidden border-t border-border bg-primary px-5 py-20 text-primary-foreground sm:px-8 sm:py-28">
        <div className="absolute inset-0 opacity-20 dot-grid" />
        <div className="relative mx-auto flex max-w-7xl flex-col items-start justify-between gap-10 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary-foreground/65">
              better-native / 0.0.0
            </p>
            <h2 className="mt-4 text-balance text-4xl font-semibold leading-[0.98] tracking-[-0.065em] sm:text-6xl">
              The reliable path to native.
            </h2>
          </div>
          <a
            className={buttonVariants({ size: "lg", variant: "secondary" })}
            href={githubUrl}
            rel="noreferrer"
            target="_blank"
          >
            View the repository
            <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Wordmark />
        <p>Open source · MIT licensed</p>
      </footer>
    </main>
  )
}

export default LandingPrototype
