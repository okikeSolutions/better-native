import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { MetroConfig } from "@expo/metro-config";
export type ResolutionMode = "upstream" | "candidate";
export type ResolutionDecision = "upstream" | "candidate" | "self-upstream" | "unmanaged";
export type ResolutionOutcome = {
    readonly kind: "source-file";
    readonly filePath: string;
} | {
    readonly kind: "asset-files";
    readonly filePaths: ReadonlyArray<string>;
} | {
    readonly kind: "empty";
} | {
    readonly kind: "failure";
    readonly name: string;
    readonly message: string;
};
export interface ResolutionEvent {
    readonly runId: string;
    readonly buildId: string;
    readonly ownershipFingerprint: string | null;
    readonly mode: ResolutionMode;
    readonly specifier: string;
    readonly replacement: string | null;
    readonly decision: ResolutionDecision;
    readonly originModulePath: string;
    readonly originPackage: string | null;
    readonly platform: string | null;
    readonly environment: string | null;
    readonly isEsmImport: boolean | null;
    readonly conditions: ReadonlyArray<string>;
    readonly mainFields: ReadonlyArray<string>;
    readonly sourceExtensions: ReadonlyArray<string>;
    readonly preferNativePlatform: boolean;
    readonly outcome: ResolutionOutcome;
    readonly resolvedTarget: string | ReadonlyArray<string> | null;
    readonly resolvedPackage: string | null;
}
export interface Replacement {
    readonly source: string;
    readonly target: string;
}
export interface BetterNativeMetroOptions {
    readonly runId: string;
    readonly buildId: string;
    readonly mode: ResolutionMode;
    /** Fingerprint of the ownership policy that produced `replacements`. */
    readonly ownershipFingerprint?: string;
    readonly replacements: ReadonlyArray<Replacement>;
    /** node_modules produced from the exact pinned Expo worktree. */
    readonly upstreamNodeModulesPath: string;
    readonly trackedSpecifiers?: ReadonlyArray<string>;
    readonly onResolution?: (event: ResolutionEvent) => void;
}
export interface ResolutionRequest {
    readonly mode: ResolutionMode;
    readonly specifier: string;
    readonly originPackage: string | null;
}
export interface ResolutionDirective {
    readonly decision: ResolutionDecision;
    readonly requestedSpecifier: string;
    readonly replacement: string | null;
}
declare const MetroConfigurationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "MetroConfigurationError";
} & Readonly<A>;
export declare class MetroConfigurationError extends MetroConfigurationError_base<{
    readonly cause: unknown;
}> {
}
declare const ResolutionPolicy_base: Context.ServiceClass<ResolutionPolicy, "@better-native/metro/ResolutionPolicy", {
    readonly resolve: (request: ResolutionRequest) => Effect.Effect<ResolutionDirective>;
    readonly runId: string;
    readonly buildId: string;
    readonly ownershipFingerprint: string | null;
    readonly mode: ResolutionMode;
    readonly upstreamNodeModulesPath: string;
}>;
export declare class ResolutionPolicy extends ResolutionPolicy_base {
}
declare const ResolutionObserver_base: Context.ServiceClass<ResolutionObserver, "@better-native/metro/ResolutionObserver", {
    readonly observe: (event: ResolutionEvent) => Effect.Effect<void>;
}>;
export declare class ResolutionObserver extends ResolutionObserver_base {
}
export declare const layer: (options: BetterNativeMetroOptions) => Layer.Layer<ResolutionPolicy | ResolutionObserver, MetroConfigurationError>;
export declare const make: (config: MetroConfig) => Effect.Effect<MetroConfig, MetroConfigurationError, ResolutionPolicy | ResolutionObserver>;
export declare const configure: (config: MetroConfig, options: BetterNativeMetroOptions) => Effect.Effect<MetroConfig, MetroConfigurationError>;
/** Synchronous Metro entrypoint. Effect programs stay behind this reviewed boundary. */
export declare const withBetterNative: (config: MetroConfig, options: BetterNativeMetroOptions) => MetroConfig;
export {};
