import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Railway runs behind one proxy — trust it so req.ip is the real client IP
  // (required for the per-IP rate limit on /analysis/trigger to work).
  app.set('trust proxy', 1);
  app.enableCors();
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
