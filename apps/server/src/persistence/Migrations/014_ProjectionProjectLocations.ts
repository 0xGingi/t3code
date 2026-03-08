import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN location_json TEXT
  `.pipe(Effect.catch(() => Effect.void));

  yield* sql`
    UPDATE projection_projects
    SET location_json = json_object('kind', 'local', 'rootPath', workspace_root)
    WHERE location_json IS NULL
       OR trim(location_json) = ''
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.location',
      json_object('kind', 'local', 'rootPath', json_extract(payload_json, '$.workspaceRoot'))
    )
    WHERE event_type = 'project.created'
      AND json_type(payload_json, '$.location') IS NULL
      AND json_type(payload_json, '$.workspaceRoot') = 'text'
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.location',
      json_object('kind', 'local', 'rootPath', json_extract(payload_json, '$.workspaceRoot'))
    )
    WHERE event_type = 'project.meta-updated'
      AND json_type(payload_json, '$.location') IS NULL
      AND json_type(payload_json, '$.workspaceRoot') = 'text'
  `;
});
