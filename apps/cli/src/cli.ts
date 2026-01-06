#!/usr/bin/env node
import { runCli } from './index.js';

runCli()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
