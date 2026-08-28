import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma-client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL não configurada.");
    }

    super({ adapter: new PrismaPg({ connectionString }) });
  }

  public async onModuleInit() {
    await this.$connect();
  }

  public async onModuleDestroy() {
    await this.$disconnect();
  }
}
