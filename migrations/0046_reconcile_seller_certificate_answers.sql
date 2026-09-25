-- A certificate uploaded after submission is evidence the chef now has it.
UPDATE applications
SET food_safety_license = 'yes'
WHERE food_safety_license <> 'yes'
  AND food_safety_license_url IS NOT NULL
  AND btrim(food_safety_license_url) <> '';

UPDATE applications
SET food_establishment_cert = 'yes'
WHERE food_establishment_cert <> 'yes'
  AND food_establishment_cert_url IS NOT NULL
  AND btrim(food_establishment_cert_url) <> '';
