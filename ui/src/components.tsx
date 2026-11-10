import type { RideStatus } from './api';

const LABELS: Record<RideStatus, string> = {
  requested: 'Solicitada',
  accepted: 'Aceita',
  in_progress: 'Em andamento',
  finished: 'Finalizada',
};

export function StatusBadge({ status }: { status: RideStatus }) {
  return (
    <span className={`status status-${status}`} data-testid="status">
      {LABELS[status]}
    </span>
  );
}

export function ErrorMessage({
  message,
  testId,
  sticky = false,
}: {
  message?: string;
  testId?: string;
  sticky?: boolean;
}) {
  if (!message) return null;
  return (
    <p role="alert" className={sticky ? 'error sticky' : 'error'} data-testid={testId}>
      {message}
    </p>
  );
}
