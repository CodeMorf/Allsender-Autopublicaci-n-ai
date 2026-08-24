import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  unique,
  boolean,
  foreignKey,
  index,
  decimal,
  doublePrecision,
  PgColumn,
  PgTableWithColumns,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const plans = pgTable('plans', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),

  stripeProductId: text('stripe_product_id').notNull(),
  stripePriceId: text('stripe_price_id').notNull(),
  amount: integer('amount').notNull().default(0),
  currency: varchar('currency', { length: 3 }).notNull().default('usd'),
  interval: varchar('interval', { length: 20 }).notNull().default('month'),
  trialDays: integer('trial_days').notNull().default(0),

  maxUsers: integer('max_users').notNull().default(1),
  maxContacts: integer('max_contacts').notNull().default(1000),
  maxInstances: integer('max_instances').notNull().default(1),

  isAiEnabled: boolean('is_ai_enabled').notNull().default(false),
  isAiSalesEnabled: boolean('is_ai_sales_enabled').notNull().default(false),
  isFlowBuilderEnabled: boolean('is_flow_builder_enabled').notNull().default(false),
  isCampaignsEnabled: boolean('is_campaigns_enabled').notNull().default(false),
  isTemplatesEnabled: boolean('is_templates_enabled').notNull().default(false),
  isLogihubQuoteEnabled: boolean('is_logihub_quote_enabled').notNull().default(false),
  isLogihubCreateEnabled: boolean('is_logihub_create_enabled').notNull().default(false),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  planId: integer('plan_id').references(() => plans.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 20 }),
  isCanceled: boolean('is_canceled').default(false),
  trialEndsAt: timestamp('trial_ends_at'),
});

export const teamMembers = pgTable('team_members', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  role: varchar('role', { length: 50 }).notNull(),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
});

export const invitations = pgTable('invitations', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  invitedBy: integer('invited_by')
    .notNull()
    .references(() => users.id),
  invitedAt: timestamp('invited_at').notNull().defaultNow(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
});

/* =========================================================
   NUEVO: password_reset_tokens
   ========================================================= */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    tokenHash: text('token_hash').notNull(),

    // TIMESTAMP WITHOUT TIME ZONE
    expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: false }),
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow(),
  },
  (t) => ({
    tokenHashIdx: index('idx_token_hash').on(t.tokenHash),
  })
);

export const chats = pgTable(
  'chats',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    instanceId: integer('instance_id').references(() => evolutionInstances.id, { onDelete: 'set null' }),
    remoteJid: text('remote_jid').notNull(),

    name: text('name'),
    pushName: text('push_name'),
    profilePicUrl: text('profile_pic_url'),
    lastMessageText: text('last_message_text'),
    lastMessageTimestamp: timestamp('last_message_timestamp'),
    lastCustomerInteraction: timestamp('last_customer_interaction'),
    unreadCount: integer('unread_count').default(0),
    lastMessageStatus: varchar('last_message_status', { length: 20 }),
    lastMessageFromMe: boolean('last_message_from_me'),
    archivedAt: timestamp('archived_at'),
    archivedReason: text('archived_reason'),
    archivedBy: integer('archived_by').references(() => users.id, { onDelete: 'set null' }),
    provider: varchar('provider', { length: 50 }).default('whatsapp'),
    platform: varchar('platform', { length: 50 }),
    channelLabel: varchar('channel_label', { length: 200 }),
    externalConversationId: text('external_conversation_id'),
    sourceChannel: varchar('source_channel', { length: 50 }),
    locationLatitude: decimal('location_latitude', { precision: 10, scale: 7 }),
    locationLongitude: decimal('location_longitude', { precision: 10, scale: 7 }),
    locationAddress: text('location_address'),
  },
  (self) => ({
    teamChatInstanceUnique: unique('team_chat_instance_idx').on(self.teamId, self.remoteJid, self.instanceId),
    providerIndex: index('idx_chats_provider').on(self.provider),
    teamPlatformIndex: index('idx_chats_team_platform').on(self.teamId, self.platform, self.lastMessageTimestamp),
  })
);

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  chatId: integer('chat_id')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  fromMe: boolean('from_me').notNull(),
  messageType: text('message_type'),
  text: text('text'),
  mediaUrl: text('media_url'),
  mediaMimetype: text('media_mimetype'),
  mediaCaption: text('media_caption'),
  mediaFileLength: text('media_file_length'),
  mediaSeconds: integer('media_seconds'),
  mediaIsPtt: boolean('media_is_ptt'),
  contactName: text('contact_name'),
  contactVcard: text('contact_vcard'),
  locationLatitude: decimal('location_latitude', { precision: 10, scale: 7 }),
  locationLongitude: decimal('location_longitude', { precision: 10, scale: 7 }),
  locationName: text('location_name'),
  locationAddress: text('location_address'),
  status: varchar('status', { length: 20 }).default('sent'),
  isAi: boolean('is_ai').default(false),
  isAutomation: boolean('is_automation').default(false),
  quotedMessageId: varchar('quoted_message_id', { length: 255 }),
  quotedMessageText: text('quoted_message_text'),
  isInternal: boolean('is_internal').default(false),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
});

export const evolutionInstances = pgTable(
  'evolution_instances',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    instanceName: text('instance_name').notNull(),
    instanceNumber: text('instance_number'),
    evolutionInstanceId: text('evolution_instance_id').unique(),
    metaToken: text('meta_token'),
    accessToken: text('access_token'),
    integration: varchar('integration', { length: 50 }).default('WHATSAPP-BAILEYS').notNull(),
    metaBusinessId: text('meta_business_id'),
    metaPhoneNumberId: text('meta_phone_number_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => {
    return {
      teamInstanceNameUnique: unique('team_instance_name_idx').on(table.teamId, table.instanceName),
      teamInstanceIdUnique: unique('team_instance_id_idx').on(table.teamId, table.evolutionInstanceId),
      teamIdIndex: index('instance_team_id_idx').on(table.teamId),
    };
  }
);

export const funnelStages = pgTable('funnel_stages', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  emoji: varchar('emoji', { length: 10 }).default('📁'),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tags = pgTable(
  'tags',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    color: varchar('color', { length: 20 }).default('gray'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    teamNameUnique: unique('team_tag_name_idx').on(table.teamId, table.name),
  })
);

export const contacts = pgTable(
  'contacts',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' })
      .unique(),
    name: text('name').notNull(),
    assignedUserId: integer('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    funnelStageId: integer('funnel_stage_id').references(() => funnelStages.id, { onDelete: 'set null' }),
    notes: text('notes'),
    showTimeInStage: boolean('show_time_in_stage').default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    teamIdIndex: index('contact_team_id_idx').on(table.teamId),
    chatIdIndex: index('contact_chat_id_idx').on(table.chatId),
  })
);

