/**
 * Output renderer for the `capabilities` command.
 *
 * `src/commands/capabilities.ts` delegates output rendering here.
 */
import type { OutputContext } from "./common.js";
/**
 * The static capabilities payload.
 * Renderer owns the data shape; command handler just calls render.
 */
export interface CapabilitiesPayload {
    commands: Array<{
        name: string;
        description: string;
        aliases?: string[];
        flags?: string[];
        usage?: string;
        agentFlags?: string;
        requiresInit: boolean;
    }>;
    globalFlags: Array<{
        flag: string;
        description: string;
    }>;
    agentWorkflow: string[];
    jsonOutputContract: string;
}
/**
 * Render capabilities output.
 */
export declare function renderCapabilities(ctx: OutputContext, payload: CapabilitiesPayload): void;
