#!/usr/bin/env node

import { createHash, createHmac } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_ASSET_BASE_URL =
  process.env.LEGACY_ASSET_BASE_URL ||
  'https://cloudreve-bei.oss-cn-guangzhou.aliyuncs.com/ledgerflow';
const EXTRA_ASSET_PATHS = [
  'ui/arrow-down-narrow-wide.svg',
  'ui/arrow-down-wide-narrow.svg'
];
const LEGACY_ASSET_PATTERN =
  /https:\/\/cloudreve-bei\.oss-cn-guangzhou\.aliyuncs\.com\/ledgerflow\/([A-Za-z0-9._/-]+)/g;
const R2_ASSET_PATTERN =
  /https:\/\/pub-[A-Za-z0-9]+\.r2\.dev\/([A-Za-z0-9._/-]+)/g;
const SOURCE_SCAN_ROOTS = ['src'];
const SOURCE_SCAN_FILES = ['index.html', 'vite.config.ts'];
const SKIPPED_SCAN_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git']);

const CONTENT_TYPES = new Map([
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

function printHelp() {
  console.log(`Usage:
  npm run assets:migrate:r2 -- --dry-run
  npm run assets:migrate:r2
  npm run assets:migrate:r2 -- --verify

Required for upload:
  R2_ACCOUNT_ID or R2_ENDPOINT
  R2_BUCKET
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY

Optional:
  R2_PREFIX              Object key prefix (default: empty, bucket root)
  R2_PUBLIC_BASE_URL     Public R2 domain used for post-upload verification
  LEGACY_ASSET_BASE_URL  Source asset base (default: current Aliyun OSS base)
  ASSET_CONCURRENCY      Parallel transfers (default: 6)

Flags:
  --dry-run   List discovered assets without downloading or uploading
  --verify    Verify assets through R2_PUBLIC_BASE_URL only
  --help      Show this help
`);
}

function trimUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeRelativeAssetPath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  if (
    !normalized ||
    normalized === 'ui' ||
    normalized.includes('..') ||
    normalized.includes('?') ||
    normalized.includes('#')
  ) {
    return null;
  }

  return normalized;
}

function buildAssetUrl(baseUrl, relativePath) {
  const encodedPath = relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${trimUrl(baseUrl)}/${encodedPath}`;
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_SCAN_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await collectFiles(path.join(directory, entry.name))));
      continue;
    }

    if (
      entry.isFile() &&
      !/\.test\.[cm]?[jt]sx?$/.test(entry.name) &&
      /\.(?:css|html|js|jsx|json|mjs|ts|tsx)$/.test(entry.name)
    ) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

async function discoverAssets() {
  const files = [];

  for (const root of SOURCE_SCAN_ROOTS) {
    files.push(...(await collectFiles(path.join(ROOT, root))));
  }

  for (const fileName of SOURCE_SCAN_FILES) {
    files.push(path.join(ROOT, fileName));
  }

  const assets = new Set(EXTRA_ASSET_PATHS);

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    for (const pattern of [LEGACY_ASSET_PATTERN, R2_ASSET_PATTERN]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const assetPath = normalizeRelativeAssetPath(match[1]);
        if (assetPath) assets.add(assetPath);
      }
    }
  }

  return [...assets].sort((left, right) => left.localeCompare(right, 'en'));
}

function contentTypeFor(assetPath, sourceContentType) {
  const normalizedContentType = String(sourceContentType || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();

  if (
    normalizedContentType &&
    normalizedContentType !== 'application/octet-stream' &&
    normalizedContentType !== 'binary/octet-stream'
  ) {
    return normalizedContentType;
  }

  return CONTENT_TYPES.get(path.extname(assetPath).toLowerCase()) || 'application/octet-stream';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function buildR2ObjectKey(config, relativePath) {
  return [config.prefix, relativePath].filter(Boolean).join('/');
}

function buildR2ObjectUrl(config, relativePath) {
  const objectKey = buildR2ObjectKey(config, relativePath);
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = new URL(
    `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodedKey}`
  );
  return { objectKey, url };
}

function buildR2Authorization(config, url, method, payloadHash) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalHeaders = [
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    ''
  ].join('\n');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

async function fetchWithRetry(url, options, label) {
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }

  throw new Error(`${label} failed after retries: ${lastError?.message || 'unknown error'}`);
}

async function downloadAsset(relativePath) {
  const sourceUrl = buildAssetUrl(LEGACY_ASSET_BASE_URL, relativePath);
  const response = await fetchWithRetry(sourceUrl, { method: 'GET' }, `download ${relativePath}`);

  if (!response.ok) {
    throw new Error(`download ${relativePath} returned HTTP ${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  return {
    body,
    contentType: contentTypeFor(relativePath, response.headers.get('content-type'))
  };
}

async function uploadAsset(config, relativePath, asset) {
  const { objectKey, url } = buildR2ObjectUrl(config, relativePath);
  const payloadHash = sha256(asset.body);
  const { amzDate, authorization } = buildR2Authorization(
    config,
    url,
    'PUT',
    payloadHash
  );
  const response = await fetchWithRetry(
    url,
    {
      method: 'PUT',
      body: asset.body,
      headers: {
        Authorization: authorization,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': asset.contentType,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate
      }
    },
    `upload ${objectKey}`
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`upload ${objectKey} returned HTTP ${response.status}: ${detail}`);
  }

  return { bytes: asset.body.length, key: objectKey };
}