export const contactTags = pgTable(
  'contact_tags',
  {
    id: serial('id').primaryKey(),
    contactId: integer('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    contactTagUnique: unique('contact_tag_idx').on(table.contactId, table.tagId),
  })
);

export const quickReplies = pgTable(
  'quick_replies',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    shortcut: varchar('shortcut', { length: 50 }).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    teamShortcutUnique: unique('team_shortcut_idx').on(table.teamId, table.shortcut),
  })
);

export const wabaTemplates = pgTable(
  'waba_templates',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    instanceId: integer('instance_id')
      .notNull()
      .references(() => evolutionInstances.id, { onDelete: 'cascade' }),

    metaId: text('meta_id').unique(),

    name: varchar('name', { length: 255 }).notNull(),
    language: varchar('language', { length: 10 }).notNull(),
    category: varchar('category', { length: 50 }).notNull(),

    status: varchar('status', { length: 50 }).notNull().default('PENDING'),
    components: jsonb('components').notNull(),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    uniqueNameLang: unique('waba_template_name_lang_idx').on(table.instanceId, table.name, table.language),
  })
);

export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  instanceId: integer('instance_id').references(() => evolutionInstances.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  channel: varchar('channel', { length: 20 }).default('WHATSAPP').notNull(),
  status: varchar('status', { length: 50 }).default('DRAFT').notNull(),
  scheduledAt: timestamp('scheduled_at'),
  templateId: integer('template_id').references(() => wabaTemplates.id),
  emailTemplateId: integer('email_template_id'),
  smtpProviderId: integer('smtp_provider_id'),
  testMode: boolean('test_mode').default(true).notNull(),
  totalLeads: integer('total_leads').default(0),
  sentCount: integer('sent_count').default(0),
  failedCount: integer('failed_count').default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const campaignLeads = pgTable('campaign_leads', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 320 }),
  variables: jsonb('variables'),
  status: varchar('status', { length: 20 }).default('PENDING'),
  error: text('error'),
});

export const automations = pgTable('automations', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  instanceId: integer('instance_id').references(() => evolutionInstances.id, { onDelete: 'set null' }),
  triggerKeyword: varchar('trigger_keyword', { length: 100 }),
  nodes: jsonb('nodes').notNull().default([]),
  edges: jsonb('edges').notNull().default([]),

  isActive: boolean('is_active').default(false).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});


export const departmentSettings = pgTable(
  'department_settings',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(false),
    companyName: text('company_name').notNull().default('nuestra empresa'),
    companyTimezone: varchar('company_timezone', { length: 80 }).notNull().default('America/Santo_Domingo'),
    mainMenuMessage: text('main_menu_message').notNull().default('Hola, bienvenido a {empresa}.\n\nPara ayudarte mejor, selecciona el departamento:\n\n{departamentos}\n\nResponde solo con el número de la opción.'),
    waitingSelectionMessage: text('waiting_selection_message').notNull().default('Ya recibimos tu mensaje, pero aún no has elegido un departamento.\n\nPara ayudarte correctamente, selecciona una opción:\n\n{departamentos}\n\nResponde solo con el número.'),
    invalidOptionMessage: text('invalid_option_message').notNull().default('No encontramos esa opción.\n\nPor favor selecciona una opción válida:\n\n{departamentos}'),
    menuKeywords: jsonb('menu_keywords').notNull().default(['menu', 'menú', 'departamento', 'cambiar departamento', 'volver']),
    defaultDepartmentCode: varchar('default_department_code', { length: 80 }),
    autoAssignAfterAttempts: integer('auto_assign_after_attempts').notNull().default(3),
    pauseAiOnAssign: boolean('pause_ai_on_assign').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    teamUnique: unique('department_settings_team_id_unique').on(table.teamId),
    teamActiveIndex: index('idx_department_settings_team_active').on(table.teamId, table.isActive),
  })
);

export const departments = pgTable(
  'departments',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 80 }).notNull(),
    orderIndex: integer('order_index').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    welcomeMessage: text('welcome_message').notNull().default('Perfecto. Te conectamos con {area}.\n\nUn miembro del equipo te responderá lo antes posible.'),
    outOfHoursMessage: text('out_of_hours_message').notNull().default('Gracias por escribirnos. En este momento {area} está fuera de horario.\n\nNuestro horario es {horario}. Déjanos tu mensaje y te responderemos tan pronto estemos disponibles.'),
    timezone: varchar('timezone', { length: 80 }).notNull().default('America/Santo_Domingo'),
    officeHoursEnabled: boolean('office_hours_enabled').notNull().default(false),
    officeDays: jsonb('office_days').notNull().default([1, 2, 3, 4, 5]),
    startTime: varchar('start_time', { length: 5 }).notNull().default('08:00'),
    endTime: varchar('end_time', { length: 5 }).notNull().default('18:00'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    teamCodeUnique: unique('departments_team_code_unique').on(table.teamId, table.code),
    teamActiveOrderIndex: index('idx_departments_team_active_order').on(table.teamId, table.isActive, table.orderIndex),
  })
);

export const departmentMembers = pgTable(
  'department_members',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    departmentId: integer('department_id').notNull().references(() => departments.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    departmentUserUnique: unique('department_members_department_user_unique').on(table.departmentId, table.userId),
    teamDepartmentIndex: index('idx_department_members_team_department').on(table.teamId, table.departmentId, table.priority),
  })
);

export const departmentChatStates = pgTable(
  'department_chat_states',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
    contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
    assignedUserId: integer('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 40 }).notNull().default('waiting_selection'),
    selectionAttempts: integer('selection_attempts').notNull().default(0),
    aiPaused: boolean('ai_paused').notNull().default(false),
    lastMenuSentAt: timestamp('last_menu_sent_at'),
    assignedAt: timestamp('assigned_at'),
    closedAt: timestamp('closed_at'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    teamChatUnique: unique('department_chat_states_team_chat_unique').on(table.teamId, table.chatId),
    teamStatusIndex: index('idx_department_chat_states_team_status').on(table.teamId, table.status, table.updatedAt),
    chatIndex: index('idx_department_chat_states_chat').on(table.chatId),
  })
);

export const departmentLogs = pgTable(
  'department_logs',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: varchar('event_type', { length: 60 }).notNull(),
    message: text('message'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    teamTimeIndex: index('idx_department_logs_team_time').on(table.teamId, table.createdAt),
    chatTimeIndex: index('idx_department_logs_chat_time').on(table.chatId, table.createdAt),
  })
);

