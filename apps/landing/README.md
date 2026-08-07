# Better Native landing site

The public landing page for Better Native. It is an Astro application with a React island for the
interactive product presentation, Tailwind CSS for styling, and static social/share assets under
`public/`.

## Local development

Install the monorepo from the repository root, then run the app from this directory:

```sh
bun install
cd apps/landing
bun run dev
```

Astro serves the development site at `http://localhost:4321` by default.

## Commands

| Command              | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `bun run dev`        | Start Astro's development server.            |
| `bun run build`      | Build the static production site to `dist/`. |
| `bun run typecheck`  | Run Astro and TypeScript checks.             |
| `bun run preview`    | Preview the production build locally.        |
| `bun run astro -- …` | Run another Astro CLI command.               |

From the repository root, `bun run landing:check` builds this workspace through Turbo. The root
`bun run check` command includes that production build.

## Structure

```text
public/                          Favicons, social image, logo, and crawl metadata
src/pages/index.astro            Document shell and metadata
src/components/LandingPrototype.tsx
                                 Interactive landing-page content
src/components/ui/               Local UI primitives
src/styles/global.css            Theme, Tailwind entrypoint, and page motion
```

The canonical production URL and Open Graph metadata live in `src/pages/index.astro`. Keep the
`1200×630` social image, favicon set, canonical URL, and sitemap reference in sync when the brand or
deployment domain changes.
