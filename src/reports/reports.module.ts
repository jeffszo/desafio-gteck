import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { MoneyModule } from "../money/money.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [PrismaModule, MoneyModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
