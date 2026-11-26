-- JORNADA+ V3: executar no SQL Editor de um projeto Supabase novo.
-- Armazenamento privado e políticas que isolam os dados por usuário.
-- Execute com atenção no projeto CORRETO; este script configura tabelas e políticas.

create table if not exists public.jornada_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Meu perfil' check (char_length(name) between 2 and 70),
  schedule jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.jornada_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  mark_idx smallint not null check (mark_idx between 0 and 3),
  at timestamptz not null,
  manual boolean not null default false,
  scheduled boolean not null default true,
  goal_minutes integer not null default 480 check (goal_minutes between 0 and 1440),
  has_interval boolean not null default true,
  photo_path text,
  original_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, day, mark_idx)
);

create index if not exists jornada_marks_owner_day on public.jornada_marks(user_id,day desc);

alter table public.jornada_profiles enable row level security;
alter table public.jornada_marks enable row level security;

-- Em cada operação, somente o próprio usuário autenticado tem acesso.
drop policy if exists "profile_read_self" on public.jornada_profiles;
create policy "profile_read_self" on public.jornada_profiles for select to authenticated
  using (id=(select auth.uid()));
drop policy if exists "profile_insert_self" on public.jornada_profiles;
create policy "profile_insert_self" on public.jornada_profiles for insert to authenticated
  with check (id=(select auth.uid()));
drop policy if exists "profile_update_self" on public.jornada_profiles;
create policy "profile_update_self" on public.jornada_profiles for update to authenticated
  using (id=(select auth.uid())) with check (id=(select auth.uid()));
drop policy if exists "profile_delete_self" on public.jornada_profiles;
create policy "profile_delete_self" on public.jornada_profiles for delete to authenticated
  using (id=(select auth.uid()));

drop policy if exists "marks_read_self" on public.jornada_marks;
create policy "marks_read_self" on public.jornada_marks for select to authenticated
  using (user_id=(select auth.uid()));
drop policy if exists "marks_insert_self" on public.jornada_marks;
create policy "marks_insert_self" on public.jornada_marks for insert to authenticated
  with check (user_id=(select auth.uid()));
drop policy if exists "marks_update_self" on public.jornada_marks;
create policy "marks_update_self" on public.jornada_marks for update to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists "marks_delete_self" on public.jornada_marks;
create policy "marks_delete_self" on public.jornada_marks for delete to authenticated
  using (user_id=(select auth.uid()));

-- Foto opcional: bucket PRIVADO. Não disponibilizar publicamente!
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('ponto-fotos','ponto-fotos',false,15728640,array['image/jpeg'])
on conflict (id) do update set public=false,file_size_limit=15728640,allowed_mime_types=array['image/jpeg'];

-- O caminho de cada foto começa com o id da conta: <user_id>/<foto>.jpg.
drop policy if exists "ponto_upload_owner" on storage.objects;
create policy "ponto_upload_owner" on storage.objects for insert to authenticated
  with check (bucket_id='ponto-fotos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "ponto_read_owner" on storage.objects;
create policy "ponto_read_owner" on storage.objects for select to authenticated
  using (bucket_id='ponto-fotos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "ponto_delete_owner" on storage.objects;
create policy "ponto_delete_owner" on storage.objects for delete to authenticated
  using (bucket_id='ponto-fotos' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- JORNADA+ V4 - Observações pessoais associadas ao dia.
-- Execute novamente o setup.sql completo caso venha de uma V3 já configurada.
create table if not exists public.jornada_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null default 'outro' check (kind in ('falta','atestado','feriado','folga','outro')),
  description text not null default '' check (char_length(description)<=500),
  created_at timestamptz not null default now(),
  unique (user_id,day)
);
create index if not exists jornada_notes_owner_day on public.jornada_notes(user_id,day desc);
alter table public.jornada_notes enable row level security;
drop policy if exists "notes_select_self" on public.jornada_notes;
create policy "notes_select_self" on public.jornada_notes for select to authenticated using (user_id=(select auth.uid()));
drop policy if exists "notes_insert_self" on public.jornada_notes;
create policy "notes_insert_self" on public.jornada_notes for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists "notes_update_self" on public.jornada_notes;
create policy "notes_update_self" on public.jornada_notes for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists "notes_delete_self" on public.jornada_notes;
create policy "notes_delete_self" on public.jornada_notes for delete to authenticated using (user_id=(select auth.uid()));

-- Garantir que a API permita acesso às tabelas SOMENTE para usuários autenticados;
-- RLS acima continua restringindo cada usuário aos próprios dados.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.jornada_profiles to authenticated;
grant select, insert, update, delete on public.jornada_marks to authenticated;
grant select, insert, update, delete on public.jornada_notes to authenticated;
revoke all on public.jornada_profiles from anon;
revoke all on public.jornada_marks from anon;
revoke all on public.jornada_notes from anon;

-- JORNADA+ V5.2 — CADASTRO POR USUÁRIO, SEM E-MAIL INFORMADO
-- Reexecute todo este SQL no SQL Editor após criar um projeto Supabase.
-- A função Edge é a ÚNICA autorizada a consultar/alterar códigos de recuperação.
create table if not exists public.jornada_account_recovery (
 user_id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z][a-z0-9_-]{3,23}$'),
 code_hash text not null,
 changed_at timestamptz not null default now()
);
create table if not exists public.jornada_auth_attempts (
 id bigint generated always as identity primary key,
 action text not null check (action in ('register','recover','rotate')),
 ip_hash text not null,
 identifier_hash text not null,
 created_at timestamptz not null default now()
);
create index if not exists jornada_auth_attempts_lookup on public.jornada_auth_attempts(action,ip_hash,created_at desc);
create index if not exists jornada_auth_attempts_identifier on public.jornada_auth_attempts(action,identifier_hash,created_at desc);
alter table public.jornada_account_recovery enable row level security;
alter table public.jornada_auth_attempts enable row level security;
-- Nenhuma policy: clientes anon/authenticated NÃO podem ler, inserir, alterar ou excluir os códigos.
revoke all on public.jornada_account_recovery from PUBLIC, anon, authenticated;
revoke all on public.jornada_auth_attempts from PUBLIC, anon, authenticated;
-- NÃO criar políticas permissivas nessas tabelas. O service_role do servidor usa bypass de RLS.
