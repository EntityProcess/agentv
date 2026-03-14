import { resolveAgentvCommand } from "./paths.js";

/**
 * Creates a CLI invocation with the resolved agentv command and appended arguments
 */
export function createAgentvCliInvocation(args: string[]): string[] {
  return [...resolveAgentvCommand(), ...args];
}
