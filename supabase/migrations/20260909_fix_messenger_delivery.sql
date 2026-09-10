-- Make direct chats and message delivery atomic under RLS.

alter table public.chats add column if not exists direct_key text;
create unique index if not exists chats_direct_key_unique
  on public.chats (direct_key)
  where direct_key is not null;

create or replace function public.get_or_create_direct_chat(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_chat_id uuid;
  v_direct_key text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'A different recipient is required';
  end if;

  if not exists (select 1 from auth.users where id = p_other_user_id) then
    raise exception 'Recipient does not exist';
  end if;

  v_direct_key := least(v_user_id::text, p_other_user_id::text) || ':' || greatest(v_user_id::text, p_other_user_id::text);

  select id into v_chat_id
  from public.chats
  where direct_key = v_direct_key;

  if v_chat_id is null then
    insert into public.chats (direct_key)
    values (v_direct_key)
    on conflict (direct_key) where direct_key is not null do update
    set direct_key = excluded.direct_key
    returning id into v_chat_id;
  end if;

  insert into public.chat_members (chat_id, user_id, other_user_id)
  values
    (v_chat_id, v_user_id, p_other_user_id),
    (v_chat_id, p_other_user_id, v_user_id)
  on conflict (chat_id, user_id) do update
  set other_user_id = excluded.other_user_id;

  return v_chat_id;
end;
$$;

create or replace function public.send_chat_message(
  p_chat_id uuid,
  p_message_id uuid,
  p_sender_id uuid,
  p_text text,
  p_media_url text,
  p_media_type text,
  p_reply_to uuid,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_summary text;
  v_inserted_message_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_sender_id then
    raise exception 'Sender must be the authenticated user';
  end if;

  if not exists (
    select 1
    from public.chat_members
    where chat_id = p_chat_id and user_id = p_sender_id
  ) then
    raise exception 'Sender is not a chat member';
  end if;

  insert into public.messages (
    id,
    chat_id,
    sender_id,
    text,
    media_url,
    media_type,
    reply_to,
    created_at
  )
  values (
    p_message_id,
    p_chat_id,
    p_sender_id,
    coalesce(p_text, ''),
    p_media_url,
    p_media_type,
    p_reply_to,
    v_created_at
  )
  on conflict (id) do nothing
  returning id into v_inserted_message_id;

  if v_inserted_message_id is null then
    return;
  end if;

  v_summary := case
    when p_media_type = 'voice' then 'Voice message'
    when p_media_type = 'image' then 'Image file'
    when p_media_type = 'file' then 'Document file'
    when coalesce(p_text, '') <> '' then p_text
    else 'Media'
  end;

  update public.chat_members
  set
    last_message_text = v_summary,
    last_message_at = v_created_at,
    last_message_sender_id = p_sender_id,
    last_message_is_read = user_id = p_sender_id,
    unread_count = case
      when user_id = p_sender_id then 0
      else unread_count + 1
    end
  where chat_id = p_chat_id;
end;
$$;

revoke all on function public.get_or_create_direct_chat(uuid) from public;
revoke all on function public.send_chat_message(uuid, uuid, uuid, text, text, text, uuid, timestamptz) from public;
grant execute on function public.get_or_create_direct_chat(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid, uuid, uuid, text, text, text, uuid, timestamptz) to authenticated;

-- The RPCs above exclusively create memberships and update recipient previews.
-- Clients may only update or hide their own inbox entry.
drop policy if exists chat_members_all on public.chat_members;
drop policy if exists chat_members_insert on public.chat_members;
drop policy if exists chat_members_update on public.chat_members;
drop policy if exists chat_members_delete on public.chat_members;
create policy chat_members_update on public.chat_members
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy chat_members_delete on public.chat_members
  for delete using (auth.uid() = user_id);

-- Message body/content cannot be inserted or edited through the client;
-- senders may only soft-delete their own messages.
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update using (auth.uid() = sender_id)
  with check (auth.uid() = sender_id and is_deleted = true);

drop policy if exists chats_insert on public.chats;
create policy chats_insert on public.chats
  for insert with check (false);
