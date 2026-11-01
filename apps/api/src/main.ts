import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Detrás de un proxy (Nginx, Caddy, Traefik) hace falta para que el límite de intentos vea la IP real
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true });
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // Swagger solo fuera de producción, salvo que se pida explícitamente
  const docs = process.env.NODE_ENV !== 'production' || process.env.ENABLE_DOCS === 'true';
  const config = new DocumentBuilder().setTitle('Finanzas API').setVersion('0.1').addBearerAuth().build();
  if (docs) SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`API:  http://localhost:${port}/api   Docs: http://localhost:${port}/docs`);
}
bootstrap();
