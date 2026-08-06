import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import ts from "typescript"
import { sanitizeDiagnostics } from "./CompileDiagnostics.ts"
import { readStdinJson, decodeSupervisorRequest } from "./Protocol.ts"
import { makeRunnerRuntime } from "./Runtime.ts"

const runtime = makeRunnerRuntime()
try {
  const { observation, request } = await runtime.runPromise(
    Effect.gen(function* () {
      const supervisorRequest = decodeSupervisorRequest(yield* readStdinJson)
      const compileObservation = yield* Effect.sync(() => {
        const options: ts.CompilerOptions = {
          allowImportingTsExtensions: true,
          exactOptionalPropertyTypes: true,
          module: ts.ModuleKind.NodeNext,
          moduleDetection: ts.ModuleDetectionKind.Force,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          noEmit: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          strict: true,
          target: ts.ScriptTarget.ES2022,
          verbatimModuleSyntax: true,
        }
        const contractFileName = "/workspace/public-contract.ts"
        const contractSource = Match.value(supervisorRequest.publicCompileContract).pipe(
          Match.when(undefined, () => undefined),
          Match.when({ kind: "effect-no-requirements" }, ({ exportName }) =>
            [
              'import type * as Effect from "effect/Effect"',
              `import { ${exportName} as candidate } from ${JSON.stringify(`./${supervisorRequest.entrypoint.replace(/^\/workspace\//, "")}`)}`,
              "type Requirements<T> = T extends Effect.Effect<unknown, unknown, infer R> ? R : never",
              "type AssertNever<T extends never> = T",
              "type ExportMustHaveNoServiceRequirements = AssertNever<Requirements<typeof candidate>>",
            ].join("\n"),
          ),
          Match.exhaustive,
        )
        const host = ts.createCompilerHost(options)
        const getSourceFile = host.getSourceFile.bind(host)
        const fileExists = host.fileExists.bind(host)
        const readFile = host.readFile.bind(host)
        host.fileExists = (fileName) =>
          (contractSource !== undefined && fileName === contractFileName) || fileExists(fileName)
        host.readFile = (fileName) =>
          contractSource !== undefined && fileName === contractFileName
            ? contractSource
            : readFile(fileName)
        host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
          contractSource !== undefined && fileName === contractFileName
            ? ts.createSourceFile(fileName, contractSource, languageVersion, true)
            : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        const program = ts.createProgram({
          rootNames: [
            supervisorRequest.entrypoint,
            ...(contractSource === undefined ? [] : [contractFileName]),
          ],
          options,
          host,
        })
        const sanitized = sanitizeDiagnostics(ts.getPreEmitDiagnostics(program))
        return {
          schemaVersion: 1,
          kind: "compile" as const,
          status: sanitized.diagnostics.some((diagnostic) => diagnostic.category === "error")
            ? ("failed" as const)
            : ("passed" as const),
          diagnostics: sanitized.diagnostics,
          truncated: sanitized.truncated,
        }
      })
      return { request: supervisorRequest, observation: compileObservation }
    }),
  )
  process.stdout.write(
    `BETTER_NATIVE_OBSERVATION:${request.nonce}:${JSON.stringify(observation)}\n`,
  )
} finally {
  await runtime.dispose()
}
