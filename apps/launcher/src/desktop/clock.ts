export type ClockTimer = ReturnType<typeof setTimeout>;

export interface Clock {
  now(): number;
  setTimeout(callback: () => void | Promise<void>, delayMs: number): ClockTimer;
  clearTimeout(timer: ClockTimer): void;
  setInterval(callback: () => void | Promise<void>, delayMs: number): ClockTimer;
  clearInterval(timer: ClockTimer): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (timer) => clearInterval(timer),
};