export const branchSettings = pgTable(
  'branch_settings',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(false),
    companyName: text('company_name').notNull().default('nuestra empresa'),
    companyTimezone: varchar('company_timezone', { length: 80 }).notNull().default('America/Santo_Domingo'),
    country: varchar('country', { length: 120 }).notNull().default(''),
    maxGeoDistanceKm: doublePrecision('max_geo_distance_km').notNull().default(150),
    greetingMessage: text('greeting_message').notNull().default('Hola, te atiende {empresa}. Para ayudarte mejor, dime en que ciudad, zona o sucursal necesitas atencion.'),
    askLocationMessage: text('ask_location_message').notNull().default('Para conectarte con la sucursal correcta, dime en que ciudad o zona estas.'),
    notFoundMessage: text('not_found_message').notNull().default('Aun no identifico la sucursal correcta. Puedes decirme tu ciudad, sector o la sucursal mas cercana.'),
    handoffMessage: text('handoff_message').notNull().default('Perfecto. Te conectamos con {sucursal}. Un miembro del equipo continuara contigo.'),
    fallbackBranchCode: varchar('fallback_branch_code', { length: 80 }),
    pauseAiOnAssign: boolean('pause_ai_on_assign').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    teamUnique: unique('branch_settings_team_id_unique').on(table.teamId),
    teamActiveIndex: index('idx_branch_settings_team_active').on(table.teamId, table.isActive),
  })
);

export const branches = pgTable(
  'branches',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    code: varchar('code', { length: 80 }).notNull(),
    locationText: text('location_text'),
    keywords: jsonb('keywords').notNull().default([]),
    orderIndex: integer('order_index').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    welcomeMessage: text('welcome_message').notNull().default('Perfecto. Te conectamos con {sucursal}. Un miembro del equipo continuara contigo.'),
    outOfHoursMessage: text('out_of_hours_message').notNull().default('Gracias por escribirnos. En este momento {sucursal} esta fuera de horario. Nuestro horario es {horario}. Dejanos tu mensaje y te responderemos tan pronto estemos disponibles.'),
    timezone: varchar('timezone', { length: 80 }).notNull().default('America/Santo_Domingo'),
    officeHoursEnabled: boolean('office_hours_enabled').notNull().default(false),
    officeDays: jsonb('office_days').notNull().default([1, 2, 3, 4, 5]),
    startTime: varchar('start_time', { length: 5 }).notNull().default('08:00'),
    endTime: varchar('end_time', { length: 5 }).notNull().default('18:00'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    country: varchar('country', { length: 120 }).notNull().default(''),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    teamCodeUnique: unique('branches_team_code_unique').on(table.teamId, table.code),
    teamActiveOrderIndex: index('idx_branches_team_active_order').on(table.teamId, table.isActive, table.orderIndex),
  })
);

export const branchMembers = pgTable(
  'branch_members',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    branchId: integer('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => ({
    branchUserUnique: unique('branch_members_branch_user_unique').on(table.branchId, table.userId),
    teamBranchIndex: index('idx_branch_members_team_branch').on(table.teamId, table.branchId, table.priority),
  })
);

export const branchChatStates = pgTable(
  'branch_chat_states',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
    contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    branchId: integer('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    assignedUserId: integer('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 40 }).notNull().default('waiting_location'),
    selectionAttempts: integer('selection_attempts').notNull().default(0),
    aiPaused: boolean('ai_paused').notNull().default(false),
    lastPromptSentAt: timestamp('last_prompt_sent_at'),
    assignedAt: timestamp('assigned_at'),
    closedAt: timestamp('closed_at'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    teamChatUnique: unique('branch_chat_states_team_chat_unique').on(table.teamId, table.chatId),
    teamStatusIndex: index('idx_branch_chat_states_team_status').on(table.teamId, table.status, table.updatedAt),
    chatIndex: index('idx_branch_chat_states_chat').on(table.chatId),
  })
);

export const branchLogs = pgTable(
  'branch_logs',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    branchId: integer('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: varchar('event_type', { length: 60 }).notNull(),
    message: text('message'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    teamTimeIndex: index('idx_branch_logs_team_time').on(table.teamId, table.createdAt),
    chatTimeIndex: index('idx_branch_logs_chat_time').on(table.chatId, table.createdAt),
  })
);

export const automationSessions = pgTable('automation_sessions', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),

  automationId: integer('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  chatId: integer('chat_id')
    .notNull()
    .references(() => chats.id, { onDelete: 'cascade' }),
  contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  currentNodeId: text('current_node_id'),
  variables: jsonb('variables').default({}),
  status: varchar('status', { length: 20 }).default('active').notNull(),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const aiConfigs = pgTable(
  'ai_configs',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').default(false).notNull(),
    provider: varchar('provider', { length: 50 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    apiKey: text('api_key').notNull(),
    systemPrompt: text('system_prompt'),
    temperature: decimal('temperature', { precision: 2, scale: 1 }).default('0.7'),
    maxOutputTokens: integer('max_output_tokens').default(1000),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    uniqueTeamConfig: unique('team_ai_config_idx').on(t.teamId),
  })
);



export const aiSalesSettings = pgTable(
  'ai_sales_settings',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(false),
    agentName: text('agent_name').notNull().default('AllSender IA Ventas'),
    currency: varchar('currency', { length: 3 }).notNull().default('DOP'),
    paymentMethods: jsonb('payment_methods').notNull().default(['cod']),
    defaultPaymentMethod: varchar('default_payment_method', { length: 40 }).notNull().default('cod'),
    codEnabled: boolean('cod_enabled').notNull().default(true),
    transferEnabled: boolean('transfer_enabled').notNull().default(true),
    paymentAccounts: jsonb('payment_accounts').notNull().default([]),
    paymentInstructions: text('payment_instructions').notNull().default(''),
    paymentDiscountEnabled: boolean('payment_discount_enabled').notNull().default(false),
    paymentDiscountType: varchar('payment_discount_type', { length: 20 }).notNull().default('fixed'),
    paymentDiscountValue: decimal('payment_discount_value', { precision: 12, scale: 2 }).notNull().default('0.00'),
    paymentDiscountAppliesTo: varchar('payment_discount_applies_to', { length: 40 }).notNull().default('transfer'),
    requireCustomerConfirmation: boolean('require_customer_confirmation').notNull().default(true),
    requireHumanReview: boolean('require_human_review').notNull().default(false),
    defaultDeliveryFee: decimal('default_delivery_fee', { precision: 12, scale: 2 }).notNull().default('0'),
    orderPrefix: varchar('order_prefix', { length: 20 }).notNull().default('AI'),
    salesPolicy: text('sales_policy').notNull().default('La IA debe mostrar opciones, confirmar producto, cantidad, precio, nombre, telefono, direccion y metodo de pago antes de crear una orden.'),
    businessDescription: text('business_description').notNull().default(''),
    salesInstructions: text('sales_instructions').notNull().default(''),
    deliveryAdditionalItemFee: decimal('delivery_additional_item_fee', { precision: 12, scale: 2 }).notNull().default('5.00'),
    logihubQuoteEnabled: boolean('logihub_quote_enabled').notNull().default(false),
    logihubCreateShipmentEnabled: boolean('logihub_create_shipment_enabled').notNull().default(false),
    logihubDeliveryMode: varchar('logihub_delivery_mode', { length: 20 }).notNull().default('central'),
    logihubServiceType: varchar('logihub_service_type', { length: 30 }).notNull().default('standard'),
    logihubDefaultWeightLb: decimal('logihub_default_weight_lb', { precision: 10, scale: 2 }).notNull().default('2.50'),
    logihubDefaultContent: text('logihub_default_content').notNull().default('Productos'),
    logihubApiKey: text('logihub_api_key'),
    logihubAccountName: text('logihub_account_name'),
    logihubCustomerId: integer('logihub_customer_id'),
    logihubWalletBalance: decimal('logihub_wallet_balance', { precision: 12, scale: 2 }),
    logihubWalletCurrency: varchar('logihub_wallet_currency', { length: 8 }).notNull().default('DOP'),
    logihubOriginJson: jsonb('logihub_origin_json').notNull().default({}),
    logihubLastSummaryAt: timestamp('logihub_last_summary_at'),
    logihubLastError: text('logihub_last_error'),
    logihubSenderAddress: text('logihub_sender_address'),
    logihubSenderLat: decimal('logihub_sender_lat', { precision: 11, scale: 7 }),
    logihubSenderLng: decimal('logihub_sender_lng', { precision: 11, scale: 7 }),
    logihubIsPickup: boolean('logihub_is_pickup').notNull().default(false),
    googleMapsGeocodingEnabled: boolean('google_maps_geocoding_enabled').notNull().default(true),
    googleMapsApiKey: text('google_maps_api_key'),
    trainingPlaybook: jsonb('training_playbook').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqueTeamSalesSettings: unique('team_ai_sales_settings_idx').on(t.teamId),
    teamIdIndex: index('ai_sales_settings_team_id_idx').on(t.teamId),
  })
);


