import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PurchaseService } from '../purchase/purchase.service';

process.loadEnvFile?.('.env');

async function main() {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const purchase = context.get(PurchaseService);
    const result = await purchase.backfillOrderLifecycles('1');
    console.log(JSON.stringify(result, null, 2));
    if (result.failed) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
