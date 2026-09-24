import { execSync } from 'node:child_process';
import { TEST_ENV } from './test-env';

export default async function globalSetup(): Promise<void> {
  const env = { ...process.env, DATABASE_URL: TEST_ENV.DATABASE_URL };
  for (let attempt = 1; ; attempt++) {
    try {
      execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
      return;
    } catch (err) {
      if (attempt >= 10) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