export const feedSyncSettings = pgTable(
  'feed_sync_settings',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(false),
    feedName: varchar('feed_name', { length: 160 }).notNull().default('XML / Feed Sync'),
    feedUrl: text('feed_url'),
    feedType: varchar('feed_type', { length: 40 }).notNull().default('google_merchant'),
    syncMode: varchar('sync_mode', { length: 40 }).notNull().default('upsert'),
    freeProductLimit: integer('free_product_limit').notNull().default(100),
    maxProductLimit: integer('max_product_limit').notNull().default(5000),
    additionalProductFee: decimal('additional_product_fee', { precision: 12, scale: 2 }).notNull().default('0.00'),
    currency: varchar('currency', { length: 3 }).notNull().default('DOP'),
    autoSyncEnabled: boolean('auto_sync_enabled').notNull().default(false),
    autoSyncHour: integer('auto_sync_hour').notNull().default(2),
    autoSyncMinute: integer('auto_sync_minute').notNull().default(0),
    autoSyncTimezone: varchar('auto_sync_timezone', { length: 80 }).notNull().default('America/Santo_Domingo'),
    autoSyncLastRunAt: timestamp('auto_sync_last_run_at'),
    lastStatus: varchar('last_status', { length: 40 }),
    lastMessage: text('last_message'),
    lastSyncAt: timestamp('last_sync_at'),
    lastTotalFound: integer('last_total_found').notNull().default(0),
    lastImported: integer('last_imported').notNull().default(0),
    lastSkipped: integer('last_skipped').notNull().default(0),
    lastOverLimit: integer('last_over_limit').notNull().default(0),
    lastStockAlerts: integer('last_stock_alerts').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqueTeamFeedSettings: unique('feed_sync_settings_team_id_idx').on(t.teamId),
    teamIdIndex: index('feed_sync_settings_team_id_lookup_idx').on(t.teamId),
  })
);

export const feedSyncLogs = pgTable(
  'feed_sync_logs',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    settingsId: integer('settings_id').references(() => feedSyncSettings.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 40 }).notNull().default('pending'),
    feedUrl: text('feed_url'),
    totalFound: integer('total_found').notNull().default(0),
    importedCount: integer('imported_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    overLimitCount: integer('over_limit_count').notNull().default(0),
    stockAlertCount: integer('stock_alert_count').notNull().default(0),
    message: text('message'),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    teamIdIndex: index('feed_sync_logs_team_id_idx').on(t.teamId),
    settingsIdIndex: index('feed_sync_logs_settings_id_idx').on(t.settingsId),
  })
);

export const aiSalesProducts = pgTable(
  'ai_sales_products',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 100 }),
    name: text('name').notNull(),
    description: text(),
    category: varchar('category', { length: 120 }),
    price: decimal('price', { precision: 12, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('DOP'),
    imageUrl: text('image_url'),
    stock: integer('stock').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamSkuUnique: unique('ai_sales_products_team_sku_idx').on(t.teamId, t.sku),
    teamIdIndex: index('ai_sales_products_team_id_idx').on(t.teamId),
    activeIndex: index('ai_sales_products_team_active_idx').on(t.teamId, t.isActive),
  })
);


export const aiSalesStockAlerts = pgTable(
  'ai_sales_stock_alerts',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => aiSalesProducts.id, { onDelete: 'set null' }),
    sku: varchar('sku', { length: 100 }),
    name: text('name').notNull(),
    category: varchar('category', { length: 120 }),
    imageUrl: text('image_url'),
    source: varchar('source', { length: 40 }).notNull().default('xml_feed'),
    sourceUrl: text('source_url'),
    sourceId: varchar('source_id', { length: 160 }),
    availability: varchar('availability', { length: 80 }),
    stock: integer('stock').notNull().default(0),
    status: varchar('status', { length: 30 }).notNull().default('open'),
    note: text('note'),
    detectedAt: timestamp('detected_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamSkuUnique: unique('ai_sales_stock_alerts_team_sku_idx').on(t.teamId, t.sku),
    teamIdIndex: index('ai_sales_stock_alerts_team_id_idx').on(t.teamId),
    statusIndex: index('ai_sales_stock_alerts_team_status_idx').on(t.teamId, t.status),
  })
);

