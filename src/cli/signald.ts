#!/usr/bin/env node
import "dotenv/config";
import { startSignalD } from "../index.js";

await startSignalD(readConfigArg() ?? process.env.SIGNALD_CONFIG);

function readConfigArg(): string | undefined {
  const index = process.argv.indexOf("--config");
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return undefined;
}
