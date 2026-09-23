-- CreateIndex
CREATE INDEX "event_deliveries_status_next_attempt_at_idx" ON "event_deliveries"("status", "next_attempt_at");