export const aiSalesOrders = pgTable(
  'ai_sales_orders',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    orderNumber: varchar('order_number', { length: 80 }).notNull().unique(),
    customerName: varchar('customer_name', { length: 160 }),
    customerPhone: varchar('customer_phone', { length: 60 }),
    customerEmail: varchar('customer_email', { length: 160 }),
    customerAddress: text('customer_address'),
    customerReference: text('customer_reference'),
    deliveryZone: text('delivery_zone'),
    destProvince: text('dest_province'),
    destCity: text('dest_city'),
    destBarrio: text('dest_barrio'),
    receiverLat: decimal('receiver_lat', { precision: 11, scale: 7 }),
    receiverLng: decimal('receiver_lng', { precision: 11, scale: 7 }),
    paymentMethod: varchar('payment_method', { length: 60 }).notNull().default('cod'),
    paymentStatus: varchar('payment_status', { length: 40 }).notNull().default('pending'),
    paymentAccountId: varchar('payment_account_id', { length: 120 }),
    subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
    deliveryFee: decimal('delivery_fee', { precision: 12, scale: 2 }).notNull().default('0'),
    discount: decimal('discount', { precision: 12, scale: 2 }).notNull().default('0'),
    paymentDiscount: decimal('payment_discount', { precision: 12, scale: 2 }).notNull().default('0'),
    prepaidAmount: decimal('prepaid_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    codAmount: decimal('cod_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
    paymentMeta: jsonb('payment_meta').notNull().default({}),
    status: varchar('status', { length: 40 }).notNull().default('draft_ai'),
    aiSummary: text('ai_summary'),
    internalNotes: text('internal_notes'),
    source: jsonb('source').notNull().default({}),
    shippingProvider: varchar('shipping_provider', { length: 40 }),
    shippingMode: varchar('shipping_mode', { length: 20 }),
    shippingTracking: varchar('shipping_tracking', { length: 80 }),
    shippingLabelUrl: text('shipping_label_url'),
    shippingStatus: varchar('shipping_status', { length: 40 }),
    logihubPayload: jsonb('logihub_payload'),
    logihubResponse: jsonb('logihub_response'),
    logihubTracking: varchar('logihub_tracking', { length: 80 }),
    logihubStatus: varchar('logihub_status', { length: 60 }),
    logihubLabelUrl: text('logihub_label_url'),
    logihubError: text('logihub_error'),
    logihubPayloadJson: jsonb('logihub_payload_json'),
    logihubResponseJson: jsonb('logihub_response_json'),
    confirmedAt: timestamp('confirmed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamIdIndex: index('ai_sales_orders_team_id_idx').on(t.teamId),
    teamStatusIndex: index('ai_sales_orders_team_status_idx').on(t.teamId, t.status),
    customerPhoneIndex: index('ai_sales_orders_customer_phone_idx').on(t.customerPhone),
  })
);

export const aiSalesOrderItems = pgTable(
  'ai_sales_order_items',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    orderId: integer('order_id').notNull().references(() => aiSalesOrders.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => aiSalesProducts.id, { onDelete: 'set null' }),
    sku: varchar('sku', { length: 100 }),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull().default('0'),
    total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0'),
    productSnapshot: jsonb('product_snapshot').notNull().default({}),
    variantId: integer('variant_id'),
    variantSku: text('variant_sku'),
    variantLabel: text('variant_label'),
    variantMeta: jsonb('variant_meta'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    orderIdIndex: index('ai_sales_order_items_order_id_idx').on(t.orderId),
    teamIdIndex: index('ai_sales_order_items_team_id_idx').on(t.teamId),
  })
);

export const aiSalesOrderEvents = pgTable(
  'ai_sales_order_events',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    orderId: integer('order_id').notNull().references(() => aiSalesOrders.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    eventData: jsonb('event_data').notNull().default({}),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    orderIdIndex: index('ai_sales_order_events_order_id_idx').on(t.orderId),
    teamIdIndex: index('ai_sales_order_events_team_id_idx').on(t.teamId),
  })
);


export const aiConversationLearningSettings = pgTable(
  'ai_conversation_learning_settings',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(false),
    autoCapture: boolean('auto_capture').notNull().default(true),
    useInPrompt: boolean('use_in_prompt').notNull().default(true),
    learningMode: varchar('learning_mode', { length: 40 }).notNull().default('sales'),
    maxPromptMemories: integer('max_prompt_memories').notNull().default(12),
    minMessageLength: integer('min_message_length').notNull().default(8),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqueTeamLearningSettings: unique('ai_conversation_learning_settings_team_unique').on(t.teamId),
    teamIdIndex: index('ai_conversation_learning_settings_team_idx').on(t.teamId),
  })
);

export const aiConversationMemories = pgTable(
  'ai_conversation_memories',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatId: integer('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    sourceMessageId: text('source_message_id'),
    memoryType: varchar('memory_type', { length: 60 }).notNull().default('note'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    keywords: jsonb('keywords').notNull().default([]),
    confidence: decimal('confidence', { precision: 4, scale: 2 }).notNull().default('0.70'),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    timesSeen: integer('times_seen').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamStatusIndex: index('ai_conversation_memories_team_status_idx').on(t.teamId, t.status),
    teamTypeIndex: index('ai_conversation_memories_team_type_idx').on(t.teamId, t.memoryType),
    chatIdIndex: index('ai_conversation_memories_chat_idx').on(t.chatId),
    lastSeenIndex: index('ai_conversation_memories_last_seen_idx').on(t.teamId, t.lastSeenAt),
  })
);

export const aiSessions = pgTable('ai_sessions', {
  id: serial('id').primaryKey(),
  chatId: integer('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).default('active'),
  history: jsonb('history').default([]),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const aiTools = pgTable(
  'ai_tools',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 50 }).notNull(),
    description: text('description').notNull(),
    mediaUrl: text('media_url').notNull(),
    mediaType: varchar('media_type', { length: 20 }).notNull(),
    caption: text('caption'),
    confirmationMessage: text('confirmation_message'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    uniqueToolName: unique('team_tool_name_idx').on(t.teamId, t.name),
  })
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    key: varchar('key', { length: 255 }).notNull().unique(),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    teamIdIndex: index('api_key_team_id_idx').on(table.teamId),
    keyIndex: index('api_key_value_idx').on(table.key),
  })
);

export const outboundWebhooks = pgTable(
  'outbound_webhooks',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),

    name: varchar('name', { length: 100 }).notNull(),
    url: text('url').notNull(),

    // JSONB array de strings: ["message.received","message.status"]
    events: jsonb('events').notNull().default([]),

    secret: text('secret').notNull(),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqueTeamUrl: unique('team_webhook_url_idx').on(t.teamId, t.url),
    teamIdx: index('outbound_webhook_team_idx').on(t.teamId),
  })
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    webhookId: integer('webhook_id')
      .notNull()
      .references(() => outboundWebhooks.id, { onDelete: 'cascade' }),

    eventId: text('event_id').notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),

    attempt: integer('attempt').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    lastStatusCode: integer('last_status_code'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqueDelivery: unique('webhook_delivery_unique').on(t.webhookId, t.eventId),
    teamIdx: index('webhook_deliveries_team_idx').on(t.teamId),
  })
);


