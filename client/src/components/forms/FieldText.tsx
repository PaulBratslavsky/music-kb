import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import { cn } from '#/lib/utils';

// Minimal slice of TanStack's FieldApi we actually use. Typing against
// `AnyFieldApi` from @tanstack/react-form trips TS variance checks on
// FormListeners<any, any, ...> when concrete form value types get passed
// in — happens regardless of form generics, because the listener params
// are contravariant.
type FieldSlice = {
  name: string;
  state: {
    value: string | undefined;
    meta: { errors: unknown[]; isTouched: boolean };
  };
  handleChange: (value: string) => void;
  handleBlur: () => void;
};

type FieldTextProps = {
  field: FieldSlice;
  label: string;
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
};

export function FieldText({
  field,
  label,
  type = 'text',
  placeholder,
  autoComplete,
  disabled,
}: FieldTextProps) {
  const errors = field.state.meta.errors;
  const hasError = errors.length > 0 && field.state.meta.isTouched;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={field.name} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        value={field.state.value ?? ''}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        aria-invalid={hasError || undefined}
      />
      {hasError && (
        <p className={cn('text-xs text-destructive')}>
          {errors
            .map((e: unknown) =>
              typeof e === 'string' ? e : (e as { message?: string })?.message,
            )
            .filter(Boolean)
            .join(' • ')}
        </p>
      )}
    </div>
  );
}
