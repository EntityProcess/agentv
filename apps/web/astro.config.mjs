import cloudflare from '@astrojs/cloudflare';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://agentv.dev',
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [
    starlight({
      title: 'agent v',
      head: [
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://fonts.googleapis.com',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://fonts.gstatic.com',
            crossorigin: true,
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap',
          },
        },
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/EntityProcess/agentv' },
      ],
      sidebar: [
        { label: 'Getting Started', autogenerate: { directory: 'docs/getting-started' } },
        { label: 'Evaluation', autogenerate: { directory: 'docs/evaluation' } },
        { label: 'Evaluators', autogenerate: { directory: 'docs/evaluators' } },
        { label: 'Targets', autogenerate: { directory: 'docs/targets' } },
        { label: 'Tools', autogenerate: { directory: 'docs/tools' } },
        { label: 'Guides', autogenerate: { directory: 'docs/guides' } },
        { label: 'Integrations', autogenerate: { directory: 'docs/integrations' } },
        { label: 'Reference', autogenerate: { directory: 'docs/reference' } },
      ],
      editLink: {
        baseUrl: 'https://github.com/EntityProcess/agentv/edit/main/apps/web/',
      },
      customCss: ['./src/styles/custom.css'],
      components: {
        Hero: './src/components/Hero.astro',
      },
    }),
  ],
});