export const allsenderChannelModules = pgTable(
  'allsender_channel_modules',
  {
    id: serial('id').primaryKey(),
    moduleKey: varchar('module_key', { length: 80 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    channelType: varchar('channel_type', { length: 50 }).notNull(),
    provider: varchar('provider', { length: 50 }).notNull().default('chatwoot'),
    priceCents: integer('price_cents').notNull().default(0),
    currency: varchar('currency', { length: 3 }).notNull().default('usd'),
    trialDays: integer('trial_days').notNull().default(7),
    stripeProductId: text('stripe_product_id'),
    stripePriceId: text('stripe_price_id'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    moduleKeyUnique: unique('allsender_channel_modules_key_idx').on(t.moduleKey),
    enabledIndex: index('allsender_channel_modules_enabled_idx').on(t.isEnabled),
  })
);

export const teamChannelModuleSubscriptions = pgTable(
  'team_channel_module_subscriptions',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    moduleKey: varchar('module_key', { length: 80 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('inactive'),
    isActive: boolean('is_active').notNull().default(false),
    priceCents: integer('price_cents').notNull().default(0),
    currency: varchar('currency', { length: 3 }).notNull().default('usd'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    trialStartedAt: timestamp('trial_started_at'),
    trialEndsAt: timestamp('trial_ends_at'),
    currentPeriodEndsAt: timestamp('current_period_ends_at'),
    canceledAt: timestamp('canceled_at'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamModuleUnique: unique('team_channel_module_unique_idx').on(t.teamId, t.moduleKey),
    teamStatusIndex: index('team_channel_module_status_idx').on(t.teamId, t.status),
  })
);

export const zernioConnections = pgTable(
  'zernio_connections',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    localInstanceId: integer('local_instance_id').references(() => evolutionInstances.id, { onDelete: 'set null' }),
    provider: varchar('provider', { length: 50 }).notNull().default('zernio'),
    platform: varchar('platform', { length: 50 }).notNull(),
    moduleKey: varchar('module_key', { length: 80 }).notNull(),
    zernioProfileId: varchar('zernio_profile_id', { length: 150 }).notNull(),
    zernioAccountId: varchar('zernio_account_id', { length: 150 }),
    accountUsername: varchar('account_username', { length: 150 }),
    accountDisplayName: varchar('account_display_name', { length: 200 }),
    accountPicture: text('account_picture'),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    lastError: text('last_error'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamIndex: index('idx_zernio_connections_team').on(t.teamId),
    accountIndex: index('idx_zernio_connections_account').on(t.zernioAccountId),
    profileIndex: index('idx_zernio_connections_profile').on(t.zernioProfileId),
    teamLocalInstanceUnique: unique('zernio_connections_team_local_instance_idx').on(t.teamId, t.localInstanceId),
  })
);

export const zernioWebhookLogs = pgTable(
  'zernio_webhook_logs',
  {
    id: serial('id').primaryKey(),
    eventType: varchar('event_type', { length: 100 }),
    zernioAccountId: varchar('zernio_account_id', { length: 150 }),
    zernioProfileId: varchar('zernio_profile_id', { length: 150 }),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    eventId: varchar('event_id', { length: 150 }),
    teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
    platform: varchar('platform', { length: 50 }),
    status: varchar('status', { length: 50 }).notNull().default('received'),
    processedAt: timestamp('processed_at'),
    processingError: text('processing_error'),
    rawPayload: jsonb('raw_payload'),
    duplicateOfEventId: varchar('duplicate_of_event_id', { length: 150 }),
  },
  (t) => ({
    accountIndex: index('idx_zernio_webhook_logs_account').on(t.zernioAccountId),
    profileIndex: index('idx_zernio_webhook_logs_profile').on(t.zernioProfileId),
    eventIdUnique: unique('zernio_webhook_logs_event_id_uidx').on(t.eventId),
    teamIndex: index('idx_zernio_webhook_logs_team').on(t.teamId, t.createdAt),
    platformIndex: index('idx_zernio_webhook_logs_platform').on(t.platform, t.createdAt),
    statusIndex: index('idx_zernio_webhook_logs_status').on(t.status),
    statusTimeIndex: index('idx_zernio_webhook_logs_status_time').on(t.status, t.createdAt),
    teamPlatformIndex: index('idx_zernio_webhook_logs_team_platform').on(t.teamId, t.platform),
  })
);

export const zernioTeamProfiles = pgTable(
  'zernio_team_profiles',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    zernioProfileId: varchar('zernio_profile_id', { length: 150 }).notNull(),
    profileName: varchar('profile_name', { length: 200 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
    profileId: varchar('profile_id', { length: 150 }),
    provider: varchar('provider', { length: 50 }).notNull().default('zernio'),
  },
  (t) => ({
    teamUnique: unique('zernio_team_profiles_team_uidx').on(t.teamId),
    profileUnique: unique('zernio_team_profiles_profile_uidx').on(t.zernioProfileId),
    teamProviderUnique: unique('zernio_team_profiles_team_provider_uidx').on(t.teamId, t.provider),
    statusIndex: index('idx_zernio_team_profiles_status').on(t.status),
  })
);

export const chatwootAccounts = pgTable(
  'chatwoot_accounts',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatwootAccountId: integer('chatwoot_account_id').notNull(),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamUnique: unique('chatwoot_accounts_team_idx').on(t.teamId),
    accountUnique: unique('chatwoot_accounts_external_idx').on(t.chatwootAccountId),
  })
);

export const chatwootUsers = pgTable(
  'chatwoot_users',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    chatwootUserId: integer('chatwoot_user_id'),
    chatwootAccountId: integer('chatwoot_account_id'),
    apiAccessTokenEncrypted: text('api_access_token_encrypted'),
    role: varchar('role', { length: 40 }).notNull().default('agent'),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamUserUnique: unique('chatwoot_users_team_user_idx').on(t.teamId, t.userId),
  })
);

export const channelConnections = pgTable(
  'channel_connections',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    moduleKey: varchar('module_key', { length: 80 }).notNull(),
    provider: varchar('provider', { length: 50 }).notNull(),
    channelType: varchar('channel_type', { length: 50 }).notNull(),
    displayName: varchar('display_name', { length: 160 }),
    status: varchar('status', { length: 30 }).notNull().default('inactive'),
    chatwootAccountId: integer('chatwoot_account_id'),
    chatwootInboxId: integer('chatwoot_inbox_id'),
    evolutionInstanceId: integer('evolution_instance_id').references(() => evolutionInstances.id, { onDelete: 'set null' }),
    externalAccountId: text('external_account_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    teamModuleUnique: unique('channel_connections_team_module_idx').on(t.teamId, t.moduleKey),
    teamProviderIndex: index('channel_connections_team_provider_idx').on(t.teamId, t.provider),
  })
);

export const chatwootConversationRefs = pgTable(
  'chatwoot_conversation_refs',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatwootAccountId: integer('chatwoot_account_id').notNull(),
    chatwootInboxId: integer('chatwoot_inbox_id'),
    chatwootConversationId: integer('chatwoot_conversation_id').notNull(),
    localChatId: integer('local_chat_id').references(() => chats.id, { onDelete: 'set null' }),
    channelType: varchar('channel_type', { length: 50 }),
    status: varchar('status', { length: 30 }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    chatwootConversationUnique: unique('chatwoot_conversation_refs_unique_idx').on(t.chatwootAccountId, t.chatwootConversationId),
    teamIndex: index('chatwoot_conversation_refs_team_idx').on(t.teamId),
  })
);

