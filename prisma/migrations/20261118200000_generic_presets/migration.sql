UPDATE "jobs" SET "preset" = 'react', "request" = replace("request", '"preset":"gta6-react"', '"preset":"react"') WHERE "preset" = 'gta6-react';
UPDATE "jobs" SET "preset" = 'gameplay-camera', "request" = replace("request", '"preset":"gta6-gameplay"', '"preset":"gameplay-camera"') WHERE "preset" = 'gta6-gameplay';
UPDATE "batches" SET "preset" = 'react' WHERE "preset" = 'gta6-react';
UPDATE "batches" SET "preset" = 'gameplay-camera' WHERE "preset" = 'gta6-gameplay';
