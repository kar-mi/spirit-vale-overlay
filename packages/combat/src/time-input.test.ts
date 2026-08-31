import { describe, expect, test } from "bun:test";

import { formatTimeInput, normalizeTimeText, parseTwelveHourTime } from "./mainview/past-session-panel.tsx";

describe("typed 12-hour time", () => {
  test("inserts the colon when minute digits are supplied", () => {
    expect(formatTimeInput("9")).toBe("9");
    expect(formatTimeInput("12")).toBe("12");
    expect(formatTimeInput("930")).toBe("9:30");
    expect(formatTimeInput("1230")).toBe("12:30");
  });

  test("reinterprets the fourth digit while typing one key at a time", () => {
    let value = "";
    for (const digit of "1222") value = formatTimeInput(value + digit);
    expect(value).toBe("12:22");

    value = "";
    for (const digit of "1230") value = formatTimeInput(value + digit);
    expect(value).toBe("12:30");
  });

  test("accepts an optional manually typed colon", () => {
    expect(formatTimeInput("9:")).toBe("9:");
    expect(formatTimeInput("9:3")).toBe("9:3");
    expect(formatTimeInput("9:30")).toBe("9:30");
  });

  test("resolves hour-only and partial values on blur", () => {
    expect(normalizeTimeText("9")).toBe("9:00");
    expect(normalizeTimeText("12")).toBe("12:00");
    expect(normalizeTimeText("9:3")).toBe("9:03");
  });

  test("converts noon and midnight correctly", () => {
    expect(parseTwelveHourTime("12:00", "AM")).toEqual({ hour: 0, minute: 0 });
    expect(parseTwelveHourTime("12:00", "PM")).toEqual({ hour: 12, minute: 0 });
    expect(parseTwelveHourTime("9:30", "PM")).toEqual({ hour: 21, minute: 30 });
  });
});