export const chatwootMessageRefs = pgTable(
  'chatwoot_message_refs',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    chatwootAccountId: integer('chatwoot_account_id').notNull(),
    chatwootConversationId: integer('chatwoot_conversation_id').notNull(),
    chatwootMessageId: integer('chatwoot_message_id').notNull(),
    localMessageId: text('local_message_id'),
    messageType: varchar('message_type', { length: 40 }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    chatwootMessageUnique: unique('chatwoot_message_refs_unique_idx').on(t.chatwootAccountId, t.chatwootMessageId),
    teamIndex: index('chatwoot_message_refs_team_idx').on(t.teamId),
  })
);


export const aiSalesSettingsRelations = relations(aiSalesSettings, ({ one }) => ({
  team: one(teams, { fields: [aiSalesSettings.teamId], references: [teams.id] }),
}));

export const aiSalesProductsRelations = relations(aiSalesProducts, ({ one, many }) => ({
  team: one(teams, { fields: [aiSalesProducts.teamId], references: [teams.id] }),
  items: many(aiSalesOrderItems),
  stockAlerts: many(aiSalesStockAlerts),
}));

export const aiSalesStockAlertsRelations = relations(aiSalesStockAlerts, ({ one }) => ({
  team: one(teams, { fields: [aiSalesStockAlerts.teamId], references: [teams.id] }),
  product: one(aiSalesProducts, { fields: [aiSalesStockAlerts.productId], references: [aiSalesProducts.id] }),
}));

export const aiSalesOrdersRelations = relations(aiSalesOrders, ({ one, many }) => ({
  team: one(teams, { fields: [aiSalesOrders.teamId], references: [teams.id] }),
  chat: one(chats, { fields: [aiSalesOrders.chatId], references: [chats.id] }),
  items: many(aiSalesOrderItems),
  events: many(aiSalesOrderEvents),
}));

export const aiSalesOrderItemsRelations = relations(aiSalesOrderItems, ({ one }) => ({
  team: one(teams, { fields: [aiSalesOrderItems.teamId], references: [teams.id] }),
  order: one(aiSalesOrders, { fields: [aiSalesOrderItems.orderId], references: [aiSalesOrders.id] }),
  product: one(aiSalesProducts, { fields: [aiSalesOrderItems.productId], references: [aiSalesProducts.id] }),
}));

export const aiSalesOrderEventsRelations = relations(aiSalesOrderEvents, ({ one }) => ({
  team: one(teams, { fields: [aiSalesOrderEvents.teamId], references: [teams.id] }),
  order: one(aiSalesOrders, { fields: [aiSalesOrderEvents.orderId], references: [aiSalesOrders.id] }),
  chat: one(chats, { fields: [aiSalesOrderEvents.chatId], references: [chats.id] }),
}));


export const aiConversationLearningSettingsRelations = relations(aiConversationLearningSettings, ({ one }) => ({
  team: one(teams, { fields: [aiConversationLearningSettings.teamId], references: [teams.id] }),
}));

