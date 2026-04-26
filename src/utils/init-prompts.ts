import { promptCancelledError } from "./errors.js";
import {
  confirmPrompt as inquirerConfirmPrompt,
  inputPrompt as inquirerInputPrompt,
  passwordPrompt as inquirerPasswordPrompt,
  selectPrompt as inquirerSelectPrompt,
  type PromptConfirm,
  type PromptInput,
  type PromptPassword,
  type PromptSelect,
} from "./prompts.js";

type InitPromptChoice<Value> =
  | {
      name?: string;
      value?: Value;
      description?: string;
      disabled?: boolean | string;
    }
  | {
      type?: string;
      separator?: boolean;
    };

function useInquirerCompatibility(): boolean {
  return process.env.PRIVACY_POOLS_INIT_PROMPT_ENGINE?.trim().toLowerCase() === "inquirer";
}

function assertNotCancelled(
  value: unknown,
  isCancel: (value: unknown) => boolean,
): void {
  if (isCancel(value)) {
    throw promptCancelledError();
  }
}

function isSelectableChoice<Value>(
  choice: InitPromptChoice<Value>,
): choice is Extract<InitPromptChoice<Value>, { value?: Value }> & { value: Value } {
  return (
    typeof choice === "object" &&
    choice !== null &&
    "value" in choice &&
    choice.value !== undefined &&
    !("disabled" in choice && choice.disabled)
  );
}

function normalizeSelectOptions<Value>(
  choices: readonly InitPromptChoice<Value>[],
): Array<{ label: string; value: Value; hint?: string }> {
  return choices
    .filter(isSelectableChoice<Value>)
    .map((choice) => ({
      label: choice.name ?? String(choice.value),
      value: choice.value,
      ...(choice.description ? { hint: choice.description } : {}),
    }));
}

export async function confirmPrompt(
  options: Parameters<PromptConfirm>[0],
  context?: Parameters<PromptConfirm>[1],
): ReturnType<PromptConfirm> {
  if (useInquirerCompatibility()) {
    return inquirerConfirmPrompt(options, context);
  }

  const { confirm, isCancel } = await import("@clack/prompts");
  const value = await confirm({
    message: options.message,
    initialValue: options.default,
  });
  assertNotCancelled(value, isCancel);
  return Boolean(value) as Awaited<ReturnType<PromptConfirm>>;
}

export async function inputPrompt(
  options: Parameters<PromptInput>[0],
  context?: Parameters<PromptInput>[1],
): ReturnType<PromptInput> {
  if (useInquirerCompatibility()) {
    return inquirerInputPrompt(options, context);
  }

  const { text, isCancel } = await import("@clack/prompts");
  const value = await text({
    message: options.message,
    defaultValue: options.default,
    placeholder: options.default,
    validate: options.validate as never,
  });
  assertNotCancelled(value, isCancel);
  return String(value) as Awaited<ReturnType<PromptInput>>;
}

export async function passwordPrompt(
  options: Parameters<PromptPassword>[0],
  context?: Parameters<PromptPassword>[1],
): ReturnType<PromptPassword> {
  if (useInquirerCompatibility()) {
    return inquirerPasswordPrompt(options, context);
  }

  const { password, isCancel } = await import("@clack/prompts");
  const value = await password({
    message: options.message,
    mask: typeof options.mask === "string" ? options.mask : options.mask ? "*" : undefined,
    validate: options.validate as never,
  });
  assertNotCancelled(value, isCancel);
  return String(value) as Awaited<ReturnType<PromptPassword>>;
}

export async function selectPrompt<Value>(
  options: Parameters<PromptSelect>[0],
  context?: Parameters<PromptSelect>[1],
): Promise<Value> {
  if (useInquirerCompatibility()) {
    return inquirerSelectPrompt<Value>(options, context);
  }

  const { select, isCancel } = await import("@clack/prompts");
  const value = await select({
    message: options.message,
    options: normalizeSelectOptions<Value>(
      (options.choices ?? []) as readonly InitPromptChoice<Value>[],
    ) as never,
  } as never);
  assertNotCancelled(value, isCancel);
  return value as Value;
}
