import { configurePortableEnvironment } from "./portable-environment.ts";

console.log("Hello from ./launcher/src/desktop/index.ts");

await configurePortableEnvironment();
await import("./desktop.ts");
