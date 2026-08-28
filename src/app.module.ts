import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { ReportsModule } from "./reports/reports.module";
import { ReconciliationModule } from "./reconciliation/reconciliation.module";

@Module({
  imports: [PrismaModule, IngestionModule, ReportsModule, ReconciliationModule],
  controllers: [AppController],
})
export class AppModule {}
