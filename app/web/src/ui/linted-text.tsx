import { useMemo, type ReactNode } from 'react';
import { lintTells, mergeTells } from '@forge/shared';

/** Plain text with its tells marked in place. For text the operator reads but cannot edit here. */
export function LintedText({ text, className }: { text: string; className?: string }): ReactNode {
  const spans = useMemo(() => mergeTells(lintTells(text)), [text]);
  if (spans.length === 0) return <span className={className}>{text}</span>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) parts.push(text.slice(cursor, span.start));
    parts.push(
      <mark
        key={`${span.start}-${span.end}`}
        data-tip={span.labels.join(', ')}
        className="rounded-[2px] border-b-2 border-salmon bg-salmon/20 text-inherit"
      >
        {text.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <span className={className}>{parts}</span>;
}
