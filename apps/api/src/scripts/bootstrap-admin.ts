import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

process.loadEnvFile?.('.env');

async function main() {
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!password || password.length < 8) throw new Error('BOOTSTRAP_ADMIN_PASSWORD 至少 8 位');
  const prisma = new PrismaClient();
  await prisma.hspsi_sys_user.update({
    where: { username: 'admin' },
    data: { password: await hash(password, 12), status: 1, updated_at: new Date() },
  });
  await prisma.$disconnect();
  console.log('管理员已安全启用');
}
main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
