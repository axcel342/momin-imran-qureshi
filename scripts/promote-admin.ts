import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) throw new Error('usage: npm run promote-admin -- <email>');
  const prisma = new PrismaClient();
  const { count } = await prisma.user.updateMany({ where: { email }, data: { role: 'ADMIN' } });
  console.log(
    count > 0
      ? `Promoted ${email} to ADMIN`
      : `No user with email ${email} (they must bind a key once first)`,
  );
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
