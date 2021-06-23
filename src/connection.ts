import { PoolClient } from "pg";
import stream from "stream";

//------------------------------------------------------------------------------

export interface FieldDef {
	name: string;
	tableID: number;
	columnID: number;
	dataTypeID: number;
	dataTypeSize: number;
	dataTypeModifier: number;
	format: string;
}

export interface QueryResultBase {
	command: string;
	rowCount: number;
	oid: number;
	fields: FieldDef[];
}

export interface QueryResultRow {
	[column: string]: any;
}

export interface QueryResult<R extends QueryResultRow = any> extends QueryResultBase {
	rows: R[];
}

export interface QueryArrayResult<R extends any[] = any[]> extends QueryResultBase {
	rows: R[];
}

/**
 * A set of options to pass to an INSERT query.
 *
 * @interface InsertOptions
 */
export interface InsertOptions {
	/**
	 * conflictAction: Optional action to take if the row being inserted already exists.
	 */
	conflictAction?: 'update' | 'ignore';

	/**
	 * conflictKeys: Optional array of keys containing the columns to evaluate.
	 */
	conflictKeys?: string[];

	/**
	 * returning: Optional values to return upon the execution of the query.
	 */
	returning?: ReturningOptions[];
}

enum ConflictAction {
	None = 0,
	Ignore = 1,
	Update = 2
}

/**
 * A set of options to pass to an UPDATE query.
 *
 * @interface UpdateOptions
 */
export interface UpdateOptions {
	/**
	 * returning: Optional values to return upon the execution of the query.
	 */
	returning?: ReturningOptions[];
}

/**
 * A set of options to pass to a DELETE query.
 *
 * @interface DeleteOptions
 */
export interface DeleteOptions {
	/**
	 * returning: Optional values to return upon the execution of the query.
	 */
	returning?: ReturningOptions[];
}

/**
 * A set of conditionals of a WHERE clause.
 *
 * @type WhereClause
 */
export type WhereClause = Record<string, WhereCondition | any>;

/**
 * A conditional that is part of a WHERE clause.
 *
 * @interface WhereCondition
 */
export interface WhereCondition {
	/**
	 * value: The value to check.
	 */
	value: any;

	/**
	 * operator: The conditional operator to use in evaluation.
	 */
	operator: WhereConditionOperator;

	/**
	 * returning: Optional upper limit to use for the BETWEEN operator.
	 */
	betweenUpperValue?: any;
}

/**
 * Operators that can be used in a conditional evaluation.
 *
 * @enum WhereConditionOperator
 */
export enum WhereConditionOperator {
	Equal = 0, NotEqual, Less, LessOrEqual, Greater, GreaterOrEqual, Between
}

/**
 * A set of items to return upon query completion.
 *
 * @interface ReturningOptions
 */
export interface ReturningOptions {
	/**
	 * expression: Value, field or expression to return.
	 */
	expression: string;

	/**
	 * as: Optional name to use when the expression is a formula.
	 */
	as?: string;
}

export type WithTxCallback<Result = any, CallbackParam = any> = (conn: Connection, param?: CallbackParam) => Promise<Result> | Result;

type ConnectionReleaseFn = (client: PoolClient, err?: boolean | Error | undefined) => void;

/**
 * Class representing a Postgres connection wrapper.
 *
 * @class Connection
 */
export class Connection {
	/** @internal */
	private client: PoolClient;
	/** @internal */
	private releaseFn: ConnectionReleaseFn;

	/**
	 * @internal
	 * @constructor
	 * @param {PoolClient} client - Postgres connection this wrapper will handle.
	 * @param {ConnectionReleaseFn} releaseFn - A callback to call when this wrapper is released.
	 */
	private constructor(client: PoolClient, releaseFn: ConnectionReleaseFn) {
		this.client = client;
		this.releaseFn = releaseFn;
	}

	/**
	 * @internal
	 * @param {PoolClient} client - Postgres connection to wrap.
	 * @param {ConnectionReleaseFn} releaseFn - A callback to call when the wrapper is released.
	 * @returns {Connection} Returns the connection wrapper.
	 */
	static create(client: PoolClient, releaseFn: ConnectionReleaseFn): Connection {
		const conn = new Connection(client, releaseFn);
		return conn;
	}

	/**
	 * @param {Error | boolean} err - An optional error condition to inform.
	 * @returns {void}
	 */
	release(err?: Error | boolean): void {
		this.releaseFn(this.client, err);
	}

	/**
	 * @param {string} sql - SQL sentence to execute.
	 * @param {any[]} values - Optional parameterized values to bind.
	 * @returns {Promise<QueryResult<R>>} Returns a promise with the result of the query.
	 */
	async query<R extends QueryResultRow = any, I extends any[] = any[]>(sql: string, values?: I): Promise<QueryResult<R>> {
		const res = await this.client.query<R, I>(sql, values);
		return res;
	}

