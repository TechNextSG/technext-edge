-- Migration kênh AI / WhatsApp cho Supabase (PG 17+).
-- Thay thế hoàn toàn Redis KV: hội thoại, chống trùng lặp tin nhắn (claim), chuyển giao nhân viên (handoff),
-- khóa phân tán theo số điện thoại (phone lease), lưu trữ trích xuất và cấu hình AI.
--
-- RLS bật trên tất cả các bảng mới, KHÔNG tạo policy: chỉ BFF (DATABASE_URL qua service_role/postgres) đọc/ghi.
-- Quy ước: tên bảng/cột tiếng Anh, chú thích tiếng Việt, enum thay bằng text + check.

-- 1. wa_conversation: thay cho thread:{phone} và phonelock:{phone}
-- Mỗi phiên hội thoại đại diện cho một chuỗi tương tác liên tục của một số điện thoại.
-- Khoá concurrency thực hiện bằng cơ chế lease (lock_token, lock_until), không dùng advisory lock.
create table wa_conversation (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^[0-9]{6,15}$'),
  language text not null default 'en' check (language in ('en', 'zh')),
  open_fields text[] not null default '{}',
  stall_count int not null default 0 check (stall_count >= 0),
  stated_values jsonb not null default '{}'::jsonb,
  last_guest_at timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason is null or end_reason in ('reset', 'expired')),
  lock_token uuid,
  lock_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wa_conversation_ended_pair check ((ended_at is null) = (end_reason is null)),
  constraint wa_conversation_lock_pair check ((lock_token is null) = (lock_until is null))
);

-- Chỉ cho phép duy nhất MỘT hội thoại đang mở (ended_at is null) trên mỗi số điện thoại.
create unique index wa_conversation_active_phone_uidx on wa_conversation (phone)
  where ended_at is null;

create index wa_conversation_phone_started_idx on wa_conversation (phone, started_at desc);

-- 2. wa_message: lịch sử lượt chat thay cho mảng tin nhắn trong thread:{phone}
create table wa_message (
  id bigserial primary key,
  conversation_id uuid not null references wa_conversation(id) on delete cascade,
  role text not null check (role in ('guest', 'assistant', 'staff')),
  body text not null check (char_length(body) > 0 and char_length(body) <= 4096),
  wa_message_id text,
  reply_kind text check (reply_kind is null or reply_kind in (
    'converse', 'handoff', 'not_booking', 'stalled',
    'asking_limit', 'partner_invitation', 'apology', 'reset', 'staff'
  )),
  staff_ref text,
  created_at timestamptz not null default now(),
  constraint wa_message_staff_ref_check check ((role = 'staff') = (staff_ref is not null))
);

create index wa_message_conversation_created_idx on wa_message (conversation_id, created_at desc);
create index wa_message_wamid_idx on wa_message (wa_message_id) where wa_message_id is not null;

