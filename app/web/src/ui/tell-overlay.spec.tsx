import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TellOverlay } from './tell-overlay';

// jsdom does no layout, so the mirror-div measurement can only ever return nothing here.
// One box per call, never `[]`: the overlay paints one rect per box.
vi.mock('../lib/textarea-caret', () => ({
  measureSelectionRects: () => [{ top: 4, left: 8, right: 20, bottom: 22 }],
  measureSelection: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));

function Harness({ text }: { text: string }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div className="relative">
      <textarea ref={ref} defaultValue={text} aria-label="body" />
      <TellOverlay textareaRef={ref} text={text} />
    </div>
  );
}

describe('TellOverlay', () => {
  it('paints one rect per tell, titled with its label', () => {
    render(<Harness text={'a \u2014 b'} />);
    const rects = screen.getAllByTitle('em dash');
    expect(rects).toHaveLength(1);
  });

  it('paints nothing for a clean body', () => {
    const { container } = render(<Harness text="a clean line" />);
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('a mousedown on a rect selects the flagged span in the textarea', async () => {
    const text = 'we utilize it';
    render(<Harness text={text} />);
    const textarea = screen.getByLabelText('body') as HTMLTextAreaElement;
    await userEvent.click(screen.getByTitle('fancier synonym'));
    expect(textarea.selectionStart).toBe(text.indexOf('utilize'));
    expect(textarea.selectionEnd).toBe(text.indexOf('utilize') + 'utilize'.length);
  });

  it('re-lints when the text changes', () => {
    const { rerender, container } = render(<Harness text="clean" />);
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
    rerender(<Harness text={'now a \u2014 dash'} />);
    expect(screen.getAllByTitle('em dash')).toHaveLength(1);
  });

  it('shows its own tooltip on hover, outside the clipped frame', () => {
    const { container } = render(<Harness text={'a \u2014 b'} />);
    const rect = screen.getByTitle('em dash');
    const clip = container.querySelector('.overflow-hidden')!;

    expect(container.textContent).not.toContain('em dash');   // nothing rendered until hover
    fireEvent.mouseEnter(rect);

    const tip = screen.getByText('em dash');
    expect(tip).toBeInTheDocument();
    // Outside the overflow-hidden frame, or it would be clipped on the first line.
    expect(clip.contains(tip)).toBe(false);

    fireEvent.mouseLeave(rect);
    expect(screen.queryByText('em dash')).toBeNull();
  });
});