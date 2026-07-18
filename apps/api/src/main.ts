import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  if (!process.env.API_KEY && process.env.AUTH_DISABLED !== 'true') {
    throw new Error(
      'API_KEY is not set. Refusing to start with authentication disabled. Set API_KEY, or set AUTH_DISABLED=true to run without auth (development only).',
    );
  }
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Andon API listening on port ${port}`);
}
bootstrap();
