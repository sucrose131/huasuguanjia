import { PrismaClient } from '@prisma/client';
import OSS from 'ali-oss';
import { ATTACHMENT_DOCUMENTS } from '../attachments/attachments.service';

process.loadEnvFile?.('.env');

type StoredAttachment = { objectKey?: unknown };
type OssObject = { name?: string; lastModified?: string | Date };

const execute = process.argv.includes('--execute');
const retentionHours = Number(process.env.OSS_ORPHAN_RETENTION_HOURS ?? 24);
if (!Number.isFinite(retentionHours) || retentionHours < 1)
  throw new Error('OSS_ORPHAN_RETENTION_HOURS 必须是大于等于1的数字');

const required = ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'] as const;
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} 未配置`);
}

const prisma = new PrismaClient();
const client = new OSS({
  region: process.env.OSS_REGION!,
  bucket: process.env.OSS_BUCKET!,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
  stsToken: process.env.OSS_STS_TOKEN || undefined,
  cname: Boolean(process.env.OSS_CNAME),
  endpoint: process.env.OSS_CNAME || undefined,
});

function attachments(value: unknown): StoredAttachment[] {
  if (Array.isArray(value)) return value as StoredAttachment[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function referencedObjectKeys() {
  const result = new Set<string>();
  const tables = [...new Set(Object.values(ATTACHMENT_DOCUMENTS).map((item) => item.table))];
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ attachments: unknown }>>(
      `SELECT attachments FROM \`${table}\` WHERE attachments IS NOT NULL`,
    );
    for (const row of rows) {
      for (const attachment of attachments(row.attachments)) {
        const key = String(attachment.objectKey ?? '').trim();
        if (key.startsWith('documents/')) result.add(key);
      }
    }
  }
  return result;
}

async function ossObjects() {
  const objects: OssObject[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.listV2({
      prefix: 'documents/',
      'continuation-token': continuationToken,
      'max-keys': 1000,
    });
    objects.push(...((response.objects ?? []) as OssObject[]));
    continuationToken = response.isTruncated ? response.nextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

async function main() {
  const [referenced, objects] = await Promise.all([referencedObjectKeys(), ossObjects()]);
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  const orphanKeys = objects
    .filter((object) => {
      const key = String(object.name ?? '');
      const modified = new Date(object.lastModified ?? 0).getTime();
      return key && !referenced.has(key) && Number.isFinite(modified) && modified < cutoff;
    })
    .map((object) => String(object.name));

  if (execute) {
    for (const key of orphanKeys) await client.delete(key);
  }

  console.log(
    JSON.stringify(
      {
        mode: execute ? 'execute' : 'dry-run',
        retentionHours,
        referencedObjects: referenced.size,
        scannedObjects: objects.length,
        orphanObjects: orphanKeys.length,
        orphanKeys,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
