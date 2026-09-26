import * as z from 'zod/v4';

export const key = z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const uuid = z.uuidv4();
const shortText = z.string().trim().min(1).max(300);
const longText = z.string().min(1).max(50000).refine(s => !!s.trim(), 'Must contain text');
const clue = z.strictObject({
  key, text: longText.optional(), scene: z.string().max(500).optional(),
  enabled: z.boolean().optional(), audioAssetId: uuid.nullable().optional()
});
const puzzle = z.strictObject({
  key, title: shortText.optional(), surface: longText.optional(),
  hostNotes: z.string().max(50000).optional(), enabled: z.boolean().optional(),
  clues: z.array(clue).max(200).optional()
});
export const patch = z.strictObject({
  key, type: z.literal('puzzle_clue').optional(), title: shortText.optional(),
  displayName: shortText.optional(), tagline: shortText.optional(),
  description: z.string().max(2000).optional(), theme: shortText.optional(),
  listed: z.boolean().optional(), enabled: z.boolean().optional(),
  puzzles: z.array(puzzle).max(200).optional()
});
export const schemas = {
  list_games: z.strictObject({}),
  get_game: z.strictObject({ gameKey: key, view: z.enum(['published', 'draft']).default('published'), includeHostNotes: z.boolean().default(false) }),
  validate_import: z.strictObject({ patch }),
  save_draft: z.strictObject({ patch, expectedDraftVersion: uuid.nullable(), fromPublishedVersion: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional() }),
  preview_clue: z.strictObject({ gameKey: key, draftVersion: uuid, puzzleKey: key, clueKey: key }),
  publish_draft: z.strictObject({ gameKey: key, draftVersion: uuid, expectedPublishedVersion: z.string().regex(/^[a-f0-9]{64}$/).nullable() }),
  import_asset: z.strictObject({ gameKey: key, relativePath: z.string().min(1).max(1000) }),
  export_links: z.strictObject({ gameKey: key.optional() })
};
