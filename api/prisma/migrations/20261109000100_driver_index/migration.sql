-- CreateIndex
CREATE INDEX `rides_driver_id_created_at_idx` ON `rides`(`driver_id`, `created_at`);
