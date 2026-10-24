import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

const control =
  'block w-full rounded border border-border-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-muted/70 ' +
  'transition-colors hover:border-fg-muted/50 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-[invalid=true]:border-danger';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}
export function Input({ className, ...rest }: InputProps) {
  return <input className={cn(control, 'h-9', className)} {...rest} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}
export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  return <textarea rows={rows} className={cn(control, 'py-2 leading-relaxed', className)} {...rest} />;
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
  options?: readonly SelectOption[];
  /** Adds an empty first option with this label. */
  placeholder?: string;
}
export function Select({ className, options, placeholder, children, ...rest }: SelectProps) {
  return (
    <select className={cn(control, 'h-9 pr-8', className)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}
export function Checkbox({ label, description, id, className, ...rest }: CheckboxProps) {
  const descId = description && id ? `${id}-desc` : undefined;
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={descId}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong bg-surface accent-[#22D3EE]"
        {...rest}
      />
      <div>
        <label htmlFor={id} className="text-sm text-fg">
          {label}
        </label>
        {description && (
          <p id={descId} className="text-xs text-fg-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

export interface FieldProps {
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** Render prop receives the accessibility wiring for the control. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label + control + help + error, wired with aria-describedby / aria-invalid. */
export function Field({ id, label, help, error, required, className, children }: FieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })}
      {help && (
        <p id={helpId} className="text-xs text-fg-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
