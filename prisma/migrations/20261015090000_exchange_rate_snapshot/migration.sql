-- CreateTable
CREATE TABLE "public"."ExchangeRateSnapshot" (
    "base" TEXT NOT NULL,
    "rates" JSONB NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRateSnapshot_pkey" PRIMARY KEY ("base")
);

