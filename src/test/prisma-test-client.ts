import "dotenv/config";
import { PrismaService } from "../prisma/prisma.service";


export const testPrisma = new PrismaService();
