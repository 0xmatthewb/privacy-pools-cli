import { beforeEach, describe, expect, mock, test } from "bun:test";

const CANCELLED = Symbol("cancelled");
const confirmMock = mock(async () => true as boolean | symbol);
const textMock = mock(async () => "typed" as string | symbol);
const passwordMock = mock(async () => "secret" as string | symbol);
const selectMock = mock(async () => "restore" as string | symbol);

mock.module("@clack/prompts", () => ({
  confirm: confirmMock,
  isCancel: (value: unknown) => value === CANCELLED,
  password: passwordMock,
  select: selectMock,
  text: textMock,
}));

const {
  confirmPrompt,
  inputPrompt,
  passwordPrompt,
  selectPrompt,
} = await import("../../src/utils/init-prompts.ts");

describe("init prompt adapters", () => {
  beforeEach(() => {
    delete process.env.PRIVACY_POOLS_INIT_PROMPT_ENGINE;
    confirmMock.mockClear();
    textMock.mockClear();
    passwordMock.mockClear();
    selectMock.mockClear();
    confirmMock.mockImplementation(async () => true);
    textMock.mockImplementation(async () => "typed");
    passwordMock.mockImplementation(async () => "secret");
    selectMock.mockImplementation(async () => "restore");
  });

  test("uses clack prompts for init by default", async () => {
    await expect(confirmPrompt({ message: "Continue?", default: true })).resolves.toBe(true);
    await expect(inputPrompt({ message: "Path:", default: "/tmp/recovery.txt" })).resolves.toBe("typed");
    await expect(passwordPrompt({ message: "Secret:", mask: "*" })).resolves.toBe("secret");
    await expect(selectPrompt<string>({
      message: "Mode:",
      choices: [
        { name: "Create", value: "create" },
        { name: "Restore", value: "restore", description: "Load an account" },
        { type: "separator" },
      ],
    })).resolves.toBe("restore");

    expect(confirmMock).toHaveBeenCalledWith({
      message: "Continue?",
      initialValue: true,
    });
    expect(textMock).toHaveBeenCalledWith({
      message: "Path:",
      defaultValue: "/tmp/recovery.txt",
      placeholder: "/tmp/recovery.txt",
      validate: undefined,
    });
    expect(passwordMock).toHaveBeenCalledWith({
      message: "Secret:",
      mask: "*",
      validate: undefined,
    });
    expect(selectMock).toHaveBeenCalledWith({
      message: "Mode:",
      options: [
        { label: "Create", value: "create" },
        { label: "Restore", value: "restore", hint: "Load an account" },
      ],
    });
  });

  test("maps clack cancellation into the shared prompt cancellation error", async () => {
    selectMock.mockImplementationOnce(async () => CANCELLED);

    await expect(selectPrompt<string>({
      message: "Mode:",
      choices: [{ name: "Create", value: "create" }],
    })).rejects.toThrow("Operation cancelled");
  });
});
