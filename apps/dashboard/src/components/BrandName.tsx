import { DEFAULT_APP_NAME } from '~/lib/api';

export function BrandName({ appName }: { appName: string }) {
  if (appName !== DEFAULT_APP_NAME) {
    return <span className="av-brand-name">{appName}</span>;
  }

  return (
    <span className="av-brand-name" aria-label="AgentV">
      <span className="text-cyan-400" aria-hidden="true">
        A
      </span>
      <span aria-hidden="true">GENT</span>
      <span className="text-cyan-400" aria-hidden="true">
        V
      </span>
    </span>
  );
}
