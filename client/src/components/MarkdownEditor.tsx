// Controlled Tiptap editor that reads + writes markdown, with a
// top toolbar of common formatting controls.
//
// Tiptap's internal model is rich-text nodes; `tiptap-markdown` serializes
// to/from markdown at the boundary so storage stays markdown (matches
// the existing `api::note.note.body: richtext` field which holds markdown).
//
// External updates to `value` (e.g. AI streaming a new draft) are applied
// via `editor.commands.setContent()` only when the value actually diverges
// from the current editor content — avoids resetting the cursor on every
// keystroke-driven onChange round-trip.

import { useEffect } from 'react';
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Type,
  Undo,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';

type Props = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: string;
  className?: string;
  /** Show the top formatting toolbar. Default true. */
  toolbar?: boolean;
};

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  disabled,
  minHeight = '200px',
  className,
  toolbar = true,
}: Readonly<Props>) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        tightListClass: 'tight',
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: {
        class: `chat-md min-w-0 focus:outline-none ${className ?? ''}`,
        style: `min-height: ${minHeight}; padding: 0.75rem 0.9rem;`,
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = (
        ed.storage as unknown as { markdown: { getMarkdown: () => string } }
      ).markdown.getMarkdown();
      onChange(md);
    },
  });

  // Sync external `value` into the editor when it diverges. Critical
  // for AI-streaming: parent receives deltas from /api/notes/compose
  // and pushes the accumulating markdown in.
  useEffect(() => {
    if (!editor) return;
    const current = (
      editor.storage as unknown as { markdown: { getMarkdown: () => string } }
    ).markdown.getMarkdown();
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) {
    return (
      <div
        className={`rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] ${className ?? ''}`}
        style={{ minHeight }}
      />
    );
  }

  return (
    <div className={`overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--card)] ${className ?? ''}`}>
      {toolbar && <EditorToolbar editor={editor} disabled={disabled} />}
      <EditorContent editor={editor} />
    </div>
  );
}

// ===========================================================================
// Toolbar
// ===========================================================================

type ToolbarProps = {
  editor: Editor;
  disabled?: boolean;
};

