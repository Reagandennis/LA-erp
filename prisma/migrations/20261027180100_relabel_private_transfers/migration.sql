-- Standardized Naming Master v2: a transport event's Type uses the catalog's
-- names. Every imported movement was a "Private transfer"; one that touches an
-- airport becomes an Airport Transfer, the rest Point-to-Point Transfers.
-- Only a place's name (up to the first comma) is read, so "Airport Road" in a
-- hotel's address doesn't count. Mirrors isAirportPlace in lib/service-catalog.ts.
UPDATE "public"."TripItineraryItem" AS item
SET "details" = jsonb_set(
  item."details",
  '{mode}',
  to_jsonb(
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM unnest(ARRAY[item."details"->>'pickupLocation', item."details"->>'dropoffLocation']) AS place(value)
        WHERE lower(btrim(split_part(place.value, ',', 1))) ~ '(\y(airports?|airort|aiport|airstrip)\y|\yjkia\y|jomo kenyatta|uwanja wa ndege|kotoka|^entebbe\y|julius nyerere|murtala|nnamdi azikiwe|kenneth kaunda|\yo\.? ?r\.? tambo|\ybole (addis|international|internatoional|airport))'
          AND lower(btrim(split_part(place.value, ',', 1))) !~ '(hotel|\yinn\y|plaza|sheraton|hilton|doubletree|crowne|lodge|suites|resort|\ymall\y|school|bank|\yroad\y|street|roundabout|convention|building|apartment|office|university|campus|cent(re|er))'
      ) THEN 'Airport Transfer'
      ELSE 'Point-to-Point Transfer'
    END
  )
)
WHERE item."category" = 'transportation'
  AND jsonb_typeof(item."details") = 'object'
  AND item."details"->>'mode' = 'Private transfer';
