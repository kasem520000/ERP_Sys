import EmbeddedPostgres from "embedded-postgres";
const pg = new EmbeddedPostgres({ databaseDir: "/tmp/erp-pg-data2", user: "postgres", password: "pw", port: 54399, persistent: false });
await pg.initialise();
await pg.start();
await pg.createDatabase("erp");
console.log("PG_READY");
setInterval(() => {}, 1000);
