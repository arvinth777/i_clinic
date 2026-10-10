-- All bill writes must use the role-checked atomic payment/correction functions.
drop policy bills_insert_receptionist on public.bills;
drop policy bills_insert_doctor on public.bills;
drop policy bill_line_items_insert_receptionist on public.bill_line_items;
drop policy bill_line_items_insert_doctor on public.bill_line_items;
revoke insert, update, delete on public.bills, public.bill_line_items from anon, authenticated;
