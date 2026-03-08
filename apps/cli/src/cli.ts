#!/usr/bin/env node
import { runCli } from './index.js';

runCli()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    } else {
      console.error(error);
    }
    process.exit(1);
  });
