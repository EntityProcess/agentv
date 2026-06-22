#!/usr/bin/env bun
import { defineVitestWorkspaceGrader } from '@agentv/sdk';

export default defineVitestWorkspaceGrader({
  testFile: 'verifiers/welcome-banner.test.ts',
});
