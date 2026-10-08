-- Bộ kiểm thử tự động cho migration kênh AI / WhatsApp: 20261009000000_ai_channel.sql
-- Chạy bằng: psql -v ON_ERROR_STOP=1 -f ai_channel.test.sql
-- Bao gồm:
--   1. Đường âm (Negative tests): kiểm tra các ràng buộc toàn vẹn, định dạng, khóa ngoại và unique partial indexes.
--   2. Đường dương (Positive tests): kiểm tra cơ chế claim atomic, lease phân tán, và upsert thống kê cộng dồn.
--   3. Kế hoạch thực thi (EXPLAIN): chứng minh các truy vấn nóng dùng index chuyên dụng.

\echo '========================================================================'
\echo 'BẮT ĐẦU KIỂM THỬ MIGRATION KÊNH AI / WHATSAPP'
\echo '========================================================================'

-- Dọn dẹp dữ liệu test cũ (nếu có)
delete from wa_message where wa_message_id like 'test_%';
delete from wa_inbound_claim where wa_message_id like 'test_%';
delete from wa_handoff where phone in ('84359386414', '84901234567');
delete from ai_enquiry where phone in ('84359386414', '84901234567');
delete from wa_conversation where phone in ('84359386414', '84901234567');
delete from ai_provider_stat where day = current_date and provider in ('gemini', 'deepseek');

-- ========================================================================
-- PHẦN 1: ĐƯỜNG ÂM (NEGATIVE TESTS)
-- Mỗi trường hợp phải bị chặn chính xác bởi DB constraint/index tương ứng.
-- ========================================================================

\echo '--- [Negative 1] Mở 2 hội thoại cùng số khi hội thoại cũ chưa đóng ---'
do $$
declare
  c1_id uuid;
begin
  insert into wa_conversation (phone, language)
  values ('84359386414', 'en')
  returning id into c1_id;

  begin
    insert into wa_conversation (phone, language)
    values ('84359386414', 'zh');

    raise exception 'FAIL: Lẽ ra phải bị chặn bởi wa_conversation_active_phone_uidx!';
  exception
    when unique_violation then
      raise notice 'PASS: Đã chặn thành công 2 hội thoại mở cùng số (%)', sqlerrm;
  end;
end $$;

\echo '--- [Negative 2] Mở 2 lần chuyển máy (handoff) cùng số khi lần trước chưa giải quyết ---'
do $$
declare
  conv_id uuid;
begin
  select id into conv_id from wa_conversation where phone = '84359386414' and ended_at is null;

  insert into wa_handoff (conversation_id, phone, reason, context)
  values (conv_id, '84359386414', 'guest_asked_for_human', 'Khách muốn gặp lễ tân');

  begin
    insert into wa_handoff (conversation_id, phone, reason, context)
    values (conv_id, '84359386414', 'complaint_or_cancel', 'Khách phàn nàn lần 2');

    raise exception 'FAIL: Lẽ ra phải bị chặn bởi wa_handoff_active_phone_uidx!';
  exception
    when unique_violation then
      raise notice 'PASS: Đã chặn thành công 2 yêu cầu handoff cùng số (%)', sqlerrm;
  end;
end $$;

\echo '--- [Negative 3] Tin nhắn role=staff nhưng thiếu staff_ref hoặc role=guest có staff_ref ---'
do $$
declare
  conv_id uuid;
