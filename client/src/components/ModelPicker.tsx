import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { listChatModelsFn, type ChatModelOption } from '#/data/server-functions/models';

/**
 * Per-conversation model switcher for the interactive chat surfaces.
 *
 * The options come from a server function (`listChatModelsFn`) that enumerates
 * what is actually installed on the local Ollama host, so the list reflects
 * reality rather than the three ids pinned in env.ts. The frontier entry only
 * appears when ANTHROPIC_API_KEY is configured — the browser learns that an
 * option exists, never the key.
 *
 * `value` is a CHOICE TOKEN ('default' | 'local:<id>' | 'frontier'), not a model
 * id: the server validates it against the installed catalogue before building
 * an adapter, so a token from a stale tab cannot select an uninstalled model.
 *
 * Shape and styling mirror SkillPicker in VideoChat.tsx deliberately — these
 * two controls sit side by side in the same header.
 */
export function ModelPicker({
  surface,
  value,
  onChange,
  disabled,
}: Readonly<{
  surface: string;
  value: string;
  onChange: (token: string) => void;
  disabled: boolean;
}>) {
  const [options, setOptions] = useState<ChatModelOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listChatModelsFn({ data: surface })
      .then((opts) => {
        if (!cancelled) setOptions(opts);
      })
      .catch(() => {
        // Ollama unreachable or the call failed — fall back to the single
        // default entry so the picker still renders and chat still works.
        if (!cancelled) {
          setOptions([
            { token: 'default', label: 'Default', tier: 'local', isDefault: true },
          ]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [surface]);

  const active = options?.find((o) => o.token === value);
  const label = active?.label ?? 'Default';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || !options}
        className={
          'inline-flex h-8 items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 text-xs font-medium text-[var(--ink)] transition focus:outline-none focus:border-[var(--line-strong)] ' +
          (disabled || !options
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:border-[var(--line-strong)]')
        }
        aria-label={`Model: ${label}`}
        title={
          active?.tier === 'frontier'
            ? 'Hosted model — this request leaves your machine'
            : 'Local model — runs on your Ollama host'
        }
      >
        {active?.tier === 'frontier' && (
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
          />
        )}
        <span className="max-w-[14rem] truncate">{label}</span>
        <svg
          viewBox="0 0 20 20"
          className="h-3 w-3 text-[var(--ink-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {(options ?? []).map((opt) => (
            <DropdownMenuRadioItem
              key={opt.token}
              value={opt.token}
              className="flex flex-col items-start gap-0.5 px-2 py-1.5"
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
                {opt.tier === 'frontier' && (
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                  />
                )}
                {opt.label}
              </span>
              <span className="text-[0.65rem] leading-snug text-[var(--ink-muted)]">
                {opt.tier === 'frontier'
                  ? `hosted${opt.detail && opt.detail !== 'hosted' ? ` · ${opt.detail}` : ''} — leaves your machine`
                  : `local${opt.detail ? ` · ${opt.detail}` : ''}`}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
