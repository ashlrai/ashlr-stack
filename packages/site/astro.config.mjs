import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";
import { agentIndex } from "./scripts/agent-index.mjs";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { createGitLastmod } from "./scripts/sitemap-lastmod.mjs";

const gitLastmod = createGitLastmod(fileURLToPath(new URL("../../", import.meta.url)));

// https://astro.build/config
export default defineConfig({
  site: "https://stack.ashlr.ai",
  trailingSlash: "never",
  integrations: [
    agentIndex(),
    react(),
    mdx(),
    sitemap({
      filter: (page) => !/\/launch\/(hn|twitter)\/?$/.test(page),
      serialize: (page) => ({ ...page, lastmod: gitLastmod(page.url) }),
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
