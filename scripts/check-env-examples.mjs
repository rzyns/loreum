import { readFile } from 'node:fs/promises';

const requiredExamples = [
  {
    path: '.env.example',
    keys: [
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
      'DB_PORT',
      'REDIS_PORT',
      'CONTAINER_SUFFIX',
      'OPENSEARCH_PORT',
      'OPENSEARCH_DISABLE_SECURITY',
      'OPENSEARCH_ADMIN_PASSWORD',
    ],
  },
  {
    path: 'apps/api/.env.example',
    keys: [
      'DATABASE_URL',
      'JWT_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_CALLBACK_URL',
      'API_PORT',
      'CORS_ORIGIN',
      'REDIS_URL',
      'JWT_ACCESS_TTL',
      'TOKEN_ROTATION_MINUTES',
      'SESSION_TTL_DAYS',
      'COOKIE_DOMAIN',
    ],
  },
  {
    path: 'apps/web/.env.example',
    keys: ['NEXT_PUBLIC_API_URL'],
  },
  {
    path: 'apps/mcp/.env.example',
    keys: ['MCP_API_BASE_URL', 'MCP_API_TOKEN'],
  },
];

const parseEnvKeys = (content) => {
  const keys = new Set();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);

    if (match) {
      keys.add(match[1]);
    }
  }

  return keys;
};

let failed = false;

for (const example of requiredExamples) {
  let content;

  try {
    content = await readFile(new URL(`../${example.path}`, import.meta.url), 'utf8');
  } catch (error) {
    failed = true;
    console.error(`Missing env example: ${example.path}`);
    continue;
  }

  const keys = parseEnvKeys(content);
  const missingKeys = example.keys.filter((key) => !keys.has(key));

  if (missingKeys.length > 0) {
    failed = true;
    console.error(`${example.path} is missing keys: ${missingKeys.join(', ')}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Env example coverage check passed.');
}
