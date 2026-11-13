import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnv } from './env';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

/** Boots the api. The entry file installs the engines first; this file never names one, so the
 *  production entry's file trace can prove it never reaches the cli workspace. */
export function bootstrap(): void {
  const start = async () => {
    loadEnv(); // before NestFactory.create() — providers read process.env at instantiation
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    configureApp(app);
    await app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1');
  };
  start().catch((err: unknown) => {
    console.error('api failed to start:', err);
    process.exitCode = 1;
  });
}