async function verifyRemoteAsset(config, relativePath, expectedBytes) {
  const objectKey = buildR2ObjectKey(config, relativePath);
  const publicUrl = buildAssetUrl(config.publicBaseUrl, objectKey);
  const response = await fetchWithRetry(publicUrl, { method: 'HEAD' }, `verify ${objectKey}`);

  if (!response.ok) {
    throw new Error(`verify ${objectKey} returned HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(expectedBytes) &&
    Number.isFinite(contentLength) &&
    contentLength !== expectedBytes
  ) {
    throw new Error(
      `verify ${objectKey} size mismatch: expected ${expectedBytes}, received ${contentLength}`
    );
  }

  return objectKey;
}

function readR2Config({ requireCredentials }) {
  const endpoint =
    trimUrl(process.env.R2_ENDPOINT) ||
    (process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`
      : '');
  const config = {
    endpoint,
    bucket: String(process.env.R2_BUCKET || '').trim(),
    prefix: String(process.env.R2_PREFIX ?? '')
      .trim()
      .replace(/^\/+|\/+$/g, ''),
    publicBaseUrl: trimUrl(process.env.R2_PUBLIC_BASE_URL),
    region: 'auto',
    accessKeyId: String(process.env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY || '').trim()
  };

  if (!config.bucket) throw new Error('R2_BUCKET is required');

  if (requireCredentials) {
    if (!config.endpoint) throw new Error('R2_ENDPOINT or R2_ACCOUNT_ID is required');
    if (!config.accessKeyId) throw new Error('R2_ACCESS_KEY_ID is required');
    if (!config.secretAccessKey) throw new Error('R2_SECRET_ACCESS_KEY is required');
  }

  return config;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help')) {
    printHelp();
    return;
  }

  const assets = await discoverAssets();
  if (assets.length === 0) {
    throw new Error('No public assets were discovered');
  }

  if (args.has('--dry-run')) {
    console.log(`Discovered ${assets.length} public assets:`);
    for (const assetPath of assets) {
      console.log(`${buildAssetUrl(LEGACY_ASSET_BASE_URL, assetPath)}`);
    }
    return;
  }

  const verifyOnly = args.has('--verify');
  const config = readR2Config({ requireCredentials: !verifyOnly });
  if (!config.publicBaseUrl) {
    throw new Error('R2_PUBLIC_BASE_URL is required to verify migrated assets');
  }

  const concurrency = Math.max(Number(process.env.ASSET_CONCURRENCY) || 6, 1);
  let completed = 0;

  if (verifyOnly) {
    const verified = await mapWithConcurrency(assets, concurrency, async (assetPath) => {
      const key = await verifyRemoteAsset(config, assetPath);
      completed += 1;
      console.log(`[${completed}/${assets.length}] verified ${key}`);
      return key;
    });
    console.log(`Verified ${verified.length} R2 assets.`);
    return;
  }

  const migrated = await mapWithConcurrency(assets, concurrency, async (assetPath) => {
    const asset = await downloadAsset(assetPath);
    const uploaded = await uploadAsset(config, assetPath, asset);
    await verifyRemoteAsset(config, assetPath, uploaded.bytes);
    completed += 1;
    console.log(
      `[${completed}/${assets.length}] migrated ${uploaded.key} (${uploaded.bytes} bytes)`
    );
    return uploaded;
  });

  const totalBytes = migrated.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`Migrated and verified ${migrated.length} assets (${totalBytes} bytes).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
