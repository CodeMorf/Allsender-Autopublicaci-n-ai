BEGIN;

ALTER TABLE reservation_ai_settings
  ADD COLUMN IF NOT EXISTS business_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS business_description TEXT,
  ADD COLUMN IF NOT EXISTS agent_personality TEXT,
  ADD COLUMN IF NOT EXISTS booking_policy TEXT,
  ADD COLUMN IF NOT EXISTS closed_message TEXT,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) DEFAULT 'America/Santo_Domingo';

UPDATE reservation_ai_settings
SET
  agent_personality = COALESCE(NULLIF(agent_personality, ''), 'Profesional, amable, claro y conversacional. No sonar como bot.'),
  booking_policy = COALESCE(NULLIF(booking_policy, ''), 'Confirmar servicio, fecha, hora, nombre y contacto antes de crear la cita.'),
  closed_message = COALESCE(NULLIF(closed_message, ''), 'Ahora mismo estamos fuera de horario, pero puedo ayudarte a dejar tu solicitud de cita.'),
  timezone = COALESCE(NULLIF(timezone, ''), 'America/Santo_Domingo')
WHERE true;

COMMIT;
