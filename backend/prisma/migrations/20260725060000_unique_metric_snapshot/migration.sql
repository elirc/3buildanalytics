-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_metricKey_periodStart_periodEnd_key" ON "MetricSnapshot"("metricKey", "periodStart", "periodEnd");

