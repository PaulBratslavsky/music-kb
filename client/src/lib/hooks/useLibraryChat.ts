// State + streaming hook for the library-wide chat panel. Lives outside
// any route so conversation survives navigation. Messages are persisted
// to localStorage (per-browser) — survives refresh but not cross-device.
//
// TanStack Query orchestrates the ask lifecycle (`useMutation`) so
// isPending / error / abort play nice with the rest of the app's
// data layer. Streaming text still lives in local React state because
// React Query's cache model isn't designed around partial stream
// deltas — the mutation gives us the control plane, we own the
// textual payload.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';
import { streamChatSSE, type Citation } from '#/lib/services/chat-stream';

// The citation wire shape lives with the SSE transport; re-exported so
// existing consumers (LibraryChat) keep importing it from the hook.
export type { Citation };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  status: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
};

type Persisted = {
  messages: ChatMessage[];
  isOpen: boolean;
};

const STORAGE_KEY = 'ytkb:library-chat:v1';

function loadPersisted(): Persisted {
  if (typeof window === 'undefined') return { messages: [], isOpen: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [], isOpen: false };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const messages = (parsed.messages ?? []).map((m) =>
      m.status === 'pending' || m.status === 'streaming'
        ? { ...m, status: 'error' as const, error: 'Interrupted by reload' }
        : m,
    );
    return { messages, isOpen: Boolean(parsed.isOpen) };
  } catch {
    return { messages: [], isOpen: false };
  }
}

function savePersisted(state: Persisted) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or access error — ignore. Chat still works in memory.
  }
}

function newId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// The streamer: issues the /api/ask fetch and maps typed stream events
// onto message state. Returned mutation resolves when the stream
// completes (or rejects on error/abort). The mutation's `isPending`
// mirrors "a question is in flight", which is what the UI cares about.
async function streamAsk(
  question: string,
  handlers: {
    assistantId: string;
    setState: React.Dispatch<React.SetStateAction<Persisted>>;
    signal: AbortSignal;
  },
): Promise<void> {
  const { assistantId, setState, signal } = handlers;
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  });

  // Wire framing + AG-UI parsing live in `chat-stream.ts` — including
  // non-OK body extraction and RUN_ERROR translation. This loop only
  // maps typed events onto message state.
  let accumulated = '';
  let citations: Citation[] = [];
  for await (const event of streamChatSSE(res)) {
    if (event.kind === 'citations') {
      citations = event.citations;
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, citations } : m,
        ),
      }));
    } else if (event.kind === 'text') {
      accumulated += event.delta;
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === assistantId
            ? { ...m, content: accumulated, status: 'streaming' }
            : m,
        ),
      }));
    }
  }

  setState((s) => ({
    ...s,
    messages: s.messages.map((m) =>
      m.id === assistantId
        ? { ...m, content: accumulated, citations, status: 'done' }
        : m,
    ),
  }));
}

export function useLibraryChat() {
  const [state, setState] = useState<Persisted>(() => loadPersisted());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    savePersisted(state);
  }, [state]);

  const mutation = useMutation<
    void,
    Error,
    { question: string; assistantId: string }
  >({
    mutationFn: async ({ question, assistantId }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAsk(question, {
          assistantId,
          setState,
          signal: controller.signal,
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    onError: (err, { assistantId }) => {
      // Aborted by user — state already cleaned up by caller.
      if (abortRef.current?.signal.aborted) return;
      const raw = err instanceof Error ? err.message : 'Ask failed';
      // Translate raw connection / model errors into a recovery hint.
      // Other failures pass through unchanged so we don't hide useful
      // error detail behind a generic message.
      const msg = friendlyOllamaError(raw);
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, status: 'error', error: msg } : m,
        ),
      }));
    },
  });

  const open = useCallback(() => {
    setState((s) => ({ ...s, isOpen: true }));
  }, []);
  const close = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);
  const toggle = useCallback(() => {
    setState((s) => ({ ...s, isOpen: !s.isOpen }));
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, messages: [] }));
  }, []);

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      const userMsg: ChatMessage = {
        id: newId(),
        role: 'user',
        content: trimmed,
        status: 'done',
      };
      const assistantId = newId();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        status: 'pending',
      };
      setState((s) => ({
        ...s,
        messages: [...s.messages, userMsg, assistantMsg],
      }));

      mutation.mutate({ question: trimmed, assistantId });
    },
    [mutation],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return {
    messages: state.messages,
    isOpen: state.isOpen,
    open,
    close,
    toggle,
    clear,
    ask,
    cancel,
    isStreaming: mutation.isPending,
  };
}
