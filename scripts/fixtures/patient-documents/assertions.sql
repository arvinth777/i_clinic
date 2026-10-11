insert into public.patient_files(id,clinic_id,patient_id,title,category,mime_type,size_bytes,content_sha256,drive_file_id,uploaded_by,status)
values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','Synthetic report','MRI','application/pdf',20,repeat('a',64),'synthetic-file','30000000-0000-4000-8000-000000000001','ready');
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
do $$begin
 if (select count(*) from public.patient_files) <> 1 then raise exception 'doctor read failed'; end if;
 begin update public.patient_files set title='forged'; raise exception 'direct update allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.patient_files; raise exception 'direct delete allowed'; exception when insufficient_privilege then null; end;
 begin insert into public.patient_files(id) values(gen_random_uuid()); raise exception 'direct insert allowed'; exception when insufficient_privilege then null; end;
 begin perform * from public.clinic_drive_connections; raise exception 'credential disclosure'; exception when insufficient_privilege then null; end;
 begin perform * from public.clinic_drive_oauth_states; raise exception 'state disclosure'; exception when insufficient_privilege then null; end;
end $$;
select 'PASS: doctor read; all direct writes and credential/state reads blocked';
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',true);
do $$begin if (select count(*) from public.patient_files) <> 0 then raise exception 'reception can read files'; end if; end $$;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
do $$begin if (select count(*) from public.patient_files) <> 0 then raise exception 'admin can read files'; end if; end $$;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000004',true);
do $$begin if (select count(*) from public.patient_files) <> 0 then raise exception 'other clinic can read files'; end if; end $$;
set local role anon;
do $$begin begin perform * from public.patient_files; raise exception 'anonymous read allowed'; exception when insufficient_privilege then null; end; end $$;
reset role;
select 'PASS: reception, admin, other-clinic and anonymous boundaries';
set local role service_role;
do $$begin
 begin update public.patient_files set clinic_id='10000000-0000-4000-8000-000000000002'; raise exception 'patient clinic mismatch allowed'; exception when raise_exception then if sqlerrm <> 'invalid patient clinic' then raise; end if; end;
end $$;
select public.save_clinic_drive_connection('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','synthetic-account','clinic@example.test','synthetic-folder','encrypted-test');
do $$begin
 begin perform public.save_clinic_drive_connection('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','different-account','other@example.test','other-folder','encrypted-test'); raise exception 'account switched'; exception when raise_exception then if sqlerrm <> 'reconnect the same clinic account' then raise; end if; end;
 begin perform public.save_clinic_drive_connection('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','synthetic-account','clinic@example.test','synthetic-folder','encrypted-test'); raise exception 'reception connected'; exception when raise_exception then if sqlerrm <> 'doctor access required' then raise; end if; end;
end $$;
reset role;
select 'PASS: database enforces patient clinic and stable Drive ownership';
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
select public.merge_patients('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003');
do $$begin if not exists(select 1 from public.patient_files where patient_id='20000000-0000-4000-8000-000000000001' and drive_file_id='synthetic-file') then raise exception 'merge lost file'; end if; end $$;
select 'PASS: duplicate-patient merge retains document association';
rollback;
