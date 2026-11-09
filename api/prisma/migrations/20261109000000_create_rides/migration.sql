-- CreateTable
CREATE TABLE `rides` (
    `id` CHAR(36) NOT NULL,
    `passenger_id` VARCHAR(64) NOT NULL,
    `driver_id` VARCHAR(64) NULL,
    `origin` VARCHAR(200) NOT NULL,
    `destination` VARCHAR(200) NOT NULL,
    `status` ENUM('requested', 'accepted', 'in_progress', 'finished') NOT NULL DEFAULT 'requested',
    `version` INTEGER NOT NULL DEFAULT 1,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rides_passenger_id_created_at_idx`(`passenger_id`, `created_at`),
    INDEX `rides_status_created_at_idx`(`status`, `created_at`),
    UNIQUE INDEX `uq_ride_idempotency`(`passenger_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