-- 3. wa_inbound_claim: thay cho claim:{wa_message_id} trong KV chống xử lý trùng tin nhắn từ Meta webhook
create table wa_inbound_claim (
  wa_message_id text primary key,
  state text not null check (state in ('in_flight', 'done')),
  fence_token uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index wa_inbound_claim_expires_idx on wa_inbound_claim (expires_at);

-- 4. wa_handoff: thay cho pause:{phone} và set paused_phones
-- Giữ toàn bộ lịch sử chuyển máy nhân viên thay vì chỉ ghi đè trạng thái cuối cùng.
create table wa_handoff (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references wa_conversation(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{6,15}$'),
  reason text not null check (reason in (
    'guest_asked_for_human',
    'complaint_or_cancel',
    'not_booking',
    'stalled',
    'asking_limit',
    'partner_self_serve',
    'turn_failed'
  )),
  missing_fields text[] not null default '{}',
  context text check (context is null or char_length(context) <= 200),
  since timestamptz not null default now(),
  told_at timestamptz,
  resolved_at timestamptz,
  resolved_by_ref text,
  resolution text check (resolution is null or resolution in ('resume', 'reset', 'auto_resume', 'expired')),
  constraint wa_handoff_resolved_pair check ((resolved_at is null) = (resolution is null))
);

-- Mỗi số điện thoại chỉ có tối đa MỘT yêu cầu chuyển máy đang mở (chưa giải quyết).
create unique index wa_handoff_active_phone_uidx on wa_handoff (phone)
  where resolved_at is null;

create index wa_handoff_pending_idx on wa_handoff (since desc)
  where resolved_at is null;

create index wa_handoff_phone_since_idx on wa_handoff (phone, since desc);

-- 5. ai_enquiry: phần siêu dữ liệu riêng của bot gắn vào scenario của team
-- Mỗi báo giá do bot tạo là một bản ghi trong scenario (source='whatsapp').
-- Bảng này lưu thêm vòng đời phê duyệt của nhân viên (Studio) và các ghi chú chưa đồng bộ vào Odoo.
create table ai_enquiry (
  scenario_id uuid primary key references scenario(id) on delete cascade,
  conversation_id uuid references wa_conversation(id) on delete set null,
  phone text not null check (phone ~ '^[0-9]{6,15}$'),
  review_state text not null default 'pending_review' check (review_state in ('pending_review', 'approved', 'cancelled')),
  approved_at timestamptz,
  approved_by_ref text,
  staff_alerts text[] not null default '{}',
  staff_edits jsonb not null default '[]'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  confirmed_reply text,
  sent_to_guest_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_enquiry_approved_pair check ((approved_at is null) = (approved_by_ref is null))
);

-- Mỗi số điện thoại chỉ có tối đa MỘT báo giá đang mở (thay cho việc quét toàn bộ KV store).
create unique index ai_enquiry_active_phone_uidx on ai_enquiry (phone)
  where closed_at is null;

create index ai_enquiry_review_state_idx on ai_enquiry (review_state, created_at desc);
create index ai_enquiry_phone_created_idx on ai_enquiry (phone, created_at desc);

-- 6. ai_extraction: lưu trạng thái trích xuất theo từng revision do bot sinh ra (author='ai')
create table ai_extraction (
  revision_id uuid primary key references revision(id) on delete cascade,
  field_states jsonb not null default '{}'::jsonb,
  provider text not null check (provider in ('gemini', 'deepseek')),
  model text not null,
  tokens_in int not null default 0 check (tokens_in >= 0),
  tokens_out int not null default 0 check (tokens_out >= 0),
  latency_ms int not null default 0 check (latency_ms >= 0),
  created_at timestamptz not null default now()
);

-- 7. ai_provider_key: quản lý API key của các nhà cung cấp LLM, mã hoá bằng AES-256-GCM giống odoo_key_enc
create table ai_provider_key (
  provider text primary key check (provider in ('gemini', 'deepseek')),
  key_enc bytea not null,
  last4 text not null check (char_length(last4) = 4),
  updated_at timestamptz not null default now(),
  updated_by_ref text not null
);

-- 8. ai_setting_audit: vết kiểm toán thay đổi cấu hình AI (không giới hạn 50 dòng như KV cũ)
create table ai_setting_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_ref text not null,
  diff jsonb not null
);

create index ai_setting_audit_at_idx on ai_setting_audit (at desc);

-- 9. ai_provider_stat: thống kê sản lượng và độ trễ theo ngày, ghi nhận bằng upsert cộng dồn
create table ai_provider_stat (
  day date not null,
  provider text not null check (provider in ('gemini', 'deepseek')),
  ok int not null default 0 check (ok >= 0),
  fail int not null default 0 check (fail >= 0),
  fallback int not null default 0 check (fallback >= 0),
  ms_sum bigint not null default 0 check (ms_sum >= 0),
  n int not null default 0 check (n >= 0),
  primary key (day, provider)
);

-- 10. Cấu hình AI mặc định trong app_setting của team (hỗ trợ kiểm soát phiên bản lạc quan qua trường version)
insert into app_setting (key, value)
values (
  'ai',
  jsonb_build_object(
    'version', 1,
    'primary_provider', 'deepseek',
    'fallback_provider', 'gemini',
    'deepseek_model', 'deepseek-chat',
    'gemini_model', 'gemini-3.1-flash-lite',
    'timeout_ms', 20000,
    'circuit_breaker', jsonb_build_object(
      'failure_threshold', 5,
      'cooldown_ms', 60000
    )
  )
)
on conflict (key) do nothing;

-- Bật RLS trên tất cả các bảng mới: chỉ backend qua DATABASE_URL được phép truy cập
alter table wa_conversation enable row level security;
alter table wa_message enable row level security;
alter table wa_inbound_claim enable row level security;
alter table wa_handoff enable row level security;
alter table ai_enquiry enable row level security;
alter table ai_extraction enable row level security;
alter table ai_provider_key enable row level security;
alter table ai_setting_audit enable row level security;
alter table ai_provider_stat enable row level security;
-- Không có policy nào: anon / authenticated qua PostgREST sẽ thấy 0 dòng.
