import { configurePortableEnvironment } from "./portable-environment.ts";

await configurePortableEnvironment();
await import("./desktop.ts");