export const aiConversationMemoriesRelations = relations(aiConversationMemories, ({ one }) => ({
  team: one(teams, { fields: [aiConversationMemories.teamId], references: [teams.id] }),
  chat: one(chats, { fields: [aiConversationMemories.chatId], references: [chats.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  team: one(teams, {
    fields: [apiKeys.teamId],
    references: [teams.id],
  }),
}));

export const outboundWebhooksRelations = relations(outboundWebhooks, ({ one, many }) => ({
  team: one(teams, {
    fields: [outboundWebhooks.teamId],
    references: [teams.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  team: one(teams, {
    fields: [webhookDeliveries.teamId],
    references: [teams.id],
  }),
  webhook: one(outboundWebhooks, {
    fields: [webhookDeliveries.webhookId],
    references: [outboundWebhooks.id],
  }),
}));

export const plansRelations = relations(plans, ({ many }) => ({
  teams: many(teams),
}));

export const aiToolsRelations = relations(aiTools, ({ one }) => ({
  team: one(teams, {
    fields: [aiTools.teamId],
    references: [teams.id],
  }),
}));

export const automationsRelations = relations(automations, ({ one, many }) => ({
  team: one(teams, {
    fields: [automations.teamId],
    references: [teams.id],
  }),
  instance: one(evolutionInstances, {
    fields: [automations.instanceId],
    references: [evolutionInstances.id],
  }),
  sessions: many(automationSessions),
}));

export const automationSessionsRelations = relations(automationSessions, ({ one }) => ({
  automation: one(automations, {
    fields: [automationSessions.automationId],
    references: [automations.id],
  }),
  chat: one(chats, {
    fields: [automationSessions.chatId],
    references: [chats.id],
  }),
  contact: one(contacts, {
    fields: [automationSessions.contactId],
    references: [contacts.id],
  }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  team: one(teams, { fields: [campaigns.teamId], references: [teams.id] }),
  instance: one(evolutionInstances, { fields: [campaigns.instanceId], references: [evolutionInstances.id] }),
  template: one(wabaTemplates, { fields: [campaigns.templateId], references: [wabaTemplates.id] }),
  leads: many(campaignLeads),
}));

export const campaignLeadsRelations = relations(campaignLeads, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignLeads.campaignId], references: [campaigns.id] }),
}));

export const wabaTemplatesRelations = relations(wabaTemplates, ({ one }) => ({
  team: one(teams, {
    fields: [wabaTemplates.teamId],
    references: [teams.id],
  }),
  instance: one(evolutionInstances, {
    fields: [wabaTemplates.instanceId],
    references: [evolutionInstances.id],
  }),
}));


export const feedSyncSettingsRelations = relations(feedSyncSettings, ({ one, many }) => ({
  team: one(teams, {
    fields: [feedSyncSettings.teamId],
    references: [teams.id],
  }),
  logs: many(feedSyncLogs),
}));

export const feedSyncLogsRelations = relations(feedSyncLogs, ({ one }) => ({
  team: one(teams, {
    fields: [feedSyncLogs.teamId],
    references: [teams.id],
  }),
  settings: one(feedSyncSettings, {
    fields: [feedSyncLogs.settingsId],
    references: [feedSyncSettings.id],
  }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  plan: one(plans, {
    fields: [teams.planId],
    references: [plans.id],
  }),
  teamMembers: many(teamMembers),
  activityLogs: many(activityLogs),
  invitations: many(invitations),
  chats: many(chats),
  evolutionInstances: many(evolutionInstances),
  contacts: many(contacts),
  tags: many(tags),
  funnelStages: many(funnelStages),
  quickReplies: many(quickReplies),
  wabaTemplates: many(wabaTemplates),
  automations: many(automations),
  apiKeys: many(apiKeys),
  outboundWebhooks: many(outboundWebhooks),
  webhookDeliveries: many(webhookDeliveries),
  aiSalesSettings: many(aiSalesSettings),
  aiSalesProducts: many(aiSalesProducts),
  aiSalesStockAlerts: many(aiSalesStockAlerts),
  aiSalesOrders: many(aiSalesOrders),
  feedSyncSettings: many(feedSyncSettings),
  feedSyncLogs: many(feedSyncLogs),
  aiConversationLearningSettings: many(aiConversationLearningSettings),
  aiConversationMemories: many(aiConversationMemories),

  // NUEVO
  passwordResetTokens: many(passwordResetTokens),
}));

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
  invitationsSent: many(invitations),
  contactsAssigned: many(contacts),

  // NUEVO
  passwordResetTokens: many(passwordResetTokens),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  team: one(teams, {
    fields: [invitations.teamId],
    references: [teams.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  team: one(teams, {
    fields: [activityLogs.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  team: one(teams, {
    fields: [chats.teamId],
    references: [teams.id],
  }),
  messages: many(messages),
  contact: one(contacts, {
    fields: [chats.id],
    references: [contacts.chatId],
  }),
  instance: one(evolutionInstances, {
    fields: [chats.instanceId],
    references: [evolutionInstances.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.id],
  }),
}));

export const evolutionInstancesRelations = relations(evolutionInstances, ({ one, many }) => ({
  team: one(teams, {
    fields: [evolutionInstances.teamId],
    references: [teams.id],
  }),
  chats: many(chats),
  wabaTemplates: many(wabaTemplates),
  zernioConnections: many(zernioConnections),
}));

export const zernioConnectionsRelations = relations(zernioConnections, ({ one }) => ({
  team: one(teams, {
    fields: [zernioConnections.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [zernioConnections.userId],
    references: [users.id],
  }),
  localInstance: one(evolutionInstances, {
    fields: [zernioConnections.localInstanceId],
    references: [evolutionInstances.id],
  }),
}));

export const funnelStagesRelations = relations(funnelStages, ({ one, many }) => ({
  team: one(teams, {
    fields: [funnelStages.teamId],
    references: [teams.id],
  }),
  contacts: many(contacts),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  team: one(teams, {
    fields: [tags.teamId],
    references: [teams.id],
  }),
  contactTags: many(contactTags),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  team: one(teams, {
    fields: [contacts.teamId],
    references: [teams.id],
  }),
  chat: one(chats, {
    fields: [contacts.chatId],
    references: [chats.id],
  }),
  assignedUser: one(users, {
    fields: [contacts.assignedUserId],
    references: [users.id],
  }),
  funnelStage: one(funnelStages, {
    fields: [contacts.funnelStageId],
    references: [funnelStages.id],
  }),
  contactTags: many(contactTags),
}));

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactTags.contactId],
    references: [contacts.id],
  }),
  tag: one(tags, {
    fields: [contactTags.tagId],
    references: [tags.id],
  }),
}));

export const quickRepliesRelations = relations(quickReplies, ({ one }) => ({
  team: one(teams, {
    fields: [quickReplies.teamId],
    references: [teams.id],
  }),
}));

export const branding = pgTable('branding', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().default('WhatsSaaS'),
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/* =========================
   TYPES
   ========================= */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export type TeamDataWithMembers = Team & {
  teamMembers: (TeamMember & {
    user: Pick<User, 'id' | 'name' | 'email'>;
  })[];
};

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type EvolutionInstance = typeof evolutionInstances.$inferSelect;
export type NewEvolutionInstance = typeof evolutionInstances.$inferInsert;

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type FunnelStage = typeof funnelStages.$inferSelect;
export type NewFunnelStage = typeof funnelStages.$inferInsert;

export type QuickReply = typeof quickReplies.$inferSelect;
export type NewQuickReply = typeof quickReplies.$inferInsert;

export type WabaTemplate = typeof wabaTemplates.$inferSelect;
export type NewWabaTemplate = typeof wabaTemplates.$inferInsert;

export type Automation = typeof automations.$inferSelect;
export type NewAutomation = typeof automations.$inferInsert;
export type AutomationSession = typeof automationSessions.$inferSelect;

export type AiTool = typeof aiTools.$inferSelect;
export type NewAiTool = typeof aiTools.$inferInsert;
export type AiSalesSettings = typeof aiSalesSettings.$inferSelect;
export type NewAiSalesSettings = typeof aiSalesSettings.$inferInsert;
export type AiSalesProduct = typeof aiSalesProducts.$inferSelect;
export type NewAiSalesProduct = typeof aiSalesProducts.$inferInsert;
export type AiSalesStockAlert = typeof aiSalesStockAlerts.$inferSelect;
export type NewAiSalesStockAlert = typeof aiSalesStockAlerts.$inferInsert;
export type AiSalesOrder = typeof aiSalesOrders.$inferSelect;
export type NewAiSalesOrder = typeof aiSalesOrders.$inferInsert;
export type AiSalesOrderItem = typeof aiSalesOrderItems.$inferSelect;
export type NewAiSalesOrderItem = typeof aiSalesOrderItems.$inferInsert;
export type AiSalesOrderEvent = typeof aiSalesOrderEvents.$inferSelect;
export type NewAiSalesOrderEvent = typeof aiSalesOrderEvents.$inferInsert;
export type Branding = typeof branding.$inferSelect;
export type NewBranding = typeof branding.$inferInsert;


export type AllSenderChannelModule = typeof allsenderChannelModules.$inferSelect;
export type TeamChannelModuleSubscription = typeof teamChannelModuleSubscriptions.$inferSelect;
export type ZernioConnection = typeof zernioConnections.$inferSelect;
export type NewZernioConnection = typeof zernioConnections.$inferInsert;
export type ZernioWebhookLog = typeof zernioWebhookLogs.$inferSelect;
export type ChatwootAccount = typeof chatwootAccounts.$inferSelect;
export type ChatwootUser = typeof chatwootUsers.$inferSelect;
export type ChannelConnection = typeof channelConnections.$inferSelect;
export type ChatwootConversationRef = typeof chatwootConversationRefs.$inferSelect;
export type ChatwootMessageRef = typeof chatwootMessageRefs.$inferSelect;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type OutboundWebhook = typeof outboundWebhooks.$inferSelect;
export type NewOutboundWebhook = typeof outboundWebhooks.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_TEAM = 'CREATE_TEAM',
  REMOVE_TEAM_MEMBER = 'REMOVE_TEAM_MEMBER',
  INVITE_TEAM_MEMBER = 'INVITE_TEAM_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
  CREATE_INSTANCE = 'CREATE_INSTANCE',
  DELETE_INSTANCE = 'DELETE_INSTANCE',
  LOGOUT_INSTANCE = 'LOGOUT_INSTANCE',
  CREATE_CONTACT = 'CREATE_CONTACT',
  ASSIGN_AGENT = 'ASSIGN_AGENT',
  CHANGE_FUNNEL_STAGE = 'CHANGE_FUNNEL_STAGE',
  ADD_TAG = 'ADD_TAG',
  REMOVE_TAG = 'REMOVE_TAG',
}
