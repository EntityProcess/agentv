import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatchAgentSession } from "subagent";

import type { VSCodeResolvedConfig } from "./targets.js";
import type { Provider, ProviderRequest, ProviderResponse } from "./types.js";

const PROMPT_FILE_PREFIX = "bbeval-vscode-";

export class VSCodeProvider implements Provider {
  readonly id: string;
  readonly kind: "vscode" | "vscode-insiders";
  readonly targetName: string;

  private readonly config: VSCodeResolvedConfig;

  constructor(
    targetName: string,
    config: VSCodeResolvedConfig,
    kind: "vscode" | "vscode-insiders",
  ) {
    this.id = `${kind}:${targetName}`;
    this.kind = kind;
    this.targetName = targetName;
    this.config = config;
  }

  async invoke(request: ProviderRequest): Promise<ProviderResponse> {
    if (request.signal?.aborted) {
      throw new Error("VS Code provider request was aborted before dispatch");
    }

    const promptContent = buildPromptDocument(request);
    const directory = await mkdtemp(path.join(tmpdir(), PROMPT_FILE_PREFIX));
    const promptPath = path.join(directory, `${request.testCaseId ?? "request"}.prompt.md`);

    try {
      await writeFile(promptPath, promptContent, "utf8");

      const attachments = normalizeAttachments(request.attachments);
      const session = await dispatchAgentSession({
        userQuery: composeUserQuery(request),
        promptFile: promptPath,
        extraAttachments: attachments,
        wait: this.config.waitForResponse,
        dryRun: this.config.dryRun,
        vscodeCmd: this.config.command,
        subagentRoot: this.config.subagentRoot,
      });

      if (session.exitCode !== 0 || !session.responseFile) {
        const failure = session.error ?? "VS Code subagent did not produce a response";
        throw new Error(failure);
      }

      if (this.config.dryRun) {
        return {
          text: "",
          raw: {
            session,
            promptFile: promptPath,
            attachments,
          },
        };
      }

      const responseText = await readFile(session.responseFile, "utf8");

      return {
        text: responseText,
        raw: {
          session,
          promptFile: promptPath,
          attachments,
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

function buildPromptDocument(request: ProviderRequest): string {
  const parts: string[] = [];

  // Add mandatory preread block if guidelines or attachments exist
  const guidelineFiles = extractGuidelineFiles(request.guidelines);
  if (guidelineFiles.length > 0 || (request.attachments && request.attachments.length > 0)) {
    parts.push(buildMandatoryPrereadBlock(guidelineFiles, request.attachments));
  }

  parts.push(`# BbEval Request`);
  if (request.testCaseId) {
    parts.push(`- Test Case: ${request.testCaseId}`);
  }
  if (request.metadata?.target) {
    parts.push(`- Target: ${String(request.metadata.target)}`);
  }

  parts.push("\n## Task\n", request.prompt.trim());

  if (request.guidelines && request.guidelines.trim().length > 0) {
    parts.push("\n## Guidelines\n", request.guidelines.trim());
  }

  if (request.attachments && request.attachments.length > 0) {
    const attachmentList = request.attachments.map((item) => `- ${item}`).join("\n");
    parts.push("\n## Attachments\n", attachmentList);
  }

  return parts.join("\n").trim();
}

function extractGuidelineFiles(guidelines: string | undefined): string[] {
  if (!guidelines || guidelines.trim().length === 0) {
    return [];
  }

  const files: string[] = [];
  // Match paths that look like instruction files
  // Patterns: *.instructions.md, /instructions/, @instructions/
  const patterns = [
    /(?:^|\s)([^\s]+\.instructions\.md)/gi,
    /(?:^|\s)([^\s]*\/instructions\/[^\s]+)/gi,
    /(?:^|\s)@instructions\/([^\s]+)/gi,
  ];

  for (const pattern of patterns) {
    const matches = guidelines.matchAll(pattern);
    for (const match of matches) {
      files.push(match[1]);
    }
  }

  return [...new Set(files)];
}

function buildMandatoryPrereadBlock(
  guidelineFiles: string[],
  attachments: readonly string[] | undefined,
): string {
  const allFiles = [
    ...guidelineFiles,
    ...(attachments?.filter((f) => f.endsWith(".instructions.md") || f.includes("/instructions/")) ??
      []),
  ];

  if (allFiles.length === 0) {
    return "";
  }

  const fileList: string[] = [];
  const tokenList: string[] = [];

  allFiles.forEach((filePath, index) => {
    const fileName = path.basename(filePath);
    const fileUri = pathToFileUri(filePath);
    fileList.push(`[${fileName}](${fileUri})`);
    tokenList.push(`INSTRUCTIONS_READ: \`${fileName}\` i=${index + 1} SHA256=<hex>`);
  });

  const filesText = fileList.join(", ");
  const tokensText = tokenList.join("\n");

  const instruction = [
    `Read all instruction files: ${filesText}.`,
    `After reading each file, compute its SHA256 hash using this PowerShell command:`,
    "`Get-FileHash -Algorithm SHA256 -LiteralPath '<file-path>' | Select-Object -ExpandProperty Hash`.",
    `Then include, at the top of your reply, these exact tokens on separate lines:\n`,
    tokensText,
    `\nReplace \`<hex>\` with the actual SHA256 hash value computed from the PowerShell command.`,
    `If any file is missing, fail with ERROR: missing-file <filename> and stop.\n`,
    `Then fetch all documentation required by the instructions before proceeding with your task.`,
  ].join(" ");

  return `[[ ## mandatory_pre_read ## ]]\n\n${instruction}\n\n`;
}

function pathToFileUri(filePath: string): string {
  // Convert to absolute path if relative
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

  // On Windows, convert backslashes to forward slashes
  const normalizedPath = absolutePath.replace(/\\/g, "/");

  // Handle Windows drive letters (e.g., C:/ becomes file:///C:/)
  if (/^[a-zA-Z]:\//.test(normalizedPath)) {
    return `file:///${normalizedPath}`;
  }

  // Unix-like paths
  return `file://${normalizedPath}`;
}

function composeUserQuery(request: ProviderRequest): string {
  const segments: string[] = [];
  segments.push(request.prompt.trim());
  if (request.guidelines && request.guidelines.trim().length > 0) {
    segments.push("\nGuidelines:\n", request.guidelines.trim());
  }
  return segments.join("\n").trim();
}

function normalizeAttachments(attachments: readonly string[] | undefined): string[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }
  const deduped = new Set<string>();
  for (const attachment of attachments) {
    deduped.add(path.resolve(attachment));
  }
  return Array.from(deduped);
}
