-- Free-text business columns from each FMS's source sheet (order ID, customer name, amount, etc.
-- — everything before that FMS's first stage's Plan Time column), published by
-- FMS_Status_Publisher.gs's new details_json field (see app/FMS_Status_Publisher.gs). Nullable —
-- an FMS still running an older publisher script simply has no details until it's redeployed.
ALTER TABLE records ADD COLUMN IF NOT EXISTS details jsonb;
