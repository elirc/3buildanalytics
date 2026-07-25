-- CreateEnum
CREATE TYPE "AlertComparator" AS ENUM ('GREATER_THAN', 'LESS_THAN');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('FIRING', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metricType" "MonitoringMetricType" NOT NULL,
    "comparator" "AlertComparator" NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowMinutes" INTEGER NOT NULL DEFAULT 15,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'FIRING',
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertRule_metricType_idx" ON "AlertRule"("metricType");

-- CreateIndex
CREATE INDEX "AlertRule_isEnabled_idx" ON "AlertRule"("isEnabled");

-- CreateIndex
CREATE INDEX "AlertEvent_ruleId_status_idx" ON "AlertEvent"("ruleId", "status");

-- CreateIndex
CREATE INDEX "AlertEvent_firedAt_idx" ON "AlertEvent"("firedAt");

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

