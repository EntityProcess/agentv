import { DEFAULT_APP_NAME } from '~/lib/api';

export function BrandName({ appName }: { appName: string }) {
  if (appName !== DEFAULT_APP_NAME) {
    return <span className="av-brand-name">{appName}</span>;
  }

  return (
    <span className="av-brand-name">
      agent<span className="text-cyan-400">v</span>
    </span>
  );
}
