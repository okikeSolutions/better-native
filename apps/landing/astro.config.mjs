// @ts-check
import { defineConfig } from "astro/config"

import react from "@astrojs/react"
import sitemap from "@astrojs/sitemap"
import stylex from "@stylexjs/unplugin"

// https://astro.build/config
export default defineConfig({
  site: "https://better-native.dev",
  integrations: [react(), sitemap()],

  vite: {
    plugins: [stylex.vite()],
  },
})
