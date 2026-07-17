import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export const DATABASE_PROVIDERS = ['sqlite', 'mysql'];
const SETUP_FILE_NAME = 'database-provider.json';

function normalizeProvider(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function assertKnownProvider(provider) {
  if (!DATABASE_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported database provider: ${provider || 'empty'}.`);
  }
}

export function getConfiguredDatabaseProvider(env = process.env) {
  const provider = normalizeProvider(env.DATABASE_PROVIDER);
  if (!provider || provider === 'auto') return null;
  assertKnownProvider(provider);
  return provider;
}

export function getAvailableDatabaseProviders(env = process.env) {
  const configuredProvider = getConfiguredDatabaseProvider(env);
  return configuredProvider ? [configuredProvider] : DATABASE_PROVIDERS;
}

export function getDatabaseDataDirectory(env = process.env) {
  return path.resolve(env.LEDGERFLOW_DATA_DIR || path.join(process.cwd(), 'data'));
}

export function getDatabaseSetupFilePath(env = process.env) {
  return path.join(getDatabaseDataDirectory(env), SETUP_FILE_NAME);
}

export function getSqliteDatabasePath(env = process.env) {
  const configuredPath = String(env.SQLITE_PATH || '').trim();
  return path.resolve(
    configuredPath || path.join(getDatabaseDataDirectory(env), 'ledgerflow.sqlite')
  );
}

async function readSetupFile(env = process.env) {
  try {
    const raw = await readFile(getDatabaseSetupFilePath(env), 'utf8');
    const parsed = JSON.parse(raw);
    const provider = normalizeProvider(parsed?.provider);
    assertKnownProvider(provider);

    return {
      version: Number(parsed.version || 1),
      provider,
      initializedAt: String(parsed.initializedAt || '')
    };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw new Error('Database provider setup metadata is invalid.');
  }
}

export async function getDatabaseSetupStatus(env = process.env) {
  const setup = await readSetupFile(env);
  const configuredProvider = getConfiguredDatabaseProvider(env);

  return {
    initialized: Boolean(setup),
    provider: setup?.provider || null,
    initializedAt: setup?.initializedAt || null,
    allowedProviders: getAvailableDatabaseProviders(env),
    configuredProvider,
    configurationMismatch: Boolean(
      setup && configuredProvider && setup.provider !== configuredProvider
    )
  };
}

export async function initializeDatabaseProvider({
  provider,
  env = process.env,
  validateProvider
}) {
  const normalizedProvider = normalizeProvider(provider);
  assertKnownProvider(normalizedProvider);

  const availableProviders = getAvailableDatabaseProviders(env);
  if (!availableProviders.includes(normalizedProvider)) {
    throw new Error(`This deployment only permits the ${availableProviders.join(', ')} provider.`);
  }

  const existing = await readSetupFile(env);
  if (existing) {
    if (existing.provider !== normalizedProvider) {
      throw new Error(
        `Database provider is already locked to ${existing.provider}. Export and migrate data to change it.`
      );
    }
    return { ...existing, created: false };
  }

  if (typeof validateProvider === 'function') {
    await validateProvider(normalizedProvider);
  }

  const dataDirectory = getDatabaseDataDirectory(env);
  const setupPath = getDatabaseSetupFilePath(env);
  const setup = {
    version: 1,
    provider: normalizedProvider,
    initializedAt: new Date().toISOString()
  };

  await mkdir(dataDirectory, { recursive: true });

  try {
    const file = await open(setupPath, 'wx');
    try {
      await file.writeFile(`${JSON.stringify(setup, null, 2)}\n`, 'utf8');
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'EEXIST')) {
      throw error;
    }

    const concurrentSetup = await readSetupFile(env);
    if (concurrentSetup?.provider === normalizedProvider) {
      return { ...concurrentSetup, created: false };
    }
    throw new Error('Database provider was initialized by another request. Refresh setup status.');
  }

  return { ...setup, created: true };
}
