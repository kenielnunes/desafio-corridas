-- A collation padrão (utf8mb4_unicode_ci) ignora maiúsculas, acentos e espaço no fim:
-- 'Ana' seria dona das corridas de 'ana'. Identificadores precisam de comparação exata.
ALTER TABLE `rides`
    MODIFY `passenger_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    MODIFY `driver_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    MODIFY `idempotency_key` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
