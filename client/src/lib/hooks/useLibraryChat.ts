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
import {
  friendlyStreamError,
  streamChatSSE,
  type Citation,
} from '#/lib/services/chat-stream';

// The citation wire shape lives with the SSE transport; re-exported so
// existing consumers (LibraryChat) keep importing it from the hook.
export type { Citation };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  /**
   * The model that ACTUALLY answered, reported by the server.
   *
   * Recorded per-message rather than read from the picker so the label cannot
   * drift from the answer: switching models mid-conversation must not relabel
   * older replies, and a refused choice (uninstalled id, missing key) shows the
   * model that really ran rather than the one that was asked for.
   */
  answeredBy?: string;
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
    modelChoice: string;
    /** Prior turns, oldest first, EXCLUDING the question being asked. */
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  },
): Promise<void> {
  const { assistantId, setState, signal, modelChoice, history } = handlers;
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Choice TOKEN, not a model id — validated server-side against the
    // installed Ollama catalogue before an adapter is built.
    body: JSON.stringify({ question, modelChoice, history }),
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
      const answeredBy = event.model;
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, citations, answeredBy } : m,
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
  // Model choice is session state, deliberately NOT part of `Persisted`:
  // persisting it would silently restore a model choice made weeks ago —
  // including one whose model has since been removed from the Ollama host —
  // into a fresh conversation. Defaulting each session keeps the picker
  // honest about what is actually answering.
  const [modelChoice, setModelChoice] = useState<string>('default');
  // NOTE: `modelChoice` is deliberately NOT closed over by the mutation. It
  // travels as a mutation VARIABLE (see mutation.mutate below), so there is no
  // captured value that can go stale. A stale read here would fail invisibly —
  // the picker showing one model while another answers, with nothing thrown —
  // and a value with that failure mode should not depend on a closure being
  // refreshed at the right moment.

  useEffect(() => {
    savePersisted(state);
  }, [state]);

  const mutation = useMutation<
    void,
    Error,
    {
      question: string;
      assistantId: string;
      modelChoice: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
    }
  >({
    mutationFn: async ({ question, assistantId, modelChoice, history }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamAsk(question, {
          modelChoice,
          history,
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
      // A run failure is already translated by the model that answered
      // (stream-errors.ts). A transport failure is translated here, and
      // anything unrecognised passes through so we don't hide useful detail.
      const msg = friendlyStreamError(err, 'Ask failed');
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

      // Prior turns, captured BEFORE this question is appended and passed as a
      // mutation VARIABLE rather than closed over. Only completed messages with
      // real content: a failed or still-streaming assistant turn would send the
      // model a description of its own broken output as if it were an answer.
      const history = state.messages
        .filter((m) => m.status === 'done' && m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));

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

      mutation.mutate({ question: trimmed, assistantId, modelChoice, history });
    },
    [mutation, modelChoice, state.messages],
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
    modelChoice,
    setModelChoice,
  };
}
