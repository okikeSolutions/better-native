import * as ManagedRuntime from "effect/ManagedRuntime"
import { live } from "./ConfigurationLive.ts"

/** The compatibility app owns one runtime for its entire JavaScript lifetime. */
export const runtime = ManagedRuntime.make(live)
