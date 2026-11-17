-- Node mode and the workflow hub were retired; saved workflows are cleared by product decision.
DELETE FROM wujie_user_data WHERE data_key LIKE 'workflow\_%' ESCAPE '\';

UPDATE wujie_projects
   SET metadata = metadata - 'workflow'
 WHERE metadata ? 'workflow';

UPDATE wujie_user_data
   SET data_value = (
     SELECT jsonb_agg(
       CASE
         WHEN jsonb_typeof(item.value->'metadata') = 'object' AND (item.value->'metadata') ? 'workflow'
           THEN jsonb_set(item.value, '{metadata}', (item.value->'metadata') - 'workflow')
         ELSE item.value
       END
       ORDER BY item.ordinality
     )
     FROM jsonb_array_elements(data_value) WITH ORDINALITY AS item(value, ordinality)
   )
 WHERE data_key = 'projects'
   AND jsonb_typeof(data_value) = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(data_value) AS item(value)
      WHERE jsonb_typeof(item.value->'metadata') = 'object' AND (item.value->'metadata') ? 'workflow'
   );

DROP TABLE IF EXISTS wujie_workflow_edit_outputs;
DROP TABLE IF EXISTS wujie_workflow_edit_publications;