	/**
	 * @param {string} tableName - The target table of the INSERT operation.
	 * @param {Record<string, any>} values - An object containing the row values to insert.
	 * @param {InsertOptions} options - Optional insertion options.
	 * @returns {Promise<QueryResult<R>>} Returns a promise with the result of the query.
	 */
	insert<R extends QueryResultRow = any>(
		tableName: string,
		values: Record<string, any>,
		options?: InsertOptions
	): Promise<QueryResult<R>> {
		const sql: string[] = [];
		const params: any[] = [];

		// Parse conflict action
		let conflictAction = ConflictAction.None;
		if (options) {
			if (options.conflictAction === 'update') {
				conflictAction = ConflictAction.Update;
			}
			else if (options.conflictAction === 'ignore') {
				conflictAction = ConflictAction.Ignore;
			}
		}

		// Parse values and classify those involved in a conflict for check/upsert
		const columns: string[] = [];
		const columnValues: string[] = [];

		const conflictColumns: string[] = [];
		const upsertColumns: string[] = [];

		for (const columnName in values) {
			if (Object.prototype.hasOwnProperty.call(values, columnName)) {
				const sanitizedColumnName = this.client.escapeIdentifier(columnName);

				columns.push(sanitizedColumnName);

				if (!(typeof values[columnName] === 'object' && typeof values[columnName].raw === 'string')) {
					params.push(values[columnName]);

					columnValues.push("$" + params.length.toString());

					switch (conflictAction) {
						case ConflictAction.Ignore:
							if (options!.conflictKeys!.includes(columnName)) {
								conflictColumns.push(sanitizedColumnName);
							}
							break;

						case ConflictAction.Update:
							if (options!.conflictKeys!.includes(columnName)) {
								conflictColumns.push(sanitizedColumnName);
							}
							else {
								upsertColumns.push(sanitizedColumnName + " = $" + params.length.toString());
							}
							break;
					}
				}
				else {
					columnValues.push(values[columnName].raw);

					switch (conflictAction) {
						case ConflictAction.Ignore:
							if (options!.conflictKeys!.includes(columnName)) {
								conflictColumns.push(sanitizedColumnName);
							}
							break;

						case ConflictAction.Update:
							if (options!.conflictKeys!.includes(columnName)) {
								conflictColumns.push(sanitizedColumnName);
							}
							else {
								upsertColumns.push(sanitizedColumnName + " = " + values[columnName].raw);
							}
							break;
					}
				}
			}
		}

		// Write the initial part of the SQL sentence
		sql.push("INSERT INTO " + this.client.escapeIdentifier(tableName) + " (");
		sql.push(columns.join(", "));
		sql.push(") VALUES (");
		sql.push(columnValues.join(", "));

		// Check if we must handle the curse of action on conflicts
		if (conflictAction == ConflictAction.Ignore || conflictAction == ConflictAction.Update) {
			sql.push(") ON CONFLICT (");
			sql.push(conflictColumns.join(","));

			switch (conflictAction) {
				case ConflictAction.Ignore:
					sql.push(") DO NOTHING");
					break;

				case ConflictAction.Update:
					sql.push(") DO UPDATE SET ");
					sql.push(upsertColumns.join(", "));
					break;
			}
		}
		else {
			sql.push(")");
		}

		// Add returning values if specified
		this.addReturningToSQL(sql, options ? options.returning : undefined);

		// Execute query
		return this.query<R>(sql.join(""), params);
	}

	/**
	 * @param {string} tableName - The target table of the UPDATE operation.
	 * @param {Record<string, any>} values - An object containing the values to update.
	 * @param {WhereClause} where - Optional set of conditions to match rows to update.
	 * @param {UpdateOptions} options - Optional update options.
	 * @returns {Promise<QueryResult<R>>} Returns a promise with the result of the query.
	 */
	update<R extends QueryResultRow = any>(
		tableName: string,
		values: Record<string, any>,
		where?: WhereClause,
		options?: UpdateOptions
	): Promise<QueryResult<R>> {
		const sql: string[] = [];
		const params: any[] = [];

		// Parse values
		const columnValues: string[] = [];

		for (const columnName in values) {
			if (Object.prototype.hasOwnProperty.call(values, columnName)) {
				const sanitizedColumnName = this.client.escapeIdentifier(columnName);

				if (!(typeof values[columnName] === 'object' && typeof values[columnName].raw === 'string')) {
					params.push(values[columnName]);

					columnValues.push(sanitizedColumnName + " = $" + params.length.toString());
				}
				else {
					columnValues.push(sanitizedColumnName + " = " + values[columnName].raw);
				}
			}
		}

		// Write the initial part of the SQL sentence
		sql.push("UPDATE " + this.client.escapeIdentifier(tableName) + " SET ");
		sql.push(columnValues.join(", "));

		// Process update conditionals if specified
		this.addWhereToSQL(sql, params, where);

		// Add returning values if specified
		this.addReturningToSQL(sql, options ? options.returning : undefined);

		// Execute query
		return this.query<R>(sql.join(""), params);
	}

