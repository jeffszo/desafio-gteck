-- CreateTable
CREATE TABLE "FacebookAdMetric" (
    "id" TEXT NOT NULL,
    "externalCampaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "siteRef" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "accountTimezone" TEXT NOT NULL,
    "accountCurrency" TEXT NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacebookAdMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamAdMetric" (
    "id" TEXT NOT NULL,
    "networkCode" TEXT NOT NULL,
    "siteCode" TEXT NOT NULL,
    "utcDate" DATE NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "adRevenue" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "adRequests" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamAdMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteMapping" (
    "id" TEXT NOT NULL,
    "facebookSiteRef" TEXT NOT NULL,
    "gamSiteCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "revSharePct" DECIMAL(5,4) NOT NULL,
    "taxOnRevenuePct" DECIMAL(5,4) NOT NULL,
    "taxOnMediaCostPct" DECIMAL(5,4) NOT NULL,

    CONSTRAINT "SiteMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "date" DATE NOT NULL,
    "usdBrl" DECIMAL(10,6) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "FacebookAdMetric_siteRef_localDate_idx" ON "FacebookAdMetric"("siteRef", "localDate");

-- CreateIndex
CREATE INDEX "GamAdMetric_siteCode_utcDate_idx" ON "GamAdMetric"("siteCode", "utcDate");

-- CreateIndex
CREATE UNIQUE INDEX "SiteMapping_facebookSiteRef_key" ON "SiteMapping"("facebookSiteRef");

-- CreateIndex
CREATE UNIQUE INDEX "SiteMapping_gamSiteCode_key" ON "SiteMapping"("gamSiteCode");