function EditorToolbar({ editor, disabled }: Readonly<ToolbarProps>) {
  // Tiptap v3 — `useEditor()` alone doesn't trigger re-renders on
  // every transaction, so `editor.isActive(...)` reads go stale.
  // `useEditorState` is the v3 reactive-subscription primitive: the
  // selector re-runs on each transaction and forces a re-render when
  // its output changes. This is the official pattern for toolbars.
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return null;
      return {
        isBold: ed.isActive('bold'),
        isItalic: ed.isActive('italic'),
        isStrike: ed.isActive('strike'),
        isCode: ed.isActive('code'),
        isBulletList: ed.isActive('bulletList'),
        isOrderedList: ed.isActive('orderedList'),
        isBlockquote: ed.isActive('blockquote'),
        isCodeBlock: ed.isActive('codeBlock'),
        isLink: ed.isActive('link'),
        headingLevel:
          ([1, 2, 3] as const).find((lvl) =>
            ed.isActive('heading', { level: lvl }),
          ) ?? null,
        canBold: ed.can().toggleBold(),
        canItalic: ed.can().toggleItalic(),
        canStrike: ed.can().toggleStrike(),
        canCode: ed.can().toggleCode(),
        canBulletList: ed.can().toggleBulletList(),
        canOrderedList: ed.can().toggleOrderedList(),
        canBlockquote: ed.can().toggleBlockquote(),
        canCodeBlock: ed.can().toggleCodeBlock(),
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
      };
    },
  });

  const chain = () => editor.chain().focus();

  const promptForLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous ?? '');
    if (url === null) return;
    if (url === '') {
      chain().extendMarkRange('link').unsetLink().run();
      return;
    }
    chain().extendMarkRange('link').setLink({ href: url }).run();
  };

  // Selector may return null briefly on first render before the editor
  // is ready. Render a disabled skeleton in that window.
  if (!state) {
    return (
      <div className="flex items-center gap-0.5 border-b border-[var(--line)] bg-[var(--bg-subtle)] px-1.5 py-1 opacity-60" />
    );
  }

  return (
    <div
      className={
        'flex flex-wrap items-center gap-0.5 border-b border-[var(--line)] bg-[var(--bg-subtle)] px-1.5 py-1 ' +
        (disabled ? 'pointer-events-none opacity-60' : '')
      }
    >
      <HeadingDropdown
        editor={editor}
        currentLevel={state.headingLevel}
        disabled={disabled}
      />

      <Divider />

      <ToolbarButton
        title="Bold  ⌘B"
        onClick={() => chain().toggleBold().run()}
        active={state.isBold}
        disabled={!state.canBold}
      >
        <Bold size={14} strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        title="Italic  ⌘I"
        onClick={() => chain().toggleItalic().run()}
        active={state.isItalic}
        disabled={!state.canItalic}
      >
        <Italic size={14} strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        onClick={() => chain().toggleStrike().run()}
        active={state.isStrike}
        disabled={!state.canStrike}
      >
        <Strikethrough size={14} strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        title="Inline code  ⌘E"
        onClick={() => chain().toggleCode().run()}
        active={state.isCode}
        disabled={!state.canCode}
      >
        <Code size={14} strokeWidth={2.5} />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        title="Bullet list"
        onClick={() => chain().toggleBulletList().run()}
        active={state.isBulletList}
        disabled={!state.canBulletList}
      >
        <List size={14} strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        title="Numbered list"
        onClick={() => chain().toggleOrderedList().run()}
        active={state.isOrderedList}
        disabled={!state.canOrderedList}
      >
        <ListOrdered size={14} strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        title="Blockquote"
        onClick={() => chain().toggleBlockquote().run()}
        active={state.isBlockquote}
        disabled={!state.canBlockquote}
      >
        <Quote size={14} strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        title="Code block"
        onClick={() => chain().toggleCodeBlock().run()}
        active={state.isCodeBlock}
        disabled={!state.canCodeBlock}
      >
        <Code2 size={14} strokeWidth={2.5} />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        title="Link"
        onClick={promptForLink}
        active={state.isLink}
      >
        <LinkIcon size={14} strokeWidth={2.5} />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        title="Undo  ⌘Z"
        onClick={() => chain().undo().run()}
        disabled={!state.canUndo}
      >
        <Undo size={14} strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        title="Redo  ⌘⇧Z"
        onClick={() => chain().redo().run()}
        disabled={!state.canRedo}
      >
        <Redo size={14} strokeWidth={2.5} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: Readonly<{
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}>) {
  // `onMouseDown preventDefault` is critical: without it, pressing a
  // toolbar button blurs the editor BEFORE onClick fires, collapsing
  // the selection. `editor.chain().focus().toggleBold().run()` would
  // then run against an empty range and nothing visible happens.
  // Preventing the default mousedown keeps the editor focused so the
  // selection is intact when the command executes.
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active ? true : undefined}
      className={
        'inline-flex h-7 w-7 items-center justify-center rounded transition ' +
        (active
          ? 'bg-[var(--ink)] text-[var(--card)]'
          : 'text-[var(--ink-muted)] hover:bg-[var(--card)] hover:text-[var(--ink)]') +
        (disabled ? ' cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[var(--ink-muted)]' : '')
      }
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px self-center bg-[var(--line)]" aria-hidden="true" />;
}

// Heading dropdown — paragraph + H1/H2/H3. `currentLevel` flows in from
// the parent's useEditorState subscription so the label stays in sync
// with the caret position. A plain editor.isActive() read here wouldn't
// re-evaluate on selection changes.
function HeadingDropdown({
  editor,
  currentLevel,
  disabled,
}: Readonly<{
  editor: Editor;
  currentLevel: 1 | 2 | 3 | null;
  disabled?: boolean;
}>) {
  const label = currentLevel ? `H${currentLevel}` : 'Text';

  const setBlock = (level: 0 | 1 | 2 | 3) => {
    if (level === 0) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().toggleHeading({ level }).run();
    }
  };

  // preventDefault on pointerdown-style events keeps editor focus.
  // Radix DropdownMenu closes on item select, which naturally triggers
  // the command chain with `focus()` on a still-live selection.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        className="inline-flex h-7 items-center gap-1 rounded px-2 text-[0.7rem] font-medium text-[var(--ink-muted)] transition hover:bg-[var(--card)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
        title="Heading level"
      >
        <Type size={14} strokeWidth={2.5} />
        <span>{label}</span>
        <svg
          viewBox="0 0 20 20"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[160px]">
        <DropdownMenuItem onSelect={() => setBlock(0)}>
          <Type size={14} className="mr-2" />
          <span>Paragraph</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setBlock(1)}>
          <Heading1 size={14} className="mr-2" />
          <span>Heading 1</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setBlock(2)}>
          <Heading2 size={14} className="mr-2" />
          <span>Heading 2</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setBlock(3)}>
          <Heading3 size={14} className="mr-2" />
          <span>Heading 3</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
