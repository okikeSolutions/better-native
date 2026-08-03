import type { VercelConfig } from "@vercel/config/v1"

export const config: VercelConfig = {
  framework: "astro",
  // Vercel may initialize repository submodules during checkout. Landing does
  // not consume them, so remove their worktrees before installing packages.
  installCommand: "git submodule deinit -f --all || true; bun install",
  buildCommand: "bun run build",
}
