import type { HybridPlan } from '@forge/shared';
import type { SplitPrompt } from '../engines/engine.interface';

export function assemblePlanPrompt(constitution: string, brief: string, designLanguageDoc: string, referenceImagePath?: string): SplitPrompt {
  const ref = referenceImagePath
    ? `\n## reference image\nUse the Read tool to view ${referenceImagePath}, the background of a previous winning image. Treat it as DIRECTION, not a template: extract what worked (palette, line quality/weight, density, mood, motif style) into \`refLearnings\` (<= 60 words), and choose \`textZone\` and \`palette\` consistent with it. The new background must NOT copy the reference's composition or layout.`
    : '';
  const shape = referenceImagePath
    ? '{ "backgroundPrompt": "...", "headline": "...", "subtext": "...", "textZone": "lower-third|upper-third|left-half|right-half|center", "palette": "...", "refLearnings": "..." }'
    : '{ "backgroundPrompt": "...", "headline": "...", "subtext": "...", "textZone": "lower-third|upper-third|left-half|right-half|center", "palette": "..." }';
  const role = 'You are an art director planning ONE 1200x1200 social image that layers a headline over a generated background.';
  return {
    system: [{ text: ['# role', role, constitution].join('\n\n'), cache: true }],
    user: [
      '## design language\n' + designLanguageDoc,
      '## brief\n' + brief + ref,
      '## output',
      'Return an object with this exact shape and nothing else:',
      shape,
      'Rules: `backgroundPrompt` describes a textless on-brand background that leaves `textZone` visually calm and high-contrast for overlaid text. `headline` <= 8 words. `subtext` optional, <= 16 words. Every value a short plain string: no HTML, no markup.',
    ].join('\n\n'),
  };
}

export function assembleBackgroundPrompt(plan: HybridPlan, withReference = false): SplitPrompt {
  const ref = withReference
    ? `Style direction distilled from a previous winning image${plan.refLearnings ? `. Carry over what worked: ${plan.refLearnings}` : ''}. Style/quality guidance only: compose the scene fresh from the brief below.`
    : '';
  return { system: [], user: [
    `Generate exactly ONE 1200x1200 px PNG named bg.png in the current working directory.`,
    ref,
    `Background brief: ${plan.backgroundPrompt}`,
    `Keep the ${plan.textZone} region visually calm and high-contrast so overlaid text stays legible.`,
    `Palette: ${plan.palette}.`,
    `The image must contain NO text, letters, numbers, or logos. Do not write any other file.`,
  ].filter(Boolean).join('\n') };
}

/**
 * Patch an EXISTING background rather than composing a new one. The source bg.png is attached to
 * the call (codex `-i=`), so the prompt only has to bound the edit: everything the user did not ask
 * about must survive byte-for-byte-ish, because the same text layer is re-composited over the result.
 */
export function assembleBgRefinePrompt(instruction: string): SplitPrompt {
  return { system: [], user: [
    'Edit the ATTACHED image and write the edited result as exactly ONE 1200x1200 px PNG named bg.png in the current working directory.',
    `Requested change: ${instruction}`,
    'Apply ONLY the requested change. Everything else must stay identical to the attached image: composition, framing, subject, palette, lighting, line quality, texture, and every region the change does not touch. This is a patch of that image, not a new image inspired by it.',
    'The image must contain NO text, letters, numbers, or logos. Do not write any other file.',
  ].join('\n') };
}

export function hybridTextBrief(plan: HybridPlan): string {
  const sub = plan.subtext ? `\nSubtext: ${plan.subtext}` : '';
  return [
    `Compose typography over a provided full-bleed background image.`,
    `Headline: ${plan.headline}${sub}`,
    `Place all text within the ${plan.textZone} region. Palette: ${plan.palette}.`,
    `Add a subtle scrim/gradient (a semi-opaque panel or gradient) behind the text within ${plan.textZone} so it stays legible over any background.`,
  ].join('\n');
}

export function assembleVariatorPrompt(constitution: string, brief: string, n: number): SplitPrompt {
  const role = `You are an art director generating ${n} DISTINCT visual directions for one social-image brief. A separate system renders one candidate per direction; the batch exists to explore variety, so directions must be deliberately far apart.`;
  return {
    system: [{ text: ['# role', role, constitution].join('\n\n'), cache: true }],
    user: [
      '## brief\n' + brief,
      '## output',
      'Return an object whose `directions` array holds exactly ' + `${n} strings and nothing else:`,
      // Built from n, never fixed: a 2-element example sitting next to "exactly n strings" is a strong
      // shape attractor, and a short reply degrades the surplus slots to the plain brief, i.e. it
      // resurfaces as the sameness bug this whole arc exists to fix.
      JSON.stringify({ directions: Array.from({ length: n }, (_, i) => `direction ${i + 1}`) }),
      `Rules: each direction <= 40 words of plain prose. The brief may spell out one concrete visual treatment: specific devices, elements, a layout. Treat that as ONE possible rendering, not a contract: you are free to discard and replace its devices, elements, and layout wholesale. Directions describe VISUALS ONLY: composition, metaphor, mood, palette emphasis. Each direction REINVENTS the visual metaphor from scratch: its own scene concept and element vocabulary, sharing no motif lineup with the brief's rendering or any other direction, plus a clearly different composition family, density, and mood. Never alter, rephrase, or extend the brief's message, headline, or subtext wording. No HTML, no markup.`,
    ].join('\n\n'),
  };
}
