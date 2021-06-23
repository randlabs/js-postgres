# js-postgres

An augmented Postgresql database wrapper.

## Installation

Run `npm i @randlabs/js-postgres` inside your project's root directory.

## Quick usage

```typescript
import * as Database from "@randlabs/js-postgres";

// Initialize database manager
let manager = new Database.Manager({
	host: "127.0.0.1",
	port: 5432,
	user: "my-user",
	password: "my-password",
	database: "my-database",
	usePool: true,
	maxConnections: 100
});

// Get a connection
const client = await manager.getClient();

// Execute a query within a try/catch block in order to return the connection to the pool after using it
try {
	// For documentation about queries, see node-postgres documentation at https://node-postgres.com/
	const result = await client.query(
		"SELECT value FROM config WHERE key = $1",
		[ key ]
	);
	...
	client.release();
}
catch (err) {
	client.release(err);
	throw err; //re-throw
}

// Or use our wrapper to handle errors automatically
const result = await manager.withClient((client: Database.Client, customParam: any): Promise<any> => {
	const result = await client.query(
		"SELECT value FROM config WHERE key = $1",
		[ customParam.key ]
	);
	return result;
}, {
	key: "test-key"
});

// Also we provide a transaction wrapper
const result = await manager.withClient((client: Database.Client): Promise<any> => {
	// withTx will start a transaction and commit/rollback it, depending if an error is thrown or not
	await client.withTx((c: Database.Client) => {
		await c.query("INSERT INTO ....");
	});
});

```

# License

Apache 2.0 