	/**
	 * @param {string} tableName - The target table of the DELETE operation.
	 * @param {WhereClause} where - Optional set of conditions to match rows to delete.
	 * @param {UpdateOptions} options - Optional delete options.
	 * @returns {Promise<QueryResult<R>>} Returns a promise with the result of the query.
	 */
	delete<R extends QueryResultRow = any>(
		tableName: string,
		where?: WhereClause,
		options?: DeleteOptions
	): Promise<QueryResult<R>> {
		const sql: string[] = [];
		const params: any[] = [];

		// Write the initial part of the SQL sentence
		sql.push("DELETE FROM " + this.client.escapeIdentifier(tableName));

		// Process update conditionals if specified
		this.addWhereToSQL(sql, params, where);

		// Add returning values if specified
		this.addReturningToSQL(sql, options ? options.returning : undefined);

		// Execute query
		return this.query<R>(sql.join(""), params);
	}

	/**
	 * @param {WithTxCallback<Result, CallbackParam>} cb - Callback to call within a transaction.
	 * @param {CallbackParam} cbParam - Optional custom parameter to send to the callback.
	 * @returns {Promise<Result>} A custom result retrieved during the execution of the transaction.
	 */
	async withTx<Result = any, CallbackParam = any>(cb: WithTxCallback<Result, CallbackParam>, cbParam?: CallbackParam): Promise<Result> {
		let res: any;

		await this.client.query("BEGIN");
		try {
			// eslint-disable-next-line callback-return
			res = await cb(this, cbParam);
			await this.client.query("COMMIT");
		}
		catch (err) {
			try {
				await this.client.query("ROLLBACK");
			}
			catch (err2) {
				// Keep ESLint happy
			}
			// Rethrow original error
			throw err;
		}
		return res;
	}

	copyFrom(queryText: string): stream.Writable {
		return this.client.copyFrom(queryText);
	}

	copyTo(queryText: string): stream.Readable {
		return this.client.copyTo(queryText);
	}

	escapeIdentifier(str: string): string {
		return this.client.escapeIdentifier(str);
	}

	escapeLiteral(str: string): string {
		return this.client.escapeLiteral(str);
	}

	private addWhereToSQL(sql: string[], params: any[], where?: WhereClause) {
		if (where) {
			const conditions: string[] = [];

			for (const whereItem in where) {
				if (Object.prototype.hasOwnProperty.call(where, whereItem)) {
					const sanitizedColumnName = this.client.escapeIdentifier(whereItem);

					if (typeof where[whereItem] === "object" &&
							(where[whereItem] as WhereCondition).value != null &&
							(where[whereItem] as WhereCondition).operator != null) {
						params.push((where[whereItem] as WhereCondition).value);

						switch ((where[whereItem] as WhereCondition).operator) {
							case WhereConditionOperator.Equal:
								conditions.push(sanitizedColumnName + " = $" + params.length.toString());
								break;

							case WhereConditionOperator.NotEqual:
								conditions.push(sanitizedColumnName + " <> $" + params.length.toString());
								break;

							case WhereConditionOperator.Less:
								conditions.push(sanitizedColumnName + " < $" + params.length.toString());
								break;

							case WhereConditionOperator.LessOrEqual:
								conditions.push(sanitizedColumnName + " <= $" + params.length.toString());
								break;

							case WhereConditionOperator.Greater:
								conditions.push(sanitizedColumnName + " > $" + params.length.toString());
								break;

							case WhereConditionOperator.GreaterOrEqual:
								conditions.push(sanitizedColumnName + " >= $" + params.length.toString());
								break;

							case WhereConditionOperator.Between:
								params.push((where[whereItem] as WhereCondition).betweenUpperValue);

								conditions.push(sanitizedColumnName + " BETWEEN $" + (params.length - 1).toString() +
									" AND $" + params.length.toString());
								break;
						}
					}
					else {
						params.push(where[whereItem]);

						conditions.push(sanitizedColumnName + " = $" + params.length.toString());
					}
				}
			}
			sql.push(" WHERE ");
			sql.push(conditions.join(", "));
		}
	}

	private addReturningToSQL(sql: string[], returning?: ReturningOptions[]) {
		if (returning) {
			const expressions: string[] = [];

			for (const item of returning) {
				let expr = item.expression;
				if (item.as) {
					expr += " AS " + this.client.escapeIdentifier(item.as);
				}
				expressions.push(expr);
			}

			sql.push(" RETURNING ");
			sql.push(expressions.join(", "));
		}
	}
}
