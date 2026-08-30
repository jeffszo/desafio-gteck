import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { JsonLoggerService } from "./common/json-logger.service";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";

async function bootstrap() {

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(new JsonLoggerService());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(3000);
}

bootstrap();
