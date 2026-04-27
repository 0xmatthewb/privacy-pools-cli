import { z } from "zod";
import { COMMAND_PATHS, type CommandPath } from "../../utils/command-catalog.js";
import {
  errorEnvelopeSchema,
  nextActionSchema,
  successEnvelopeSchema,
} from "./common.js";

const nullableString = z.string().nullable();
const optionalNullableString = nullableString.optional();
const warningSchema = z.object({
  code: z.string().optional(),
  category: z.string().optional(),
  message: z.string(),
}).passthrough();
const deprecationWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  replacementCommand: z.string(),
}).passthrough();

const poolBaseSchema = z.object({
  asset: z.string(),
  tokenAddress: z.string(),
  pool: z.string(),
  scope: z.string(),
  decimals: z.number(),
  minimumDeposit: z.string(),
  vettingFeeBPS: z.string(),
  maxRelayFeeBPS: z.string(),
  totalInPoolValue: nullableString,
  totalInPoolValueUsd: optionalNullableString,
  totalDepositsValue: optionalNullableString,
  totalDepositsValueUsd: optionalNullableString,
  acceptedDepositsValue: optionalNullableString,
  acceptedDepositsValueUsd: optionalNullableString,
  pendingDepositsValue: optionalNullableString,
  pendingDepositsValueUsd: optionalNullableString,
  totalDepositsCount: z.number().nullable(),
  acceptedDepositsCount: z.number().nullable().optional(),
  pendingDepositsCount: z.number().nullable(),
  growth24h: z.number().nullable().optional(),
  pendingGrowth24h: z.number().nullable().optional(),
  myPoolAccountsCount: z.number().optional(),
}).passthrough();

const poolListItemSchema = poolBaseSchema.extend({
  chain: z.string().optional(),
});

const timeBasedStatsSchema = z.object({
  tvl: z.string().nullable().optional(),
  tvlUsd: z.string().nullable().optional(),
  avgDepositSizeUsd: z.string().nullable().optional(),
  totalDepositsCount: z.number().nullable().optional(),
  totalWithdrawalsCount: z.number().nullable().optional(),
  totalDepositsValue: z.string().nullable().optional(),
  totalWithdrawalsValue: z.string().nullable().optional(),
  totalDepositsValueUsd: z.string().nullable().optional(),
  totalWithdrawalsValueUsd: z.string().nullable().optional(),
}).passthrough();

const transactionResultBaseSchema = z.object({
  operation: z.string(),
  status: z.enum(["submitted", "confirmed"]).optional(),
  submissionId: z.string().optional(),
  txHash: z.string().optional(),
  amount: z.string(),
  asset: z.string(),
  chain: z.string(),
  poolAccountNumber: z.number().optional(),
  poolAccountId: z.string().optional(),
  poolAddress: z.string().optional(),
  scope: z.string().optional(),
  blockNumber: z.union([z.string(), z.number()]).nullable().optional(),
  explorerUrl: z.string().nullable().optional(),
  reconciliationRequired: z.boolean().optional(),
  localStateSynced: z.boolean().optional(),
  warningCode: z.string().nullable().optional(),
  warnings: z.array(warningSchema).optional(),
  deprecationWarning: deprecationWarningSchema.optional(),
}).passthrough();

function commandEnvelope(payloadSchema: z.ZodTypeAny): z.ZodTypeAny {
  return z.union([
    successEnvelopeSchema.and(payloadSchema),
    errorEnvelopeSchema,
  ]);
}

