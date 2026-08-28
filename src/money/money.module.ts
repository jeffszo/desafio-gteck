import { Module } from "@nestjs/common";
import { MoneyService } from "./money.service";

@Module({
  providers: [MoneyService],
  exports: [MoneyService],
})
export class MoneyModule {}
