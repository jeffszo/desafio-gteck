import "dotenv/config";
import { PrismaService } from "../prisma/prisma.service";

// Não existe uma base de teste separada nesse projeto (compose.yml só
// sobe um Postgres, e é o mesmo DATABASE_URL do .env pra dev e pra
// teste). Então em vez de isolar por banco, cada spec isola pelos dados
// que cria: prefixo próprio em id/siteRef/siteCode e um intervalo de
// datas (2030) que não encosta em nada do prisma/seed.sql (que é todo em
// julho de 2026). Cada spec limpa só o que criou, no afterAll.
export const testPrisma = new PrismaService();
