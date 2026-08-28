import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ReconciliationController } from "./reconciliation.controller";
import { ReconciliationService } from "./reconciliation.service";

@Module({
  imports: [PrismaModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
