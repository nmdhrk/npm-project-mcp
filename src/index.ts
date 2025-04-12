import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { z } from 'zod';

const server = new McpServer({
  name: 'npm-project',
  version: '0.1.0',
  capabilities: {
    resources: {},
    tools: {},
  },
});

server.tool(
  'npm-install',
  'Install all dependencies for a Node.js project by running npm install in the specified folder',
  {
    folder: z.string().describe('Absolute path to the project folder'),
  },
  async ({ folder }) => {
    const result = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${folder}:/app`,
        '-w',
        '/app',
        'node:20-alpine',
        'sh',
        '-c',
        'npm install',
      ],
      {
        encoding: 'utf-8',
        timeout: 10000,
      }
    );

    if (result.error || result.status !== 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error (exit ${result.status}):\n${result.stderr || result.error?.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Output:\n${result.stdout.trim()}`,
        },
      ],
    };
  }
);

server.tool(
  'list-npm-script',
  'List all available scripts defined in the `package.json` of the specified Node.js project.',
  {
    folder: z
      .string()
      .describe('Absolute path to the Node.js project folder containing package.json'),
  },
  async ({ folder }) => {
    try {
      const packageJsonPath = path.join(folder, 'package.json');
      const fileContent = readFileSync(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(fileContent);

      const scripts = pkg.scripts;
      if (!scripts || typeof scripts !== 'object') {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No scripts found in package.json.',
            },
          ],
        };
      }

      const scriptLines = Object.entries(scripts)
        .map(([name, cmd]) => `- ${name}: ${cmd}`)
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Available npm scripts:\n\n${scriptLines}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to read package.json: ${err.message || err.toString()}`,
          },
        ],
      };
    }
  }
);

server.tool(
  'run-npm-script',
  'Run a named `npm` script from the specified project folder. Optionally, the script can be run as a persistent background process inside a Docker container.',
  {
    folder: z.string().describe('Absolute path to the Node.js project folder'),
    scriptName: z
      .string()
      .describe('Name of the script defined in package.json to run (e.g. build, start)'),
    persist: z.boolean().optional().default(false),
    containerName: z
      .string()
      .optional()
      .describe('Name to assign to the persistent container (only used if persist is true)'),
    portMap: z
      .string()
      .optional()
      .describe('Port mapping like "3000:3000" (only used if persist is true)'),
  },
  async ({ folder, scriptName, persist, containerName, portMap }) => {
    const absPath = path.resolve(folder);
    const image = 'node:20-alpine';

    if (persist) {
      const name = containerName ? `mcp-${containerName}` : `mcp-${scriptName}-${Date.now()}`;
      const args = [
        'run',
        '-d',
        '--name',
        name,
        ...(portMap ? ['-p', portMap] : []),
        '-v',
        `${absPath}:/app`,
        '-w',
        '/app',
        image,
        'npm',
        'run',
        scriptName,
      ];

      const result = spawnSync('docker', args, { encoding: 'utf-8' });

      if (result.error || result.status !== 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to start persistent script:\n${
                result.stderr || result.error?.message || 'Unknown error'
              }`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Persistent script '${scriptName}' started in container '${name}'${
              portMap ? ` (port ${portMap})` : ''
            }.`,
          },
        ],
      };
    } else {
      // 一時コンテナで実行（完了まで待つ）
      const args = [
        'run',
        '--rm',
        '-v',
        `${absPath}:/app`,
        '-w',
        '/app',
        image,
        'npm',
        'run',
        scriptName,
      ];

      const result = spawnSync('docker', args, {
        encoding: 'utf-8',
        timeout: 60000,
      });

      if (result.error || result.status !== 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Script '${scriptName}' failed:\n${
                result.stderr || result.error?.message || 'Unknown error'
              }`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Output of '${scriptName}':\n${result.stdout.trim()}`,
          },
        ],
      };
    }
  }
);

server.tool(
  'stop-process',
  'Stop a background process started by `npm-run-script` by removing the corresponding Docker container.',
  {
    containerName: z.string().describe('Name of the Docker container to stop and remove'),
  },
  async ({ containerName }) => {
    const inspect = spawnSync('docker', ['inspect', containerName], {
      encoding: 'utf-8',
    });

    if (inspect.status !== 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No running container named '${containerName}' was found.`,
          },
        ],
      };
    }

    const result = spawnSync('docker', ['rm', '-f', containerName], {
      encoding: 'utf-8',
    });

    if (result.status === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Container '${containerName}' has been stopped and removed.`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to stop container '${containerName}':\n${
              result.stderr || 'Unknown error'
            }`,
          },
        ],
      };
    }
  }
);

server.tool(
  'list-running-processes',
  'List all running Docker containers started by this system.',
  {},
  async () => {
    const result = spawnSync('docker', ['ps', '--format', '{{json .}}'], {
      encoding: 'utf-8',
    });

    if (result.status !== 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to list running containers:\n${result.stderr}`,
          },
        ],
      };
    }

    const lines = result.stdout.trim().split('\n');
    const processes = lines
      .map((line) => JSON.parse(line))
      .filter((p) => p.Names?.startsWith('mcp-'));

    if (processes.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No running MCP-managed processes found.',
          },
        ],
      };
    }

    const formatted = processes
      .map((p) => `- ${p.Names}: ${p.Status}${p.Ports ? ` (ports: ${p.Ports})` : ''}`)
      .join('\n');

    return {
      content: [
        {
          type: 'text' as const,
          text: `Running MCP processes:\n\n${formatted}`,
        },
      ],
    };
  }
);

server.tool(
  'check-process-status',
  'Check whether a named background process (Docker container) is still running and optionally return its status and uptime.',
  {
    containerName: z.string().describe('Name of the Docker container to check'),
  },
  async ({ containerName }) => {
    const inspect = spawnSync('docker', ['inspect', containerName], {
      encoding: 'utf-8',
    });

    if (inspect.status !== 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No container named '${containerName}' was found.`,
          },
        ],
      };
    }

    try {
      const data = JSON.parse(inspect.stdout)[0];
      const state = data?.State;
      const startedAt = new Date(state?.StartedAt);
      const now = new Date();
      const uptimeSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
      const status = state?.Running ? 'running' : 'exited';

      const ports = data?.NetworkSettings?.Ports
        ? Object.keys(data.NetworkSettings.Ports).join(', ')
        : 'N/A';

      return {
        content: [
          {
            type: 'text' as const,
            text: `Container '${containerName}' is ${status}.\nUptime: ${uptimeSeconds} seconds\nPorts: ${ports}`,
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error checking status of '${containerName}': ${err.message || err.toString()}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Node exec Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
