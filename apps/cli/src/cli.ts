#!/usr/bin/env node
import { runCli } from './index.js';

runCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
