import { surfaceProbes as generatedSurfaceProbes } from "./generated/SurfaceProbes"

export type SurfaceProbes = ReadonlyMap<string, () => unknown>

export const surfaceProbes = generatedSurfaceProbes
