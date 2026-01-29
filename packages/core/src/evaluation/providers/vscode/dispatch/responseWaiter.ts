import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { pathExists } from '../utils/fs.js';
import { sleep } from '../utils/time.js';

export async function waitForResponseOutput(
  responseFileFinal: string,
  pollInterval = 1000,
  silent = false,
): Promise<boolean> {
  if (!silent) {
    console.error(`waiting for agent to finish: ${responseFileFinal}`);
  }

  try {
    while (!(await pathExists(responseFileFinal))) {
      await sleep(pollInterval);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  let attempts = 0;
  const maxAttempts = 10;
  while (attempts < maxAttempts) {
    try {
      const content = await readFile(responseFileFinal, { encoding: 'utf8' });
      if (!silent) {
        process.stdout.write(`${content}\n`);
      }
      return true;
    } catch (error) {
      attempts += 1;
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempts >= maxAttempts) {
        if (!silent) {
          console.error(`error: failed to read agent response: ${(error as Error).message}`);
        }
        return false;
      }
      await sleep(pollInterval);
    }
  }

  return false;
}

export async function waitForBatchResponses(
  responseFilesFinal: readonly string[],
  pollInterval = 1000,
  silent = false,
): Promise<boolean> {
  if (!silent) {
    const fileList = responseFilesFinal.map((file) => path.basename(file)).join(', ');
    console.error(`waiting for ${responseFilesFinal.length} batch response(s): ${fileList}`);
  }

  try {
    const pending = new Set(responseFilesFinal);
    while (pending.size > 0) {
      for (const file of [...pending]) {
        if (await pathExists(file)) {
          pending.delete(file);
        }
      }

      if (pending.size > 0) {
        await sleep(pollInterval);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  for (const file of responseFilesFinal) {
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      try {
        const content = await readFile(file, { encoding: 'utf8' });
        if (!silent) {
          process.stdout.write(`${content}\n`);
        }
        break;
      } catch (error) {
        attempts += 1;
        if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempts >= maxAttempts) {
          if (!silent) {
            console.error(`error: failed to read agent response: ${(error as Error).message}`);
          }
          return false;
        }
        await sleep(pollInterval);
      }
    }
  }

  return true;
}
