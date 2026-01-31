import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import cloudflare from "@astrojs/cloudflare"

export default defineConfig({
  site: "https://agentv.dev",
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  integrations: [
    starlight({
      title: "AgentV",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/EntityProcess/agentv" },
      ],
      sidebar: [
        { label: "Getting Started", autogenerate: { directory: "getting-started" } },
        { label: "Evaluation", autogenerate: { directory: "evaluation" } },
        { label: "Evaluators", autogenerate: { directory: "evaluators" } },
        { label: "Targets", autogenerate: { directory: "targets" } },
        { label: "Tools", autogenerate: { directory: "tools" } },
      ],
      editLink: {
        baseUrl: "https://github.com/EntityProcess/agentv/edit/main/apps/web/",
      },
      customCss: ["./src/styles/custom.css"],
      components: {
        Hero: "./src/components/Hero.astro",
      },
    }),
  ],
})
