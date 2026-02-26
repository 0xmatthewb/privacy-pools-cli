export declare function styleCommanderHelp(raw: string): string;
/**
 * Minimal footer for root --help. Points users to the right places
 * without overwhelming them with a tutorial.
 */
export declare function rootHelpFooter(): string;
/**
 * Full guide content - displayed by `privacy-pools guide`.
 * Contains the quick start, workflow, automation tips, and exit codes
 * that used to live in root --help.
 */
export declare function guideText(): string;
interface CommandHelpConfig {
    prerequisites?: string;
    jsonFields: string;
    jsonVariants?: string[];
}
export declare function commandHelpText(config: CommandHelpConfig): string;
export {};
