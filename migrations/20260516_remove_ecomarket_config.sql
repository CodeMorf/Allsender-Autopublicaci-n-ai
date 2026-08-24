DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ecomarket_ai_configs'
  ) THEN
    DELETE FROM public.ecomarket_ai_configs;
  END IF;
END $$;
