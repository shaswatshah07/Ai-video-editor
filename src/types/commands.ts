import { z } from 'zod';

export const TrimSectionPayloadSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive()
});

export const RemoveSilencePayloadSchema = z.object({
  minDurationMs: z.number().int().default(1200),
  paddingPreMs: z.number().int().default(150),
  paddingPostMs: z.number().int().default(200)
});

export const InsertLibraryMemePayloadSchema = z.object({
  memeId: z.string(),
  atProjectMs: z.number().int().nonnegative()
});

export const InsertUserClipPayloadSchema = z.object({
  clipId: z.string(),
  atProjectMs: z.number().int().nonnegative()
});

export const AddTransitionPayloadSchema = z.object({
  clipId: z.string().optional(),
  type: z.enum(['fade', 'dissolve', 'wipeleft', 'wiperight', 'slideup']),
  durationMs: z.number().int().default(400)
});

export const AudioTogglePayloadSchema = z.object({
  enabled: z.boolean()
});

export const AmbiguousPayloadSchema = z.object({
  message: z.string(),
  suggestedAction: z.string().optional()
});

export const UnsupportedPayloadSchema = z.object({
  feature: z.string(),
  message: z.string()
});

export const AssistantAdvicePayloadSchema = z.object({
  message: z.string(),
  source: z.enum(['gemini', 'local']).optional()
});

export const AICommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('ASSISTANT_ADVICE'),
    payload: AssistantAdvicePayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('TRIM_SECTION'),
    payload: TrimSectionPayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('REMOVE_SILENCE'),
    payload: RemoveSilencePayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('INSERT_LIBRARY_MEME'),
    payload: InsertLibraryMemePayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('INSERT_USER_CLIP'),
    payload: InsertUserClipPayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('ADD_TRANSITION'),
    payload: AddTransitionPayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('ENHANCE_AUDIO'),
    payload: AudioTogglePayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('REMOVE_NOISE'),
    payload: AudioTogglePayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('RESET_AUDIO'),
    payload: z.object({}),
    explanation: z.string()
  }),
  z.object({
    action: z.literal('GENERATE_TRANSCRIPT'),
    payload: z.object({}),
    explanation: z.string()
  }),
  z.object({
    action: z.literal('GENERATE_TIMESTAMPS'),
    payload: z.object({}),
    explanation: z.string()
  }),
  z.object({
    action: z.literal('AMBIGUOUS_NEED_CLARIFICATION'),
    payload: AmbiguousPayloadSchema,
    explanation: z.string()
  }),
  z.object({
    action: z.literal('UNSUPPORTED_OPERATION'),
    payload: UnsupportedPayloadSchema,
    explanation: z.string()
  })
]);

export type AICommand = z.infer<typeof AICommandSchema>;

export interface CommandLogEntry {
  id: string;
  rawInput: string;
  timestamp: number;
  parsedCommand: AICommand;
  status: 'SUCCESS' | 'WARNING' | 'REJECTED' | 'CLARIFICATION';
  appliedMessage: string;
}