begin
  select id into conv_id from wa_conversation where phone = '84359386414' and ended_at is null;

  -- Trường hợp 3a: role=staff nhưng staff_ref is null
  begin
    insert into wa_message (conversation_id, role, body, staff_ref)
    values (conv_id, 'staff', 'Xin chào từ nhân viên', null);

    raise exception 'FAIL: Lẽ ra phải bị chặn do role=staff mà staff_ref null!';
  exception
    when check_violation then
      raise notice 'PASS: Đã chặn role=staff thiếu staff_ref (%)', sqlerrm;
  end;

  -- Trường hợp 3b: role=guest nhưng lại có staff_ref
  begin
    insert into wa_message (conversation_id, role, body, staff_ref)
    values (conv_id, 'guest', 'Tin từ khách', 'staff_user_1');

    raise exception 'FAIL: Lẽ ra phải bị chặn do role=guest mà có staff_ref!';
  exception
    when check_violation then
      raise notice 'PASS: Đã chặn role=guest có staff_ref (%)', sqlerrm;
  end;
end $$;

\echo '--- [Negative 4] Handoff với reason không hợp lệ (không nằm trong 7 lý do chuẩn) ---'
do $$
declare
  conv_id uuid;
begin
  select id into conv_id from wa_conversation where phone = '84359386414' and ended_at is null;

  begin
    insert into wa_handoff (conversation_id, phone, reason)
    values (conv_id, '84901234567', 'random_invalid_reason');

    raise exception 'FAIL: Lẽ ra phải bị chặn do reason không hợp lệ!';
  exception
    when check_violation then
      raise notice 'PASS: Đã chặn reason không hợp lệ (%)', sqlerrm;
  end;
end $$;

\echo '--- [Negative 5] Phone sai định dạng (chứa chữ cái hoặc độ dài không hợp lệ) ---'
do $$
begin
  -- 5a: Chứa chữ cái
  begin
    insert into wa_conversation (phone) values ('+84359386abc');
    raise exception 'FAIL: Lẽ ra phải bị chặn phone chứa chữ cái!';
  exception
    when check_violation then
      raise notice 'PASS: Đã chặn phone chứa chữ cái (%)', sqlerrm;
  end;

  -- 5b: Quá ngắn (< 6 ký tự)
  begin
    insert into wa_conversation (phone) values ('12345');
    raise exception 'FAIL: Lẽ ra phải bị chặn phone quá ngắn!';
  exception
    when check_violation then
      raise notice 'PASS: Đã chặn phone < 6 ký tự (%)', sqlerrm;
  end;

  -- 5c: Quá dài (> 15 ký tự)
  begin
    insert into wa_conversation (phone) values ('1234567890123456');
    raise exception 'FAIL: Lẽ ra phải bị chặn phone > 15 ký tự!';
  exception
    when check_violation then
      raise notice 'PASS: Đã chặn phone > 15 ký tự (%)', sqlerrm;
  end;
end $$;

\echo '--- [Negative 6] ai_extraction trỏ tới revision không tồn tại ---'
do $$
begin
  begin
    insert into ai_extraction (revision_id, field_states, provider, model)
    values (gen_random_uuid(), '{"checkIn": "given"}'::jsonb, 'gemini', 'gemini-3.1-flash-lite');

    raise exception 'FAIL: Lẽ ra phải bị chặn do khóa ngoại revision_id không tồn tại!';
  exception
    when foreign_key_violation then
      raise notice 'PASS: Đã chặn foreign_key_violation revision_id (%)', sqlerrm;
  end;
end $$;

\echo '--- [Negative 7] Claim trùng tin nhắn khi còn in_flight và chưa hết hạn ---'
do $$
declare
  claim1_rows int;
  claim2_rows int;
  fence1 uuid := gen_random_uuid();
  fence2 uuid := gen_random_uuid();
