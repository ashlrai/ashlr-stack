import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import { agentIndex } from "./scripts/agent-index.mjs";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://stack.ashlr.ai",
  trailingSlash: "never",
  integrations: [
    agentIndex(),
    react(),
    mdx(),
    sitemap({
      changefreq: "weekly",
      priority: 0.7,
      filter: (page) => !/\/launch\/(hn|twitter)\/?$/.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    port: 4321,
    host: true,
  },
});
