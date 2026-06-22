import { DEFAULT_APP_NAME } from '~/lib/api';

export function BrandName({ appName }: { appName: string }) {
  if (appName !== DEFAULT_APP_NAME) {
    return <span className="av-brand-name">{appName}</span>;
  }

  return (
    <span className="av-brand-name" aria-label="AgentV">
      <span className="av-brand-name__letter" aria-hidden="true">
        A
      </span>
      <span className="av-brand-name__middle" aria-hidden="true">
        GENT
      </span>
      <span className="av-brand-name__letter" aria-hidden="true">
        V
      </span>
    </span>
  );
}
