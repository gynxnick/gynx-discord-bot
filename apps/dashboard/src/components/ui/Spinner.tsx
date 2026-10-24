import { cn } from './cn';

export function Spinner({
  size = 'md',
  label = 'Loading',
  className,
}: {
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}) {
  const dim = size === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5';
  return (
    <span role="status" className={cn('inline-flex items-center', className)}>
      <svg className={cn(dim, 'animate-spin')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
