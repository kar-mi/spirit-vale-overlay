import { expect, test } from "bun:test";
import { timelineCoordinates } from "./timeline-chart.tsx";

test("timelineCoordinates maps elapsed time and values into the plot area", () => {
  const result = timelineCoordinates(
    [{ elapsedMs: 0, value: 0 }, { elapsedMs: 1_000, value: 10 }],
    1_000,
    100,
    100,
    { left: 10, top: 10, right: 10, bottom: 10 },
  );
  expect(result).toBe("10,90 90,10");
});
