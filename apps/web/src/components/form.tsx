// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Form building blocks shared by the auth pages, the setup wizard, and Settings, styled after the design's inputs
 * (`$input` fill, `$border-input` stroke) in two sizes: `lg` (42 px, auth pages and wizard) and `sm` (32 px,
 * settings rows). Labels are real `<label>`s; errors are announced (`role="alert"`) and linked with
 * `aria-describedby`.
 */
import { CircleAlert, LoaderCircle } from 'lucide-react';
import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

export type ControlSize = 'lg' | 'sm';

const CONTROL: Readonly<Record<ControlSize, string>> = {
  lg: 'h-[42px] rounded-[9px] px-3 text-[14px]',
  sm: 'h-8 rounded-[7px] px-2.5 text-[12.5px]',
};

const CONTROL_BASE =
  'w-full min-w-0 border border-border-input bg-input text-fg outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-red disabled:text-text-disabled';

export interface FieldProps {
  label: string;
  /** Next to the label, right-aligned (e.g. "Lupa kata sandi?"). */
  aside?: ReactNode;
  /** Shown under the control (e.g. "Min. 10 karakter"). */
  hint?: ReactNode;
  error?: string | null;
  children: (control: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** A label, one control (rendered by `children` with the ids it needs), and its hint or error. */
export function Field({ label, aside, hint, error = null, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const hasMessage = error !== null || hint !== undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[12.5px] font-medium text-muted-fg">
          {label}
        </label>
        {aside}
      </div>
      {children({ id, describedBy: hasMessage ? messageId : undefined, invalid: error !== null })}
      {error === null ? (
        hint === undefined ? null : (
          <div id={messageId} className="text-[12px] text-subtle">
            {hint}
          </div>
        )
      ) : (
        <p id={messageId} role="alert" className="flex items-start gap-1.5 text-[12px] text-red-fg">
          <CircleAlert aria-hidden="true" className="mt-px size-[13px] shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** A frame that looks like a text input, for controls that draw no border themselves (`AmountInput` inline). */
export const INPUT_FRAME: Readonly<Record<ControlSize, string>> = {
  lg: 'flex h-[42px] w-full min-w-0 items-center rounded-[9px] border border-border-input bg-input px-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:text-text-disabled',
  sm: 'flex h-8 w-full min-w-0 items-center rounded-[7px] border border-border-input bg-input px-2.5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
};

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
}

export function TextInput({ size = 'lg', className = '', ...props }: TextInputProps) {
  return <input {...props} className={`${CONTROL_BASE} ${CONTROL[size]} ${className}`} />;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize;
}

export function Select({ size = 'lg', className = '', children, ...props }: SelectProps) {
  return (
    <select {...props} className={`${CONTROL_BASE} ${CONTROL[size]} ${className}`}>
      {children}
    </select>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

const BUTTON_VARIANT: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-fg font-semibold text-primary-fg hover:bg-text-strong',
  secondary: 'border border-border font-medium text-fg hover:bg-muted',
  destructive: 'bg-red font-semibold text-on-accent hover:bg-red-fg',
  ghost: 'font-medium text-muted-fg hover:bg-muted hover:text-fg',
};

const BUTTON_SIZE: Readonly<Record<ControlSize, string>> = {
  lg: 'h-[42px] rounded-[9px] px-4 text-[14px]',
  sm: 'h-[30px] rounded-[8px] px-3 text-[12.5px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Shows a spinner, disables the button, and marks it busy. */
  pending?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'lg',
  pending = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending}
      className={`inline-flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`}
    >
      {pending ? <LoaderCircle aria-hidden="true" className="size-3.5 motion-safe:animate-spin" /> : null}
      {children}
    </button>
  );
}

/** A form-level error (not tied to one field), e.g. "Akun dikunci sampai 16.52". */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-[8px] bg-red-tint-2 px-3 py-2 text-[12.5px] text-red-fg">
      <CircleAlert aria-hidden="true" className="mt-px size-[14px] shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A success note, e.g. "Email terkirim". */
export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-[8px] bg-green-tint-2 px-3 py-2 text-[12.5px] text-green-fg">
      {children}
    </p>
  );
}