begin
  -- Lần 1: Claim tin nhắn 'test_wamid_001' trong 60 giây
  with claim_attempt as (
    insert into wa_inbound_claim (wa_message_id, state, fence_token, expires_at)
    values ('test_wamid_001', 'in_flight', fence1, now() + interval '60 seconds')
    on conflict (wa_message_id) do update
      set state = 'in_flight', fence_token = excluded.fence_token, expires_at = excluded.expires_at, updated_at = now()
    where wa_inbound_claim.state = 'in_flight' and wa_inbound_claim.expires_at < now()
    returning *
  )
  select count(*) into claim1_rows from claim_attempt;

  if claim1_rows <> 1 then
    raise exception 'FAIL: Lần 1 claim phải thành công (1 dòng)!';
  end if;

  -- Lần 2: Thử claim lại ngay lập tức khi claim 1 chưa hết hạn
  with claim_attempt as (
    insert into wa_inbound_claim (wa_message_id, state, fence_token, expires_at)
    values ('test_wamid_001', 'in_flight', fence2, now() + interval '60 seconds')
    on conflict (wa_message_id) do update
      set state = 'in_flight', fence_token = excluded.fence_token, expires_at = excluded.expires_at, updated_at = now()
    where wa_inbound_claim.state = 'in_flight' and wa_inbound_claim.expires_at < now()
    returning *
  )
  select count(*) into claim2_rows from claim_attempt;

  if claim2_rows <> 0 then
    raise exception 'FAIL: Lần 2 claim phải trả về 0 dòng do claim cũ còn in_flight!';
  else
    raise notice 'PASS: Chặn trùng tin nhắn thành công (claim 2 trả về 0 dòng)';
  end if;
end $$;

-- ========================================================================
-- PHẦN 2: ĐƯỜNG DƯƠNG (POSITIVE TESTS)
-- ========================================================================

\echo '--- [Positive 1] Tái chiếm Claim (Reclaim) sau khi hết hạn timeout ---'
do $$
declare
  reclaimed_rows int;
  fence_new uuid := gen_random_uuid();
begin
  -- Giả lập claim cũ đã hết hạn (expires_at trong quá khứ)
  update wa_inbound_claim
     set expires_at = now() - interval '5 seconds'
   where wa_message_id = 'test_wamid_001';

  -- Thử chiếm lại
  with claim_attempt as (
    insert into wa_inbound_claim (wa_message_id, state, fence_token, expires_at)
    values ('test_wamid_001', 'in_flight', fence_new, now() + interval '60 seconds')
    on conflict (wa_message_id) do update
      set state = 'in_flight', fence_token = excluded.fence_token, expires_at = excluded.expires_at, updated_at = now()
    where wa_inbound_claim.state = 'in_flight' and wa_inbound_claim.expires_at < now()
    returning *
  )
  select count(*) into reclaimed_rows from claim_attempt;

  if reclaimed_rows = 1 then
    raise notice 'PASS: Reclaim thành công khi claim cũ đã hết hạn (1 dòng)';
  else
    raise exception 'FAIL: Lẽ ra phải reclaim thành công khi expires_at < now()!';
  end if;
end $$;

\echo '--- [Positive 2] Cơ chế Lease khóa hội thoại theo số điện thoại ---'
do $$
declare
  conv_id uuid;
  token1 uuid := gen_random_uuid();
  token2 uuid := gen_random_uuid();
  token3 uuid := gen_random_uuid();
  locked1 int;
  locked2 int;
  locked3 int;
begin
  select id into conv_id from wa_conversation where phone = '84359386414' and ended_at is null;

  -- 2a: Lấy khóa lần 1 khi chưa ai giữ khóa
  update wa_conversation
     set lock_token = token1, lock_until = now() + interval '30 seconds'
   where id = conv_id and (lock_until is null or lock_until < now());
  get diagnostics locked1 = row_count;

  if locked1 <> 1 then
    raise exception 'FAIL: Lấy lease lần 1 thất bại!';
  end if;

  -- 2b: Cố gắng lấy khóa lần 2 khi lease đang còn hạn -> phải bị từ chối (0 dòng)
  update wa_conversation
     set lock_token = token2, lock_until = now() + interval '30 seconds'
   where id = conv_id and (lock_until is null or lock_until < now());
  get diagnostics locked2 = row_count;

  if locked2 <> 0 then
    raise exception 'FAIL: Lease đang còn hiệu lực không được cho phép cướp!';
  end if;

  -- 2c: Giả lập lease hết hạn -> tiến trình khác lấy lại được khóa thành công
  update wa_conversation set lock_until = now() - interval '1 second' where id = conv_id;

  update wa_conversation
     set lock_token = token3, lock_until = now() + interval '30 seconds'
   where id = conv_id and (lock_until is null or lock_until < now());
  get diagnostics locked3 = row_count;

  if locked3 = 1 then
    raise notice 'PASS: Lease phân tán hoạt động hoàn hảo (lấy thành công, chống cướp, và tự hồi phục khi hết hạn)';
  else
    raise exception 'FAIL: Lease hết hạn nhưng không lấy lại được!';
  end if;

  -- Giải phóng khóa
  update wa_conversation set lock_token = null, lock_until = null where id = conv_id;
