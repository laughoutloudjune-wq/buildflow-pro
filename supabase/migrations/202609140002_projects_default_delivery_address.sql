-- A saved delivery note per job site, to prefill the PO form's
-- "หมายเหตุการจัดส่ง" box (purchase_orders.delivery_address).
--
-- That box has always started empty, so whoever raises a PO retypes the same
-- drop-off point, site contact and timing for every order on the same site.
-- Each project takes deliveries at one place in practice, so the preset lives
-- here as a single column rather than a list of drop points.
--
-- Deliberately NOT projects.location: that column is a short locale label
-- ("ต.หนองตำลึง อ.พานทอง จ.ชลบุรี") used to group and sort project lists and
-- shown as a dropdown sublabel. A delivery note is a different thing - where
-- the truck actually goes, who meets it, when - and overloading location
-- would change what those lists display.
--
-- The PO keeps its own delivery_address copy: prefilling happens at PO
-- creation, so editing a site's preset later never rewrites the delivery
-- instructions on orders already placed.
alter table public.projects
  add column if not exists delivery_address text;

comment on column public.projects.delivery_address is
  'Default delivery note for this job site. Prefills purchase_orders.delivery_address on new POs, overridable per PO.';
