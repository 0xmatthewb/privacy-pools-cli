import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import chalk from "chalk";
import {
  renderRippleFrame,
  UNICODE_DENSITY,
  ASCII_DENSITY,
  RIPPLE_FRAME_COUNT,
  RIPPLE_FRAME_DELAY_MS,
} from "../../src/utils/ripple.js";

describe("renderRippleFrame", () => {
  test("returns correct number of lines matching height", () => {
    const frame = renderRippleFrame(62, 22, 0, {
      useColor: false,
      useUnicode: true,
    });
    expect(frame).toHaveLength(22);
  });

  test("each line matches requested width when uncolored", () => {
    const frame = renderRippleFrame(62, 22, 0, {
      useColor: false,
      useUnicode: true,
    });
    for (const line of frame) {
      expect(line).toHaveLength(62);
    }
  });

  test("uses only Unicode density ramp characters when uncolored", () => {
    const valid = new Set(UNICODE_DENSITY);
    const frame = renderRippleFrame(30, 15, 5, {
      useColor: false,
      useUnicode: true,
    });
    for (const line of frame) {
      for (const ch of line) {
        expect(valid.has(ch)).toBe(true);
      }
    }
  });

  test("ASCII mode uses no characters above code point 127", () => {
    const frame = renderRippleFrame(30, 15, 5, {
      useColor: false,
      useUnicode: false,
    });
    for (const line of frame) {
      for (const ch of line) {
        expect(ch.charCodeAt(0)).toBeLessThan(128);
      }
    }
  });

  test("different time steps produce different frames", () => {
    const f0 = renderRippleFrame(30, 15, 0, {
      useColor: false,
      useUnicode: true,
    });
    const f10 = renderRippleFrame(30, 15, 10, {
      useColor: false,
      useUnicode: true,
    });
    expect(f0.join("\n")).not.toBe(f10.join("\n"));
  });

  test("colored output contains ANSI escape sequences", () => {
    const prevLevel = chalk.level;
    chalk.level = 3; // Force truecolor so chalk emits ANSI codes
    try {
      const frame = renderRippleFrame(30, 15, 5, {
        useColor: true,
        useUnicode: true,
      });
      const joined = frame.join("\n");
      expect(joined).toContain("\x1b[");
    } finally {
      chalk.level = prevLevel;
    }
  });

  test("center of pool has denser characters than edges", () => {
    const frame = renderRippleFrame(40, 20, 5, {
      useColor: false,
      useUnicode: true,
    });
    // Center row, center column area
    const centerRow = frame[10];
    const centerChar = centerRow[20];
    // Edge row (near boundary)
    const edgeRow = frame[1];
    const edgeChar = edgeRow[20];
    // Center should be denser (higher index in ramp) than edge
    const centerIdx = UNICODE_DENSITY.indexOf(centerChar);
    const edgeIdx = UNICODE_DENSITY.indexOf(edgeChar);
    expect(centerIdx).toBeGreaterThanOrEqual(edgeIdx);
  });

  test("exports expected animation constants", () => {
    expect(RIPPLE_FRAME_COUNT).toBe(40);
    expect(RIPPLE_FRAME_DELAY_MS).toBe(55);
  });

  test("handles small dimensions without errors", () => {
    const frame = renderRippleFrame(10, 5, 0, {
      useColor: false,
      useUnicode: true,
    });
    expect(frame).toHaveLength(5);
    for (const line of frame) {
      expect(line).toHaveLength(10);
    }
  });
});
