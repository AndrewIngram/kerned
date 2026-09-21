import { z } from 'zod';

const configuration = z.strictObject({
  zoom: z.number().finite().positive().optional(),
  paddingTop: z.number().finite().nonnegative().optional(),
  maxWidth: z.number().finite().positive().nullable().optional(),
  background: z.string().min(1).optional(),
});

/** View settings can change without replacing the session, input or resource owner. */
export type ViewConfiguration = z.infer<typeof configuration>;

const revealOptions = z.strictObject({
  align: z.enum(['nearest', 'start', 'center', 'end']).default('nearest'),
  margin: z.number().finite().nonnegative().default(0),
});

/** Alignment within the viewport, with a clearance measured in CSS pixels. */
export type RevealOptions = z.input<typeof revealOptions>;

export function readRevealOptions(input: RevealOptions) {
  return revealOptions.parse(input);
}

export function readViewConfiguration(
  input: ViewConfiguration,
  current: { zoom: number; paddingTop: number; maxWidth: number | null; background: string } = {
    zoom: 1,
    paddingTop: 0,
    maxWidth: null,
    background: '#ffffff',
  },
) {
  const value = configuration.parse(input);

  return {
    zoom: value.zoom ?? current.zoom,
    paddingTop: value.paddingTop ?? current.paddingTop,
    maxWidth: value.maxWidth === undefined ? current.maxWidth : value.maxWidth,
    background: value.background ?? current.background,
  };
}
