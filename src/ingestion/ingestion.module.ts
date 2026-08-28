import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { IngestionController } from "./ingestion.controller";
import { IngestionService } from "./ingestion.service";

@Module({
  imports: [PrismaModule],
  controllers: [IngestionController],
  providers: [IngestionService],
})
export class IngestionModule {}
