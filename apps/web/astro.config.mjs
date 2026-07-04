import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const currentDocsRoot = fileURLToPath(new URL('./src/content/docs/docs/next', import.meta.url));

const currentRoutes = collectDocsRoutes(currentDocsRoot, '/docs');
const nextRedirects = Object.fromEntries(
  currentRoutes.map((route) => {
    const suffix = route === '/docs/' ? '' : route.slice('/docs/'.length);
    const from = suffix ? `/docs/next/${suffix}` : '/docs/next';
    return [from.replace(/\/$/, ''), route];
  }),
);

function collectDocsRoutes(root, base) {
  return collectMarkdownFiles(root)
    .map((file) => {
      const slug = getFrontmatterSlug(file);
      if (slug) return `/${slug.replace(/^\/|\/$/g, '')}/`;

      const relative = path.relative(root, file).replace(/\\/g, '/');
      const suffix = relative
        .replace(/\.mdx?$/, '')
        .replace(/(^|\/)index$/, '')
        .replace(/\/$/, '');
      return suffix ? `${base}/${suffix}/` : `${base}/`;
    })
    .sort();
}

function getFrontmatterSlug(file) {
  const source = readFileSync(file, 'utf8');
  return source
    .split('---')[1]
    ?.match(/^slug:\s*(.+)$/m)?.[1]
    ?.trim();
}

function collectMarkdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(fullPath);
    return /\.mdx?$/.test(entry.name) ? [fullPath] : [];
  });
}

export default defineConfig({
  site: 'https://agentv.dev',
  image: { service: { entrypoint: 'astro/assets/services/noop' } },
  redirects: {
    '/docs/v4': '/docs/v4.42.4/',
    ...nextRedirects,
  },
  integrations: [
    starlight({
      title: 'AgentV',
      logo: {
        src: './src/assets/logo.svg',
        alt: 'AgentV mark',
      },
      components: {
        Header: './src/components/Header.astro',
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