const commandPayloadSchemas: Partial<Record<CommandPath, z.ZodTypeAny>> = {
  accounts: z.object({
    chain: z.string(),
    requestedChain: z.string().nullable().optional(),
    chains: z.array(z.string()).optional(),
    allChains: z.boolean().optional(),
    lastSyncTime: optionalNullableString,
    syncSkipped: z.boolean().optional(),
    accounts: z.array(z.record(z.unknown())).optional(),
    balances: z.array(z.record(z.unknown())).optional(),
    pendingCount: z.number().optional(),
    warnings: z.array(warningSchema).optional(),
    nextActions: z.array(nextActionSchema).optional(),
  }).passthrough(),
  capabilities: z.object({
    commands: z.array(z.record(z.unknown())),
    commandDetails: z.record(z.record(z.unknown())),
    executionRoutes: z.record(z.record(z.unknown())),
    globalFlags: z.array(z.record(z.unknown())),
    exitCodes: z.array(z.record(z.unknown())),
    envVars: z.array(z.record(z.unknown())),
    agentWorkflow: z.array(z.string()),
    agentNotes: z.record(z.string()),
    schemas: z.record(z.unknown()),
    supportedChains: z.array(z.record(z.unknown())),
    protocol: z.record(z.unknown()),
    runtime: z.record(z.unknown()),
    safeReadOnlyCommands: z.array(z.string()),
    jsonOutputContract: z.string(),
    documentation: z.object({
      reference: z.string(),
      agentGuide: z.string(),
      changelog: z.string(),
      runtimeUpgrades: z.string().optional(),
      jsonContract: z.string().optional(),
      envelopeSchemas: z.string().optional(),
      errorCodes: z.string().optional(),
    }).passthrough().optional(),
    nextActions: z.array(nextActionSchema).optional(),
  }).passthrough(),
  deposit: transactionResultBaseSchema.extend({
    operation: z.literal("deposit"),
    workflowId: z.string().optional(),
    committedValue: z.string().nullable().optional(),
    estimatedCommitted: z.string().nullable().optional(),
    vettingFeeBPS: z.string().optional(),
    vettingFeeAmount: z.string().optional(),
    feesApply: z.boolean().optional(),
    label: z.string().nullable().optional(),
  }).passthrough(),
  pools: z.object({
    chain: z.string(),
    requestedChain: z.string().nullable().optional(),
    chainSummaries: z.array(z.object({
      chain: z.string(),
      pools: z.number(),
      error: z.string().nullable(),
    }).passthrough()).optional(),
    search: z.string().nullable(),
    sort: z.string(),
    pools: z.array(poolListItemSchema),
    warnings: z.array(warningSchema).optional(),
    nextActions: z.array(nextActionSchema).optional(),
  }).passthrough(),
  "pool-stats": z.object({
    mode: z.literal("pool-stats"),
    command: z.string(),
    invokedAs: z.string().optional(),
    deprecationWarning: deprecationWarningSchema.optional(),
    chain: z.string(),
    asset: z.string(),
    pool: z.string(),
    scope: z.string(),
    cacheTimestamp: optionalNullableString,
    allTime: timeBasedStatsSchema.nullable(),
    last24h: timeBasedStatsSchema.nullable(),
  }).passthrough(),
  "protocol-stats": z.object({
    mode: z.literal("global-stats"),
    command: z.string(),
    invokedAs: z.string().optional(),
    deprecationWarning: deprecationWarningSchema.optional(),
    chain: z.string(),
    chains: z.array(z.string()),
    cacheTimestamp: optionalNullableString,
    allTime: timeBasedStatsSchema.nullable(),
    last24h: timeBasedStatsSchema.nullable(),
    perChain: z.array(z.record(z.unknown())).optional(),
  }).passthrough(),
  status: z.object({
    mode: z.string().optional(),
    configExists: z.boolean(),
    configDir: z.string(),
    defaultChain: z.string(),
    selectedChain: z.string(),
    rpcUrl: z.string().optional(),
    rpcIsCustom: z.boolean().optional(),
    recoveryPhraseSet: z.boolean(),
    signerKeySet: z.boolean(),
    signerKeyValid: z.boolean(),
    signerAddress: z.string().nullable().optional(),
    entrypoint: z.string().optional(),
    aspHost: z.string().optional(),
    accountFiles: z.array(z.record(z.unknown())).optional(),
    readyForDeposit: z.boolean(),
    readyForWithdraw: z.boolean(),
    readyForUnsigned: z.boolean(),
    recommendedMode: z.string(),
    blockingIssues: z.array(z.record(z.unknown())).optional(),
    warnings: z.array(z.record(z.unknown())).optional(),
    nextActions: z.array(nextActionSchema).optional(),
    aspLive: z.boolean().optional(),
    rpcLive: z.boolean().optional(),
    rpcBlockNumber: z.string().optional(),
  }).passthrough(),
  withdraw: transactionResultBaseSchema.extend({
    operation: z.literal("withdraw"),
    mode: z.enum(["relayed", "direct"]).optional(),
    recipient: z.string().optional(),
    feeBPS: z.string().optional(),
    relayerHost: z.string().optional(),
    quoteRefreshCount: z.number().optional(),
    extraGas: z.boolean().optional(),
    extraGasFundAmount: z.string().nullable().optional(),
    remainingBalance: z.string().optional(),
    rootMatchedAtProofTime: z.boolean().optional(),
    anonymitySet: z.object({
      eligible: z.number(),
      total: z.number(),
      percentage: z.number(),
    }).passthrough().optional(),
  }).passthrough(),
};

export const commandEnvelopeSchemas = Object.fromEntries(
  COMMAND_PATHS.map((command) => [
    command,
    commandEnvelope(commandPayloadSchemas[command] ?? z.object({}).passthrough())
      .describe(command),
  ]),
) as Record<CommandPath, z.ZodTypeAny>;

export type CommandEnvelopeSchemas = typeof commandEnvelopeSchemas;
export type CommandEnvelope = z.infer<typeof successEnvelopeSchema> | z.infer<typeof errorEnvelopeSchema>;
