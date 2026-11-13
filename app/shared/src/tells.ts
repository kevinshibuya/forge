/** Tells are the stock signatures of machine-written prose: em dashes, curly quotes,
 *  the vocabulary every model reaches for. The table below is the source of truth for
 *  what counts as one; the style docs are the prose version of it for the model.
 *
 *  A tell is a warning. Nothing here changes a run's status, blocks a save or an approve.
 *  Offsets are UTF-16 indices into the linted string, the same coordinates a textarea
 *  reports through selectionStart, so a hit can be painted on the exact characters.
 *
 *  Punctuation is written as escapes so this file carries none of it literally. */

export interface TellPattern {
  id: string;
  label: string;
  regex: RegExp;
}

export interface Tell {
  id: string;
  label: string;
  start: number;
  end: number;
}

/** A tell found in a run's output, tagged with the field path it came from. */
export interface RunTell extends Tell {
  field: string;
}

/** Appendix D lists several inflections per stem (showcase, showcases, showcasing) but misses
 *  others of the same words, and the missing ones are the forms slop actually reaches for. The
 *  gaps are closed with explicit forms rather than stems: `elevat\\w*` would flag "elevator
 *  pitch" and `enhanc\\w*` is fine but the pattern is not worth the inconsistency. */
const AI_VOCAB = [
  'additionally', 'crucial', 'delve', 'delves', 'delved', 'delving', 'enduring',
  'enhance', 'enhances', 'enhanced', 'enhancing',
  'foster', 'fosters', 'fostered', 'fostering', 'garner', 'garners', 'garnered',
  'interplay', 'intricate', 'pivotal',
  'showcase', 'showcases', 'showcased', 'showcasing', 'tapestry', 'testament',
  'vibrant', 'robust', 'seamless', 'seamlessly',
  'unlock', 'unlocks', 'unlocked', 'unlocking',
  'empower', 'empowers', 'empowered', 'empowering',
  'elevate', 'elevates', 'elevated', 'elevating',
  'game-changing', 'game\\s+changing', 'game[-\\s]changer', 'revolutionary', 'groundbreaking',
];

const METAPHOR_NOUNS = [
  'substrate', 'wedge', 'locus', 'nexus', 'flywheel', 'endgame',
  'north\\s+star',
  // Narrowed, not dropped. Bare `bedrock` and `paradigm` fire on "we run on Amazon Bedrock" and
  // "the actor paradigm in Erlang", which is the exact false-positive class appendix D excluded
  // `harness`, `surface` and `vector` for. The collocation is where the tell actually lives.
  'bedrock\\s+of', 'paradigm\\s+shift', 'paradigm\\s+shifts',
];

const PLAIN_WORDS = [
  'utilize', 'utilizes', 'utilized', 'utilizing',
  'leverage', 'leverages', 'leveraged', 'leveraging',
  'facilitate', 'facilitates', 'facilitated', 'facilitating',
  'numerous', 'in\\s+the\\s+event\\s+that',
];

/** Whole-word alternation. The trailing \b is what keeps `enhance` from swallowing
 *  `enhances`: the shorter branch backtracks and the longer one wins. */
function wholeWords(words: string[]): RegExp {
  return new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi');
}

export const TELL_PATTERNS: readonly TellPattern[] = [
  { id: 'em-dash', label: 'em dash', regex: /\u2014/gi },
  /** A spaced en dash, or a double hyphen standing in for one.
   *
   *  Every branch is pure lookaround, for two reasons. The span must cover the punctuation and
   *  nothing else, or the mark paints over the neighbouring spaces and clicking it selects them.
   *  And the inner branch requires a WORD character on each side, not merely a non-space: a flag
   *  written `--settings`, (--max-turns) or "--allowedTools" has a backtick, paren or quote
   *  against the hyphens, which \S accepts and \w does not. This operator writes flags that way
   *  constantly, and a lint that cries wolf gets ignored. `wait--no` still matches; so does the
   *  spaced ` -- `, through the last branch. */
  { id: 'dash-substitute', label: 'dash substitute', regex: /(?<=\s)\u2013(?=\s)|(?<=\w)--(?=\w)|(?<=\s)--(?=\s)/gi },
  { id: 'curly-quote', label: 'curly quote', regex: /[\u201c\u201d\u2018\u2019]/gi },
  { id: 'ai-vocab', label: 'AI vocabulary', regex: wholeWords(AI_VOCAB) },
  { id: 'fancy-is', label: 'fancy "is"', regex: /\b(?:serves\s+as|stands\s+as|boasts)\b/gi },
  { id: 'not-just-but', label: 'not just X but Y', regex: /\bnot\s+(?:just|only|merely)\b[^.!?\n]{0,80}?\bbut\b/gi },
  {
    id: 'filler',
    label: 'filler phrase',
    regex: /\b(?:in\s+order\s+to|due\s+to\s+the\s+fact\s+that|it\s+is\s+important\s+to\s+note|it['\u2019]s\s+worth\s+noting|at\s+the\s+end\s+of\s+the\s+day)\b/gi,
  },
  { id: 'hedge-stack', label: 'stacked hedge', regex: /\b(?:could|might|may)\s+(?:potentially|possibly)\b/gi },
  { id: 'metaphor-noun', label: 'abstract metaphor noun', regex: wholeWords(METAPHOR_NOUNS) },
  { id: 'plain-word', label: 'fancier synonym', regex: wholeWords(PLAIN_WORDS) },
  { id: 'announcement', label: 'announcement opener', regex: /\b(?:excited|thrilled|humbled)\s+to\s+(?:share|announce)\b/gi },
];

/** One display span: overlapping hits from different patterns, merged, carrying every label.
 *  Both renderers use this. Two nested underlines on the same characters read as a rendering
 *  bug, and the reader wants every reason in one tooltip. */
export interface TellSpan {
  start: number;
  end: number;
  labels: string[];
}

/** Merge overlapping tells into display spans. Input must be `lintTells` output (sorted by
 *  start), which is what makes comparing against the last span sufficient: a merged end only
 *  grows. Adjacent-but-disjoint spans stay separate. */
export function mergeTells(tells: Tell[]): TellSpan[] {
  const spans: TellSpan[] = [];
  for (const tell of tells) {
    const last = spans[spans.length - 1];
    if (last && tell.start < last.end) {
      last.end = Math.max(last.end, tell.end);
      if (!last.labels.includes(tell.label)) last.labels.push(tell.label);
      continue;
    }
    spans.push({ start: tell.start, end: tell.end, labels: [tell.label] });
  }
  return spans;
}

/** Every hit from every pattern, sorted by position. Overlapping hits from different
 *  patterns are all kept; only an exact repeat of the same id and span is dropped. */
export function lintTells(text: string): Tell[] {
  const found: Tell[] = [];

  for (const pattern of TELL_PATTERNS) {
    /** The regexes are module-level and carry `g`, so lastIndex survives the call. */
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        pattern.regex.lastIndex += 1;
        continue;
      }
      found.push({
        id: pattern.id,
        label: pattern.label,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    pattern.regex.lastIndex = 0;
  }

  /** No dedupe pass: ids are unique and one `g` regex cannot return the same span twice, so
   *  there is nothing to drop. Overlapping hits from DIFFERENT patterns are all kept on purpose;
   *  the renderers merge them for display. */
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  return found;
}
