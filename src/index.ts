//import { BigNumber } from "bignumber.js";
//import moment from "moment";
import { Pool, PoolClient } from "pg";
import { Connection, QueryResult, QueryResultRow } from "./connection";
import { registerParsers } from "./parser";

//------------------------------------------------------------------------------

export { Connection, QueryResult, QueryResultRow };

export type WithConnCallback<Result = any, CallbackParam = any> = (conn: Connection, param?: CallbackParam) => Promise<Result> | Result;

/**
 * Options to pass when the connection manager is created.
 *
 * @interface ManagerOptions
 */
export interface ManagerOptions {
	/**
	 * host: Server host to connect. Defaults to '127.0.0.1'.
	 */
	host?: string;

	/**
	 * port: Server port. Defaults to 5432.
	 */
	port?: number;

	/**
	 * user: User name to use when authenticating.
	 */
	user: string;

	/**
	 * password: Password to use when authenticating.
	 */
	password: string;

	/**
	 * database: Database to connect to.
	 */
	database: string;

	/**
	 * usePool: Establishes if a single connection or a pool will be used.
	 */
	usePool?: boolean;

	/**
	 * maxConnections: Maximum amount of connections to use when a pool is used.
	 */
	maxConnections?: number;
}

/**
 * Class representing a Postgres connection manager.
 *
 * @class Manager
 */
export class Manager {
	/** @internal */
	private pool: Pool | null;
	/** @internal */
	private singleConn: Connection | null;
	/** @internal */
	private usingSingleConnection: boolean;
	/** @internal */
	private bindedReleaseConnection: (client: PoolClient, err?: boolean | Error | undefined) => void;

	/**
	 * @constructor
	 * @param {ManagerOptions} options - A set of options to use to create the manager.
	 */
	constructor(options: ManagerOptions) {
		if (!options) {
			throw new Error("Error: Missing or invalid options");
		}

		let maxConnections = 2;
		if (options && options.usePool) {
			maxConnections = options.maxConnections ? options.maxConnections : 100;
			this.usingSingleConnection = false;
		}
		else {
			this.usingSingleConnection = true;
		}

		// eslint-disable-next-line require-atomic-updates
		this.pool = new Pool({
			host: options.host ? options.host : "127.0.0.1",
			port: options.port ? options.port : 5432,
			user: options.user,
			...(options.password != null && { password: options.password }),
			database: options.database,
			max: maxConnections,
			parseInputDatesAsUTC: true
		});
		this.singleConn = null;

		this.bindedReleaseConnection = this.releaseConnection.bind(this);

		registerParsers();
	}

	/**
	 * @returns {void}
	 */
	async shutdown(): Promise<void> {
		if (this.singleConn) {
			const c = this.singleConn;
			this.singleConn = null;

			try {
				c.release(new Error("shutting down"));
			}
			catch (err) {
				// Ignore errors
			}
		}
		if (this.pool) {
			const p = this.pool;
			this.pool = null;

			try {
				await p.end();
			}
			catch (err) {
				// Ignore errors
			}
		}
	}

	/**
	 * @returns {Promise<Connection>} A promise with a database connection.
	 */
	async getConnection(): Promise<Connection> {
		if (!this.usingSingleConnection) {
			const client = await this.pool!.connect();
			const conn = Connection.create(client, this.bindedReleaseConnection);
			return conn;
		}

		// Create single client connection if not created yet
		if (!this.singleConn) {
			const client = await this.pool!.connect();
			this.singleConn = Connection.create(client, this.bindedReleaseConnection);
			client.once("end", () => {
				this.singleConn = null;
			});
		}
		return this.singleConn;
	}

	/**
	 * @param {WithConnCallback<Result, CallbackParam>} cb - Callback to call after establishing a connection.
	 * @param {CallbackParam} cbParam - Optional custom parameter to send to the callback.
	 * @returns {Promise<Result>} A custom result retrieved during the execution within the connection.
	 */
	async withConnection<Result = any, CallbackParam = any>(
		cb: WithConnCallback<Result, CallbackParam>,
		cbParam?: CallbackParam
	): Promise<Result> {
		let res: any;

		const conn = await this.getConnection();
		try {
			res = await cb(conn, cbParam);
			conn.release();
		}
		catch (err) {
			conn.release(err);
			throw err;
		}
		return res;
	}

	/**
	 * @internal
	 * @param {PoolClient} client - Postgres' client to release.
	 * @param {Error | boolean} err - Optional error.
	 * @returns {void}
	 */
	private releaseConnection(client: PoolClient, err?: Error | boolean): void {
		if (this.usingSingleConnection) {
			if (err) {
				this.singleConn = null;
				client.release(err);
			}
		}
		else {
			client.release(err);
		}
	}
}

/**
 * @param {Error | boolean} err - Optional error object to check.
 * @returns {boolean} Returns true if the error is related to a networking issue.
 */
export function isNetworkError(err?: any): boolean {
	if (err && typeof err.code === "string") {
		switch (err.code) {
			case "ECONNREFUSED":
			case "ECONNRESET":
			case "ECONNABORTED":
			case "EHOSTUNREACH":
			case "EHOSTDOWN":
				return true;
		}
	}
	return false;
}
