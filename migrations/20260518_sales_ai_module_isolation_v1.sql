BEGIN;

-- Sales AI module isolation v1
-- PostgreSQL migration. Keep legacy tables, but stop using ai_sales_chat_memory as source of truth.
-- Apply this before deploying the patched TypeScript files.

CREATE TABLE IF NOT EXISTS public.ai_sales_chat_memory_legacy_disabled_20260518 (
  id bigint PRIMARY KEY,
  backup_at timestamptz NOT NULL DEFAULT now(),
  team_id integer,
  chat_id integer,
  customer_name text,
  customer_phone text,
  customer_alt_phone text,
  customer_address text,
  product_hint text,
  payment_method text,
  last_user_intent text,
  raw_summary jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

INSERT INTO public.ai_sales_chat_memory_legacy_disabled_20260518 (
  id, backup_at, team_id, chat_id, customer_name, customer_phone, customer_alt_phone,
  customer_address, product_hint, payment_method, last_user_intent, raw_summary, created_at, updated_at
)
SELECT
  id, now(), team_id, chat_id, customer_name, customer_phone, customer_alt_phone,
  customer_address, product_hint, payment_method, last_user_intent, raw_summary, created_at, updated_at
FROM public.ai_sales_chat_memory
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ai_sales_conversation_state
  ADD COLUMN IF NOT EXISTS pending_choice_type varchar(40),
  ADD COLUMN IF NOT EXISTS pending_choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_lat numeric(10,7),
  ADD COLUMN IF NOT EXISTS delivery_lng numeric(10,7),
  ADD COLUMN IF NOT EXISTS delivery_name text,
  ADD COLUMN IF NOT EXISTS delivery_address_text text,
  ADD COLUMN IF NOT EXISTS delivery_maps_url text,
  ADD COLUMN IF NOT EXISTS order_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_processed_message_id text,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text;

CREATE INDEX IF NOT EXISTS ai_sales_conversation_state_pending_choice_idx
  ON public.ai_sales_conversation_state(team_id, chat_id, pending_choice_type);

CREATE INDEX IF NOT EXISTS ai_sales_conversation_state_last_processed_message_idx
  ON public.ai_sales_conversation_state(last_processed_message_id);

CREATE INDEX IF NOT EXISTS ai_sales_conversation_state_order_draft_gin_idx
  ON public.ai_sales_conversation_state USING gin(order_draft);

CREATE TABLE IF NOT EXISTS public.ai_sales_processed_messages (
  id bigserial PRIMARY KEY,
  team_id integer NOT NULL,
  chat_id integer NOT NULL,
  message_id text NOT NULL,
  provider varchar(60) NOT NULL DEFAULT 'evolution',
  action varchar(80),
  processed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(team_id, message_id)
);

CREATE INDEX IF NOT EXISTS ai_sales_processed_messages_chat_idx
  ON public.ai_sales_processed_messages(team_id, chat_id, processed_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_sales_order_drafts (
  id bigserial PRIMARY KEY,
  team_id integer NOT NULL,
  chat_id integer NOT NULL,
  contact_id integer,
  selected_product_id integer,
  quantity integer NOT NULL DEFAULT 1,
  customer_name text,
  customer_phone varchar(80),
  customer_alt_phone varchar(80),
  customer_address text,
  delivery_lat numeric(10,7),
  delivery_lng numeric(10,7),
  delivery_name text,
  delivery_address_text text,
  delivery_maps_url text,
  payment_method varchar(60),
  selected_payment_account_id varchar(120),
  draft_status varchar(40) NOT NULL DEFAULT 'active',
  created_order_id integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_sales_order_drafts_active_unique
  ON public.ai_sales_order_drafts(team_id, chat_id)
  WHERE draft_status IN ('active', 'ready_to_create_order', 'payment_pending');

CREATE INDEX IF NOT EXISTS ai_sales_order_drafts_team_chat_idx
  ON public.ai_sales_order_drafts(team_id, chat_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS ai_sales_order_drafts_status_idx
  ON public.ai_sales_order_drafts(team_id, draft_status, updated_at DESC);

-- Neutralize legacy free-text memory. Data is backed up above; table remains for compatibility.
UPDATE public.ai_sales_chat_memory
SET
  customer_name = NULL,
  customer_phone = NULL,
  customer_alt_phone = NULL,
  customer_address = NULL,
  product_hint = NULL,
  payment_method = NULL,
  last_user_intent = 'legacy_disabled_by_sales_ai_isolation_v1',
  raw_summary = COALESCE(raw_summary, '{}'::jsonb) || jsonb_build_object(
    'legacy_disabled_at', now()::text,
    'reason', 'sales_ai_conversation_state_and_order_draft_are_source_of_truth'
  ),
  updated_at = now();

-- Normalize damaged states where product exists but stage/missing_data still says product is missing.
UPDATE public.ai_sales_conversation_state
SET
  missing_data = COALESCE(missing_data, '[]'::jsonb) - 'producto',
  current_stage = CASE
    WHEN current_stage = 'waiting_product_selection' THEN 'product_selected'
    ELSE current_stage
  END,
  order_draft = COALESCE(order_draft, '{}'::jsonb) || jsonb_build_object(
    'product_selected', true,
    'selected_product_id', selected_product_id,
    'selected_product_name', selected_product_name,
    'selected_product_price', selected_product_price
  ),
  updated_at = now()
WHERE selected_product_id IS NOT NULL;

-- Remove obvious text contamination from state if it came from legacy extraction.
UPDATE public.ai_sales_conversation_state
SET
  customer_name = NULL,
  updated_at = now()
WHERE lower(trim(customer_name)) IN (
  'deja eso bye',
  'ya te lo envie',
  'te la envie ya',
  'te la envíe ya',
  'precio de envio',
  'precio de envío'
);

UPDATE public.ai_sales_conversation_state
SET
  customer_address = NULL,
  updated_at = now()
WHERE lower(trim(customer_address)) IN (
  'deja eso bye',
  'ya te lo envie',
  'te la envie ya',
  'te la envíe ya',
  'precio de envio',
  'precio de envío'
);

UPDATE public.ai_sales_conversation_state
SET
  pending_choice_type = NULL,
  pending_choices = '[]'::jsonb
WHERE pending_choice_type IS NULL
  AND pending_choices IS DISTINCT FROM '[]'::jsonb;

COMMIT;
