-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "next_check_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "payments_next_check_at_idx" ON "payments"("next_check_at");
