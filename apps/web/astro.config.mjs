import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// Static builds can't redirect an open-ended `/docs/[...slug]` wildcard to
// v4.42.4 (that requires enumerable paths), so generate one concrete
// redirect per known v4.42.4 route from its route manifest instead.
const v4RoutesPath = fileURLToPath(new URL('./src/data/docs-v4.42.4-routes.json', import.meta.url));
const v4Routes = JSON.parse(readFileSync(v4RoutesPath, 'utf8'));
const v4Redirects = Object.fromEntries(
  v4Routes.map((route) => {
    const bareRoute = route.replace('/docs/v4.42.4/', '/docs/');
    const from = bareRoute === '/docs/' ? '/docs' : bareRoute.replace(/\/$/, '');
    return [from, route];
  }),
);

export default defineConfig({
  site: 'https://agentv.dev',
  image: { service: { entrypoint: 'astro/assets/services/noop' } },
  redirects: {
    '/docs/v4': '/docs/v4.42.4/',
    ...v4Redirects,
  },
  integrations: [
    starlight({
      title: 'AgentV',
      logo: {
        src: './src/assets/logo.svg',
        alt: 'AgentV mark',
      },
      components: {
        SiteTitle: './src/components/StarlightSiteTitle.astro',
        LanguageSelect: './src/components/VersionSelect.astro',
        Sidebar: './src/components/VersionedSidebar.astro',
      },
      disable404Route: true,
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
        { label: 'Getting Started', autogenerate: { directory: 'docs/next/getting-started' } },
        { label: 'Evaluation', autogenerate: { directory: 'docs/next/evaluation' } },
        { label: 'Graders', autogenerate: { directory: 'docs/next/graders' } },
        { label: 'Targets', autogenerate: { directory: 'docs/next/targets' } },
        { label: 'Tools', autogenerate: { directory: 'docs/next/tools' } },
        { label: 'Guides', autogenerate: { directory: 'docs/next/guides' } },
        { label: 'Integrations', autogenerate: { directory: 'docs/next/integrations' } },
        { label: 'Reference', autogenerate: { directory: 'docs/next/reference' } },
      ],
      editLink: {
        baseUrl: 'https://github.com/EntityProcess/agentv/edit/main/apps/web/',
      },
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
