-- Rede de segurança: se por algum motivo esta migration rodar sobre um
-- banco que já tenha a duplicata histórica (seed-fb-15/seed-fb-dup-125,
-- fb-site-nutrihealth-camp-1 / 2026-07-11) carregada de uma execução
-- anterior do seed, esse DELETE evita que a criação do índice único
-- abaixo falhe. Em um banco novo (o caminho normal: migrate antes de
-- seed) isso não afeta nada, porque a linha nunca chega a existir -- a
-- correção de verdade é ter tirado esse INSERT do próprio
-- prisma/seed.sql, senão todo `npm run prisma:seed` (que recarrega tudo
-- do zero) ia recriar o mesmo conflito de novo. Ver DECISIONS.md, seção 2.
DELETE FROM "FacebookAdMetric" WHERE id = 'seed-fb-dup-125';

-- Chave natural de idempotência da ingestão (ver DECISIONS.md, seção 3).
-- FacebookAdMetric é "uma linha por campanha/dia", então a chave inclui a
-- campanha -- duas campanhas do mesmo site no mesmo dia são duas linhas
-- legítimas, não um reenvio.
CREATE UNIQUE INDEX "FacebookAdMetric_externalCampaignId_localDate_key" ON "FacebookAdMetric"("externalCampaignId", "localDate");

-- GamAdMetric é "uma linha por site/dia" (GAM não tem conceito de
-- campanha aqui), a chave natural é só site + dia.
CREATE UNIQUE INDEX "GamAdMetric_siteCode_utcDate_key" ON "GamAdMetric"("siteCode", "utcDate");
