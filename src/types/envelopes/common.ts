import { z } from "zod";

export const nextActionSchema = z.object({
  command: z.string(),
  reason: z.string(),
  when: z.string(),
  cliCommand: z.string().optional(),
  args: z.array(z.string()).optional(),
  options: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  parameters: z.array(z.object({
    name: z.string(),
    type: z.string(),
    required: z.boolean().optional(),
    description: z.string().optional(),
  })).optional(),
  runnable: z.boolean().optional(),
});

export const acknowledgementRequestSchema = z.object({
  id: z.string(),
  severity: z.string(),
  summary: z.string(),
});

export const acknowledgementRecordSchema = z.object({
  id: z.string(),
  severity: z.string(),
});

export const freshnessRecordSchema = z.object({
  chain: z.string(),
  lastSyncAt: z.string().nullable().optional(),
  ageSeconds: z.number().nullable().optional(),
  isStale: z.boolean(),
});

export const errorEnvelopeSchema = z.object({
  schemaVersion: z.string(),
  success: z.literal(false),
  errorCode: z.string(),
  errorMessage: z.string(),
  error: z.object({
    code: z.string(),
    category: z.string(),
    message: z.string(),
    hint: z.string().optional(),
    retryable: z.boolean().optional(),
    docUrl: z.string().url().optional(),
    helpTopic: z.string().optional(),
    nextActions: z.array(nextActionSchema).optional(),
    retry: z.record(z.unknown()).optional(),
    availableFields: z.array(z.string()).optional(),
    unknownFields: z.array(z.string()).optional(),
  }),
  availableFields: z.array(z.string()).optional(),
  unknownFields: z.array(z.string()).optional(),
  helpTopic: z.string().optional(),
  nextActions: z.array(nextActionSchema).optional(),
  retry: z.record(z.unknown()).optional(),
  requiredAcknowledgements: z.array(acknowledgementRequestSchema).optional(),
});

export const successEnvelopeSchema = z.object({
  schemaVersion: z.string(),
  success: z.literal(true),
  mode: z.string(),
  action: z.string().optional(),
  operation: z.string(),
  nextActions: z.array(nextActionSchema).optional(),
  acceptedAcknowledgements: z.array(acknowledgementRecordSchema).optional(),
  freshness: z.array(freshnessRecordSchema).optional(),
});

export const cliEnvelopeSchema = z.union([
  successEnvelopeSchema,
  errorEnvelopeSchema,
]);

export type CliEnvelope = z.infer<typeof cliEnvelopeSchema>;