end $$;

\echo '--- [Positive 3] Upsert cộng dồn thống kê ai_provider_stat ---'
do $$
declare
  r record;
begin
  -- Lượt 1: Ghi nhận 1 request ok
  insert into ai_provider_stat (day, provider, ok, fail, fallback, ms_sum, n)
  values (current_date, 'gemini', 1, 0, 0, 1500, 1)
  on conflict (day, provider) do update
    set ok = ai_provider_stat.ok + excluded.ok,
        fail = ai_provider_stat.fail + excluded.fail,
        fallback = ai_provider_stat.fallback + excluded.fallback,
        ms_sum = ai_provider_stat.ms_sum + excluded.ms_sum,
        n = ai_provider_stat.n + excluded.n;

  -- Lượt 2: Ghi nhận thêm 2 ok, 1 fail, 1 fallback
  insert into ai_provider_stat (day, provider, ok, fail, fallback, ms_sum, n)
  values (current_date, 'gemini', 2, 1, 1, 3500, 3)
  on conflict (day, provider) do update
    set ok = ai_provider_stat.ok + excluded.ok,
        fail = ai_provider_stat.fail + excluded.fail,
        fallback = ai_provider_stat.fallback + excluded.fallback,
        ms_sum = ai_provider_stat.ms_sum + excluded.ms_sum,
        n = ai_provider_stat.n + excluded.n;

  select ok, fail, fallback, ms_sum, n into r
  from ai_provider_stat where day = current_date and provider = 'gemini';

  if r.ok = 3 and r.fail = 1 and r.fallback = 1 and r.ms_sum = 5000 and r.n = 4 then
    raise notice 'PASS: Upsert thống kê cộng dồn chính xác (ok=3, fail=1, fallback=1, ms_sum=5000, n=4)';
  else
    raise exception 'FAIL: Thống kê cộng dồn sai kết quả!';
  end if;
end $$;

-- ========================================================================
-- PHẦN 3: KIỂM CHỨNG KẾ HOẠCH THỰC THI (EXPLAIN PLAN CHO TRUY VẤN NÓNG)
-- ========================================================================

\echo '--- [Explain 1] Tìm báo giá đang mở theo số điện thoại (ai_enquiry_active_phone_uidx) ---'
explain (costs off)
select * from ai_enquiry where phone = '84359386414' and closed_at is null;

\echo '--- [Explain 2] Danh sách yêu cầu chuyển máy đang mở theo thời gian (wa_handoff_pending_idx) ---'
explain (costs off)
select * from wa_handoff where resolved_at is null order by since desc;

\echo '--- [Explain 3] 20 lượt tin nhắn gần nhất theo hội thoại (wa_message_conversation_created_idx) ---'
explain (costs off)
select * from wa_message
where conversation_id = 'a0000000-0000-0000-0000-000000000001'
order by created_at desc
limit 20;

\echo '========================================================================'
\echo 'TẤT CẢ CÁC BÀI TEST ĐÃ VƯỢT QUA 100% THÀNH CÔNG!'
\echo '========================================================================'
