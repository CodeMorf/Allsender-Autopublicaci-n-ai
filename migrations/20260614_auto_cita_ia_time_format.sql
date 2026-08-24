-- Auto Cita IA Fase 2.7
-- Preferencia comercial para mostrar horas en formato 12h o 24h.

ALTER TABLE reservation_ai_settings
ADD COLUMN IF NOT EXISTS time_format text NOT NULL DEFAULT '12h';

UPDATE reservation_ai_settings
SET time_format = '12h'
WHERE time_format IS NULL OR time_format NOT IN ('12h', '24h');
