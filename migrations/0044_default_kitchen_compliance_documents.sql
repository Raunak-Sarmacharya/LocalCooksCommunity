ALTER TABLE location_requirements
  ALTER COLUMN tier2_food_establishment_cert_required SET DEFAULT true;

UPDATE location_requirements
SET require_food_handler_cert = true,
    tier2_food_establishment_cert_required = true
WHERE require_food_handler_cert IS DISTINCT FROM true
   OR tier2_food_establishment_cert_required IS DISTINCT FROM true;
