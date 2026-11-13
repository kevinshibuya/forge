import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LintedText } from './linted-text';

describe('LintedText', () => {
  it('marks every tell and keeps the surrounding text', () => {
    render(<LintedText text={'we \u2014 utilize it'} />);
    const marks = screen.getAllByRole('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]!.textContent).toBe('\u2014');
    expect(marks[0]!.getAttribute('data-tip')).toBe('em dash');
    expect(marks[1]!.textContent).toBe('utilize');
    expect(marks[1]!.getAttribute('data-tip')).toBe('fancier synonym');
    expect(screen.getByText(/we/).textContent).toBe('we \u2014 utilize it');
  });

  it('renders a clean body with no marks', () => {
    render(<LintedText text="a clean line about api surfaces" />);
    expect(screen.queryAllByRole('mark')).toHaveLength(0);
    expect(screen.getByText('a clean line about api surfaces')).toBeTruthy();
  });

  it('merges two overlapping tells into one mark carrying both labels', () => {
    render(<LintedText text="not just a testament but a win" />);
    const marks = screen.getAllByRole('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.getAttribute('data-tip')).toBe('not just X but Y, AI vocabulary');
    expect(marks[0]!.textContent).toBe('not just a testament but');
  });

  it('passes the className through to the wrapper', () => {
    const { container } = render(<LintedText text="clean" className="text-soft" />);
    expect(container.querySelector('span.text-soft')).toBeTruthy();
  });

  it('keeps the label out of the DOM text, so the mark reads as the flagged characters only', () => {
    render(<LintedText text="we utilize it" />);
    const mark = screen.getAllByRole('mark')[0]!;
    expect(mark.textContent).toBe('utilize');            // not "utilizefancier synonym"
    expect(mark.getAttribute('data-tip')).toBe('fancier synonym');
    expect(mark.getAttribute('title')).toBeNull();       // the slow native tooltip is gone
  });
});